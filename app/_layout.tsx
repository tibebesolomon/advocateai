import { useEffect, useRef } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Colors } from '@/ui/theme'
import { configureNotifications } from '@/notifications/deadlines'
import { hasAcceptedCurrentTerms } from '@/legal/consent'

// After this many ms in background, navigate back to the home tab on foreground
// so sensitive document screens are not exposed when the device is picked up.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

export default function RootLayout() {
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    configureNotifications()
  }, [])

  useEffect(() => {
    hasAcceptedCurrentTerms().then((accepted) => {
      if (!accepted) router.replace('/consent' as never)
    })
  }, [])

  useEffect(() => {
    function handleAppStateChange(next: AppStateStatus) {
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now()
      } else if (next === 'active') {
        const since = backgroundedAt.current
        if (since !== null && Date.now() - since >= SESSION_TIMEOUT_MS) {
          // Return to the home tab so any open document/letter screens are cleared
          router.replace('/(tabs)')
        }
        backgroundedAt.current = null
      }
    }

    const sub = AppState.addEventListener('change', handleAppStateChange)
    return () => sub.remove()
  }, [])

  return (
    <>
      <StatusBar style="light" backgroundColor={Colors.background} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ title: 'Scan Document', headerShown: false }} />
        <Stack.Screen name="review" options={{ title: 'Review Scan' }} />
        <Stack.Screen name="action" options={{ title: 'AI Analysis' }} />
        <Stack.Screen name="letter" options={{ title: 'Your Letter' }} />
        <Stack.Screen name="thread" options={{ title: 'Reply Thread' }} />
        <Stack.Screen name="chat" options={{ title: 'Your Advocate', headerShown: false }} />
        <Stack.Screen
          name="model-setup"
          options={{ title: 'Set Up AI Model', presentation: 'modal' }}
        />
        <Stack.Screen
          name="consent"
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </>
  )
}
