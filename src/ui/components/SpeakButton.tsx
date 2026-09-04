import React, { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { Colors, Radius, TouchTarget } from '../theme'
import { speak, stopSpeaking, isSpeaking } from '@/voice/tts'

interface Props {
  /** The text that will be read aloud. */
  text: string
  /** Icon size (default 24). */
  size?: number
  /** Color when idle. Defaults to textSecondary. */
  color?: string
  style?: object
  accessibilityLabel?: string
}

/**
 * Tap-to-listen button. Reads `text` aloud via device TTS.
 * Second tap stops playback. Animates while speaking.
 */
export function SpeakButton({ text, size = 24, color, style, accessibilityLabel }: Props) {
  const [speaking, setSpeaking] = useState(false)
  const pulse = useRef(new Animated.Value(1)).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (speaking) {
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      )
      animRef.current.start()
    } else {
      animRef.current?.stop()
      pulse.setValue(1)
    }
  }, [speaking])

  // Stop speech when component unmounts (e.g. navigation away)
  useEffect(() => {
    return () => { stopSpeaking() }
  }, [])

  async function toggle() {
    const currently = await isSpeaking()
    if (currently || speaking) {
      await stopSpeaking()
      setSpeaking(false)
    } else {
      setSpeaking(true)
      await speak(text, {
        onDone: () => setSpeaking(false),
        onStopped: () => setSpeaking(false),
      })
      setSpeaking(false)
    }
  }

  return (
    <Animated.View style={[{ transform: [{ scale: pulse }] }, style]}>
      <TouchableOpacity
        style={[styles.btn, speaking && styles.btnActive]}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={speaking ? 'Stop reading aloud' : (accessibilityLabel ?? 'Read aloud')}
        accessibilityState={{ selected: speaking }}
        accessibilityHint={speaking ? 'Tap to stop' : 'Tap to hear this content read aloud'}
      >
        <MaterialIcons
          name={speaking ? 'stop-circle' : 'volume-up'}
          size={size}
          color={speaking ? Colors.primary : (color ?? Colors.textSecondary)}
        />
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: TouchTarget.min,
    height: TouchTarget.min,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: 'rgba(74,158,255,0.12)',
  },
})
