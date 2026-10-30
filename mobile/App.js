import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Import Screens
import ConnectScreen from './src/screens/ConnectScreen';
import TrackpadScreen from './src/screens/TrackpadScreen';
import FilesScreen from './src/screens/FilesScreen';
import PCControlScreen from './src/screens/PCControlScreen';
import MirrorScreen from './src/screens/MirrorScreen';
import PresentationScreen from './src/screens/PresentationScreen';

const Tab = createBottomTabNavigator();

const theme = {
  dark: true,
  colors: {
    primary: '#facc15',
    background: '#000000',
    card: '#0d0d0d',
    text: '#ffffff',
    border: 'rgba(255,255,255,0.08)',
    notification: '#22c55e',
  },
  fonts: Platform.select({
    ios: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '800' },
    },
    default: {
      regular: { fontFamily: 'sans-serif', fontWeight: '400' },
      medium: { fontFamily: 'sans-serif-medium', fontWeight: '500' },
      bold: { fontFamily: 'sans-serif', fontWeight: '700' },
      heavy: { fontFamily: 'sans-serif', fontWeight: '800' },
    },
  }),
};

// Error boundary to catch and display crashes instead of black screen
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('MoodLink Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: '#facc15', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>
            MoodLink Error
          </Text>
          <Text style={{ color: '#ffffff', fontSize: 14, textAlign: 'center' }}>
            {this.state.error?.toString()}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="light" backgroundColor="#000000" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerStyle: { backgroundColor: '#0d0d0d', elevation: 0, shadowOpacity: 0, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
              headerTintColor: '#ffffff',
              tabBarStyle: { backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
              tabBarActiveTintColor: '#facc15',
              tabBarInactiveTintColor: '#94a3b8',
              tabBarIcon: ({ focused, color, size }) => {
                let iconName;
                if (route.name === 'Connect') iconName = focused ? 'link' : 'link-outline';
                else if (route.name === 'Trackpad') iconName = focused ? 'radio-button-on' : 'radio-button-off';
                else if (route.name === 'Files') iconName = focused ? 'folder' : 'folder-outline';
                else if (route.name === 'System') iconName = focused ? 'laptop' : 'laptop-outline';
                else if (route.name === 'Mirror') iconName = focused ? 'camera' : 'camera-outline';
                else if (route.name === 'Present') iconName = focused ? 'easel' : 'easel-outline';
                return <Ionicons name={iconName} size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen name="Connect" component={ConnectScreen} />
            <Tab.Screen name="Trackpad" component={TrackpadScreen} />
            <Tab.Screen name="Files" component={FilesScreen} />
            <Tab.Screen name="System" component={PCControlScreen} />
            <Tab.Screen name="Mirror" component={MirrorScreen} />
            <Tab.Screen name="Present" component={PresentationScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
