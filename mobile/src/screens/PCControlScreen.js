import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';

export default function PCControlScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [volume, setVolume] = useState(50);
  const [sysInfo, setSysInfo] = useState(null);
  const [audioMixerApps, setAudioMixerApps] = useState([]);

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);
    
    const unsubVol = ConnectionService.on('volume:level', (data) => setVolume(data.level));
    const unsubVolChg = ConnectionService.on('volume:changed', (data) => setVolume(data.level));
    const unsubSys = ConnectionService.on('system:info:data', setSysInfo);
    const unsubAudio = ConnectionService.on('audio:mixer:data', setAudioMixerApps);
    
    if (ConnectionService.isConnected) {
      ConnectionService.send('volume:get');
      ConnectionService.send('system:info');
      ConnectionService.send('audio:mixer:get');
    }

    return () => {
      unsubConn();
      unsubVol();
      unsubVolChg();
      unsubSys();
      unsubAudio();
    };
  }, []);

  const handleVolumeChange = (value) => {
    const newVol = Math.round(value);
    setVolume(newVol);
    ConnectionService.send('volume:set', { level: newVol });
  };

  const handleMixerVolumeChange = (appName, value) => {
    const newVol = Math.round(value);
    setAudioMixerApps(prev => prev.map(app => app.name === appName ? { ...app, volume: newVol } : app));
    ConnectionService.send('audio:mixer:set', { name: appName, volume: newVol });
  };

  const handleMedia = (action) => {
    ConnectionService.send(`media:${action}`);
  };

  const handleSystemCmd = (cmd) => {
    Alert.alert(
      `Confirm ${cmd}`,
      `Are you sure you want to ${cmd} the PC?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes", 
          onPress: () => ConnectionService.send(`system:${cmd}`),
          style: cmd === 'shutdown' || cmd === 'restart' ? 'destructive' : 'default'
        }
      ]
    );
  };

  const handleSyncClipboard = async () => {
    const success = await ConnectionService.syncClipboardToPC();
    if (success) {
      Alert.alert('Success', 'Clipboard sent to PC');
    } else {
      Alert.alert('Error', 'No text found in clipboard or failed to read.');
    }
  };

  const handleToggleIntercom = () => {
    ConnectionService.send('intercom:toggle:request');
    Alert.alert('Intercom', 'Requested PC to toggle 2-way audio stream.');
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      
      {/* System Info Overview */}
      {sysInfo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>System Performance</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{sysInfo.cpu?.usage || 0}%</Text>
              <Text style={styles.statLabel}>CPU</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{sysInfo.memory?.percent || 0}%</Text>
              <Text style={styles.statLabel}>RAM</Text>
            </View>
            {sysInfo.battery?.hasBattery && (
              <View style={styles.statBox}>
                <Text style={[styles.statValue, sysInfo.battery.percent < 20 && {color: '#ef4444'}]}>
                  {sysInfo.battery.percent}%
                </Text>
                <Text style={styles.statLabel}>Battery</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Audio Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Audio & Media</Text>
        
        <View style={styles.volumeRow}>
          <TouchableOpacity onPress={() => ConnectionService.send('volume:mute')} style={styles.iconBtn}>
            <Ionicons name="volume-mute" size={24} color="#94a3b8" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const v = Math.max(0, volume - 10); setVolume(v); ConnectionService.send('volume:set', { level: v }); }} style={styles.volBtn}>
            <Ionicons name="remove" size={20} color="#f1f5f9" />
          </TouchableOpacity>
          <View style={styles.volumeBarOuter}>
            <View style={[styles.volumeBarInner, { width: `${volume}%` }]} />
          </View>
          <TouchableOpacity onPress={() => { const v = Math.min(100, volume + 10); setVolume(v); ConnectionService.send('volume:set', { level: v }); }} style={styles.volBtn}>
            <Ionicons name="add" size={20} color="#f1f5f9" />
          </TouchableOpacity>
          <Text style={styles.volumeText}>{volume}%</Text>
        </View>

        <View style={styles.mediaRow}>
          <TouchableOpacity onPress={() => handleMedia('prev')} style={styles.mediaBtn}>
            <Ionicons name="play-back" size={24} color="#f1f5f9" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleMedia('play')} style={[styles.mediaBtn, styles.playBtn]}>
            <Ionicons name="play" size={32} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleMedia('next')} style={styles.mediaBtn}>
            <Ionicons name="play-forward" size={24} color="#f1f5f9" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Advanced Audio Mixer */}
      {audioMixerApps.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>App Audio Mixer</Text>
            <TouchableOpacity onPress={() => ConnectionService.send('audio:mixer:get')}>
              <Ionicons name="refresh" size={20} color="#6366f1" />
            </TouchableOpacity>
          </View>

          {audioMixerApps.map((app, idx) => (
            <View key={idx} style={styles.mixerRow}>
              <View style={styles.mixerInfo}>
                <Ionicons name="musical-notes" size={16} color="#94a3b8" />
                <Text style={styles.mixerName} numberOfLines={1}>{app.name.replace('.exe', '')}</Text>
              </View>
              <View style={styles.volumeRowSmall}>
                <TouchableOpacity onPress={() => handleMixerVolumeChange(app.name, Math.max(0, app.volume - 10))} style={styles.volBtnSmall}>
                  <Ionicons name="remove" size={16} color="#f1f5f9" />
                </TouchableOpacity>
                <View style={styles.volumeBarOuterSmall}>
                  <View style={[styles.volumeBarInner, { width: `${app.volume}%` }]} />
                </View>
                <TouchableOpacity onPress={() => handleMixerVolumeChange(app.name, Math.min(100, app.volume + 10))} style={styles.volBtnSmall}>
                  <Ionicons name="add" size={16} color="#f1f5f9" />
                </TouchableOpacity>
                <Text style={styles.volumeTextSmall}>{Math.round(app.volume)}%</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Two-Way Sync Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Two-Way Features</Text>
        <View style={styles.powerGrid}>
          <TouchableOpacity style={styles.powerBtn} onPress={handleSyncClipboard}>
            <Ionicons name="clipboard" size={24} color="#6366f1" />
            <Text style={styles.powerText}>Send Clipboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={handleToggleIntercom}>
            <Ionicons name="mic" size={24} color="#6366f1" />
            <Text style={styles.powerText}>Remote PC Mic</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Power Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Power Options</Text>
        <View style={styles.powerGrid}>
          <TouchableOpacity style={styles.powerBtn} onPress={() => handleSystemCmd('lock')}>
            <Ionicons name="lock-closed" size={24} color="#94a3b8" />
            <Text style={styles.powerText}>Lock</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={() => handleSystemCmd('sleep')}>
            <Ionicons name="moon" size={24} color="#94a3b8" />
            <Text style={styles.powerText}>Sleep</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.powerBtn, styles.powerWarn]} onPress={() => handleSystemCmd('restart')}>
            <Ionicons name="refresh" size={24} color="#f59e0b" />
            <Text style={[styles.powerText, {color: '#f59e0b'}]}>Restart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.powerBtn, styles.powerDanger]} onPress={() => handleSystemCmd('shutdown')}>
            <Ionicons name="power" size={24} color="#ef4444" />
            <Text style={[styles.powerText, {color: '#ef4444'}]}>Shutdown</Text>
          </TouchableOpacity>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  content: {
    padding: 16,
    gap: 16,
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
  card: {
    backgroundColor: '#12121a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f1f5f9',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  statLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBtn: {
    padding: 8,
  },
  volumeText: {
    color: '#f1f5f9',
    width: 40,
    textAlign: 'right',
    fontWeight: 'bold',
  },
  volBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(99,102,241,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeBarOuter: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  volumeBarInner: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 4,
  },
  mediaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  mediaBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#6366f1',
  },
  powerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  powerBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  powerWarn: {
    borderColor: 'rgba(245,158,11,0.3)',
    backgroundColor: 'rgba(245,158,11,0.05)',
  },
  powerDanger: {
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.05)',
  },
  powerText: {
    color: '#94a3b8',
    marginTop: 8,
    fontWeight: '500',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  mixerRow: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    paddingBottom: 16,
  },
  mixerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  mixerName: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  volumeRowSmall: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  volBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(99,102,241,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeBarOuterSmall: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  volumeTextSmall: {
    color: '#94a3b8',
    width: 36,
    textAlign: 'right',
    fontSize: 12,
  }
});
