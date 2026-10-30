import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  TextInput,
  Modal,
  Animated,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function TrackpadScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.5);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    const unsub = ConnectionService.on('connectionChanged', setIsConnected);
    return unsub;
  }, []);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    try {
      Haptics.impactAsync(style).catch(() => {});
    } catch (e) {}
  };

  const lastPan = useRef({ x: 0, y: 0 });
  const touchStartTime = useRef(0);
  const lastTapTime = useRef(0);
  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);
  const isTwoFingerGesture = useRef(false);

  // PanResponder for trackpad gestures
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > 1 || Math.abs(gestureState.dy) > 1;
    },
    onPanResponderGrant: (evt, gestureState) => {
      touchStartTime.current = Date.now();
      lastPan.current = { x: 0, y: 0 };
      longPressTriggered.current = false;

      const touchCount = evt.nativeEvent.touches ? evt.nativeEvent.touches.length : 1;
      isTwoFingerGesture.current = touchCount >= 2;

      // Start long-press timer for right click if single finger
      if (!isTwoFingerGesture.current) {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = setTimeout(() => {
          longPressTriggered.current = true;
          ConnectionService.send('mouse:click', { button: 'right' });
          triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
        }, 500);
      }
    },
    onPanResponderMove: (evt, gestureState) => {
      const touchCount = evt.nativeEvent.touches ? evt.nativeEvent.touches.length : 1;

      // Cancel long press if movement exceeds threshold
      if (Math.abs(gestureState.dx) > 8 || Math.abs(gestureState.dy) > 8) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      if (touchCount >= 2 || isTwoFingerGesture.current) {
        // Two-finger scroll
        const dy = gestureState.dy - lastPan.current.y;
        if (Math.abs(dy) > 4) {
          const scrollDir = dy > 0 ? 1 : -1;
          ConnectionService.send('mouse:scroll', { dy: scrollDir, dx: 0 });
          lastPan.current = { x: gestureState.dx, y: gestureState.dy };
        }
      } else {
        // Single-finger cursor move
        const deltaX = (gestureState.dx - lastPan.current.x) * sensitivity;
        const deltaY = (gestureState.dy - lastPan.current.y) * sensitivity;

        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          ConnectionService.sendFastInput('m', Math.round(deltaX), Math.round(deltaY));
        }
        lastPan.current = { x: gestureState.dx, y: gestureState.dy };
      }
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      if (longPressTriggered.current) {
        return;
      }

      const duration = Date.now() - touchStartTime.current;
      const isTap = Math.abs(gestureState.dx) < 8 && Math.abs(gestureState.dy) < 8 && duration < 280;

      if (isTap) {
        const now = Date.now();
        if (now - lastTapTime.current < 320) {
          // Double click
          ConnectionService.send('mouse:doubleclick', {});
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          lastTapTime.current = 0;
        } else {
          // Single left click
          ConnectionService.send('mouse:click', { button: 'left' });
          triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
          lastTapTime.current = now;
        }
      }
    },
    onPanResponderTerminate: () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }), [sensitivity]);

  const handleMouseClick = (button) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.send('mouse:click', { button });
  };

  const handleScroll = (direction) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.send('mouse:scroll', { dy: direction === 'up' ? -1 : 1, dx: 0 });
  };

  const handleSendKey = (key, modifiers = []) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.send('key:press', { key, modifiers });
  };

  const handleTypeChange = (text) => {
    if (text.length > inputText.length) {
      const addedChar = text.slice(inputText.length);
      ConnectionService.send('key:type', { text: addedChar });
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    } else if (text.length < inputText.length) {
      ConnectionService.send('key:press', { key: 'backspace' });
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    }
    setInputText(text);
  };

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={54} color="#facc15" />
        <Text style={styles.disconnectedTitle}>Not Connected</Text>
        <Text style={styles.disconnectedText}>Connect to your PC first to use the trackpad</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Trackpad</Text>
          <Text style={styles.subtitle}>Touch &amp; gesture control</Text>
        </View>

        <View style={styles.headerActions}>
          {/* Sensitivity cycle */}
          <TouchableOpacity
            style={styles.sensitivityBadge}
            onPress={() => {
              triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
              setSensitivity(s => s === 1 ? 1.5 : s === 1.5 ? 2.2 : 1);
            }}
          >
            <Text style={styles.sensitivityText}>{sensitivity}x</Text>
          </TouchableOpacity>

          {/* Keyboard toggle */}
          <TouchableOpacity
            style={[styles.headerBtn, isKeyboardVisible && styles.headerBtnActive]}
            onPress={() => {
              triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
              setKeyboardVisible(!isKeyboardVisible);
            }}
          >
            <Ionicons name="keypad" size={20} color="#f1f5f9" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Trackpad Area */}
      <View style={styles.trackpadArea} {...panResponder.panHandlers}>
        <View style={styles.trackpadCenterHint}>
          <Ionicons name="finger-print-outline" size={56} color="rgba(250, 204, 21, 0.25)" />
          <Text style={styles.trackpadHintText}>Tap: Click  •  Double Tap: Select</Text>
          <Text style={styles.trackpadSubHintText}>Two Fingers: Scroll  •  Hold: Right Click</Text>
        </View>
      </View>

      {/* Mouse Buttons & Scroll Bar */}
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={styles.mouseButton}
          activeOpacity={0.7}
          onPress={() => handleMouseClick('left')}
        >
          <Ionicons name="radio-button-on" size={18} color="#facc15" style={{ marginBottom: 4 }} />
          <Text style={styles.buttonText}>Left Click</Text>
        </TouchableOpacity>

        {/* Scroll wheel */}
        <View style={styles.scrollArea}>
          <TouchableOpacity
            onPress={() => handleScroll('up')}
            style={styles.scrollBtn}
            hitSlop={{ top: 10, bottom: 5, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-up" size={20} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.scrollDivider} />
          <TouchableOpacity
            onPress={() => handleScroll('down')}
            style={styles.scrollBtn}
            hitSlop={{ top: 5, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-down" size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.mouseButton}
          activeOpacity={0.7}
          onPress={() => handleMouseClick('right')}
        >
          <Ionicons name="ellipsis-horizontal-circle" size={18} color="#ffffff" style={{ marginBottom: 4 }} />
          <Text style={styles.buttonText}>Right Click</Text>
        </TouchableOpacity>
      </View>

      {/* Virtual Keyboard Modal / Overlay */}
      <Modal
        visible={isKeyboardVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setKeyboardVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.keyboardCard}>
            <View style={styles.keyboardHeader}>
              <Text style={styles.keyboardTitle}>Remote Keyboard</Text>
              <TouchableOpacity
                onPress={() => setKeyboardVisible(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Live Typing Input */}
            <TextInput
              style={styles.typingInput}
              placeholder="Type here to send directly to PC..."
              placeholderTextColor="#64748b"
              value={inputText}
              onChangeText={handleTypeChange}
              autoFocus={true}
              multiline={false}
              autoCorrect={false}
              autoCapitalize="none"
            />

            {/* Quick keys row */}
            <View style={styles.quickKeysGrid}>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('enter')}>
                <Text style={styles.quickKeyText}>Enter ↵</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('backspace')}>
                <Text style={styles.quickKeyText}>⌫ Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('space')}>
                <Text style={styles.quickKeyText}>Space</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('escape')}>
                <Text style={styles.quickKeyText}>Esc</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('tab')}>
                <Text style={styles.quickKeyText}>Tab ⇥</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('c', ['control'])}>
                <Text style={styles.quickKeyText}>Ctrl+C</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('v', ['control'])}>
                <Text style={styles.quickKeyText}>Ctrl+V</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickKey} onPress={() => handleSendKey('z', ['control'])}>
                <Text style={styles.quickKeyText}>Ctrl+Z</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  disconnectedContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  disconnectedTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 8,
  },
  disconnectedText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sensitivityBadge: {
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    borderWidth: 1,
    borderColor: '#facc15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sensitivityText: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: '800',
  },
  headerBtn: {
    padding: 8,
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  headerBtnActive: {
    backgroundColor: '#facc15',
    borderColor: '#facc15',
  },
  trackpadArea: {
    flex: 1,
    backgroundColor: '#111111',
    margin: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackpadCenterHint: {
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  trackpadHintText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    letterSpacing: 0.2,
  },
  trackpadSubHintText: {
    color: 'rgba(250, 204, 21, 0.6)',
    fontSize: 11,
    marginTop: 4,
  },
  buttonsRow: {
    flexDirection: 'row',
    height: 84,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  mouseButton: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollArea: {
    width: 54,
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  scrollBtn: {
    padding: 6,
  },
  scrollDivider: {
    width: 24,
    height: 2,
    backgroundColor: '#facc15',
    borderRadius: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  keyboardCard: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#facc15',
  },
  keyboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  keyboardTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  typingInput: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#facc15',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
    marginBottom: 16,
  },
  quickKeysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  quickKey: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  quickKeyText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
