import Constants from 'expo-constants';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView as NativeWebView } from 'react-native-webview';

import AppSplash from '@/components/app-splash';

// react-native-webview's class typing does not match the React 19 types, so it is used through a loose type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebView = NativeWebView as unknown as React.ComponentType<any>;

const PORT = 5190; // the Musabe web system (frontend, Vite). It forwards /api to the backend on 4310.

// In Expo Go the phone already knows this computer's address (the one in the exp:// link), so reuse it.
function systemUrl() {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${PORT}/`;
}

export default function Staff() {
  const [splash, setSplash] = useState(true);
  const [error, setError] = useState(false);
  const web = useRef<{ reload: () => void }>(null);
  const url = systemUrl();
  const done = useCallback(() => setSplash(false), []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {error ? (
          <View style={styles.center}>
            <Text style={styles.h}>Cannot reach the system</Text>
            <Text style={styles.p}>
              {url}{'\n'}Check that the phone and the computer are on the same Wi-Fi and that the web system and the backend are running.
            </Text>
            <Text style={styles.btn} onPress={() => { setError(false); web.current?.reload(); }}>Try again</Text>
          </View>
        ) : (
          <WebView ref={web} source={{ uri: url }} style={styles.root} startInLoadingState sharedCookiesEnabled thirdPartyCookiesEnabled
            renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} color="#16794a" />}
            onError={() => setError(true)} onHttpError={(e: { nativeEvent: { statusCode: number } }) => { if (e.nativeEvent.statusCode >= 500) setError(true); }} />
        )}
      </SafeAreaView>
      {splash && <AppSplash variant="parents" onDone={done} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c3a29' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#f4f8f5' },
  h: { fontSize: 20, fontWeight: '700', color: '#13241b', marginBottom: 10 },
  p: { color: '#587064', textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 20, color: '#fff', backgroundColor: '#16794a', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, overflow: 'hidden', fontWeight: '600' },
});
