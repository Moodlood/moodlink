import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  PanResponder,
  ScrollView
} from 'react-native';
import { Gyroscope } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import ConnectionService from '../services/ConnectionService';
import * as Haptics from 'expo-haptics';

export default function PresentationScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [laserActive, setLaserActive] = useState(false);
  const [laserMode, setLaserMode] = useState('touch'); // 'touch' | 'gyro' | 'ink'
  const [inkColor, setInkColor] = useState('yellow'); // 'yellow' (1) | 'green' (2)
  const [clutchMode, setClutchMode] = useState(true); // true = Hold-to-aim clutch
  const [isClutchHeld, setIsClutchHeld] = useState(false);
  const [slideNumber, setSlideNumber] = useState(1);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [notes, setNotes] = useState('');
  const [gyroSensitivity, setGyroSensitivity] = useState(1); // 0.5 | 1 | 1.8

  const posRef = useRef({ x: 960, y: 540 }); // Center of 1920x1080
  const isClutchHeldRef = useRef(false);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    try {
      Haptics.impactAsync(style).catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    const unsub = ConnectionService.on('connectionChanged', setIsConnected);
    return unsub;
  }, []);

  // Timer interval
  useEffect(() => {
    let interval;
    if (timerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Gyroscope tracking with Drift-Compensation Clutch
  useEffect(() => {
    if (laserMode !== 'gyro') return;
    if (!clutchMode && !laserActive) return;

    let sub;
    try {
      Gyroscope.setUpdateInterval(30); // ~33fps
      sub = Gyroscope.addListener(data => {
        // Only stream coordinates if clutch is held down (or if always-on is toggled)
        if (clutchMode && !isClutchHeldRef.current) return;
        if (!clutchMode && !laserActive) return;

        const mult = -85 * gyroSensitivity;
        const dx = data.z * mult;
        const dy = data.x * mult;

        const newX = Math.max(0, Math.min(1920, posRef.current.x + dx));
        const newY = Math.max(0, Math.min(1080, posRef.current.y + dy));

        posRef.current = { x: newX, y: newY };

        // Sub-10ms fast input channel
        ConnectionService.sendFastInput('l', (newX / 1920).toFixed(4), (newY / 1080).toFixed(4), true);
      });
    } catch (e) {
      console.warn('Gyroscope error:', e);
    }

    return () => {
      if (sub) sub.remove();
      ConnectionService.sendFastInput('l', 0, 0, false);
    };
  }, [laserActive, laserMode, gyroSensitivity, clutchMode]);

  // PanResponder for Touch Pad Laser & Screen Ink Annotation
  const padPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      const { locationX, locationY } = evt.nativeEvent;
      const rx = Math.max(0, Math.min(1, locationX / 300));
      const ry = Math.max(0, Math.min(1, locationY / 160));
      posRef.current = { x: rx * 1920, y: ry * 1080 };

      if (laserMode === 'ink') {
        const colNum = inkColor === 'yellow' ? 1 : 2;
        ConnectionService.sendFastInput('ink', 'point', rx.toFixed(4), ry.toFixed(4), 1, colNum);
      } else {
        ConnectionService.sendFastInput('l', rx.toFixed(4), ry.toFixed(4), true);
      }
    },
    onPanResponderMove: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      const rx = Math.max(0, Math.min(1, locationX / 300));
      const ry = Math.max(0, Math.min(1, locationY / 160));
      posRef.current = { x: rx * 1920, y: ry * 1080 };

      if (laserMode === 'ink') {
        const colNum = inkColor === 'yellow' ? 1 : 2;
        ConnectionService.sendFastInput('ink', 'point', rx.toFixed(4), ry.toFixed(4), 0, colNum);
      } else {
        ConnectionService.sendFastInput('l', rx.toFixed(4), ry.toFixed(4), true);
      }
    },
    onPanResponderRelease: () => {
      if (laserMode !== 'ink') {
        ConnectionService.sendFastInput('l', 0, 0, false);
      }
    }
  }), [laserMode, inkColor]);

  const handleClutchIn = () => {
    isClutchHeldRef.current = true;
    setIsClutchHeld(true);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    posRef.current = { x: 960, y: 540 };
    ConnectionService.sendFastInput('l', 0.5, 0.5, true);
  };

  const handleClutchOut = () => {
    isClutchHeldRef.current = false;
    setIsClutchHeld(false);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.sendFastInput('l', 0, 0, false);
  };

  const toggleLaser = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    const next = !laserActive;
    setLaserActive(next);
    if (!next) {
      ConnectionService.sendFastInput('l', 0, 0, false);
    } else {
      posRef.current = { x: 960, y: 540 };
      ConnectionService.sendFastInput('l', 0.5, 0.5, true);
    }
  };

  const calibrateLaser = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    posRef.current = { x: 960, y: 540 };
    ConnectionService.sendFastInput('l', 0.5, 0.5, true);
  };

  const handleClearInk = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    ConnectionService.sendFastInput('ink', 'clear');
  };

  const handleNext = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    ConnectionService.send('key:press', { key: 'right' });
    setSlideNumber(s => s + 1);
  };

  const handlePrev = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    ConnectionService.send('key:press', { key: 'left' });
    setSlideNumber(s => Math.max(1, s - 1));
  };

  const handleStartShow = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    ConnectionService.send('key:press', { key: 'f5' });
    setSlideNumber(1);
    if (!timerRunning) setTimerRunning(true);
  };

  const handleEndShow = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    ConnectionService.send('key:press', { key: 'escape' });
    if (laserActive) toggleLaser();
  };

  const handleBlackScreen = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.send('key:press', { key: 'b' });
  };

  const handleWhiteScreen = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    ConnectionService.send('key:press', { key: 'w' });
  };

  const toggleTimer = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    setTimerRunning(!timerRunning);
  };

  const resetTimer = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    setTimerRunning(false);
    setTimerSeconds(0);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={54} color="#facc15" />
        <Text style={styles.disconnectedTitle}>Not Connected</Text>
        <Text style={styles.disconnectedText}>
          Connect to your PC first to use the presentation remote and laser pointer
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 30 }}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Presentation Remote</Text>
          <Text style={styles.subtitle}>Slide controls, laser pointer &amp; speaker notes</Text>
        </View>

        {/* Slide Counter */}
        <View style={styles.slideCounterBadge}>
          <Text style={styles.slideCounterText}>Slide {slideNumber}</Text>
        </View>
      </View>

      {/* Top Bar: Timer & Quick Slide Actions */}
      <View style={styles.topCard}>
        <View style={styles.timerSection}>
          <TouchableOpacity onPress={toggleTimer} style={styles.timerDisplay}>
            <Ionicons
              name={timerRunning ? "pause-circle" : "play-circle"}
              size={24}
              color={timerRunning ? "#22c55e" : "#94a3b8"}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.timerText}>{formatTime(timerSeconds)}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={resetTimer} style={styles.resetBtn}>
            <Ionicons name="refresh" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        <View style={styles.showActionsRow}>
          <TouchableOpacity style={styles.actionPill} onPress={handleStartShow}>
            <Ionicons name="play" size={14} color="#22c55e" />
            <Text style={styles.actionPillText}>Start (F5)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionPill} onPress={handleEndShow}>
            <Ionicons name="stop" size={14} color="#ffffff" />
            <Text style={styles.actionPillText}>Exit (Esc)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionPill} onPress={handleBlackScreen}>
            <Ionicons name="contrast-outline" size={14} color="#94a3b8" />
            <Text style={styles.actionPillText}>Black (B)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionPill} onPress={handleWhiteScreen}>
            <Ionicons name="sunny-outline" size={14} color="#94a3b8" />
            <Text style={styles.actionPillText}>White (W)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Laser & Annotation Section */}
      <View style={styles.laserCard}>
        <View style={styles.laserHeader}>
          <View style={styles.laserTitleRow}>
            <View style={[styles.laserDot, (laserActive || isClutchHeld || laserMode !== 'gyro') && styles.laserDotActive]} />
            <Text style={styles.laserCardTitle}>
              {laserMode === 'ink' ? 'Screen Annotation Ink' : 'Laser Pointer'}
            </Text>
          </View>

          {/* 3-Mode switch */}
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[styles.modeBtn, laserMode === 'touch' && styles.modeBtnActive]}
              onPress={() => { setLaserMode('touch'); triggerHaptic(); }}
            >
              <Text style={[styles.modeBtnText, laserMode === 'touch' && styles.modeBtnTextActive]}>Touch</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, laserMode === 'gyro' && styles.modeBtnActive]}
              onPress={() => { setLaserMode('gyro'); triggerHaptic(); }}
            >
              <Text style={[styles.modeBtnText, laserMode === 'gyro' && styles.modeBtnTextActive]}>Air Motion</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, laserMode === 'ink' && styles.modeBtnActive]}
              onPress={() => { setLaserMode('ink'); triggerHaptic(); }}
            >
              <Text style={[styles.modeBtnText, laserMode === 'ink' && styles.modeBtnTextActive]}>Ink Pen</Text>
            </TouchableOpacity>
          </View>
        </View>

        {laserMode === 'touch' && (
          /* Interactive Touch Pad Laser */
          <View style={styles.touchLaserPad} {...padPanResponder.panHandlers}>
            <Ionicons name="finger-print" size={36} color="rgba(34, 197, 94, 0.5)" />
            <Text style={styles.touchLaserHint}>Drag finger here to aim laser on PC screen</Text>
            <Text style={styles.touchLaserSubHint}>Laser is active while touching</Text>
          </View>
        )}

        {laserMode === 'ink' && (
          /* Screen Annotation Drawing Pad */
          <View>
            <View style={[styles.touchLaserPad, styles.inkPadBorder]} {...padPanResponder.panHandlers}>
              <Ionicons name="pencil" size={36} color={inkColor === 'yellow' ? "#facc15" : "#22c55e"} />
              <Text style={styles.touchLaserHint}>Draw annotations directly on your presentation</Text>
              <Text style={styles.touchLaserSubHint}>Strokes fade smoothly over 3.5 seconds on PC</Text>
            </View>

            {/* Ink options */}
            <View style={styles.inkControlsRow}>
              <View style={styles.inkColorPicker}>
                <TouchableOpacity
                  style={[styles.colorChip, inkColor === 'yellow' && styles.colorChipSelectedYellow]}
                  onPress={() => { setInkColor('yellow'); triggerHaptic(); }}
                >
                  <View style={[styles.chipInner, { backgroundColor: '#facc15' }]} />
                  <Text style={[styles.chipText, inkColor === 'yellow' && { color: '#facc15' }]}>Yellow</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.colorChip, inkColor === 'green' && styles.colorChipSelectedGreen]}
                  onPress={() => { setInkColor('green'); triggerHaptic(); }}
                >
                  <View style={[styles.chipInner, { backgroundColor: '#22c55e' }]} />
                  <Text style={[styles.chipText, inkColor === 'green' && { color: '#22c55e' }]}>Green</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.clearInkBtn} onPress={handleClearInk}>
                <Ionicons name="trash-outline" size={16} color="#ffffff" />
                <Text style={styles.clearInkText}>Clear Ink</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {laserMode === 'gyro' && (
          /* Gyroscope Air Motion Mode with Clutch */
          <View style={styles.gyroControls}>
            {clutchMode ? (
              /* Zero-Drift Clutch: Hold to Aim */
              <TouchableOpacity
                style={[styles.clutchBtn, isClutchHeld && styles.clutchBtnActive]}
                activeOpacity={0.85}
                onPressIn={handleClutchIn}
                onPressOut={handleClutchOut}
              >
                <Ionicons
                  name={isClutchHeld ? "radio-button-on" : "locate"}
                  size={26}
                  color={isClutchHeld ? "#000000" : "#facc15"}
                />
                <View>
                  <Text style={[styles.clutchTitle, isClutchHeld && { color: '#000000' }]}>
                    {isClutchHeld ? 'AIMING ACTIVE (POINT PHONE)' : 'HOLD TO AIM (CLUTCH)'}
                  </Text>
                  <Text style={[styles.clutchSubtitle, isClutchHeld && { color: 'rgba(0,0,0,0.8)' }]}>
                    {isClutchHeld ? 'Release thumb to stop & lock laser' : 'Press & hold while pointing to eliminate drift'}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              /* Always-On Toggle */
              <TouchableOpacity
                style={[styles.laserToggleBtn, laserActive && styles.laserToggleBtnActive]}
                onPress={toggleLaser}
              >
                <Ionicons name="flashlight" size={20} color="#ffffff" />
                <Text style={styles.laserToggleText}>
                  {laserActive ? 'Air Laser ON (Point Phone)' : 'Turn On Air Laser'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.gyroSubControls}>
              <TouchableOpacity
                style={styles.calibrateBtn}
                onPress={() => { setClutchMode(!clutchMode); triggerHaptic(); }}
              >
                <Ionicons name="switch-outline" size={16} color="#94a3b8" />
                <Text style={styles.calibrateText}>{clutchMode ? 'Mode: Clutch' : 'Mode: Always-On'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.calibrateBtn} onPress={calibrateLaser}>
                <Ionicons name="locate-outline" size={16} color="#94a3b8" />
                <Text style={styles.calibrateText}>Center</Text>
              </TouchableOpacity>

              <View style={styles.sensitivityGroup}>
                <Text style={styles.sensLabel}>Speed:</Text>
                {[0.5, 1, 1.8].map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.sensBtn, gyroSensitivity === s && styles.sensBtnActive]}
                    onPress={() => { setGyroSensitivity(s); triggerHaptic(); }}
                  >
                    <Text style={[styles.sensText, gyroSensitivity === s && styles.sensTextActive]}>
                      {s === 0.5 ? 'Slow' : s === 1 ? 'Med' : 'Fast'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Main Slide Navigation Row */}
      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={styles.navBtnPrev}
          onPress={handlePrev}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={32} color="#ffffff" />
          <Text style={styles.prevText}>PREV</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navBtnNext}
          onPress={handleNext}
          activeOpacity={0.7}
        >
          <Text style={styles.nextText}>NEXT SLIDE</Text>
          <Ionicons name="chevron-forward" size={36} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Speaker Notes */}
      <View style={styles.notesContainer}>
        <View style={styles.notesHeader}>
          <Text style={styles.notesTitle}>Speaker Notes / Cues</Text>
          {notes.length > 0 && (
            <TouchableOpacity onPress={() => setNotes('')}>
              <Text style={styles.clearNotesText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <TextInput
          style={styles.notesInput}
          multiline
          placeholder="Jot down bullet points, key questions, or slide reminders..."
          placeholderTextColor="#475569"
          value={notes}
          onChangeText={setNotes}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
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
    fontWeight: '700',
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
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  slideCounterBadge: {
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    borderWidth: 1,
    borderColor: '#facc15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  slideCounterText: {
    color: '#facc15',
    fontWeight: '800',
    fontSize: 13,
  },
  topCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  timerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  timerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  resetBtn: {
    padding: 6,
    backgroundColor: '#1c1c1c',
    borderRadius: 8,
  },
  showActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161616',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  actionPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  laserCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  laserHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  laserTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  laserDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333333',
  },
  laserDotActive: {
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  laserCardTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#161616',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: '#facc15',
  },
  modeBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: '#000000',
    fontWeight: '700',
  },
  touchLaserPad: {
    height: 130,
    backgroundColor: '#050505',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(34, 197, 94, 0.4)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  inkPadBorder: {
    borderColor: 'rgba(250, 204, 21, 0.4)',
  },
  touchLaserHint: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  touchLaserSubHint: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  inkControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  inkColorPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161616',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  colorChipSelectedYellow: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250, 204, 21, 0.1)',
  },
  colorChipSelectedGreen: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  chipInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  clearInkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161616',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  clearInkText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  gyroControls: {
    gap: 12,
  },
  clutchBtn: {
    backgroundColor: '#161616',
    borderWidth: 2,
    borderColor: '#facc15',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    justifyContent: 'center',
  },
  clutchBtnActive: {
    backgroundColor: '#facc15',
    borderColor: '#facc15',
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
  clutchTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  clutchSubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  laserToggleBtn: {
    backgroundColor: '#1c1c1c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  laserToggleBtnActive: {
    backgroundColor: '#22c55e',
  },
  laserToggleText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  gyroSubControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calibrateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#161616',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  calibrateText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  sensitivityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sensLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginRight: 4,
  },
  sensBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#161616',
  },
  sensBtnActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    borderWidth: 1,
    borderColor: '#facc15',
  },
  sensText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  sensTextActive: {
    color: '#facc15',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    height: 90,
    marginBottom: 16,
  },
  navBtnPrev: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  prevText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
    marginTop: 4,
  },
  navBtnNext: {
    flex: 2,
    backgroundColor: '#facc15',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  nextText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  notesContainer: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 140,
  },
  notesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  notesTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  clearNotesText: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: '700',
  },
  notesInput: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 22,
    textAlignVertical: 'top',
    minHeight: 90,
  },
});
