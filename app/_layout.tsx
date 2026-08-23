import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Colors } from '@/ui/theme'
import { configureNotifications } from '@/notifications/deadlines'

export default function RootLayout() {
  useEffect(() => {
    configureNotifications()
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
      </Stack>
    </>
  )
}
