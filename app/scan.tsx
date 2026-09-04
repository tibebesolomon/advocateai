import React, { useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import { queueCapture } from '@/ocr/pendingCapture'

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [flash, setFlash] = useState<'off' | 'on'>('off')
  const [capturing, setCapturing] = useState(false)
  const [capturedPages, setCapturedPages] = useState<string[]>([])
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

  function navigateToReview(pages: string[]) {
    if (pages.length === 0) return
    // Store URIs in module-level store — avoids URL-encoding corruption of file:/// paths
    queueCapture({ uris: pages })
    router.replace('/review')
  }

  async function capture() {
    if (capturing || !cameraRef.current) return
    setCapturing(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

    // Longer pause so autofocus can settle after vibration
    await new Promise(r => setTimeout(r, 700))

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
        exif: false,
      })
      if (photo?.uri) {
        const newPages = [...capturedPages, photo.uri]
        setCapturedPages(newPages)
      }
    } catch {
      Alert.alert('Capture failed', 'Could not take photo. Please try again.')
    } finally {
      setCapturing(false)
    }
  }

  // System camera: better autofocus + built-in crop editor
  async function captureWithSystemCamera() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Camera access needed', 'Allow camera access in Settings.')
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 1,
        allowsEditing: true,   // built-in crop: user squares up the document
        allowsMultipleSelection: false,
        exif: false,
      })
      if (!result.canceled && result.assets[0]) {
        const newPages = [...capturedPages, result.assets[0].uri]
        setCapturedPages(newPages)
      }
    } catch {
      Alert.alert('Camera failed', 'Could not open camera. Please try again.')
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

        {/* Page counter badge */}
        {capturedPages.length > 0 && (
          <View style={styles.pageCountBadge}>
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
            <Text style={styles.pageCountText}>{capturedPages.length} page{capturedPages.length > 1 ? 's' : ''} captured</Text>
          </View>
        )}

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
        {capturedPages.length === 0 ? (
          <View style={styles.tipsRow}>
            <View style={styles.tipChip}><MaterialIcons name="wb-sunny" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Good light</Text></View>
            <View style={styles.tipChip}><MaterialIcons name="straighten" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Lay doc flat</Text></View>
            <View style={styles.tipChip}><MaterialIcons name="crop-free" size={12} color="rgba(255,255,255,0.85)" /><Text style={styles.tipText}>Fill frame</Text></View>
          </View>
        ) : (
          <Text style={styles.nextPageHint}>Scan next page or tap Done</Text>
        )}

        <View style={styles.captureRow}>
          {/* Done button — only shown after first page */}
          {capturedPages.length > 0 && (
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => navigateToReview(capturedPages)}
              accessibilityLabel={`Done — ${capturedPages.length} pages`}
            >
              <MaterialIcons name="check" size={20} color="#fff" />
              <Text style={styles.doneBtnText}>Done ({capturedPages.length})</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.captureBtn, capturing && styles.captureBtnBusy]}
            onPress={capture}
            disabled={capturing}
            accessibilityRole="button"
            accessibilityLabel={capturedPages.length > 0 ? 'Capture next page' : 'Capture document'}
          >
            <View style={styles.captureInner} />
          </TouchableOpacity>

          {/* System camera with crop — better quality for detailed text */}
          <TouchableOpacity
            style={styles.altCameraBtn}
            onPress={captureWithSystemCamera}
            disabled={capturing}
            accessibilityLabel="Use system camera with crop"
          >
            <MaterialIcons name="crop" size={18} color="#fff" />
            <Text style={styles.altCameraText}>Crop Mode</Text>
          </TouchableOpacity>
        </View>
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

  pageCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: Radius.round,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  pageCountText: {
    color: Colors.success,
    fontSize: FontSize.sm,
    fontWeight: '700',
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
  nextPageHint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FontSize.sm,
    fontWeight: '600',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    width: '100%',
    paddingHorizontal: Spacing.xl,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success,
    borderRadius: Radius.round,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  doneBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
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
  altCameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.round,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  altCameraText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
})
