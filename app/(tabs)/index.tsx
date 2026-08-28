import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { MaterialIcons } from '@expo/vector-icons'
import { Platform } from 'react-native'
import { aiEngine } from '@/ai/engine'
import { getAllDocuments, deleteDocument } from '@/documents/store'
import { DocumentCard } from '@/ui/components/DocumentCard'
import { Colors, FontSize, Radius, Spacing, TouchTarget } from '@/ui/theme'
import { queueCapture } from '@/ocr/pendingCapture'
import type { ScannedDocument } from '@/types'

export default function HomeScreen() {
  const { width } = useWindowDimensions()
  const isTablet = width >= 600
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  const [recentDocs, setRecentDocs] = useState<ScannedDocument[]>([])

  useFocusEffect(
    useCallback(() => {
      checkModelAndLoad()
    }, [])
  )

  async function checkModelAndLoad() {
    const ready = await aiEngine.isModelReady()
    setModelReady(ready)
    try {
      const docs = await getAllDocuments()
      setRecentDocs(docs.slice(0, 3))
    } catch {
      setRecentDocs([])
    }
  }

  async function handleScan() {
    // The scan screen owns camera permission — just navigate there
    router.push('/scan')
  }

  async function handleImport() {
    // Both platforms: offer Files + Gallery
    Alert.alert('Import Document', 'Choose source:', [
      { text: 'Gallery / Photos', onPress: importFromPhotos },
      { text: 'Files / PDF', onPress: importFromFiles },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function importFromFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      })
      if (!result.canceled && result.assets[0]) {
        queueCapture({
          uris: [result.assets[0].uri],
          mimeType: result.assets[0].mimeType ?? '',
        })
        router.push('/review')
      }
    } catch {
      Alert.alert('Import failed', 'Could not open the file. Please try again.')
    }
  }

  async function importFromPhotos() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photos access needed', 'Allow photo library access in Settings to import documents.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as const,
      quality: 1,
      allowsMultipleSelection: true,
    })
    if (!result.canceled && result.assets.length > 0) {
      queueCapture({ uris: result.assets.map(a => a.uri) })
      router.push('/review')
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>⚖️</Text>
          <Text style={styles.heroTitle}>AdvocateAI</Text>
          <Text style={styles.heroSub}>
            Your free, private document advocate.{'\n'}Works completely offline.
          </Text>
        </View>

        {/* Model status banner */}
        {modelReady === false && (
          <TouchableOpacity
            style={styles.modelBanner}
            onPress={() => router.push('/model-setup')}
            accessibilityRole="button"
            accessibilityLabel="Set up AI model — tap to configure"
          >
            <MaterialIcons name="warning" size={20} color={Colors.warning} />
            <Text style={styles.modelBannerText}>
              AI model not set up yet — tap to configure (one-time)
            </Text>
            <MaterialIcons name="chevron-right" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}

        {modelReady === true && (
          <TouchableOpacity
            style={styles.modelReady}
            onPress={() => router.push('/model-setup')}
            accessibilityLabel="AI ready — tap to change model"
          >
            <MaterialIcons name="check-circle" size={16} color={Colors.success} />
            <Text style={styles.modelReadyText}>AI ready — tap to change model</Text>
            <MaterialIcons name="settings" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Primary actions — side-by-side on tablets, stacked on phones */}
        <View style={[styles.actions, isTablet && styles.actionsTablet]}>
          <TouchableOpacity
            style={[styles.primaryBtn, isTablet && styles.primaryBtnTablet]}
            onPress={handleScan}
            accessibilityRole="button"
            accessibilityLabel="Scan a document with your camera"
          >
            <MaterialIcons name="camera-alt" size={isTablet ? 44 : 36} color={Colors.primaryText} />
            <Text style={styles.primaryBtnLabel}>Scan Document</Text>
            <Text style={styles.primaryBtnSub}>Point camera at letter or bill</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, isTablet && styles.secondaryBtnTablet]}
            onPress={handleImport}
            accessibilityRole="button"
            accessibilityLabel="Import a document from your files or photos"
          >
            <MaterialIcons name="upload-file" size={isTablet ? 34 : 28} color={Colors.primary} />
            <Text style={styles.secondaryBtnLabel}>Import from Files</Text>
            <Text style={styles.secondaryBtnSub}>Gallery, PDF, or camera roll</Text>
          </TouchableOpacity>
        </View>

        {/* Recent documents */}
        {recentDocs.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Documents</Text>
              <TouchableOpacity onPress={() => router.push('/documents')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {recentDocs.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onPress={() =>
                  router.push({ pathname: '/action', params: { id: doc.id } })
                }
                onDelete={() => {
                  Alert.alert(
                    'Delete Document',
                    'This will permanently delete the document and any generated letters.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          deleteDocument(doc.id)
                          setRecentDocs(prev => prev.filter(d => d.id !== doc.id))
                        },
                      },
                    ]
                  )
                }}
              />
            ))}
          </View>
        )}

        {/* How it works */}
        {recentDocs.length === 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How It Works</Text>
            {HOW_IT_WORKS.map((step) => (
              <View key={step.n} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{step.n}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

const HOW_IT_WORKS = [
  { n: '1', title: 'Scan or Import', desc: 'Take a photo of your document or import a PDF from your files.' },
  { n: '2', title: 'AI Analysis', desc: 'The on-device AI reads the document and explains what it means in plain language.' },
  { n: '3', title: 'Take Action', desc: 'Generate a dispute letter, fill a form, or get a step-by-step call script.' },
  { n: '4', title: 'Download & Share', desc: 'Your letter is saved as a PDF you can print or email — no account needed.' },
]

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: 80 },

  hero: { alignItems: 'center', paddingVertical: Spacing.lg },
  heroIcon: { fontSize: 44, marginBottom: 6 },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
  },

  modelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2D2800',
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modelBannerText: { flex: 1, color: Colors.warning, fontSize: FontSize.sm },

  modelReady: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  modelReadyText: { fontSize: FontSize.sm, color: Colors.success },

  actions: { gap: Spacing.md, marginBottom: Spacing.xl },
  actionsTablet: { flexDirection: 'row' },

  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: TouchTarget.large + 40,
    justifyContent: 'center',
  },
  primaryBtnTablet: { flex: 1 },
  primaryBtnLabel: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.primaryText,
  },
  primaryBtnSub: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.75)',
  },

  secondaryBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: TouchTarget.comfortable,
  },
  secondaryBtnTablet: { flex: 1 },
  secondaryBtnLabel: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.primary,
  },
  secondaryBtnSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },

  section: { marginBottom: Spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  seeAll: { fontSize: FontSize.sm, color: Colors.primary },

  stepRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: { color: Colors.primaryText, fontWeight: '800', fontSize: FontSize.md },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  stepDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
})
