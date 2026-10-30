import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList
} from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function ConnectScreen({ navigation }) {
  const [mode, setMode] = useState('WIFI'); // 'WIFI' | 'BLUETOOTH'
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('3847');
  const [code, setCode] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [savedServer, setSavedServer] = useState(null);

  // Bluetooth state
  const [btDevices, setBtDevices] = useState([]);
  const [isScanningBt, setIsScanningBt] = useState(false);

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
        navigation.navigate('System');
      }
    });

    // Check saved server on mount and auto-connect
    ConnectionService.getSavedPairedServer().then(saved => {
      if (saved) {
        setSavedServer(saved);
        if (!ConnectionService.isConnected) {
          setIsConnecting(true);
          ConnectionService.autoConnect()
            .catch(() => {})
            .finally(() => setIsConnecting(false));
        }
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
    } catch (err) {
      setError(err.message || 'Failed to connect. Check IP and code.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    ConnectionService.disconnect();
  };

  const handleForgetSaved = async () => {
    await ConnectionService.forgetPairedServer();
    setSavedServer(null);
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

  // Bluetooth scanning & connecting
  const handleScanBluetooth = async () => {
    setIsScanningBt(true);
    setError('');
    try {
      const enabled = await ConnectionService.isBluetoothEnabled();
      if (!enabled) {
        const requested = await ConnectionService.requestEnableBluetooth();
        if (!requested) {
          setError('Please enable Bluetooth on your phone.');
          setIsScanningBt(false);
          return;
        }
      }

      const devices = await ConnectionService.getBondedBluetoothDevices();
      setBtDevices(devices);
      if (devices.length === 0) {
        setError('No paired Bluetooth devices found. Pair with your PC in Windows Settings first.');
      }
    } catch (err) {
      setError('Bluetooth error: ' + (err.message || 'Failed to scan'));
    } finally {
      setIsScanningBt(false);
    }
  };

  const handleConnectBtDevice = async (device) => {
    setIsConnecting(true);
    setError('');
    try {
      await ConnectionService.connectBluetooth(device);
    } catch (err) {
      setError('Failed to connect to Bluetooth device: ' + (err.message || ''));
      setIsConnecting(false);
    }
  };

  if (isConnected) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
          <Text style={styles.successTitle}>Connected</Text>
          <Text style={styles.successText}>Your phone is linked to the PC</Text>
          <Text style={styles.transportBadge}>
            Mode: {ConnectionService.transportMode}
          </Text>
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
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Connect to PC</Text>
        <Text style={styles.subtitle}>Link your phone via WiFi or Bluetooth</Text>

        {/* Transport Mode Switcher */}
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[styles.modeTab, mode === 'WIFI' && styles.modeTabActive]}
            onPress={() => setMode('WIFI')}
          >
            <Ionicons name="wifi" size={18} color={mode === 'WIFI' ? '#fff' : '#94a3b8'} />
            <Text style={[styles.modeTabText, mode === 'WIFI' && styles.modeTabTextActive]}>WiFi</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, mode === 'BLUETOOTH' && styles.modeTabActive]}
            onPress={() => {
              setMode('BLUETOOTH');
              handleScanBluetooth();
            }}
          >
            <Ionicons name="bluetooth" size={18} color={mode === 'BLUETOOTH' ? '#fff' : '#94a3b8'} />
            <Text style={[styles.modeTabText, mode === 'BLUETOOTH' && styles.modeTabTextActive]}>Bluetooth</Text>
          </TouchableOpacity>
        </View>

        {/* Saved Paired Server Quick Reconnect (WiFi Mode) */}
        {mode === 'WIFI' && savedServer && (
          <View style={styles.savedCard}>
            <View style={styles.savedCardHeader}>
              <View style={styles.savedCardIcon}>
                <Ionicons name="desktop-outline" size={24} color="#facc15" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.savedTitle}>{savedServer.deviceName || 'Known Computer'}</Text>
                <Text style={styles.savedSubtitle}>{savedServer.ip}:{savedServer.port}</Text>
              </View>
              <TouchableOpacity onPress={handleForgetSaved} style={styles.forgetBtn}>
                <Ionicons name="trash-outline" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.reconnectBtn}
              onPress={() => handleConnect(savedServer.ip, savedServer.port, savedServer.code)}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="flash" size={16} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.reconnectBtnText}>1-Tap Reconnect</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Error message */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {mode === 'WIFI' ? (
          <>
            <TouchableOpacity style={styles.scanButtonPrimary} onPress={handleScanBtn}>
              <Ionicons name="qr-code-outline" size={24} color="#fff" style={{marginRight: 8}} />
              <Text style={styles.buttonText}>Scan QR Code on PC</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR MANUAL IP</Text>
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
          </>
        ) : (
          /* Bluetooth Mode */
          <View style={styles.card}>
            <View style={styles.btHeaderRow}>
              <Text style={styles.cardTitle}>Paired Bluetooth PCs</Text>
              <TouchableOpacity onPress={handleScanBluetooth} style={styles.btRefreshBtn}>
                {isScanningBt ? (
                  <ActivityIndicator size="small" color="#facc15" />
                ) : (
                  <Ionicons name="refresh" size={20} color="#facc15" />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.btHint}>
              Pair your phone with your PC in Windows Settings first, then tap it below to connect.
            </Text>

            {btDevices.length === 0 ? (
              <View style={styles.emptyBt}>
                <Ionicons name="bluetooth-outline" size={40} color="#475569" />
                <Text style={styles.emptyBtText}>No paired devices found</Text>
                <TouchableOpacity style={styles.scanBtBtn} onPress={handleScanBluetooth}>
                  <Text style={styles.scanBtBtnText}>Scan Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              btDevices.map((dev, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.btDeviceRow}
                  onPress={() => handleConnectBtDevice(dev)}
                  disabled={isConnecting}
                >
                  <View style={styles.btIconWrap}>
                    <Ionicons name="laptop-outline" size={22} color="#facc15" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.btDeviceName}>{dev.name || 'Bluetooth PC'}</Text>
                    <Text style={styles.btDeviceAddr}>{dev.address}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#64748b" />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    padding: 24,
    paddingTop: 40,
    paddingBottom: 40,
  },
  header: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 20,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  modeTabActive: {
    backgroundColor: '#facc15',
  },
  modeTabText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  savedCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#facc15',
  },
  savedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  savedCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(250,204,21,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  savedSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
  },
  forgetBtn: {
    padding: 8,
  },
  reconnectBtn: {
    backgroundColor: '#facc15',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  reconnectBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  scanButtonPrimary: {
    backgroundColor: '#facc15',
    flexDirection: 'row',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dividerText: {
    color: '#94a3b8',
    paddingHorizontal: 12,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 14,
    color: '#ffffff',
    fontSize: 15,
  },
  codeInput: {
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    fontWeight: '800',
    color: '#facc15',
  },
  button: {
    backgroundColor: '#222222',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  dangerButton: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#ffffff',
    marginTop: 24,
    width: '100%',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: '#facc15',
    backgroundColor: 'rgba(250,204,21,0.1)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  successCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 32,
    margin: 24,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#22c55e',
    marginTop: 16,
    marginBottom: 6,
  },
  successText: {
    color: '#94a3b8',
    fontSize: 15,
    marginBottom: 8,
  },
  transportBadge: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 30,
    textAlign: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#facc15',
    backgroundColor: 'transparent',
  },
  cancelScanBtn: {
    marginTop: 40,
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#ffffff',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  btRefreshBtn: {
    padding: 4,
  },
  btHint: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 16,
  },
  emptyBt: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyBtText: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 14,
  },
  scanBtBtn: {
    backgroundColor: 'rgba(250,204,21,0.15)',
    borderWidth: 1,
    borderColor: '#facc15',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  scanBtBtnText: {
    color: '#facc15',
    fontWeight: '700',
    fontSize: 13,
  },
  btDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  btIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(250,204,21,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btDeviceName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  btDeviceAddr: {
    color: '#94a3b8',
    fontSize: 11,
  }
});
