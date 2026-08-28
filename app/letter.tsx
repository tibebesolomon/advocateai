import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TextInput, StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { MaterialIcons } from '@expo/vector-icons'
import { aiEngine } from '@/ai/engine'
import { getDocument, saveLetter, makeId } from '@/documents/store'
import { generateLetterPDF } from '@/pdf/generator'
import { ActionButton } from '@/ui/components/ActionButton'
import { StepIndicator } from '@/ui/components/StepIndicator'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import type { GeneratedLetter } from '@/types'

const STEPS = ['Scan', 'Review', 'Analyze', 'Act']

export default function LetterScreen() {
  const { id, letterType, letterTitle } = useLocalSearchParams<{
    id: string
    letterType: string
    letterTitle?: string
  }>()

  const [content, setContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [buildingPdf, setBuildingPdf] = useState(false)
  const [letter, setLetter] = useState<GeneratedLetter | null>(null)
  const abortRef = useRef(false)

  useEffect(() => {
    if (!id || !letterType) return
    generate()
    return () => { abortRef.current = true }
  }, [id, letterType])

  async function generate() {
    const doc = await getDocument(id)
    if (!doc) { Alert.alert('Error', 'Document not found'); router.back(); return }

    const ready = await aiEngine.isModelReady()
    if (!ready) {
      Alert.alert('AI not ready', 'Please set up the AI model first.')
      router.back()
      return
    }

    setGenerating(true)
    setContent('')
    abortRef.current = false

    try {
      let text: string
      if (letterType === 'CALL_SCRIPT') {
        text = await aiEngine.generateCallScript(doc, (token) => {
          if (!abortRef.current) setContent((c) => c + token)
        })
      } else {
        text = await aiEngine.generateLetter(doc, letterType, (token) => {
          if (!abortRef.current) setContent((c) => c + token)
        })
      }

      if (!abortRef.current) {
        setContent(text)
        const generated: GeneratedLetter = {
          id: makeId(),
          documentId: id,
          type: letterType as GeneratedLetter['type'],
          content: text,
          createdAt: Date.now(),
        }
        await saveLetter(generated)
        setLetter(generated)
      }
    } catch (err: unknown) {
      Alert.alert('Generation failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  async function downloadPDF() {
    if (!content) return
    setBuildingPdf(true)
    try {
      const title = letterTitle ?? letterType ?? 'letter'
      const filename = `advocateai-${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
      const path = await generateLetterPDF(content, filename)
      setPdfPath(path)

      const canShare = await Sharing.isAvailableAsync()
      if (canShare) {
        await Sharing.shareAsync(path, { mimeType: 'application/pdf' })
      } else {
        Alert.alert('PDF Saved', `Saved to: ${path}`)
      }
    } catch (err: unknown) {
      Alert.alert('PDF Error', err instanceof Error ? err.message : 'Could not create PDF')
    } finally {
      setBuildingPdf(false)
    }
  }

  async function sharePDF() {
    if (!pdfPath) { await downloadPDF(); return }
    await Sharing.shareAsync(pdfPath, { mimeType: 'application/pdf' })
  }

  const title = letterType === 'CALL_SCRIPT'
    ? 'Call Script'
    : letterTitle ?? letterType?.replace('_', ' ') ?? 'Letter'

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <StepIndicator steps={STEPS} currentStep={3} />

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>{title}</Text>
        <View style={styles.toolbarActions}>
          <ActionButton
            label={editing ? 'Done' : 'Edit'}
            variant="ghost"
            size="sm"
            onPress={() => setEditing((e) => !e)}
            icon={
              <MaterialIcons
                name={editing ? 'check' : 'edit'}
                size={16}
                color={Colors.primary}
              />
            }
          />
        </View>
      </View>

      {/* Disclaimer */}
      {!generating && content.length > 0 && (
        <View style={styles.disclaimer}>
          <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.disclaimerText}>
            AI-generated draft — not legal or medical advice. Review carefully before sending.
          </Text>
        </View>
      )}

      {/* Letter content */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {generating && content.length === 0 && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Drafting your letter…</Text>
          </View>
        )}

        {editing ? (
          <TextInput
            style={styles.editor}
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus
            textAlignVertical="top"
            selectionColor={Colors.primary}
            accessibilityLabel="Edit letter content"
          />
        ) : (
          <View style={styles.letterPaper}>
            <Text style={styles.letterText} selectable>
              {content}
            </Text>
            {generating && (
              <View style={styles.cursor} />
            )}
          </View>
        )}
      </ScrollView>

      {/* Footer actions */}
      <View style={styles.footer}>
        <ActionButton
          label="Regenerate"
          variant="secondary"
          size="sm"
          onPress={generate}
          loading={generating}
          icon={<MaterialIcons name="refresh" size={18} color={Colors.textPrimary} />}
        />
        <ActionButton
          label={pdfPath ? 'Share PDF' : 'Download PDF'}
          variant="primary"
          size="md"
          style={{ flex: 1 }}
          loading={buildingPdf}
          disabled={!content || generating}
          onPress={pdfPath ? sharePDF : downloadPDF}
          icon={
            <MaterialIcons
              name={pdfPath ? 'share' : 'picture-as-pdf'}
              size={20}
              color={Colors.primaryText}
            />
          }
          accessibilityHint="Export this letter as a PDF you can print or email"
        />
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 120 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  toolbarTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  toolbarActions: { flexDirection: 'row', gap: Spacing.sm },

  loadingBox: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  loadingText: { fontSize: FontSize.md, color: Colors.textSecondary },

  letterPaper: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 400,
  },
  letterText: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    lineHeight: 26,
    fontFamily: 'monospace',
  },
  cursor: {
    width: 2,
    height: 18,
    backgroundColor: Colors.primary,
    marginTop: 4,
    opacity: 0.8,
  },

  editor: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    minHeight: 400,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    lineHeight: 26,
    fontFamily: 'monospace',
  },

  disclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  disclaimerText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.lg,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
})
