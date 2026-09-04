import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Alert, Linking, TouchableOpacity,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Device from 'expo-device'
import * as Network from 'expo-network'
import { router, useLocalSearchParams } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { MODELS_DIR, MODEL_FILENAME } from '@/ai/engine'
import { ActionButton } from '@/ui/components/ActionButton'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'

// All models use Apache 2.0 licenses and are freely downloadable without a HuggingFace account.
// promptFormat tells the engine which chat template to use for each model family.
const MB = 1024 * 1024
const GB = 1024 * MB

const MODELS = [
  {
    name: 'Qwen 2.5 0.5B',
    maker: 'Alibaba',
    tag: 'Lightest',
    size: '~380 MB',
    ram: '1 GB',
    minRamBytes: 1 * GB,
    minSizeBytes: 340 * MB,
    quality: '★★',
    speed: '★★★★★',
    desc: 'For very old or budget devices with limited RAM. Ultra-fast, basic document reading.',
    features: ['Plain-language summary', 'Document type detection', 'Basic deadline info'],
    limitations: 'Letter quality may be generic',
    hfRepo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF',
    filename: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'Qwen 2.5 1.5B',
    maker: 'Alibaba',
    tag: 'Recommended',
    size: '~1.0 GB',
    ram: '2 GB',
    minRamBytes: 2 * GB,
    minSizeBytes: 900 * MB,
    quality: '★★★★',
    speed: '★★★★',
    desc: 'Best all-round choice for most phones. Great at instruction following and document analysis.',
    features: ['Full analysis & severity rating', 'Dispute & appeal letters', 'Call scripts', 'Anomaly detection'],
    limitations: null,
    hfRepo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'SmolLM2 1.7B',
    maker: 'HuggingFace',
    tag: 'Compact',
    size: '~1.0 GB',
    ram: '2 GB',
    minRamBytes: 2 * GB,
    minSizeBytes: 900 * MB,
    quality: '★★★★',
    speed: '★★★★',
    desc: "HuggingFace's own efficient 1.7B model. Strong at summarising and explaining complex documents.",
    features: ['Full analysis & severity rating', 'Dispute & appeal letters', 'Call scripts', 'Anomaly detection'],
    limitations: null,
    hfRepo: 'bartowski/SmolLM2-1.7B-Instruct-GGUF',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'Qwen 2.5 3B',
    maker: 'Alibaba',
    tag: 'Balanced',
    size: '~1.8 GB',
    ram: '3 GB',
    minRamBytes: 3 * GB,
    minSizeBytes: 1600 * MB,
    quality: '★★★★★',
    speed: '★★★',
    desc: 'Higher quality analysis and letter writing. Requires a mid-range or newer device.',
    features: ['Everything in 1.5B', 'More detailed analysis', 'Better letter writing', 'Stronger rights reasoning'],
    limitations: null,
    hfRepo: 'bartowski/Qwen2.5-3B-Instruct-GGUF',
    filename: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'Qwen 2.5 7B',
    maker: 'Alibaba',
    tag: 'Powerful',
    size: '~4.5 GB',
    ram: '6 GB',
    minRamBytes: 6 * GB,
    minSizeBytes: 4000 * MB,
    quality: '★★★★★',
    speed: '★★',
    desc: 'Best possible quality — excellent legal reasoning and writing. Needs a high-end device with 6+ GB RAM.',
    features: ['Everything in 3B', 'Best legal reasoning', 'Most persuasive letters', 'Complex document handling'],
    limitations: null,
    hfRepo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
]

type DownloadState = 'idle' | 'downloading' | 'done' | 'error'

type DeviceInfo = {
  modelName: string | null
  totalRamGB: number | null
  recommendedIdx: number
  reason: string
}

function detectRecommendedModel(totalMemoryBytes: number | null): { idx: number; reason: string } {
  if (!totalMemoryBytes || totalMemoryBytes <= 0) {
    return { idx: 1, reason: 'Could not read device RAM — defaulting to 1.5B.' }
  }
  // OS and system processes use ~30-35% of RAM; leave a buffer.
  const usable = totalMemoryBytes * 0.65
  // Walk from largest to smallest, pick the first that fits.
  for (let i = MODELS.length - 1; i >= 0; i--) {
    if (usable >= MODELS[i].minRamBytes) {
      return { idx: i, reason: `${(totalMemoryBytes / GB).toFixed(1)} GB RAM detected → ${MODELS[i].name}` }
    }
  }
  return { idx: 0, reason: `Low RAM detected (${(totalMemoryBytes / GB).toFixed(1)} GB) → lightest model selected.` }
}

export default function ModelSetupScreen() {
  const { preselect } = useLocalSearchParams<{ preselect?: string }>()
  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [progress, setProgress] = useState(0)
  const [downloadedMB, setDownloadedMB] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState(preselect ? Number(preselect) : 1)
  const [modelInstalled, setModelInstalled] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null)
  const RESUME_KEY = MODELS_DIR + 'download-resume.json'

  useEffect(() => {
    checkExisting().then(setModelInstalled)
    // Only auto-detect when not coming from a failed model load (preselect overrides)
    if (!preselect) {
      detectDevice()
    }
  }, [])

  async function detectDevice() {
    try {
      const modelName = Device.modelName
      const totalMemory = await Device.getMaxMemoryAsync()
      const { idx, reason } = detectRecommendedModel(totalMemory)
      const totalRamGB = totalMemory ? totalMemory / GB : null
      setDeviceInfo({ modelName, totalRamGB, recommendedIdx: idx, reason })
      setSelectedIdx(idx)
    } catch {
      // Device API unavailable (emulator or restricted) — keep default
    }
  }

  async function checkExisting() {
    const path = MODELS_DIR + MODEL_FILENAME
    const info = await FileSystem.getInfoAsync(path)
    return info.exists
  }

  async function checkNetworkAndWarn(): Promise<boolean> {
    try {
      const state = await Network.getNetworkStateAsync()
      if (!state.isConnected || !state.isInternetReachable) {
        Alert.alert('No Internet', 'You need an internet connection to download the model.')
        return false
      }
      if (state.type !== Network.NetworkStateType.WIFI) {
        return new Promise((resolve) => {
          Alert.alert(
            'Not on Wi-Fi',
            `You are on mobile data. Downloading ${MODELS[selectedIdx].name} will use ${MODELS[selectedIdx].size} of mobile data.\n\nContinue anyway?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Download Anyway', onPress: () => resolve(true) },
            ]
          )
        })
      }
    } catch {
      // Network API unavailable — proceed without blocking
    }
    return true
  }

  async function startDownload() {
    const exists = await checkExisting()

    if (exists) {
      Alert.alert(
        'Replace AI Model',
        `This will delete your current model and download ${MODELS[selectedIdx].name} (${MODELS[selectedIdx].size}).\n\nMake sure you are on Wi-Fi.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: async () => {
              await FileSystem.deleteAsync(MODELS_DIR + MODEL_FILENAME, { idempotent: true })
              await FileSystem.deleteAsync(RESUME_KEY, { idempotent: true })
              setModelInstalled(false)
              downloadModel()
            },
          },
        ]
      )
      return
    }

    const ok = await checkNetworkAndWarn()
    if (!ok) return

    // Check if there is a saved resume state from a previously interrupted download
    const resumeInfo = await FileSystem.getInfoAsync(RESUME_KEY)
    if (resumeInfo.exists) {
      try {
        const saved = JSON.parse(await FileSystem.readAsStringAsync(RESUME_KEY)) as FileSystem.DownloadPauseState
        Alert.alert(
          'Resume Download?',
          'A previous download was interrupted. Resume where it left off?',
          [
            {
              text: 'Start Over',
              style: 'destructive',
              onPress: async () => {
                await FileSystem.deleteAsync(RESUME_KEY, { idempotent: true })
                downloadModel()
              },
            },
            { text: 'Resume', onPress: () => downloadModel(saved) },
          ]
        )
        return
      } catch {
        await FileSystem.deleteAsync(RESUME_KEY, { idempotent: true })
      }
    }

    Alert.alert(
      'Download AI Model',
      `This will download the ${MODELS[selectedIdx].name} model (${MODELS[selectedIdx].size}). ` +
        'The model stays on your device and is never sent anywhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: () => downloadModel() },
      ]
    )
  }

  async function downloadModel(resumeSaveable?: FileSystem.DownloadPauseState) {
    const model = MODELS[selectedIdx]
    const url = `https://huggingface.co/${model.hfRepo}/resolve/main/${model.filename}?download=true`

    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR)
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })
    }

    const destPath = MODELS_DIR + MODEL_FILENAME
    setDownloadState('downloading')
    setProgress(0)

    await activateKeepAwakeAsync('model-download')

    const onProgress: FileSystem.FileSystemNetworkTaskProgressCallback<FileSystem.DownloadProgressData> = (dp) => {
      const pct = dp.totalBytesExpectedToWrite > 0
        ? dp.totalBytesWritten / dp.totalBytesExpectedToWrite
        : 0
      setProgress(pct)
      setDownloadedMB(dp.totalBytesWritten / MB)

      // Persist resume state every ~5% so we can recover if the app is killed
      if (Math.round(pct * 100) % 5 === 0) {
        resumableRef.current?.pauseAsync().then((saveable) => {
          if (saveable) {
            FileSystem.writeAsStringAsync(RESUME_KEY, JSON.stringify(saveable)).catch(() => {})
            resumableRef.current?.resumeAsync().catch(() => {})
          }
        }).catch(() => {})
      }
    }

    try {
      let downloadResumable: FileSystem.DownloadResumable
      if (resumeSaveable) {
        downloadResumable = FileSystem.createDownloadResumable(
          resumeSaveable.url,
          resumeSaveable.fileUri,
          resumeSaveable.options,
          onProgress,
          resumeSaveable.resumeData,
        )
      } else {
        downloadResumable = FileSystem.createDownloadResumable(url, destPath, {}, onProgress)
      }
      resumableRef.current = downloadResumable

      const result = await downloadResumable.downloadAsync()
      resumableRef.current = null
      try { await FileSystem.deleteAsync(RESUME_KEY, { idempotent: true }) } catch {}

      const status = result?.status ?? 0

      if (status === 401 || status === 403) {
        throw new Error(
          `This model repository requires a HuggingFace account login (HTTP ${status}).\n\n` +
          `This should not happen with the selected model — please report this as a bug or try a different model.`
        )
      }

      if (status !== 200) {
        throw new Error(`Server returned HTTP ${status}. Check your internet connection and try again.`)
      }

      const info = await FileSystem.getInfoAsync(destPath)
      const size = info.exists ? info.size : 0
      if (size < model.minSizeBytes) {
        await FileSystem.deleteAsync(destPath, { idempotent: true })
        const got = (size / MB).toFixed(0)
        const need = (model.minSizeBytes / MB).toFixed(0)
        throw new Error(
          `Download incomplete — got ${got} MB but expected at least ${need} MB.\n\nTry again on Wi-Fi.`
        )
      }

      // Validate GGUF magic bytes (G G U F = 0x47 0x47 0x55 0x46)
      const headerB64 = await FileSystem.readAsStringAsync(destPath, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 4,
      })
      if (atob(headerB64) !== 'GGUF') {
        await FileSystem.deleteAsync(destPath, { idempotent: true })
        throw new Error(
          'Downloaded file is not a valid GGUF model — the server may have returned an error page.\n\nCheck your internet connection and try again.'
        )
      }

      await FileSystem.writeAsStringAsync(
        MODELS_DIR + 'model-meta.json',
        JSON.stringify({ format: model.promptFormat, name: model.name, filename: model.filename })
      )

      setDownloadState('done')
      setTimeout(() => router.back(), 1500)
    } catch (err: unknown) {
      resumableRef.current = null
      setDownloadState('error')
      try { await FileSystem.deleteAsync(destPath, { idempotent: true }) } catch {}
      try { await FileSystem.deleteAsync(RESUME_KEY, { idempotent: true }) } catch {}
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Download Failed', msg)
    } finally {
      deactivateKeepAwake('model-download')
    }
  }

  async function openManualInstructions() {
    const url = 'https://huggingface.co/docs/huggingface_hub/guides/download'
    const supported = await Linking.canOpenURL(url)
    if (supported) await Linking.openURL(url)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <View style={styles.hero}>
        <MaterialIcons name="psychology" size={56} color={Colors.primary} />
        <Text style={styles.heroTitle}>Set Up AI Model</Text>
        <Text style={styles.heroDesc}>
          AdvocateAI uses a small AI model that runs entirely on your device.
          Your documents are never sent to any server.
          Download once — works forever without internet.
        </Text>
      </View>

      {/* Device detection banner */}
      {deviceInfo && (
        <View style={styles.detectionBanner}>
          <MaterialIcons name="phone-android" size={18} color={Colors.info} />
          <View style={styles.detectionText}>
            {deviceInfo.modelName ? (
              <Text style={styles.detectionDevice}>{deviceInfo.modelName}</Text>
            ) : null}
            <Text style={styles.detectionReason}>{deviceInfo.reason}</Text>
          </View>
        </View>
      )}

      {/* Installed model banner */}
      {modelInstalled && downloadState === 'idle' && (
        <View style={styles.installedBanner}>
          <MaterialIcons name="check-circle" size={18} color={Colors.success} />
          <Text style={styles.installedBannerText}>
            AI model installed. Select a different model below and tap "Replace Model" to switch.
          </Text>
        </View>
      )}

      {/* Banner shown when redirected from a failed model load */}
      {preselect === '0' && (
        <View style={styles.switchBanner}>
          <MaterialIcons name="info-outline" size={18} color={Colors.warning} />
          <Text style={styles.switchBannerText}>
            Your previous model could not load — likely not enough device RAM.
            The smallest model below is pre-selected. It works on all devices.
          </Text>
        </View>
      )}

      {/* Device guide */}
      <View style={styles.guideCard}>
        <Text style={styles.guideTitle}>Not sure which to pick?</Text>
        <Text style={styles.guideRow}><Text style={styles.guideBold}>Old / budget phone</Text> — 0.5B (380 MB)</Text>
        <Text style={styles.guideRow}><Text style={styles.guideBold}>Most phones</Text> — 1.5B (1 GB) · best value</Text>
        <Text style={styles.guideRow}><Text style={styles.guideBold}>Mid-range / newer</Text> — 3B for better letters</Text>
        <Text style={styles.guideRow}><Text style={styles.guideBold}>Flagship (6+ GB RAM)</Text> — 7B for best quality</Text>
        <Text style={styles.guideNote}>
          All models run 100% offline. 1.5B and above write strong dispute letters.
        </Text>
      </View>

      {/* Model selection */}
      <Text style={styles.sectionTitle}>Choose a Model</Text>
      {MODELS.map((model, i) => (
        <View
          key={i}
          style={[
            styles.modelCard,
            i === selectedIdx && styles.modelCardSelected,
            deviceInfo?.recommendedIdx === i && styles.modelCardAutoRec,
          ]}
        >
          <TouchableOpacity
            style={styles.modelHeader}
            onPress={() => setSelectedIdx(i)}
            activeOpacity={0.7}
          >
            <View style={styles.modelRadio}>
              {i === selectedIdx
                ? <MaterialIcons name="radio-button-checked" size={22} color={Colors.primary} />
                : <MaterialIcons name="radio-button-unchecked" size={22} color={Colors.textMuted} />
              }
            </View>
            <View style={styles.modelInfo}>
              <View style={styles.modelNameRow}>
                <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                <View style={[styles.tagChip, i === selectedIdx && styles.tagChipSelected]}>
                  <Text style={[styles.tagText, i === selectedIdx && styles.tagTextSelected]}>
                    {deviceInfo?.recommendedIdx === i ? 'For your phone' : model.tag}
                  </Text>
                </View>
              </View>
              <Text style={styles.modelMaker}>{model.maker}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.modelDesc}>{model.desc}</Text>
          <View style={styles.featureList}>
            {model.features.map((f, fi) => (
              <View key={fi} style={styles.featureRow}>
                <MaterialIcons name="check" size={13} color={Colors.success} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
            {model.limitations && (
              <View style={styles.featureRow}>
                <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
                <Text style={[styles.featureText, { color: Colors.textMuted }]}>{model.limitations}</Text>
              </View>
            )}
          </View>
          {/* Stats — wrap on narrow screens */}
          <View style={styles.modelStats}>
            <Text style={styles.statItem}>Quality: <Text style={styles.statValue}>{model.quality}</Text></Text>
            <Text style={styles.statItem}>Speed: <Text style={styles.statValue}>{model.speed}</Text></Text>
            <Text style={styles.statItem}>Size: <Text style={styles.statValue}>{model.size}</Text></Text>
            <Text style={styles.statItem}>RAM: <Text style={styles.statValue}>{model.ram}</Text></Text>
          </View>
        </View>
      ))}

      {/* Download progress */}
      {downloadState === 'downloading' && (
        <View style={styles.progressBox}>
          <Text style={styles.progressLabel}>
            Downloading… {Math.round(progress * 100)}%
          </Text>
          <Text style={styles.progressSub}>
            {downloadedMB.toFixed(0)} MB / {MODELS[selectedIdx].size}
          </Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressHint}>
            Screen will stay on during download. Keep the app open — if interrupted, you can resume where it left off.
          </Text>
        </View>
      )}

      {downloadState === 'done' && (
        <View style={styles.successBox}>
          <MaterialIcons name="check-circle" size={32} color={Colors.success} />
          <Text style={styles.successText}>AI model installed! You're ready to go.</Text>
        </View>
      )}

      {/* Actions */}
      {downloadState !== 'done' && (
        <ActionButton
          label={
            downloadState === 'downloading' ? 'Downloading…'
              : modelInstalled ? 'Replace Model'
              : 'Download Model'
          }
          variant="primary"
          size="lg"
          loading={downloadState === 'downloading'}
          onPress={startDownload}
          style={styles.downloadBtn}
          icon={<MaterialIcons name={modelInstalled ? 'swap-horiz' : 'download'} size={22} color={Colors.primaryText} />}
          accessibilityHint={`Download the ${MODELS[selectedIdx].name} model to your device`}
        />
      )}

      <View style={styles.manualNote}>
        <MaterialIcons name="info-outline" size={16} color={Colors.textMuted} />
        <Text style={styles.manualText}>
          You can also copy a GGUF model file manually to the app's documents folder.{' '}
          <Text style={styles.manualLink} onPress={openManualInstructions}>
            See instructions
          </Text>
        </Text>
      </View>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },

  hero: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  heroTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  heroDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  detectionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: '#0D1F2D',
    borderWidth: 1,
    borderColor: Colors.info,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  detectionText: { flex: 1, gap: 2 },
  detectionDevice: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  detectionReason: { fontSize: FontSize.sm, color: Colors.info, lineHeight: 18 },

  installedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.lowBg,
    borderWidth: 1,
    borderColor: Colors.success,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  installedBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.success,
    lineHeight: 20,
  },
  switchBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: '#2D2800',
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  switchBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.warning,
    lineHeight: 20,
  },

  guideCard: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.lg, gap: Spacing.xs,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  guideRow: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  guideBold: { fontWeight: '700', color: Colors.textPrimary },
  guideNote: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 18, marginTop: 4 },

  featureList: { gap: 4, marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  featureText: { fontSize: FontSize.xs, color: Colors.textSecondary, flex: 1, lineHeight: 18 },

  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },

  modelCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  modelCardSelected: { borderColor: Colors.primary },
  modelCardAutoRec: { borderColor: Colors.info },
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modelRadio: { flexShrink: 0 },
  modelInfo: { flex: 1, minWidth: 0 },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  modelName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1 },
  modelMaker: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  tagChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.round,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  tagChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tagText: { fontSize: 10, fontWeight: '600', color: Colors.textMuted },
  tagTextSelected: { color: Colors.primaryText },
  modelDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },

  // Stats wrap into 2×2 grid on narrow screens
  modelStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    rowGap: Spacing.xs,
  },
  statItem: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    minWidth: '45%',
  },
  statValue: { color: Colors.textPrimary, fontWeight: '600' },

  progressBox: { gap: Spacing.xs, marginVertical: Spacing.md },
  progressLabel: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: '600' },
  progressSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  progressBarBg: {
    height: 10,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.round,
    overflow: 'hidden',
    marginVertical: Spacing.xs,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.round,
  },
  progressHint: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },

  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.lowBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginVertical: Spacing.md,
  },
  successText: { fontSize: FontSize.md, color: Colors.success, fontWeight: '600', flex: 1 },

  downloadBtn: { marginVertical: Spacing.md },

  manualNote: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    marginTop: Spacing.lg,
  },
  manualText: { flex: 1, fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  manualLink: { color: Colors.primary, textDecorationLine: 'underline' },
})
