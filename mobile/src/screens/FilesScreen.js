import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export default function FilesScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [transfers, setTransfers] = useState([]);

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);
    const unsubFile = ConnectionService.on('file:received', (data) => {
      setTransfers(prev => [{ ...data, direction: 'received', status: 'done' }, ...prev]);
    });

    return () => {
      unsubConn();
      unsubFile();
    };
  }, []);

  const handlePickAndSend = async () => {
    if (!isConnected) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;

      const file = result.assets[0];
      
      // Add to transfers list
      const transferId = Date.now().toString();
      setTransfers(prev => [{
        id: transferId,
        name: file.name,
        size: file.size,
        direction: 'sent',
        status: 'uploading'
      }, ...prev]);

      // Upload file to PC Server
      const serverUrl = ConnectionService.serverUrl;
      
      const response = await FileSystem.uploadAsync(`${serverUrl}/api/upload`, file.uri, {
        fieldName: 'file',
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      });

      if (response.status !== 200) throw new Error('Upload failed');
      
      // Update status
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'done' } : t));

    } catch (err) {
      console.error(err);
      // Could show error toast here
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
        <Text style={styles.title}>Files</Text>
      </View>

      <TouchableOpacity style={styles.uploadArea} onPress={handlePickAndSend}>
        <Ionicons name="cloud-upload-outline" size={48} color="#6366f1" />
        <Text style={styles.uploadTitle}>Send File to PC</Text>
        <Text style={styles.uploadSubtitle}>Tap to browse files</Text>
      </TouchableOpacity>

      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Recent Transfers</Text>
        
        <ScrollView style={styles.list}>
          {transfers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No recent file transfers</Text>
            </View>
          ) : (
            transfers.map((item, index) => (
              <View key={item.id || index} style={styles.fileItem}>
                <View style={styles.iconBox}>
                  <Ionicons 
                    name={item.direction === 'sent' ? 'arrow-up' : 'arrow-down'} 
                    size={20} 
                    color={item.direction === 'sent' ? '#6366f1' : '#22c55e'} 
                  />
                </View>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.fileMeta}>
                    {formatSize(item.size)} • {item.direction === 'sent' ? 'Sent' : 'Received'}
                  </Text>
                </View>
                <View style={styles.fileStatus}>
                  {item.status === 'uploading' ? (
                    <Text style={styles.statusTextWarn}>Uploading...</Text>
                  ) : (
                    <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
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
  uploadArea: {
    margin: 16, padding: 32, backgroundColor: '#12121a',
    borderRadius: 16, borderWidth: 2, borderColor: 'rgba(99,102,241,0.3)',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center'
  },
  uploadTitle: { fontSize: 18, fontWeight: 'bold', color: '#f1f5f9', marginTop: 16 },
  uploadSubtitle: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  listContainer: { flex: 1, paddingHorizontal: 16 },
  listTitle: { fontSize: 16, fontWeight: 'bold', color: '#f1f5f9', marginBottom: 12 },
  list: { flex: 1 },
  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#475569' },
  fileItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    backgroundColor: '#12121a', borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)'
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12
  },
  fileInfo: { flex: 1 },
  fileName: { color: '#f1f5f9', fontWeight: '500', fontSize: 15 },
  fileMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  fileStatus: { marginLeft: 12 },
  statusTextWarn: { color: '#f59e0b', fontSize: 12 }
});
