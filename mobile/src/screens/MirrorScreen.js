import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';
import ConnectionService from '../services/ConnectionService';
import * as Haptics from 'expo-haptics';

export default function MirrorScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [remoteStreamURL, setRemoteStreamURL] = useState(null);
  const [isIntercomActive, setIsIntercomActive] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' | 'user'
  
  const lastPan = useRef({ x: 0, y: 0 });
  const touchStartTime = useRef(0);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    try {
      Haptics.impactAsync(style).catch(() => {});
    } catch (e) {}
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (evt, gs) => Math.abs(gs.dx) > 1 || Math.abs(gs.dy) > 1,
    onPanResponderGrant: () => {
      lastPan.current = { x: 0, y: 0 };
      touchStartTime.current = Date.now();
    },
    onPanResponderMove: (evt, gestureState) => {
      if (!remoteStreamURL) return; // Only track if screen is showing
      const dx = gestureState.dx - lastPan.current.x;
      const dy = gestureState.dy - lastPan.current.y;
      ConnectionService.sendFastInput('m', Math.round(dx * 1.5), Math.round(dy * 1.5));
      lastPan.current = { x: gestureState.dx, y: gestureState.dy };
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (!remoteStreamURL) return;
      const duration = Date.now() - touchStartTime.current;
      if (Math.abs(gestureState.dx) < 6 && Math.abs(gestureState.dy) < 6 && duration < 280) {
        ConnectionService.send('mouse:click', { button: 'left' });
        triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }), [remoteStreamURL]);

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);
    
    const unsubStream = ConnectionService.on('webrtc:stream', (stream) => {
      setRemoteStreamURL(stream ? stream.toURL() : null);
    });

    const unsubLocal = ConnectionService.on('webrtc:localstream', (stream) => {
      setIsIntercomActive(!!(stream && stream.getAudioTracks().length > 0));
      setIsCameraActive(!!(stream && stream.getVideoTracks().length > 0));
    });

    // Check if there's already a remote stream
    if (ConnectionService.remoteStream) {
      setRemoteStreamURL(ConnectionService.remoteStream.toURL());
    }
    const local = ConnectionService.localStream;
    setIsIntercomActive(!!(local && local.getAudioTracks().length > 0));
    setIsCameraActive(!!(local && local.getVideoTracks().length > 0));

    return () => {
      unsubConn();
      unsubStream();
      unsubLocal();
    };
  }, []);

  const handleToggleAudio = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await ConnectionService.toggleIntercom();
  };

  const handleToggleCamera = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await ConnectionService.toggleCamera(cameraFacing);
  };

  const handleFlipCamera = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    if (isCameraActive) {
      // Restart with new facing mode
      await ConnectionService.toggleCamera(cameraFacing); // stop
      await ConnectionService.toggleCamera(newFacing);     // restart
    }
  };

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={54} color="#facc15" />
        <Text style={styles.disconnectedTitle}>Not Connected</Text>
        <Text style={styles.disconnectedText}>Connect to your PC first to stream video or audio</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Mirror & Media</Text>
          <Text style={styles.subtitle}>Stream PC screen or broadcast phone camera</Text>
        </View>

        {isCameraActive && (
          <TouchableOpacity style={styles.flipBtn} onPress={handleFlipCamera}>
            <Ionicons name="camera-reverse-outline" size={20} color="#ffffff" />
            <Text style={styles.flipText}>{cameraFacing === 'environment' ? 'Rear' : 'Front'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.videoContainer} {...panResponder.panHandlers}>
        {remoteStreamURL ? (
          <RTCView
            streamURL={remoteStreamURL}
            style={styles.rtcView}
            objectFit="contain"
          />
        ) : (
          <View style={styles.placeholderView}>
            <View style={styles.placeholderIconContainer}>
              <Ionicons name="desktop-outline" size={48} color="#facc15" />
            </View>
            <Text style={styles.placeholderText}>
              {isCameraActive ? "Streaming phone camera to PC..." : "Waiting for PC stream..."}
            </Text>
            <Text style={styles.placeholderSub}>
              {isCameraActive
                ? "Your camera feed is live on the MoodLink desktop app."
                : "Click 'Stream PC Screen' on your desktop app to view your screen here with touch control."}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={[styles.audioButton, isIntercomActive && styles.audioButtonActive]} 
          onPress={handleToggleAudio}
          activeOpacity={0.8}
        >
          <Ionicons name={isIntercomActive ? "mic" : "mic-off"} size={24} color="#ffffff" />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.cameraButton, isCameraActive && styles.cameraButtonActive]} 
          onPress={handleToggleCamera}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isCameraActive ? "videocam" : "videocam-outline"}
            size={24}
            color={isCameraActive ? "#ffffff" : "#000000"}
          />
          <Text style={[styles.cameraButtonText, isCameraActive && styles.cameraButtonTextActive]}>
            {isCameraActive ? "Stop Camera" : "Stream Phone Camera to PC"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  disconnectedContainer: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', padding: 32 },
  disconnectedTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  disconnectedText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)'
  },
  title: { fontSize: 20, fontWeight: '700', color: '#ffffff' },
  subtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  flipBtn: {
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
  flipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  videoContainer: {
    flex: 1,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rtcView: {
    width: '100%',
    height: '100%',
  },
  placeholderView: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    maxWidth: 360,
  },
  placeholderIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(250, 204, 21, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.3)',
  },
  placeholderText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderSub: {
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  controlsContainer: {
    padding: 20,
    backgroundColor: '#0d0d0d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  audioButton: {
    backgroundColor: '#161616',
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  audioButtonActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  cameraButton: {
    flex: 1,
    height: 52,
    backgroundColor: '#facc15',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cameraButtonActive: {
    backgroundColor: '#22c55e',
  },
  cameraButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  cameraButtonTextActive: {
    color: '#ffffff',
  }
});
