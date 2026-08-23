import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Alert, Linking, Platform, TouchableOpacity,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { router, useLocalSearchParams } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { MODELS_DIR, MODEL_FILENAME } from '@/ai/engine'
import { ActionButton } from '@/ui/components/ActionButton'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'

// All models sourced from bartowski's public, ungated HuggingFace mirrors.
// promptFormat tells the engine which chat template to use for each model family.
const MB = 1024 * 1024

const MODELS = [
  {
    name: 'Llama 3.2 1B',
    maker: 'Meta',
    tag: 'Fastest',
    size: '~700 MB',
    ram: '2 GB',
    minSizeBytes: 650 * MB,
    quality: '★★★',
    speed: '★★★★★',
    desc: 'Best for older or budget devices. Fast responses, decent document analysis.',
    hfRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    promptFormat: 'llama3',
  },
  {
    name: 'Gemma 3 1B',
    maker: 'Google',
    tag: 'Compact',
    size: '~800 MB',
    ram: '2 GB',
    minSizeBytes: 700 * MB,
    quality: '★★★★',
    speed: '★★★★★',
    desc: "Google's tiny powerhouse. Surprisingly strong at reading and explaining documents.",
    hfRepo: 'bartowski/gemma-3-1b-it-GGUF',
    filename: 'gemma-3-1b-it-Q4_K_M.gguf',
    promptFormat: 'gemma',
  },
  {
    name: 'Qwen 2.5 1.5B',
    maker: 'Alibaba',
    tag: 'Recommended',
    size: '~1.0 GB',
    ram: '2 GB',
    minSizeBytes: 900 * MB,
    quality: '★★★★',
    speed: '★★★★',
    desc: 'Best all-round choice for most phones. Great at instruction following and analysis.',
    hfRepo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'Gemma 2 2B',
    maker: 'Google',
    tag: 'Balanced',
    size: '~1.6 GB',
    ram: '3 GB',
    minSizeBytes: 1400 * MB,
    quality: '★★★★',
    speed: '★★★★',
    desc: "Google's efficient 2B model. Excellent instruction-following and legal reasoning.",
    hfRepo: 'bartowski/gemma-2-2b-it-GGUF',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    promptFormat: 'gemma',
  },
  {
    name: 'Ministral 3B',
    maker: 'Mistral AI',
    tag: 'Strong',
    size: '~1.9 GB',
    ram: '3 GB',
    minSizeBytes: 1700 * MB,
    quality: '★★★★★',
    speed: '★★★',
    desc: "Mistral AI's compact model. Strong reasoning and very precise at following instructions.",
    hfRepo: 'bartowski/Ministral-3b-instruct-GGUF',
    filename: 'Ministral-3b-instruct-Q4_K_M.gguf',
    promptFormat: 'mistral',
  },
  {
    name: 'Phi-3.5 Mini',
    maker: 'Microsoft',
    tag: 'High Quality',
    size: '~2.2 GB',
    ram: '4 GB',
    minSizeBytes: 2000 * MB,
    quality: '★★★★★',
    speed: '★★★',
    desc: Platform.OS === 'ios'
      ? 'Great quality. Runs fast on iPhone 14+ with Metal GPU. Needs 4 GB RAM.'
      : 'High quality. Requires a device with 4 GB RAM.',
    hfRepo: 'bartowski/Phi-3.5-mini-instruct-GGUF',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
    promptFormat: 'chatml',
  },
  {
    name: 'Mistral 7B v0.3',
    maker: 'Mistral AI',
    tag: 'Powerful',
    size: '~4.1 GB',
    ram: '6 GB',
    minSizeBytes: 3800 * MB,
    quality: '★★★★★',
    speed: '★★',
    desc: "Mistral AI's flagship 7B model. Best possible quality — requires a high-end device with 6+ GB RAM.",
    hfRepo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    promptFormat: 'mistral',
  },
]

type DownloadState = 'idle' | 'downloading' | 'done' | 'error'

export default function ModelSetupScreen() {
  const { preselect } = useLocalSearchParams<{ preselect?: string }>()
  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [progress, setProgress] = useState(0)
  const [downloadedMB, setDownloadedMB] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState(preselect ? Number(preselect) : 1)
  const [modelInstalled, setModelInstalled] = useState(false)

  useEffect(() => {
    checkExisting().then(setModelInstalled)
  }, [])

  async function checkExisting() {
    const path = MODELS_DIR + MODEL_FILENAME
    const info = await FileSystem.getInfoAsync(path)
    return info.exists
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
              setModelInstalled(false)
              downloadModel()
            },
          },
        ]
      )
      return
    }

    Alert.alert(
      'Download AI Model',
      `This will download the ${MODELS[selectedIdx].name} model (${MODELS[selectedIdx].size}). ` +
        'Download once via Wi-Fi — the model stays on your device and is never sent anywhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: downloadModel },
      ]
    )
  }

  async function downloadModel() {
    const model = MODELS[selectedIdx]
    // ?download=true tells HuggingFace to serve the raw binary directly
    // instead of returning an HTML redirect or preview page.
    const url = `https://huggingface.co/${model.hfRepo}/resolve/main/${model.filename}?download=true`

    // Ensure models directory exists
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR)
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })
    }

    const destPath = MODELS_DIR + MODEL_FILENAME
    setDownloadState('downloading')
    setProgress(0)

    try {
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        destPath,
        {},
        (dp) => {
          const pct = dp.totalBytesExpectedToWrite > 0
            ? dp.totalBytesWritten / dp.totalBytesExpectedToWrite
            : 0
          setProgress(pct)
          setDownloadedMB(dp.totalBytesWritten / MB)
        }
      )

      const result = await downloadResumable.downloadAsync()
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
          `Download incomplete — got ${got} MB but expected at least ${need} MB.\n\nStay on this screen and keep the app open during download. Try again on Wi-Fi.`
        )
      }

      // Write metadata so the engine knows which prompt format to use.
      await FileSystem.writeAsStringAsync(
        MODELS_DIR + 'model-meta.json',
        JSON.stringify({ format: model.promptFormat, name: model.name, filename: model.filename })
      )

      setDownloadState('done')
      setTimeout(() => router.back(), 1500)
    } catch (err: unknown) {
      setDownloadState('error')
      // Remove partial file so it doesn't get mistaken for a valid model
      try { await FileSystem.deleteAsync(destPath, { idempotent: true }) } catch {}
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Download Failed', msg)
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

      {/* Model selection */}
      <Text style={styles.sectionTitle}>Choose a Model</Text>
      {MODELS.map((model, i) => (
        <View
          key={i}
          style={[styles.modelCard, i === selectedIdx && styles.modelCardSelected]}
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
                <Text style={styles.modelName}>{model.name}</Text>
                <View style={[styles.tagChip, i === selectedIdx && styles.tagChipSelected]}>
                  <Text style={[styles.tagText, i === selectedIdx && styles.tagTextSelected]}>
                    {model.tag}
                  </Text>
                </View>
              </View>
              <Text style={styles.modelMaker}>{model.maker}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.modelDesc}>{model.desc}</Text>
          <View style={styles.modelStats}>
            <Text style={styles.statLabel}>Quality: <Text style={styles.statValue}>{model.quality}</Text></Text>
            <Text style={styles.statLabel}>Speed: <Text style={styles.statValue}>{model.speed}</Text></Text>
            <Text style={styles.statLabel}>Size: <Text style={styles.statValue}>{model.size}</Text></Text>
            <Text style={styles.statLabel}>RAM: <Text style={styles.statValue}>{model.ram}</Text></Text>
          </View>
        </View>
      ))}

      {/* Download progress */}
      {downloadState === 'downloading' && (
        <View style={styles.progressBox}>
          <Text style={styles.progressLabel}>
            Downloading… {Math.round(progress * 100)}% ({downloadedMB.toFixed(0)} MB / {MODELS[selectedIdx].size})
          </Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressHint}>
            Keep this screen open and do not lock your phone. This will take a few minutes on Wi-Fi.
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
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  hero: { alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xl },
  heroTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary },
  heroDesc: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },

  installedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.lowBg,
    borderWidth: 1,
    borderColor: Colors.success,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
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
    marginBottom: Spacing.md,
  },
  switchBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.warning,
    lineHeight: 20,
  },

  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
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
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  modelRadio: { flexShrink: 0 },
  modelInfo: { flex: 1 },
  modelNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  modelName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  modelMaker: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.round,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tagText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  tagTextSelected: { color: Colors.primaryText },
  modelSize: { fontSize: FontSize.sm, color: Colors.textMuted },
  modelDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  modelStats: { flexDirection: 'row', gap: Spacing.lg },
  statLabel: { fontSize: FontSize.sm, color: Colors.textMuted },
  statValue: { color: Colors.textPrimary, fontWeight: '600' },

  progressBox: { gap: Spacing.sm, marginVertical: Spacing.md },
  progressLabel: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: '600' },
  progressBarBg: {
    height: 10,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.round,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.round,
  },
  progressHint: { fontSize: FontSize.sm, color: Colors.textMuted },

  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.lowBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginVertical: Spacing.md,
  },
  successText: { fontSize: FontSize.md, color: Colors.success, fontWeight: '600' },

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
