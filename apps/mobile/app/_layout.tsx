import '../src/polyfills';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SessionProvider } from '../src/session';
import { registerBackgroundSync, startAutoSync } from '../src/sync';
import { useTheme } from '../src/ui';

export default function Root() {
  const c = useTheme();
  useEffect(() => {
    void registerBackgroundSync();
    return startAutoSync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: c.card }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="index" options={{ title: 'Grids' }} />
          <Stack.Screen name="project/[tenantId]/[project]" options={{ title: 'Forms' }} />
          <Stack.Screen name="fill" options={{ title: 'Fill in', gestureEnabled: false }} />
          <Stack.Screen name="outbox" options={{ title: 'Outbox' }} />
          <Stack.Screen name="history/[tenantId]/[project]" options={{ title: 'Sent' }} />
          <Stack.Screen name="link" options={{ title: 'Open a link' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
