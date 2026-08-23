import React, { useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [flash, setFlash] = useState<'off' | 'on'>('off')
  const [capturing, setCapturing] = useState(false)
  const cameraRef = useRef<CameraView>(null)

  if (!permission) return <View style={styles.container} />

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <MaterialIcons name="camera-alt" size={48} color={Colors.textSecondary} />
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionDesc}>
            AdvocateAI needs camera access to scan your documents. No photos are stored on any server.
          </Text>
          <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
            <Text style={styles.grantBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  async function capture() {
    if (capturing || !cameraRef.current) return
    setCapturing(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

    // Brief pause so autofocus can settle after the button tap vibration
    await new Promise(r => setTimeout(r, 400))

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,           // maximum — we apply our own compression in preprocessing
        skipProcessing: false,
        exif: false,          // strip EXIF to avoid GPS/device metadata in stored images
      })
      if (photo?.uri) {
        router.replace({ pathname: '/review', params: { uri: photo.uri } })
      }
    } catch {
      Alert.alert('Capture failed', 'Could not take photo. Please try again.')
      setCapturing(false)
    }
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flash}
        autofocus="on"
      />

      {/* Document frame overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Text style={styles.hint}>Align document with frame corners</Text>
      </View>

      {/* Top controls */}
      <SafeAreaView style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="close" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))}
          accessibilityLabel={`Flash is ${flash}. Tap to toggle.`}
        >
          <MaterialIcons
            name={flash === 'on' ? 'flash-on' : 'flash-off'}
            size={28}
            color={flash === 'on' ? Colors.warning : Colors.textPrimary}
          />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Capture button */}
      <View style={styles.bottomBar}>
        <View style={styles.tipsRow}>
          <View style={styles.tipChip}><MaterialIcons name="wb-sunny" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Good light</Text></View>
          <View style={styles.tipChip}><MaterialIcons name="straighten" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Flat surface</Text></View>
          <View style={styles.tipChip}><MaterialIcons name="crop-free" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Fill frame</Text></View>
        </View>
        <TouchableOpacity
          style={[styles.captureBtn, capturing && styles.captureBtnBusy]}
          onPress={capture}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel="Capture document"
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const CORNER = 24

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  permissionTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  permissionDesc: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  grantBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    marginTop: Spacing.md,
  },
  grantBtnText: { color: Colors.primaryText, fontWeight: '700', fontSize: FontSize.md },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  frame: {
    width: '80%',
    aspectRatio: 0.72, // A4/Letter portrait
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: Colors.primary,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: FontSize.sm,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  bottomBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  tipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  tipChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.round,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnBusy: { opacity: 0.5 },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
})
