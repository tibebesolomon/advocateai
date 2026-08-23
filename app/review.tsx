import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, TextInput,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { MaterialIcons } from '@expo/vector-icons'
import { processImageURI } from '@/ocr/processor'
import { classifyDocument } from '@/documents/classifier'
import { saveDocument, makeId } from '@/documents/store'
import { StepIndicator } from '@/ui/components/StepIndicator'
import { ActionButton } from '@/ui/components/ActionButton'
import { Colors, FontSize, Radius, Spacing } from '@/ui/theme'
import {
  startRecording, stopRecording, transcribeAudio,
  isCurrentlyRecording, isSTTNativeAvailable,
} from '@/voice/stt'
import { tableToText } from '@/ocr/tables'
import type { DocumentType, ScannedDocument, ExtractedTable } from '@/types'

const STEPS = ['Scan', 'Review', 'Analyze', 'Act']

const TYPE_LABELS: Record<DocumentType, string> = {
  MEDICAL_BILL: 'Medical Bill',
  INSURANCE_DENIAL: 'Insurance Denial',
  EVICTION_NOTICE: 'Eviction Notice',
  HOUSING_NOTICE: 'Housing Notice',
  WELFARE_FORM: 'Benefits Form',
  LEGAL_NOTICE: 'Legal Notice',
  UTILITY_BILL: 'Utility Bill',
  GENERAL: 'General Document',
}

const ALL_TYPES: DocumentType[] = [
  'MEDICAL_BILL', 'INSURANCE_DENIAL', 'EVICTION_NOTICE',
  'HOUSING_NOTICE', 'WELFARE_FORM', 'LEGAL_NOTICE', 'UTILITY_BILL', 'GENERAL',
]

export default function ReviewScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>()
  const [loading, setLoading] = useState(true)
  const [enhancing, setEnhancing] = useState(false)
  const [ocrUnavailable, setOcrUnavailable] = useState(false)
  const [text, setText] = useState('')
  const [tables, setTables] = useState<ExtractedTable[]>([])
  const [docType, setDocType] = useState<DocumentType>('GENERAL')
  const [typeConfidence, setTypeConfidence] = useState(0)
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [ocrQuality, setOcrQuality] = useState<'good' | 'fair' | 'poor' | null>(null)
  const [ocrIssues, setOcrIssues] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Voice recording
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [showTables, setShowTables] = useState(false)

  useEffect(() => {
    if (uri) runOCR(uri, 2000)
  }, [uri])

  async function runOCR(imageUri: string, maxWidth: number) {
    try {
      const result = await processImageURI(imageUri, { maxWidth })
      setText(result.text)
      setTables(result.tables)
      setOcrQuality(result.quality ?? 'fair')
      setOcrIssues(result.issues ?? [])
      updateClassification(result.text)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'OCR_UNAVAILABLE') {
        setOcrUnavailable(true)
        setOcrQuality('poor')
        setOcrIssues(['Auto-scan not available — type, paste, or dictate the document text below'])
      } else {
        Alert.alert('OCR Error', 'Could not read the document. Try rescanning with better lighting.')
        router.back()
      }
    } finally {
      setLoading(false)
      setEnhancing(false)
    }
  }

  function updateClassification(t: string) {
    if (t.trim().length > 15) {
      const cl = classifyDocument(t)
      setDocType(cl.type)
      setTypeConfidence(cl.confidence)
    }
  }

  function onTextChange(t: string) {
    setText(t)
    updateClassification(t)
  }

  async function enhance() {
    if (!uri || enhancing) return
    setEnhancing(true)
    setOcrIssues([])
    setOcrQuality(null)
    await runOCR(uri, 3000)
  }

  // ── Voice input ─────────────────────────────────────────────────────────────

  async function toggleVoiceRecording() {
    if (recording) {
      setRecording(false)
      setTranscribing(true)
      try {
        const audioUri = await stopRecording()
        if (!audioUri) return

        if (!isSTTNativeAvailable()) {
          // Graceful fallback: prompt user to type
          Alert.alert(
            'Voice Input',
            'Voice transcription requires a native build with the Whisper model downloaded. You can type your problem description below instead.',
            [{ text: 'OK' }]
          )
          return
        }

        const transcript = await transcribeAudio(audioUri)
        if (transcript) {
          const joined = text ? `${text}\n\n${transcript}` : transcript
          setText(joined)
          updateClassification(joined)
        }
      } catch (err) {
        Alert.alert('Transcription failed', 'Could not transcribe audio. Please type instead.')
      } finally {
        setTranscribing(false)
      }
    } else {
      try {
        await startRecording()
        setRecording(true)
      } catch (err: unknown) {
        const code = (err as { message?: string })?.message
        if (code === 'MICROPHONE_PERMISSION_DENIED') {
          Alert.alert('Microphone Needed', 'Allow microphone access in Settings to use voice input.')
        } else {
          Alert.alert('Could not start recording', 'Please check microphone permissions.')
        }
      }
    }
  }

  // ── Proceed to analysis ──────────────────────────────────────────────────────

  async function proceed() {
    if (!text.trim() || !uri) return
    setSaving(true)
    try {
      const cl = classifyDocument(text)
      const tableText = tables.length > 0
        ? tables.map(t => tableToText(t)).join('\n\n')
        : undefined

      const doc: ScannedDocument = {
        id: makeId(),
        type: docType,
        rawText: text,
        tableText,
        imageUri: uri,
        metadata: cl.metadata,
        createdAt: Date.now(),
      }
      await saveDocument(doc)
      router.replace({ pathname: '/action', params: { id: doc.id } })
    } finally {
      setSaving(false)
    }
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Reading document text…</Text>
        <Text style={styles.loadingHint}>Hold still for best results</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StepIndicator steps={STEPS} currentStep={1} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Thumbnail + type badge */}
        <View style={styles.header}>
          {uri && <Image source={{ uri }} style={styles.thumb} resizeMode="contain" />}
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={styles.typeBadge}
              onPress={() => setShowTypePicker(!showTypePicker)}
              accessibilityLabel={`Document type: ${TYPE_LABELS[docType]}. Tap to change.`}
            >
              <Text style={styles.typeBadgeText}>{TYPE_LABELS[docType]}</Text>
              <MaterialIcons name="edit" size={14} color={Colors.primary} />
            </TouchableOpacity>
            {/* Compact word count chip — only visible, never alarming */}
            {ocrQuality && !ocrUnavailable && ocrQuality !== 'poor' && (
              <View style={[
                styles.qualityChip,
                ocrQuality === 'good' ? styles.qualityChipGood : styles.qualityChipFair,
              ]}>
                <MaterialIcons
                  name={ocrQuality === 'good' ? 'check' : 'text-fields'}
                  size={11}
                  color={ocrQuality === 'good' ? Colors.success : Colors.textMuted}
                />
                <Text style={[
                  styles.qualityChipText,
                  { color: ocrQuality === 'good' ? Colors.success : Colors.textMuted },
                ]}>
                  {wordCount} words
                </Text>
              </View>
            )}
          </View>
          {typeConfidence > 0 && (
            <Text style={styles.confidence}>{Math.round(typeConfidence * 100)}% confidence</Text>
          )}
        </View>

        {/* Type picker */}
        {showTypePicker && (
          <View style={styles.typePicker}>
            <Text style={styles.typePickerTitle}>Select Document Type</Text>
            {ALL_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeOption, t === docType && styles.typeOptionActive]}
                onPress={() => { setDocType(t); setShowTypePicker(false) }}
              >
                <Text style={[styles.typeOptionText, t === docType && styles.typeOptionTextActive]}>
                  {TYPE_LABELS[t]}
                </Text>
                {t === docType && <MaterialIcons name="check" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* OCR quality banner — only shown for problems */}
        {ocrQuality === 'poor' && !ocrUnavailable && (
          <View style={styles.qualityBanner}>
            <MaterialIcons name="error-outline" size={18} color={Colors.error} />
            <View style={styles.qualityContent}>
              <Text style={styles.qualityTitle}>
                Poor scan — {wordCount} words captured
              </Text>
              {ocrIssues.map((issue, i) => (
                <Text key={i} style={styles.qualityIssue}>{issue}</Text>
              ))}
            </View>
          </View>
        )}

        {/* OCR unavailable info strip */}
        {ocrUnavailable && (
          <View style={styles.ocrUnavailableBanner}>
            <MaterialIcons name="info-outline" size={16} color={Colors.info} />
            <Text style={styles.ocrUnavailableText}>
              Type or dictate your document text below
            </Text>
          </View>
        )}

        {/* Table detected badge */}
        {tables.length > 0 && (
          <TouchableOpacity
            style={styles.tableBadge}
            onPress={() => setShowTables(s => !s)}
          >
            <MaterialIcons name="table-chart" size={16} color={Colors.info} />
            <Text style={styles.tableBadgeText}>
              {tables[0].rows.length} line-item rows detected — tap to {showTables ? 'hide' : 'preview'}
            </Text>
            <MaterialIcons name={showTables ? 'expand-less' : 'expand-more'} size={16} color={Colors.info} />
          </TouchableOpacity>
        )}

        {/* Table preview */}
        {showTables && tables.length > 0 && (
          <View style={styles.tablePreview}>
            <Text style={styles.tableLabel}>Extracted Line Items</Text>
            {tables[0].rows.slice(0, 12).map((row, ri) => (
              <View key={ri} style={[styles.tableRow, ri % 2 === 0 && styles.tableRowAlt]}>
                {row.cells.map((cell, ci) => (
                  <Text key={ci} style={styles.tableCell} numberOfLines={2}>
                    {cell.text}
                  </Text>
                ))}
              </View>
            ))}
            {tables[0].rows.length > 12 && (
              <Text style={styles.tableMore}>+{tables[0].rows.length - 12} more rows in analysis</Text>
            )}
          </View>
        )}

        {/* Editable OCR text */}
        <View style={styles.textBox}>
          <View style={styles.textBoxHeader}>
            <Text style={styles.textBoxLabel}>
              {ocrUnavailable ? 'Enter Document Text' : 'Extracted Text — Edit to Fix Errors'}
            </Text>
            <View style={styles.textBoxActions}>
              <Text style={styles.wordCount}>{wordCount} words</Text>
              {/* Voice input button */}
              <TouchableOpacity
                style={[styles.voiceBtn, recording && styles.voiceBtnActive]}
                onPress={toggleVoiceRecording}
                disabled={transcribing}
                accessibilityLabel={recording ? 'Stop recording' : 'Describe problem verbally'}
              >
                {transcribing ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <MaterialIcons
                    name={recording ? 'stop' : 'mic'}
                    size={18}
                    color={recording ? Colors.error : Colors.primary}
                  />
                )}
              </TouchableOpacity>
            </View>
          </View>
          {recording && (
            <View style={styles.recordingBanner}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording… Tap mic to stop and transcribe</Text>
            </View>
          )}
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={onTextChange}
            multiline
            textAlignVertical="top"
            placeholder={
              ocrUnavailable
                ? 'Paste or type the full document text, or tap the mic to dictate…'
                : 'Tap to correct any misread text…'
            }
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.primary}
          />
        </View>

      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {ocrQuality === 'poor' && !ocrUnavailable && (
          <ActionButton
            label={enhancing ? 'Enhancing…' : 'Enhance Scan'}
            variant="secondary"
            size="sm"
            loading={enhancing}
            onPress={enhance}
            icon={<MaterialIcons name="auto-fix-high" size={18} color={Colors.textPrimary} />}
          />
        )}
        <ActionButton
          label="Rescan"
          variant="ghost"
          onPress={() => router.back()}
          icon={<MaterialIcons name="refresh" size={20} color={Colors.primary} />}
        />
        <ActionButton
          label="Analyze with AI"
          variant="primary"
          size="lg"
          loading={saving}
          onPress={proceed}
          disabled={text.trim().length < 10}
          style={{ flex: 1 }}
          icon={<MaterialIcons name="psychology" size={22} color={Colors.primaryText} />}
          accessibilityHint="Run the local AI to understand this document"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loadingText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  loadingHint: { fontSize: FontSize.sm, color: Colors.textMuted },
  scroll: { padding: Spacing.lg, paddingBottom: 130 },

  header: { alignItems: 'center', marginBottom: Spacing.md, gap: Spacing.sm },
  thumb: { width: '100%', height: 120, borderRadius: Radius.md, backgroundColor: Colors.surface },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.primary,
    borderRadius: Radius.round, paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  typeBadgeText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  qualityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.round, paddingHorizontal: 8, paddingVertical: 3,
  },
  qualityChipGood: { backgroundColor: Colors.lowBg },
  qualityChipFair: { backgroundColor: Colors.surfaceAlt },
  qualityChipText: { fontSize: FontSize.xs, fontWeight: '600' },
  confidence: { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-start' },

  typePicker: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md, gap: 4,
  },
  typePickerTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  typeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, borderRadius: Radius.sm,
  },
  typeOptionActive: { backgroundColor: Colors.surfaceAlt },
  typeOptionText: { fontSize: FontSize.md, color: Colors.textPrimary },
  typeOptionTextActive: { color: Colors.primary, fontWeight: '700' },

  qualityBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: '#2D1010', borderWidth: 1, borderColor: Colors.error,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  qualityContent: { flex: 1, gap: 4 },
  qualityTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.error, lineHeight: 18 },
  qualityIssue: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17 },
  ocrUnavailableBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.info,
    borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md,
  },
  ocrUnavailableText: { flex: 1, fontSize: FontSize.sm, color: Colors.info },

  tableBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.info,
    borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  tableBadgeText: { flex: 1, fontSize: FontSize.sm, color: Colors.info, fontWeight: '600' },

  tablePreview: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, marginBottom: Spacing.md, overflow: 'hidden',
  },
  tableLabel: {
    fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, padding: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tableRow: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  tableRowAlt: { backgroundColor: Colors.surfaceAlt },
  tableCell: { flex: 1, fontSize: FontSize.xs, color: Colors.textPrimary, lineHeight: 16 },
  tableMore: { fontSize: FontSize.xs, color: Colors.textMuted, padding: Spacing.sm, textAlign: 'center' },

  textBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm,
  },
  textBoxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textBoxLabel: {
    fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, flex: 1,
  },
  textBoxActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  wordCount: { fontSize: FontSize.xs, color: Colors.textMuted },
  voiceBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
  },
  voiceBtnActive: { borderColor: Colors.error, backgroundColor: '#2D1010' },

  recordingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: '#2D1010', borderRadius: Radius.sm, padding: Spacing.xs,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recordingText: { fontSize: FontSize.xs, color: Colors.error, fontWeight: '600' },

  textInput: {
    fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 24,
    minHeight: 200, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.sm, padding: Spacing.md, backgroundColor: Colors.background,
  },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
    padding: Spacing.lg, backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
})
