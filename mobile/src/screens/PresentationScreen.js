import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Dimensions } from 'react-native';
import { Gyroscope } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import ConnectionService from '../services/ConnectionService';

const { width, height } = Dimensions.get('window');

export default function PresentationScreen() {
  const [laserActive, setLaserActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [notes, setNotes] = useState('');
  
  // Gyroscope cursor positioning (useRef to avoid re-render lag)
  const posRef = useRef({ x: 960, y: 540 });

  useEffect(() => {
    let interval;
    if (timerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    Gyroscope.setUpdateInterval(32); // ~30fps
    const sub = Gyroscope.addListener(data => {
      if (!laserActive) return;
      
      const dx = data.z * -100;
      const dy = data.x * -100;
      
      const newX = Math.max(0, Math.min(1920, posRef.current.x + dx));
      const newY = Math.max(0, Math.min(1080, posRef.current.y + dy));
      
      posRef.current = { x: newX, y: newY };
      ConnectionService.send('laser:move', { x: newX, y: newY, visible: true });
    });

    return () => {
      sub.remove();
      ConnectionService.send('laser:move', { x: 0, y: 0, visible: false });
    };
  }, [laserActive]);

  const toggleLaser = () => {
    const next = !laserActive;
    setLaserActive(next);
    if (!next) {
      ConnectionService.send('laser:move', { x: 0, y: 0, visible: false });
    }
  };

  const handleNext = () => ConnectionService.send('key:press', { key: 'right' });
  const handlePrev = () => ConnectionService.send('key:press', { key: 'left' });
  const toggleTimer = () => setTimerRunning(!timerRunning);
  const resetTimer = () => { setTimerRunning(false); setTimerSeconds(0); };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Top Timer Bar */}
      <View style={styles.timerBar}>
        <TouchableOpacity onPress={toggleTimer}>
          <Text style={styles.timerText}>{formatTime(timerSeconds)}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={resetTimer}>
          <Ionicons name="refresh" size={24} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* Laser Toggle */}
      <TouchableOpacity 
        style={[styles.laserBtn, laserActive && styles.laserBtnActive]} 
        onPress={toggleLaser}
      >
        <Ionicons name="flashlight" size={24} color="#fff" />
        <Text style={styles.laserText}>{laserActive ? 'Laser ON' : 'Laser OFF'}</Text>
      </TouchableOpacity>

      {/* Speaker Notes */}
      <View style={styles.notesContainer}>
        <Text style={styles.notesTitle}>Speaker Notes</Text>
        <TextInput
          style={styles.notesInput}
          multiline
          placeholder="Type your presentation notes here..."
          placeholderTextColor="#475569"
          value={notes}
          onChangeText={setNotes}
        />
      </View>

      {/* Slide Controls */}
      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.navBtn} onPress={handlePrev}>
          <Ionicons name="chevron-back" size={48} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtnPrimary} onPress={handleNext}>
          <Ionicons name="chevron-forward" size={64} color="#fff" />
          <Text style={styles.nextText}>NEXT</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    padding: 16,
  },
  timerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#12121a',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  timerText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#f1f5f9',
    fontVariant: ['tabular-nums'],
  },
  laserBtn: {
    backgroundColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  laserBtnActive: {
    backgroundColor: '#ef4444',
  },
  laserText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  notesContainer: {
    flex: 1,
    backgroundColor: '#12121a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  notesTitle: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  notesInput: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 18,
    lineHeight: 28,
    textAlignVertical: 'top',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 16,
    height: 120,
  },
  navBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnPrimary: {
    flex: 2,
    backgroundColor: '#6366f1',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  nextText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 8,
  }
});
