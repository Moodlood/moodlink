import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';

export default function TrackpadScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  React.useEffect(() => {
    const unsub = ConnectionService.on('connectionChanged', setIsConnected);
    return unsub;
  }, []);

  const lastPan = React.useRef({ x: 0, y: 0 });

  // Trackpad gesture handling
  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      lastPan.current = { x: 0, y: 0 };
    },
    onPanResponderMove: (evt, gestureState) => {
      const dx = gestureState.dx - lastPan.current.x;
      const dy = gestureState.dy - lastPan.current.y;
      
      ConnectionService.send('mouse:move', { dx, dy });
      
      lastPan.current = { x: gestureState.dx, y: gestureState.dy };
    },
    onPanResponderRelease: (evt, gestureState) => {
      // Tap detection (if movement was minimal and quick)
      if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5 && gestureState.duration < 200) {
        ConnectionService.send('mouse:click', { button: 'left' });
      }
    }
  }), []);

  const handleMouseClick = (button) => {
    ConnectionService.send('mouse:click', { button });
  };

  const handleScroll = (direction) => {
    ConnectionService.send('mouse:scroll', { dy: direction === 'up' ? -1 : 1 });
  };

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={48} color="#475569" />
        <Text style={styles.disconnectedText}>Connect to PC first</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trackpad</Text>
        <TouchableOpacity style={styles.keyboardBtn}>
          <Ionicons name="keypad" size={24} color="#f1f5f9" />
        </TouchableOpacity>
      </View>

      {/* The main trackpad area */}
      <View 
        style={styles.trackpadArea}
        {...panResponder.panHandlers}
      >
        <Ionicons name="scan-outline" size={64} color="rgba(255,255,255,0.05)" style={styles.trackpadIcon} />
      </View>

      {/* Mouse Buttons */}
      <View style={styles.buttonsRow}>
        <TouchableOpacity 
          style={styles.mouseButton}
          onPress={() => handleMouseClick('left')}
        >
          <Text style={styles.buttonText}>Left Click</Text>
        </TouchableOpacity>
        
        {/* Scroll wheel simulation */}
        <View style={styles.scrollArea}>
          <TouchableOpacity onPress={() => handleScroll('up')} style={styles.scrollBtn}>
            <Ionicons name="chevron-up" size={24} color="#94a3b8" />
          </TouchableOpacity>
          <View style={styles.scrollDivider} />
          <TouchableOpacity onPress={() => handleScroll('down')} style={styles.scrollBtn}>
            <Ionicons name="chevron-down" size={24} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.mouseButton}
          onPress={() => handleMouseClick('right')}
        >
          <Text style={styles.buttonText}>Right Click</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  disconnectedContainer: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectedText: {
    color: '#94a3b8',
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  keyboardBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
  },
  trackpadArea: {
    flex: 1,
    backgroundColor: '#12121a',
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackpadIcon: {
    position: 'absolute',
  },
  buttonsRow: {
    flexDirection: 'row',
    height: 100,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  mouseButton: {
    flex: 1,
    backgroundColor: '#12121a',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  buttonText: {
    color: '#94a3b8',
    fontWeight: '500',
  },
  scrollArea: {
    width: 60,
    backgroundColor: '#12121a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  scrollBtn: {
    padding: 8,
  },
  scrollDivider: {
    width: 30,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
  }
});
