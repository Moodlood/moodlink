import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';
import ConnectionService from '../services/ConnectionService';

export default function MirrorScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [remoteStreamURL, setRemoteStreamURL] = useState(null);
  const [isIntercomActive, setIsIntercomActive] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const lastPan = useRef({ x: 0, y: 0 });

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { lastPan.current = { x: 0, y: 0 }; },
    onPanResponderMove: (evt, gestureState) => {
      if (!remoteStreamURL) return; // Only track if screen is showing
      const dx = gestureState.dx - lastPan.current.x;
      const dy = gestureState.dy - lastPan.current.y;
      ConnectionService.send('mouse:move', { dx, dy });
      lastPan.current = { x: gestureState.dx, y: gestureState.dy };
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (!remoteStreamURL) return;
      if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5 && gestureState.duration < 200) {
        ConnectionService.send('mouse:click', { button: 'left' });
      }
    }
  }), [remoteStreamURL]);

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);
    
    const unsubStream = ConnectionService.on('webrtc:stream', (stream) => {
      setRemoteStreamURL(stream.toURL());
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
    await ConnectionService.toggleIntercom();
  };

  const handleToggleCamera = async () => {
    await ConnectionService.toggleCamera();
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
        <Text style={styles.title}>Mirror & Media</Text>
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
            <Ionicons name="desktop-outline" size={64} color="#334155" />
            <Text style={styles.placeholderText}>Waiting for PC stream...</Text>
            <Text style={styles.placeholderSub}>Click 'Stream PC Screen' on your desktop app</Text>
          </View>
        )}
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={[styles.audioButton, isIntercomActive && styles.audioButtonActive]} 
          onPress={handleToggleAudio}
        >
          <Ionicons name={isIntercomActive ? "mic" : "mic-off"} size={28} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.audioButton, isCameraActive && styles.audioButtonActive, { flex: 1, marginLeft: 12 }]} 
          onPress={handleToggleCamera}
        >
          <Ionicons name={isCameraActive ? "videocam" : "videocam-outline"} size={28} color="#fff" />
          <Text style={styles.audioButtonText}>
            {isCameraActive ? "Stop Camera" : "Stream Phone Camera"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  disconnectedContainer: { flex: 1, backgroundColor: '#0a0a0f', alignItems: 'center', justifyContent: 'center' },
  disconnectedText: { color: '#94a3b8', marginTop: 16, fontSize: 16 },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#f1f5f9' },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
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
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  placeholderSub: {
    color: '#475569',
    marginTop: 8,
    textAlign: 'center',
  },
  controlsContainer: {
    padding: 24,
    backgroundColor: '#12121a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  audioButton: {
    backgroundColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
  },
  audioButtonActive: {
    backgroundColor: '#ef4444',
  },
  audioButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 12,
  }
});
