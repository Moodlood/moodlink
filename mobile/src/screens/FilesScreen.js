import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import ConnectionService from '../services/ConnectionService';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

export default function FilesScreen() {
  const [isConnected, setIsConnected] = useState(ConnectionService.isConnected);
  const [transfers, setTransfers] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'received' | 'sent'
  const [isUploading, setIsUploading] = useState(false);
  const [latestScreenshot, setLatestScreenshot] = useState(null);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    try {
      Haptics.impactAsync(style).catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    const unsubConn = ConnectionService.on('connectionChanged', setIsConnected);

    // Listen for regular file sent from PC
    const handleFileAvailable = (data) => {
      if (data.sender === 'phone') return;

      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      setTransfers(prev => {
        if (prev.some(t => t.id === data.id)) return prev;
        return [{
          id: data.id || Date.now().toString(),
          name: data.name,
          size: data.size,
          savedAs: data.savedAs,
          direction: 'received',
          status: 'ready',
          localUri: null,
          timestamp: data.timestamp || Date.now()
        }, ...prev];
      });
    };

    // Listen for PC Snipping Tool Screenshots (Win + Shift + S)
    const handlePCScreenshot = (data) => {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      setLatestScreenshot(data);

      const shotItem = {
        id: 'shot_' + Date.now(),
        name: data.filename || 'pc_screenshot.png',
        url: data.url || `/api/clipboard/download/${data.filename}`,
        size: 0,
        direction: 'received',
        status: 'ready',
        isScreenshot: true,
        timestamp: data.timestamp || Date.now()
      };

      setTransfers(prev => [shotItem, ...prev]);
    };

    const unsubAvail = ConnectionService.on('file:available', handleFileAvailable);
    const unsubRecv = ConnectionService.on('file:received', handleFileAvailable);
    const unsubShot = ConnectionService.on('clipboard:pc:screenshot', handlePCScreenshot);

    return () => {
      unsubConn();
      unsubAvail();
      unsubRecv();
      unsubShot();
    };
  }, []);

  // Send file from Phone to PC
  const handlePickAndSend = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Connect to your PC first to send files.');
      return;
    }

    try {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      const transferId = Date.now().toString();

      setIsUploading(true);
      setTransfers(prev => [{
        id: transferId,
        name: file.name,
        size: file.size,
        direction: 'sent',
        status: 'uploading',
        timestamp: Date.now()
      }, ...prev]);

      const serverUrl = ConnectionService.serverUrl;
      if (!serverUrl) throw new Error('No server URL configured');

      const response = await FileSystem.uploadAsync(`${serverUrl}/api/upload`, file.uri, {
        fieldName: 'file',
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        headers: {
          'x-sender': 'phone'
        }
      });

      setIsUploading(false);

      if (response.status >= 200 && response.status < 300) {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
        setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'done' } : t));
        Alert.alert('Transfer Complete', `"${file.name}" sent to your PC!`);
      } else {
        throw new Error(`Upload returned status ${response.status}`);
      }

    } catch (err) {
      setIsUploading(false);
      console.error('File send error:', err);
      triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      Alert.alert('Transfer Failed', err.message || 'Could not upload file to PC.');
      setTransfers(prev => prev.map(t => t.status === 'uploading' ? { ...t, status: 'failed' } : t));
    }
  };

  // Download file or screenshot from PC to Phone
  const handleDownloadFile = async (item) => {
    try {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      const serverUrl = ConnectionService.serverUrl;
      if (!serverUrl) throw new Error('No server URL configured');

      setTransfers(prev => prev.map(t => t.id === item.id ? { ...t, status: 'downloading' } : t));

      const downloadUrl = item.url ? `${serverUrl}${item.url}` : `${serverUrl}/api/download/${item.savedAs}`;
      const destinationUri = `${FileSystem.documentDirectory}${item.name}`;

      const res = await FileSystem.downloadAsync(downloadUrl, destinationUri);

      if (res.status === 200) {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
        setTransfers(prev => prev.map(t => t.id === item.id ? { ...t, status: 'downloaded', localUri: res.uri } : t));
        Alert.alert('Download Complete', `File saved to device.\nTap "Open" to view or share.`);
      } else {
        throw new Error(`Download failed with status ${res.status}`);
      }
    } catch (err) {
      console.error('File download error:', err);
      triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      Alert.alert('Download Failed', err.message || 'Could not download file from PC.');
      setTransfers(prev => prev.map(t => t.id === item.id ? { ...t, status: 'failed' } : t));
    }
  };

  // Open or share downloaded file
  const handleOpenFile = async (item) => {
    try {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      const uri = item.localUri || `${FileSystem.documentDirectory}${item.name}`;
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        return handleDownloadFile(item);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('File Location', `File is stored at:\n${uri}`);
      }
    } catch (err) {
      console.error('Open file error:', err);
      Alert.alert('Cannot Open', err.message || 'Failed to open file.');
    }
  };

  const handleDownloadLatestScreenshot = async () => {
    if (!latestScreenshot) return;
    const item = {
      id: 'shot_' + Date.now(),
      name: latestScreenshot.filename,
      url: latestScreenshot.url,
      isScreenshot: true
    };
    await handleDownloadFile(item);
    setLatestScreenshot(null);
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'N/A';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName, isScreenshot) => {
    if (isScreenshot) return 'camera-outline';
    const ext = fileName ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : '';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image-outline';
    if (['.mp4', '.mkv', '.mov', '.avi'].includes(ext)) return 'videocam-outline';
    if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'musical-notes-outline';
    if (['.pdf'].includes(ext)) return 'document-text-outline';
    if (['.zip', '.rar', '.7z', '.tar'].includes(ext)) return 'archive-outline';
    return 'document-outline';
  };

  const filteredTransfers = transfers.filter(t => {
    if (filter === 'received') return t.direction === 'received';
    if (filter === 'sent') return t.direction === 'sent';
    return true;
  });

  if (!isConnected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Ionicons name="link-outline" size={54} color="#facc15" />
        <Text style={styles.disconnectedTitle}>Not Connected</Text>
        <Text style={styles.disconnectedText}>Connect to your PC first to transfer files</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>File Transfer</Text>
          <Text style={styles.subtitle}>Two-way transfer between Phone &amp; PC</Text>
        </View>

        {transfers.length > 0 && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => {
              triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
              setTransfers([]);
            }}
          >
            <Ionicons name="trash-outline" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* PC Snipping Tool Alert Banner */}
      {latestScreenshot && (
        <View style={styles.screenshotBanner}>
          <View style={styles.screenshotBannerHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="cut" size={16} color="#facc15" />
              <Text style={styles.screenshotTitle}>PC Snipping Tool Screenshot</Text>
            </View>
            <TouchableOpacity onPress={() => setLatestScreenshot(null)}>
              <Ionicons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
          <Text style={styles.screenshotSub} numberOfLines={1}>
            Captured via Win+Shift+S: {latestScreenshot.filename}
          </Text>
          <TouchableOpacity
            style={styles.screenshotActionBtn}
            onPress={handleDownloadLatestScreenshot}
          >
            <Ionicons name="download-outline" size={16} color="#000000" />
            <Text style={styles.screenshotActionBtnText}>Save Screenshot to Phone</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Upload Action Card */}
      <TouchableOpacity
        style={styles.uploadArea}
        onPress={handlePickAndSend}
        activeOpacity={0.8}
        disabled={isUploading}
      >
        <View style={styles.uploadIconCircle}>
          {isUploading ? (
            <ActivityIndicator size="large" color="#facc15" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={36} color="#facc15" />
          )}
        </View>
        <Text style={styles.uploadTitle}>
          {isUploading ? 'Sending file to PC...' : 'Send File to PC'}
        </Text>
        <Text style={styles.uploadSubtitle}>
          {isUploading ? 'Please wait while uploading' : 'Tap to choose photos, documents, or videos'}
        </Text>
      </TouchableOpacity>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          onPress={() => { setFilter('all'); triggerHaptic(); }}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            All ({transfers.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'received' && styles.filterChipActive]}
          onPress={() => { setFilter('received'); triggerHaptic(); }}
        >
          <Text style={[styles.filterText, filter === 'received' && styles.filterTextActive]}>
            Received ({transfers.filter(t => t.direction === 'received').length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'sent' && styles.filterChipActive]}
          onPress={() => { setFilter('sent'); triggerHaptic(); }}
        >
          <Text style={[styles.filterText, filter === 'sent' && styles.filterTextActive]}>
            Sent ({transfers.filter(t => t.direction === 'sent').length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Transfers List */}
      <View style={styles.listContainer}>
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
          {filteredTransfers.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={48} color="#333333" />
              <Text style={styles.emptyText}>No transfers yet</Text>
              <Text style={styles.emptySubText}>Files sent from your PC or phone will appear here</Text>
            </View>
          ) : (
            filteredTransfers.map((item, index) => (
              <View key={item.id || index} style={styles.fileItem}>
                <View style={styles.iconBox}>
                  <Ionicons
                    name={getFileIcon(item.name, item.isScreenshot)}
                    size={22}
                    color={item.isScreenshot ? '#facc15' : item.direction === 'sent' ? '#facc15' : '#22c55e'}
                  />
                </View>

                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.fileMeta}>
                    {item.isScreenshot ? 'PC Screenshot' : `${formatSize(item.size)} • ${item.direction === 'sent' ? 'Sent to PC' : 'Received from PC'}`}
                  </Text>
                </View>

                <View style={styles.fileActionCol}>
                  {item.direction === 'received' ? (
                    item.status === 'downloaded' ? (
                      <TouchableOpacity
                        style={styles.openBtn}
                        onPress={() => handleOpenFile(item)}
                      >
                        <Ionicons name="share-outline" size={16} color="#000000" />
                        <Text style={styles.openBtnText}>Open</Text>
                      </TouchableOpacity>
                    ) : item.status === 'downloading' ? (
                      <ActivityIndicator size="small" color="#facc15" />
                    ) : (
                      <TouchableOpacity
                        style={styles.downloadBtn}
                        onPress={() => handleDownloadFile(item)}
                      >
                        <Ionicons name="download-outline" size={16} color="#000000" />
                        <Text style={styles.downloadBtnText}>Save</Text>
                      </TouchableOpacity>
                    )
                  ) : item.status === 'uploading' ? (
                    <ActivityIndicator size="small" color="#facc15" />
                  ) : item.status === 'failed' ? (
                    <Ionicons name="alert-circle" size={24} color="#facc15" />
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
  container: { flex: 1, backgroundColor: '#000000' },
  disconnectedContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32
  },
  disconnectedTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 8
  },
  disconnectedText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20
  },
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
  title: { fontSize: 20, fontWeight: '800', color: '#ffffff' },
  subtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  clearBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#161616',
  },
  screenshotBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#facc15',
    borderRadius: 14,
    padding: 12,
  },
  screenshotBannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  screenshotTitle: {
    color: '#facc15',
    fontSize: 13,
    fontWeight: '800',
  },
  screenshotSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  screenshotActionBtn: {
    backgroundColor: '#facc15',
    borderRadius: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  screenshotActionBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  uploadArea: {
    margin: 16,
    padding: 24,
    backgroundColor: '#111111',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#facc15',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center'
  },
  uploadIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  uploadTitle: { fontSize: 17, fontWeight: '800', color: '#ffffff' },
  uploadSubtitle: { fontSize: 13, color: '#94a3b8', marginTop: 4 },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterChipActive: {
    backgroundColor: '#facc15',
    borderColor: '#facc15',
  },
  filterText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  listContainer: { flex: 1, paddingHorizontal: 16 },
  list: { flex: 1 },
  emptyState: { padding: 48, alignItems: 'center' },
  emptyText: { color: '#94a3b8', fontSize: 16, fontWeight: '600', marginTop: 12 },
  emptySubText: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 4 },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#111111',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  fileInfo: { flex: 1 },
  fileName: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  fileMeta: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  fileActionCol: { marginLeft: 10 },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#facc15',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  downloadBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  openBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  }
});
