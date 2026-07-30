import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function ConnectScreen({ navigation }) {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('3847');
  const [code, setCode] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // Camera state
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    const unsub = ConnectionService.on('connectionChanged', (status) => {
      setIsConnected(status);
      if (status) {
        setIsConnecting(false);
        setError('');
        setIsScanning(false);
        // Automatically navigate to PC Control tab on successful connection
        navigation.navigate('System');
      }
    });
    return unsub;
  }, [navigation]);

  const handleConnect = async (customIp, customPort, customCode) => {
    const targetIp = customIp || ip;
    const targetPort = customPort || port;
    const targetCode = customCode || code;

    if (!targetIp || !targetCode) {
      setError('Please enter IP and Code');
      return;
    }
    
    setIsConnecting(true);
    setError('');
    
    try {
      await ConnectionService.connectWiFi(targetIp.trim(), targetPort.trim(), targetCode.trim());
      // On success, the event listener above handles navigation
    } catch (err) {
      setError(err.message || 'Failed to connect. Check IP and code.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    ConnectionService.disconnect();
  };

  const handleScanBtn = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        setError('Camera permission is required to scan QR code.');
        return;
      }
    }
    setIsScanning(true);
  };

  const handleBarcodeScanned = ({ data }) => {
    setIsScanning(false);
    try {
      const payload = JSON.parse(data);
      if (payload.app === 'moodlink' && payload.ip && payload.port && payload.code) {
        setIp(payload.ip);
        setPort(payload.port.toString());
        setCode(payload.code.toString());
        
        // Auto connect
        setTimeout(() => {
          handleConnect(payload.ip, payload.port.toString(), payload.code.toString());
        }, 500);
      } else {
        setError('Invalid MoodLink QR code.');
      }
    } catch (e) {
      setError('Invalid QR code format.');
    }
  };

  if (isConnected) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
          <Text style={styles.successTitle}>Connected</Text>
          <Text style={styles.successText}>Your phone is linked to the PC</Text>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={handleDisconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isScanning) {
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerText}>Point at the MoodLink QR Code</Text>
          <View style={styles.scannerFrame} />
          <TouchableOpacity style={styles.cancelScanBtn} onPress={() => setIsScanning(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.header}>Connect to PC</Text>
      <Text style={styles.subtitle}>Scan QR code or enter details manually</Text>

      <TouchableOpacity style={styles.scanButtonPrimary} onPress={handleScanBtn}>
        <Ionicons name="qr-code-outline" size={24} color="#fff" style={{marginRight: 8}} />
        <Text style={styles.buttonText}>Scan QR Code</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.card}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>PC IP Address</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 192.168.1.10"
            placeholderTextColor="#475569"
            value={ip}
            onChangeText={setIp}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.label}>Port</Text>
            <TextInput
              style={styles.input}
              placeholder="3847"
              placeholderTextColor="#475569"
              value={port}
              onChangeText={setPort}
              keyboardType="numeric"
            />
          </View>
          <View style={[styles.inputGroup, { flex: 2, marginLeft: 8 }]}>
            <Text style={styles.label}>Pairing Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="------"
              placeholderTextColor="#475569"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity 
          style={[styles.button, (!ip || !code || isConnecting) && styles.buttonDisabled]} 
          onPress={() => handleConnect(ip, port, code)}
          disabled={!ip || !code || isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Manually</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f1f5f9',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#94a3b8',
    marginBottom: 32,
  },
  scanButtonPrimary: {
    backgroundColor: '#6366f1',
    flexDirection: 'row',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dividerText: {
    color: '#94a3b8',
    paddingHorizontal: 16,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#12121a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 16,
    color: '#f1f5f9',
    fontSize: 16,
  },
  codeInput: {
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    fontWeight: 'bold',
    color: '#6366f1',
  },
  button: {
    backgroundColor: '#334155',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  dangerButton: {
    backgroundColor: '#ef4444',
    marginTop: 32,
    width: '100%',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#ef4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  successCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12121a',
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#22c55e',
    marginTop: 16,
    marginBottom: 8,
  },
  successText: {
    color: '#94a3b8',
    fontSize: 16,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#6366f1',
    backgroundColor: 'transparent',
  },
  cancelScanBtn: {
    marginTop: 40,
    backgroundColor: '#334155',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  }
});
