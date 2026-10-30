import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator
} from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';

export default function PCControlScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [volume, setVolume] = useState(50);
  const [sysInfo, setSysInfo] = useState(null);
  const [audioMixerApps, setAudioMixerApps] = useState([]);

  // Music Casting State (Phone -> PC)
  const [musicTrack, setMusicTrack] = useState(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [musicCurrentTime, setMusicCurrentTime] = useState(0);
  const [musicDuration, setMusicDuration] = useState(0);
  const [castVolume, setCastVolume] = useState(100);

  // Wireless Headphones State (PC -> Phone)
  const [isListeningToPC, setIsListeningToPC] = useState(false);

  // Context-Aware Stream Deck Profiles
  const [foregroundApp, setForegroundApp] = useState('default');
  const [autoProfile, setAutoProfile] = useState(true);
  const [activeProfile, setActiveProfile] = useState('default'); // 'default' | 'vscode' | 'powerpnt' | 'chrome' | 'spotify'

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);
    const unsubVol = ConnectionService.on('volume:level', (data) => setVolume(data.level));
    const unsubVolChg = ConnectionService.on('volume:changed', (data) => setVolume(data.level));
    const unsubSys = ConnectionService.on('system:info:data', setSysInfo);
    const unsubAudio = ConnectionService.on('audio:mixer:data', setAudioMixerApps);

    // Context-Aware Foreground App Switcher
    const unsubAppFocus = ConnectionService.on('system:foreground:changed', (appName) => {
      const name = (appName || '').toLowerCase();
      setForegroundApp(name);

      let detected = 'default';
      if (name.includes('code')) detected = 'vscode';
      else if (name.includes('powerpnt') || name.includes('presentation')) detected = 'powerpnt';
      else if (name.includes('chrome') || name.includes('msedge') || name.includes('firefox') || name.includes('brave')) detected = 'chrome';
      else if (name.includes('spotify')) detected = 'spotify';

      if (autoProfile) {
        setActiveProfile(detected);
      }
    });

    // PC Audio Streaming Status (Headphones Mode)
    const unsubPCAudio = ConnectionService.on('pc:audio:streaming:status', (data) => {
      setIsListeningToPC(!!data.streaming);
    });

    // Music sync from PC HTML5 player
    const unsubMusicProg = ConnectionService.on('music:progress', (data) => {
      setMusicCurrentTime(data.currentTime || 0);
      setMusicDuration(data.duration || 0);
      setIsPlayingMusic(!!data.isPlaying);
    });

    const unsubMusicLoaded = ConnectionService.on('music:loaded', (track) => {
      setMusicTrack(track);
      setIsPlayingMusic(true);
    });

    let pollInterval = null;
    if (ConnectionService.isConnected) {
      ConnectionService.send('volume:get');
      ConnectionService.send('system:info');
      ConnectionService.send('audio:mixer:get');

      // Send phone status to PC (battery & transport mode)
      sendPhoneStatusToPC();

      pollInterval = setInterval(() => {
        if (ConnectionService.isConnected) {
          ConnectionService.send('system:info');
        }
      }, 5000);
    }

    return () => {
      unsubConn();
      unsubVol();
      unsubVolChg();
      unsubSys();
      unsubAudio();
      unsubAppFocus();
      unsubPCAudio();
      unsubMusicProg();
      unsubMusicLoaded();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [autoProfile]);

  const sendPhoneStatusToPC = () => {
    ConnectionService.send('phone:status', {
      name: 'Android Phone',
      battery: 100,
      charging: false,
      mode: ConnectionService.transportMode
    });
  };

  const handleVolumeChange = (value) => {
    const newVol = Math.round(value);
    setVolume(newVol);
    ConnectionService.send('volume:set', { level: newVol });
  };

  const handleMixerVolumeChange = (app, value) => {
    const newVol = Math.round(value);
    setAudioMixerApps(prev => prev.map(a => ((a.id && a.id === app.id) || a.name === app.name) ? { ...a, volume: newVol } : a));
    ConnectionService.send('audio:mixer:set', { id: app.id, name: app.name, volume: newVol });
  };

  const getAppMixerIcon = (name = '') => {
    const n = name.toLowerCase();
    if (n.includes('chrome') || n.includes('browser') || n.includes('edge') || n.includes('firefox')) return 'globe-outline';
    if (n.includes('spotify') || n.includes('music') || n.includes('vlc') || n.includes('mpv')) return 'musical-note';
    if (n.includes('code') || n.includes('terminal')) return 'code-slash';
    if (n.includes('system') || n.includes('shell') || n.includes('windows')) return 'laptop-outline';
    return 'musical-notes';
  };

  const handleMedia = (action) => {
    ConnectionService.send(`media:${action}`);
  };

  const handleSystemCmd = (cmd) => {
    Alert.alert(
      `Confirm ${cmd.toUpperCase()}`,
      `Are you sure you want to ${cmd} the PC?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Confirm", 
          onPress: () => ConnectionService.send(`system:${cmd}`),
          style: 'default'
        }
      ]
    );
  };

  // Biometric PC Lock / Unlock
  const handleBiometricAuth = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        ConnectionService.send('system:lock');
        Alert.alert('Lock Triggered', 'Device lock command sent to PC.');
        return;
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Biometric Authenticate to Lock/Unlock PC',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (authResult.success) {
        ConnectionService.send('system:lock');
        Alert.alert('Authenticated', 'Biometric identity verified: PC security state toggled.');
      }
    } catch (e) {
      Alert.alert('Biometric Error', e.message || 'Authentication failed');
    }
  };

  // Toggle PC -> Phone Wireless Audio Stream
  const handleTogglePCAudio = () => {
    ConnectionService.send('pc:audio:toggle');
    setIsListeningToPC(!isListeningToPC);
  };

  const handleSyncClipboard = async () => {
    const success = await ConnectionService.syncClipboardToPC();
    if (success) {
      Alert.alert('Success', 'Text copied directly to PC Clipboard');
    } else {
      Alert.alert('Clipboard Empty', 'No text found in clipboard.');
    }
  };

  const handlePingPC = () => {
    ConnectionService.send('pc:ping');
    Alert.alert('Pinged PC', 'Audible chime sent to PC speakers!');
  };

  // ─── Music Casting (Phone to PC Speakers) ──────────────────────
  const handlePickAndCastMusic = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];

      setIsUploadingMusic(true);
      setMusicTrack({ title: asset.name, size: asset.size });

      const formData = new FormData();
      formData.append('audio', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'audio/mpeg',
      });
      formData.append('title', asset.name);

      const server = await ConnectionService.getSavedPairedServer();
      const serverUrl = ConnectionService.serverUrl || (server ? `http://${server.ip}:${server.port}` : null);
      if (!serverUrl) {
        Alert.alert('Error', 'PC server address unavailable');
        setIsUploadingMusic(false);
        return;
      }

      const uploadRes = await fetch(`${serverUrl}/api/audio/cast`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Upload failed');
      const data = await uploadRes.json();
      setMusicTrack(data);
      setIsPlayingMusic(true);
      Alert.alert('Streaming', `Now playing "${asset.name}" on PC speakers!`);
    } catch (err) {
      Alert.alert('Cast Error', err.message || 'Could not stream audio');
    } finally {
      setIsUploadingMusic(false);
    }
  };

  const handleToggleMusicPlayback = () => {
    const nextState = !isPlayingMusic;
    setIsPlayingMusic(nextState);
    ConnectionService.send('music:control', { action: nextState ? 'play' : 'pause' });
  };

  const handleSeekMusic = (direction) => {
    if (!musicDuration) return;
    const step = 10;
    const newTime = direction === 'forward' 
      ? Math.min(musicDuration, musicCurrentTime + step)
      : Math.max(0, musicCurrentTime - step);
    const percent = Math.round((newTime / musicDuration) * 100);
    ConnectionService.send('music:control', { action: 'seek', value: percent });
  };

  const handleCastVolumeChange = (step) => {
    const newVol = Math.max(0, Math.min(100, castVolume + step));
    setCastVolume(newVol);
    ConnectionService.send('music:control', { action: 'volume', value: newVol });
  };

  // ─── Direct Photo to PC Clipboard ─────────────────────────────
  const handlePhotoToPCClipboard = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];

      const formData = new FormData();
      formData.append('image', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'image/jpeg',
      });

      const server = await ConnectionService.getSavedPairedServer();
      const serverUrl = ConnectionService.serverUrl || (server ? `http://${server.ip}:${server.port}` : null);
      if (!serverUrl) return;

      const uploadRes = await fetch(`${serverUrl}/api/clipboard/image`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      Alert.alert('Clipboard', 'Photo copied directly into Windows Clipboard!');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to send image to clipboard');
    }
  };

  // ─── Launch Macros & Apps ──────────────────────────────────────
  const handleLaunchApp = (appName) => {
    ConnectionService.send('app:launch', { app: appName });
  };

  const handleMacro = (keys) => {
    ConnectionService.send('macro:exec', { keys });
  };

  const handleKey = (key) => {
    ConnectionService.send('key:press', { key });
  };

  const formatSecs = (s) => {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const rem = Math.floor(s % 60);
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  // Stream Deck Profiles Definitions
  const profiles = {
    default: [
      { name: 'Chrome', icon: 'logo-chrome', color: '#facc15', action: () => handleLaunchApp('chrome') },
      { name: 'VS Code', icon: 'code-slash', color: '#facc15', action: () => handleLaunchApp('vscode') },
      { name: 'Explorer', icon: 'folder-open', color: '#facc15', action: () => handleLaunchApp('explorer') },
      { name: 'Task Mgr', icon: 'stats-chart', color: '#facc15', action: () => handleLaunchApp('taskmgr') },
      { name: 'Snip', icon: 'cut', color: '#ffffff', action: () => handleMacro(['win', 'shift', 's']) },
      { name: 'Desktop', icon: 'desktop', color: '#ffffff', action: () => handleMacro(['win', 'd']) },
      { name: 'Undo', icon: 'arrow-undo', color: '#ffffff', action: () => handleMacro(['ctrl', 'z']) },
      { name: 'Spotify', icon: 'musical-note', color: '#22c55e', action: () => handleLaunchApp('spotify') },
    ],
    vscode: [
      { name: 'Format', icon: 'sparkles', color: '#facc15', action: () => handleMacro(['shift', 'alt', 'f']) },
      { name: 'Terminal', icon: 'terminal', color: '#22c55e', action: () => handleMacro(['ctrl', '`']) },
      { name: 'Save All', icon: 'save', color: '#ffffff', action: () => handleMacro(['ctrl', 'k', 's']) },
      { name: 'Command', icon: 'search', color: '#facc15', action: () => handleMacro(['ctrl', 'shift', 'p']) },
      { name: 'Comment', icon: 'chatbubble', color: '#ffffff', action: () => handleMacro(['ctrl', '/']) },
      { name: 'Run F5', icon: 'play', color: '#22c55e', action: () => handleKey('f5') },
      { name: 'Split View', icon: 'grid', color: '#ffffff', action: () => handleMacro(['ctrl', '\\']) },
      { name: 'Explorer', icon: 'folder', color: '#facc15', action: () => handleMacro(['ctrl', 'shift', 'e']) },
    ],
    powerpnt: [
      { name: 'Start F5', icon: 'play-circle', color: '#22c55e', action: () => handleKey('f5') },
      { name: 'From Cur', icon: 'play-forward-circle', color: '#facc15', action: () => handleMacro(['shift', 'f5']) },
      { name: 'Next', icon: 'chevron-forward', color: '#ffffff', action: () => handleKey('pagedown') },
      { name: 'Prev', icon: 'chevron-back', color: '#ffffff', action: () => handleKey('pageup') },
      { name: 'Black', icon: 'contrast', color: '#ffffff', action: () => handleKey('b') },
      { name: 'White', icon: 'sunny', color: '#facc15', action: () => handleKey('w') },
      { name: 'Pen Tool', icon: 'pencil', color: '#22c55e', action: () => handleMacro(['ctrl', 'p']) },
      { name: 'End Show', icon: 'close-circle', color: '#ffffff', action: () => handleKey('escape') },
    ],
    chrome: [
      { name: 'New Tab', icon: 'add-circle', color: '#facc15', action: () => handleMacro(['ctrl', 't']) },
      { name: 'Close Tab', icon: 'close', color: '#ffffff', action: () => handleMacro(['ctrl', 'w']) },
      { name: 'Reopen', icon: 'refresh-circle', color: '#22c55e', action: () => handleMacro(['ctrl', 'shift', 't']) },
      { name: 'DevTools', icon: 'code-working', color: '#facc15', action: () => handleKey('f12') },
      { name: 'Refresh', icon: 'reload', color: '#ffffff', action: () => handleMacro(['ctrl', 'r']) },
      { name: 'Bookmark', icon: 'star', color: '#facc15', action: () => handleMacro(['ctrl', 'd']) },
      { name: 'Incognito', icon: 'eye-off', color: '#ffffff', action: () => handleMacro(['ctrl', 'shift', 'n']) },
      { name: 'Downloads', icon: 'download', color: '#ffffff', action: () => handleMacro(['ctrl', 'j']) },
    ],
    spotify: [
      { name: 'Play/Pause', icon: 'play-circle', color: '#22c55e', action: () => handleKey('space') },
      { name: 'Next', icon: 'play-forward', color: '#ffffff', action: () => handleMacro(['ctrl', 'right']) },
      { name: 'Prev', icon: 'play-back', color: '#ffffff', action: () => handleMacro(['ctrl', 'left']) },
      { name: 'Like Song', icon: 'heart', color: '#22c55e', action: () => handleMacro(['alt', 'shift', 'b']) },
      { name: 'Vol Up', icon: 'volume-high', color: '#facc15', action: () => handleMacro(['ctrl', 'up']) },
      { name: 'Vol Down', icon: 'volume-low', color: '#facc15', action: () => handleMacro(['ctrl', 'down']) },
      { name: 'Shuffle', icon: 'shuffle', color: '#22c55e', action: () => handleMacro(['ctrl', 's']) },
      { name: 'Repeat', icon: 'repeat', color: '#ffffff', action: () => handleMacro(['ctrl', 'r']) },
    ]
  };

  const currentMacroTiles = profiles[activeProfile] || profiles.default;

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={48} color="#facc15" />
        <Text style={styles.disconnectedText}>Connect to PC first</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Biometric PC Security Card */}
      <View style={[styles.card, styles.biometricCard]}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="finger-print" size={22} color="#facc15" />
            <Text style={[styles.cardTitle, { color: '#ffffff', marginBottom: 0 }]}>
              Biometric PC Security
            </Text>
          </View>
          <View style={styles.speakerBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#000000" />
            <Text style={styles.speakerBadgeText}>Encrypted</Text>
          </View>
        </View>

        <Text style={styles.hintText}>
          Use phone fingerprint or face scan to quickly lock/toggle PC access.
        </Text>

        <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometricAuth}>
          <Ionicons name="finger-print-outline" size={20} color="#000000" style={{ marginRight: 8 }} />
          <Text style={styles.biometricBtnText}>Authenticate & Lock / Unlock PC</Text>
        </TouchableOpacity>
      </View>

      {/* Wireless Headphones Mode (PC -> Phone Audio) */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="headset" size={20} color="#22c55e" />
            <Text style={[styles.cardTitle, { color: '#ffffff', marginBottom: 0 }]}>
              Wireless Headphones Mode
            </Text>
          </View>
          <View style={[styles.speakerBadge, isListeningToPC ? { backgroundColor: '#22c55e' } : { backgroundColor: '#333333' }]}>
            <Ionicons name="radio" size={12} color={isListeningToPC ? "#000000" : "#ffffff"} />
            <Text style={[styles.speakerBadgeText, isListeningToPC ? { color: '#000000' } : { color: '#ffffff' }]}>
              {isListeningToPC ? 'Active Receiver' : 'Idle'}
            </Text>
          </View>
        </View>

        <Text style={styles.hintText}>
          Stream all PC system audio directly into your phone earphones with low latency.
        </Text>

        <TouchableOpacity
          style={[styles.headphoneToggleBtn, isListeningToPC && styles.headphoneToggleBtnActive]}
          onPress={handleTogglePCAudio}
        >
          <Ionicons
            name={isListeningToPC ? "stop-circle" : "headset"}
            size={18}
            color={isListeningToPC ? "#ffffff" : "#000000"}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.headphoneToggleText, isListeningToPC && { color: '#ffffff' }]}>
            {isListeningToPC ? 'Stop PC Audio Receiver' : 'Listen to PC Audio on Phone'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Phone Music to PC Speakers (Cast Feature) */}
      <View style={[styles.card, styles.accentCard]}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="radio" size={20} color="#facc15" />
            <Text style={[styles.cardTitle, { color: '#ffffff', marginBottom: 0 }]}>
              Cast Music to PC Speakers
            </Text>
          </View>
          <View style={styles.speakerBadge}>
            <Ionicons name="volume-high" size={14} color="#000000" />
            <Text style={styles.speakerBadgeText}>PC Audio</Text>
          </View>
        </View>

        <Text style={styles.hintText}>
          Select songs from phone storage to play through PC speakers.
        </Text>

        <TouchableOpacity 
          style={styles.castPickBtn} 
          onPress={handlePickAndCastMusic}
          disabled={isUploadingMusic}
        >
          {isUploadingMusic ? (
            <ActivityIndicator color="#000000" size="small" />
          ) : (
            <>
              <Ionicons name="musical-notes" size={18} color="#000000" style={{ marginRight: 6 }} />
              <Text style={styles.castPickBtnText}>Choose Song from Phone</Text>
            </>
          )}
        </TouchableOpacity>

        {musicTrack && (
          <View style={styles.playerBox}>
            <Text style={styles.nowPlayingTitle} numberOfLines={1}>
              {musicTrack.title}
            </Text>
            <Text style={styles.nowPlayingSub}>Playing through PC Sound Card</Text>

            {/* Time progress */}
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>{formatSecs(musicCurrentTime)}</Text>
              <View style={styles.timeProgressOuter}>
                <View 
                  style={[
                    styles.timeProgressInner, 
                    { width: musicDuration ? `${Math.min(100, (musicCurrentTime / musicDuration) * 100)}%` : '0%' }
                  ]} 
                />
              </View>
              <Text style={styles.timeLabel}>{formatSecs(musicDuration)}</Text>
            </View>

            {/* Player Controls */}
            <View style={styles.playerControlsRow}>
              <TouchableOpacity onPress={() => handleSeekMusic('backward')} style={styles.playerMiniBtn}>
                <Ionicons name="play-back" size={20} color="#ffffff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleToggleMusicPlayback} style={styles.playerMainPlayBtn}>
                <Ionicons name={isPlayingMusic ? "pause" : "play"} size={26} color="#000000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleSeekMusic('forward')} style={styles.playerMiniBtn}>
                <Ionicons name="play-forward" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Cast Volume Slider */}
            <View style={styles.castVolRow}>
              <TouchableOpacity onPress={() => handleCastVolumeChange(-10)} style={styles.volStepBtn}>
                <Ionicons name="remove" size={16} color="#ffffff" />
              </TouchableOpacity>
              <View style={styles.castVolBarOuter}>
                <View style={[styles.castVolBarInner, { width: `${castVolume}%` }]} />
              </View>
              <TouchableOpacity onPress={() => handleCastVolumeChange(10)} style={styles.volStepBtn}>
                <Ionicons name="add" size={16} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.volPercentText}>{castVolume}%</Text>
            </View>
          </View>
        )}
      </View>

      {/* Context-Aware Stream Deck & Macro Tiles */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { marginBottom: 0 }]}>
            Stream Deck Profiles
          </Text>
          <TouchableOpacity
            style={[styles.autoProfileChip, autoProfile && styles.autoProfileChipActive]}
            onPress={() => setAutoProfile(!autoProfile)}
          >
            <Ionicons name="sparkles" size={12} color={autoProfile ? "#000000" : "#94a3b8"} />
            <Text style={[styles.autoProfileText, autoProfile && { color: '#000000' }]}>
              {autoProfile ? `Auto (${foregroundApp || 'Active'})` : 'Manual'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Profile Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.profileTabsScroll}>
          {['default', 'vscode', 'powerpnt', 'chrome', 'spotify'].map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.profileTab, activeProfile === p && styles.profileTabActive]}
              onPress={() => {
                setAutoProfile(false);
                setActiveProfile(p);
              }}
            >
              <Text style={[styles.profileTabText, activeProfile === p && styles.profileTabTextActive]}>
                {p === 'default' ? 'General' : p === 'vscode' ? 'VS Code' : p === 'powerpnt' ? 'PPT' : p === 'chrome' ? 'Browser' : 'Spotify'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.macroGrid}>
          {currentMacroTiles.map((tile, idx) => (
            <TouchableOpacity key={idx} style={styles.macroTile} onPress={tile.action}>
              <Ionicons name={tile.icon} size={24} color={tile.color} />
              <Text style={styles.macroTileText}>{tile.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Two-Way Symmetrical Actions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Two-Way Symmetrical Controls</Text>
        <View style={styles.powerGrid}>
          <TouchableOpacity style={styles.powerBtn} onPress={handlePingPC}>
            <Ionicons name="notifications" size={24} color="#facc15" />
            <Text style={styles.powerText}>Ping PC Chime</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={handlePhotoToPCClipboard}>
            <Ionicons name="image" size={24} color="#facc15" />
            <Text style={styles.powerText}>Photo to PC Clip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={handleSyncClipboard}>
            <Ionicons name="clipboard" size={24} color="#ffffff" />
            <Text style={styles.powerText}>Text to PC Clip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={sendPhoneStatusToPC}>
            <Ionicons name="sync" size={24} color="#22c55e" />
            <Text style={styles.powerText}>Sync Phone Info</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* System Info Overview */}
      {sysInfo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PC Performance</Text>
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
                <Text style={[styles.statValue, { color: '#22c55e' }]}>
                  {sysInfo.battery.percent}%
                </Text>
                <Text style={styles.statLabel}>Battery</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Master Volume Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>PC Master Volume</Text>
        
        <View style={styles.volumeRow}>
          <TouchableOpacity onPress={() => ConnectionService.send('volume:mute')} style={styles.iconBtn}>
            <Ionicons name="volume-mute" size={24} color="#94a3b8" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const v = Math.max(0, volume - 10); setVolume(v); ConnectionService.send('volume:set', { level: v }); }} style={styles.volBtn}>
            <Ionicons name="remove" size={20} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.volumeBarOuter}>
            <View style={[styles.volumeBarInner, { width: `${volume}%` }]} />
          </View>
          <TouchableOpacity onPress={() => { const v = Math.min(100, volume + 10); setVolume(v); ConnectionService.send('volume:set', { level: v }); }} style={styles.volBtn}>
            <Ionicons name="add" size={20} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.volumeText}>{volume}%</Text>
        </View>

        <View style={styles.mediaRow}>
          <TouchableOpacity onPress={() => handleMedia('prev')} style={styles.mediaBtn}>
            <Ionicons name="play-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleMedia('play')} style={[styles.mediaBtn, styles.playBtn]}>
            <Ionicons name="play" size={32} color="#000000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleMedia('next')} style={styles.mediaBtn}>
            <Ionicons name="play-forward" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* App Audio Mixer */}
      {audioMixerApps.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>PC App Audio Mixer</Text>
            <TouchableOpacity onPress={() => ConnectionService.send('audio:mixer:get')}>
              <Ionicons name="refresh" size={20} color="#facc15" />
            </TouchableOpacity>
          </View>

          {audioMixerApps.map((app, idx) => (
            <View key={app.id || idx} style={styles.mixerRow}>
              <View style={styles.mixerInfo}>
                <Ionicons name={getAppMixerIcon(app.name)} size={16} color="#facc15" />
                <Text style={styles.mixerName} numberOfLines={1}>{app.name}</Text>
              </View>
              <View style={styles.volumeRowSmall}>
                <TouchableOpacity onPress={() => handleMixerVolumeChange(app, Math.max(0, app.volume - 10))} style={styles.volBtnSmall}>
                  <Ionicons name="remove" size={16} color="#ffffff" />
                </TouchableOpacity>
                <View style={styles.volumeBarOuterSmall}>
                  <View style={[styles.volumeBarInner, { width: `${app.volume}%` }]} />
                </View>
                <TouchableOpacity onPress={() => handleMixerVolumeChange(app, Math.min(100, app.volume + 10))} style={styles.volBtnSmall}>
                  <Ionicons name="add" size={16} color="#ffffff" />
                </TouchableOpacity>
                <Text style={styles.volumeTextSmall}>{Math.round(app.volume)}%</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* PC Power Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>PC Power Options</Text>
        <View style={styles.powerGrid}>
          <TouchableOpacity style={styles.powerBtn} onPress={() => handleSystemCmd('lock')}>
            <Ionicons name="lock-closed" size={24} color="#94a3b8" />
            <Text style={styles.powerText}>Lock</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={() => handleSystemCmd('sleep')}>
            <Ionicons name="moon" size={24} color="#94a3b8" />
            <Text style={styles.powerText}>Sleep</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.powerBtn} onPress={() => handleSystemCmd('restart')}>
            <Ionicons name="refresh" size={24} color="#facc15" />
            <Text style={[styles.powerText, { color: '#facc15' }]}>Restart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.powerBtn, { borderColor: '#ffffff' }]} onPress={() => handleSystemCmd('shutdown')}>
            <Ionicons name="power" size={24} color="#ffffff" />
            <Text style={[styles.powerText, { color: '#ffffff' }]}>Shutdown</Text>
          </TouchableOpacity>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  disconnectedContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectedText: {
    color: '#94a3b8',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  biometricCard: {
    borderColor: '#facc15',
    backgroundColor: '#0f0f0f',
  },
  accentCard: {
    borderColor: '#facc15',
    backgroundColor: '#0c0c0c',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  speakerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#facc15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  speakerBadgeText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  hintText: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 14,
  },
  biometricBtn: {
    backgroundColor: '#facc15',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  biometricBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  headphoneToggleBtn: {
    backgroundColor: '#22c55e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  headphoneToggleBtnActive: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  headphoneToggleText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  castPickBtn: {
    backgroundColor: '#facc15',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  castPickBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  playerBox: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  nowPlayingTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  nowPlayingSub: {
    color: '#22c55e',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  timeLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
    minWidth: 32,
  },
  timeProgressOuter: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  timeProgressInner: {
    height: '100%',
    backgroundColor: '#facc15',
  },
  playerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 14,
  },
  playerMiniBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerMainPlayBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  castVolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volStepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  castVolBarOuter: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  castVolBarInner: {
    height: '100%',
    backgroundColor: '#22c55e',
  },
  volPercentText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
  },
  autoProfileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  autoProfileChipActive: {
    backgroundColor: '#facc15',
    borderColor: '#facc15',
  },
  autoProfileText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  profileTabsScroll: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  profileTab: {
    backgroundColor: '#161616',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  profileTabActive: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250,204,21,0.1)',
  },
  profileTabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  profileTabTextActive: {
    color: '#facc15',
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  macroTile: {
    width: '22%',
    aspectRatio: 1,
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  macroTileText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
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
    fontWeight: '800',
    color: '#facc15',
  },
  statLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    fontWeight: '600',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconBtn: {
    padding: 8,
  },
  volumeText: {
    color: '#facc15',
    width: 44,
    textAlign: 'right',
    fontWeight: '800',
    fontSize: 15,
  },
  volBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(250,204,21,0.2)',
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
    backgroundColor: '#facc15',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#facc15',
  },
  powerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  powerBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  powerText: {
    color: '#ffffff',
    marginTop: 8,
    fontWeight: '600',
    fontSize: 13,
  },
  mixerRow: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 14,
  },
  mixerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  mixerName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    color: '#facc15',
    width: 36,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
  }
});
