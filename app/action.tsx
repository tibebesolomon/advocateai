import React, { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, Linking, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { router, useLocalSearchParams } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { MaterialIcons } from '@expo/vector-icons'
import { aiEngine, DEMO_MODE_NOTICE } from '@/ai/engine'
import { SpeakButton } from '@/ui/components/SpeakButton'
import { buildAnalysisSpeech, Announce } from '@/voice/tts'
import {
  getDocument, updateDocumentAnalysis, saveLetter, getLettersForDocument,
  getOrCreateThread, addThreadMessage, makeId, updateLetterContent,
  saveScheduledAlert, getAlertsForDocument, deleteAlertsForDocument,
} from '@/documents/store'
import { generateLetterPDF } from '@/pdf/generator'
import { generateCaseBundle } from '@/export/caseBundle'
import { calculateDeadlines, scheduleDeadlineAlerts, cancelAlertsForDocument } from '@/notifications/deadlines'
import { StepIndicator } from '@/ui/components/StepIndicator'
import { ActionButton } from '@/ui/components/ActionButton'
import { Colors, FontSize, Radius, Spacing, severityColors, severityLabel } from '@/ui/theme'
import type { AnalysisResult, ActionType, GeneratedLetter, ScannedDocument, DeadlineInfo, AnomalyFlag } from '@/types'

function extractAmounts(text: string): string[] {
  return [...new Set([...text.matchAll(/\$[\d,]+(?:\.\d{2})?/g)].map(m => m[0]))].slice(0, 5)
}

const STEPS = ['Scan', 'Review', 'Analyze', 'Act']

const ACTION_LABELS: Record<string, string> = {
  DISPUTE_LETTER: 'Dispute Letter',
  APPEAL_LETTER: 'Appeal',
  FORM_FILL: 'Fill Form',
  CALL_SCRIPT: 'Call Script',
  INFORMATION: 'Info',
}

const ACTION_ICONS: Record<string, string> = {
  DISPUTE_LETTER: 'edit',
  APPEAL_LETTER: 'gavel',
  FORM_FILL: 'assignment',
  CALL_SCRIPT: 'phone',
  INFORMATION: 'info',
}

const ANOMALY_COLORS: Record<string, string> = {
  OVERCHARGE: Colors.error,
  DUPLICATE_CHARGE: Colors.error,
  UNAUTHORIZED: Colors.warning,
  ILLEGAL_TERM: Colors.error,
  MISSING_DISCLOSURE: Colors.warning,
  UNBUNDLING: Colors.error,
}

export default function ActionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [doc, setDoc] = useState<ScannedDocument | null>(null)

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [anomalies, setAnomalies] = useState<AnomalyFlag[]>([])
  const [anomalyLoading, setAnomalyLoading] = useState(false)
  const [showAnomalies, setShowAnomalies] = useState(false)

  const [deadlines, setDeadlines] = useState<DeadlineInfo[]>([])
  const [alertsScheduled, setAlertsScheduled] = useState(false)
  const [schedulingAlerts, setSchedulingAlerts] = useState(false)

  const [outputText, setOutputText] = useState('')
  const [outputGenerating, setOutputGenerating] = useState(false)
  const [outputType, setOutputType] = useState<ActionType | null>(null)
  const [outputLetter, setOutputLetter] = useState<GeneratedLetter | null>(null)

  const [editing, setEditing] = useState(false)
  const [editedText, setEditedText] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)

  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [buildingPdf, setBuildingPdf] = useState(false)
  const [exportingBundle, setExportingBundle] = useState(false)

  const abortRef = useRef(false)

  useEffect(() => {
    if (!id) return
    loadDoc()
    return () => { abortRef.current = true }
  }, [id])

  async function loadDoc() {
    const loaded = await getDocument(id)
    if (!loaded) { Alert.alert('Error', 'Document not found'); router.back(); return }
    setDoc(loaded)

    // Restore deadline alerts state
    const existingAlerts = await getAlertsForDocument(id)
    setAlertsScheduled(existingAlerts.length > 0)

    // Calculate deadlines
    const dl = calculateDeadlines(loaded)
    setDeadlines(dl)

    if (loaded.analysisResult) {
      setAnalysis(loaded.analysisResult)
      if (loaded.analysisResult.anomalies) setAnomalies(loaded.analysisResult.anomalies)
      loadOrGenerate(loaded, loaded.analysisResult)
    } else {
      runAnalysis(loaded)
    }
  }

  async function runAnalysis(document: ScannedDocument) {
    setAnalysisError(null)
    const ready = await aiEngine.isModelReady()
    if (!ready) {
      setAnalysisError('AI model not set up. Tap "Set Up AI" below to download it.')
      return
    }
    setAnalysisLoading(true)
    abortRef.current = false
    try {
      const result = await aiEngine.analyzeDocument(document)
      if (!abortRef.current) {
        setAnalysis(result)
        await updateDocumentAnalysis(document.id, result)
        loadOrGenerate(document, result)
        Announce.analysisReady()

        // Run anomaly detection in parallel after analysis completes
        runAnomalyDetection(document, result)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'MODEL_NOT_FOUND' || msg === 'AI_UNAVAILABLE') {
        setAnalysisError('AI model not set up. Tap "Set Up AI" below to download it.')
      } else if (msg.startsWith('MODEL_CORRUPT')) {
        setAnalysisError('Model file could not be loaded — the download may be incomplete.\n\nTap "Delete & Re-download" to fix this.')
      } else if (msg === 'MODEL_LOAD_FAILED') {
        setAnalysisError('Model failed to load — try re-downloading it.')
      } else if (msg.startsWith('MODEL_RUNTIME_ERROR')) {
        setAnalysisError(`The model file is valid but failed to start on this device.\n\nTry closing all other apps and retrying.`)
      } else {
        setAnalysisError(`Analysis failed: ${msg}`)
      }
    } finally {
      setAnalysisLoading(false)
    }
  }

  async function runAnomalyDetection(document: ScannedDocument, result: AnalysisResult) {
    // Skip for general docs and clean low-severity bills — model hallucinates on clean docs
    if (document.type === 'GENERAL') return
    if (result.severity === 'LOW') return
    setAnomalyLoading(true)
    try {
      const detected = await aiEngine.detectAnomalies(document)
      if (!abortRef.current && detected.length > 0) {
        setAnomalies(detected)
        setShowAnomalies(true)
        // Persist anomalies back into the analysis result
        const updatedResult = { ...result, anomalies: detected }
        setAnalysis(updatedResult)
        await updateDocumentAnalysis(document.id, updatedResult)
      }
    } catch {
      // Anomaly detection failure is non-fatal — analysis still shows
    } finally {
      setAnomalyLoading(false)
    }
  }

  async function loadOrGenerate(document: ScannedDocument, result: AnalysisResult) {
    const existing = await getLettersForDocument(document.id)
    if (existing.length > 0) {
      const latest = existing[0]
      setOutputType(latest.type as ActionType)
      setOutputText(latest.content)
      setOutputLetter(latest)
    } else {
      autoGenerate(document, result)
    }
  }

  async function autoGenerate(
    document: ScannedDocument,
    result: AnalysisResult,
    forceType?: ActionType
  ) {
    const actions = [...result.recommendedActions].sort((a, b) => a.priority - b.priority)
    const action = forceType
      ? (actions.find(a => a.type === forceType) ?? actions[0])
      : actions[0]
    if (!action) return

    const type = action.type as ActionType
    setOutputType(type)
    setOutputGenerating(false)
    setOutputText('')
    setOutputLetter(null)
    setPdfPath(null)
    abortRef.current = false

    // INFORMATION means the document looks fine — show the finding directly, no AI generation needed
    if (type === 'INFORMATION') {
      const infoText = [
        action.title,
        action.description,
        ...(result.keyFindings.length > 0 ? ['\nKey Points:', ...result.keyFindings.map(f => `• ${f}`)] : []),
        result.rightsReminder ? `\nYour Rights: ${result.rightsReminder}` : '',
      ].filter(Boolean).join('\n')
      setOutputText(infoText)
      const letter: GeneratedLetter = {
        id: makeId(), documentId: document.id, type, content: infoText, createdAt: Date.now(),
      }
      await saveLetter(letter)
      setOutputLetter(letter)
      return
    }

    setOutputGenerating(true)

    try {
      let text: string
      if (type === 'CALL_SCRIPT') {
        text = await aiEngine.generateCallScript(document, (token) => {
          if (!abortRef.current) setOutputText(t => t + token)
        })
      } else {
        // DISPUTE_LETTER, APPEAL_LETTER, FORM_FILL
        text = await aiEngine.generateLetter(document, type, (token) => {
          if (!abortRef.current) setOutputText(t => t + token)
        })
      }

      if (!abortRef.current) {
        // Always sync final text — covers edge case where streaming was incomplete
        const finalText = text.trim() || 'The AI could not generate content for this document. Tap Regenerate to try again.'
        setOutputText(finalText)
        const letter: GeneratedLetter = {
          id: makeId(), documentId: document.id, type, content: finalText, createdAt: Date.now(),
        }
        await saveLetter(letter)
        setOutputLetter(letter)
      }
    } catch {
      setOutputText('Generation failed. Please try again.')
    } finally {
      setOutputGenerating(false)
    }
  }

  // ── Deadline Alerts ────────────────────────────────────────────────────────

  async function toggleDeadlineAlerts() {
    if (!doc) return

    if (alertsScheduled) {
      const existing = await getAlertsForDocument(doc.id)
      const allNotifIds = existing.flatMap(a => a.notifIds)
      await cancelAlertsForDocument(allNotifIds)
      deleteAlertsForDocument(doc.id)
      setAlertsScheduled(false)
      Alert.alert('Reminders cancelled', 'Deadline reminders for this document have been removed.')
      return
    }

    setSchedulingAlerts(true)
    try {
      const notifIds = await scheduleDeadlineAlerts(
        doc.id,
        doc.metadata.institution ?? doc.type.replace(/_/g, ' '),
        deadlines
      )
      if (notifIds.length > 0) {
        const primaryDeadline = deadlines[0]
        await saveScheduledAlert({
          id: makeId(),
          documentId: doc.id,
          notifIds,
          deadlineLabel: primaryDeadline?.label ?? 'Deadline',
          deadlineDate: primaryDeadline?.date ?? new Date().toISOString(),
          createdAt: Date.now(),
        })
        setAlertsScheduled(true)
        Alert.alert(
          'Reminders set',
          `You'll be notified ${notifIds.length} time${notifIds.length > 1 ? 's' : ''} before your deadline.`
        )
      } else {
        Alert.alert('No upcoming deadlines', 'All deadlines have already passed.')
      }
    } catch {
      Alert.alert('Permission needed', 'Allow notifications in Settings to receive deadline reminders.')
    } finally {
      setSchedulingAlerts(false)
    }
  }

  // ── Edit / Copy / PDF ──────────────────────────────────────────────────────

  function startEdit() { setEditedText(outputText); setEditing(true); setPdfPath(null) }

  async function saveEdit() {
    setOutputText(editedText)
    setEditing(false)
    if (outputLetter) await updateLetterContent(outputLetter.id, editedText)
  }

  async function copyText() {
    await Clipboard.setStringAsync(outputText)
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
  }

  async function downloadPDF() {
    if (!outputText) return
    setBuildingPdf(true)
    try {
      const filename = `advocateai-${(outputType ?? 'document').toLowerCase().replace(/_/g, '-')}-${Date.now()}`
      const path = await generateLetterPDF(outputText, filename)
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

  function confirmAndExport(afterConfirm: () => void) {
    if (outputType === 'INFORMATION') { afterConfirm(); return }
    const amounts = extractAmounts(outputText)
    const parts: string[] = []
    if (amounts.length > 0) parts.push(`Amounts: ${amounts.join(', ')}`)
    if (analysis?.deadline) parts.push(`Deadline: ${analysis.deadline}`)
    const verifyLines = parts.length > 0
      ? `\n\nVerify these match your original document:\n${parts.join('\n')}`
      : ''
    Alert.alert(
      'Check Before Exporting',
      `AI letters can contain errors. Review the letter carefully before sending it to anyone.${verifyLines}\n\nThis is not legal advice.`,
      [
        { text: 'Review Letter', style: 'cancel' },
        { text: 'Looks Correct — Export', onPress: afterConfirm },
      ]
    )
  }

  async function exportCaseBundle() {
    if (!doc) return
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(
        'Export Case Bundle',
        'This PDF contains your full case — document text, AI analysis, letters, and correspondence.\n\n' +
        'Only share it with trusted parties (e.g. your lawyer or legal aid). ' +
        'Once shared via messaging or email it may be stored by those services.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Export', onPress: () => resolve(true) },
        ]
      )
    )
    if (!confirmed) return
    setExportingBundle(true)
    try {
      const letters = await getLettersForDocument(doc.id)
      const thread = await getOrCreateThread(doc.id)
      const path = await generateCaseBundle(doc, letters, thread.messages.length > 0 ? thread : null)
      await Sharing.shareAsync(path, { mimeType: 'application/pdf' })
    } catch (err: unknown) {
      Alert.alert('Export Error', err instanceof Error ? err.message : 'Could not generate case bundle')
    } finally {
      setExportingBundle(false)
    }
  }

  async function deleteAndSwitch() {
    setDeleting(true)
    try { await aiEngine.deleteModel() } finally { setDeleting(false) }
    router.replace({ pathname: '/model-setup', params: { preselect: '0' } })
  }

  function openChat() {
    if (!doc) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push({ pathname: '/chat' as any, params: { id: doc.id } })
  }

  async function openThread() {
    if (!doc || !outputLetter) return
    const thread = await getOrCreateThread(doc.id)
    if (thread.messages.length === 0) {
      await addThreadMessage({
        threadId: thread.id, sender: 'user', content: outputLetter.content,
        isAiGenerated: true, createdAt: Date.now(),
      })
    }
    router.push({ pathname: '/thread', params: { id: doc.id } })
  }

  if (!doc) {
    return <View style={styles.centered}><ActivityIndicator color={Colors.primary} /></View>
  }

  const sevColors = analysis ? severityColors(analysis.severity) : null

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <StepIndicator steps={STEPS} currentStep={analysisLoading ? 2 : 3} />

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Demo banner */}
        {analysis && !aiEngine.isNativeAvailable && (
          <View style={styles.demoBanner}>
            <MaterialIcons name="science" size={16} color={Colors.warning} />
            <Text style={styles.demoBannerText}>Demo mode — install native build for real on-device AI.</Text>
          </View>
        )}

        {/* Analysis loading */}
        {analysisLoading && (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingTitle}>Reading Your Document…</Text>
            <Text style={styles.loadingSubtitle}>AI is analyzing content and rights</Text>
          </View>
        )}

        {/* Error state */}
        {!analysisLoading && analysisError && !analysis && (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={32} color={Colors.error} />
            <Text style={styles.errorText}>{analysisError}</Text>
          </View>
        )}

        {/* Analysis summary */}
        {analysis && sevColors && (
          <TouchableOpacity
            style={[styles.summaryHeader, { borderColor: sevColors.text }]}
            onPress={() => setSummaryExpanded(e => !e)}
            activeOpacity={0.8}
          >
            <View style={styles.summaryTop}>
              <View style={[styles.severityBadge, { backgroundColor: sevColors.bg }]}>
                <Text style={[styles.severityText, { color: sevColors.text }]}>
                  {severityLabel(analysis.severity)}
                </Text>
              </View>
              {analysis.deadline && (
                <Text style={styles.deadlineText} numberOfLines={1}>⏰ {analysis.deadline}</Text>
              )}
              <SpeakButton
                text={buildAnalysisSpeech({
                  summary: analysis.summary,
                  severity: analysis.severity,
                  keyFindings: analysis.keyFindings,
                  rightsReminder: analysis.rightsReminder,
                  deadline: analysis.deadline,
                })}
                size={20}
                accessibilityLabel="Read analysis aloud"
              />
              <MaterialIcons
                name={summaryExpanded ? 'expand-less' : 'expand-more'}
                size={20}
                color={Colors.textMuted}
              />
            </View>
            <Text style={styles.summaryText} numberOfLines={summaryExpanded ? undefined : 2}>
              {analysis.summary}
            </Text>
            {summaryExpanded && (
              <>
                {analysis.keyFindings.map((f, i) => (
                  <View key={i} style={styles.findingRow}>
                    <Text style={styles.findingBullet}>•</Text>
                    <Text style={styles.findingText}>{f}</Text>
                  </View>
                ))}
                {analysis.rightsReminder && (
                  <View style={styles.rightsBox}>
                    <MaterialIcons name="shield" size={14} color={Colors.info} />
                    <Text style={styles.rightsText}>{analysis.rightsReminder}</Text>
                  </View>
                )}
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Advocate chat entry point */}
        {analysis && (
          <TouchableOpacity style={styles.advocateCard} onPress={openChat} activeOpacity={0.8}>
            <View style={styles.advocateAvatar}>
              <MaterialIcons name="shield" size={22} color={Colors.primaryText} />
            </View>
            <View style={styles.advocateCardContent}>
              <Text style={styles.advocateCardTitle}>Talk to Your Advocate</Text>
              <Text style={styles.advocateCardSub}>Tell your story — get personalized advice & next steps</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={Colors.primary} />
          </TouchableOpacity>
        )}

        {/* Free legal aid — shown for high-stakes documents */}
        {analysis && (analysis.severity === 'HIGH' || analysis.severity === 'URGENT') && (
          <TouchableOpacity
            style={styles.legalAidBanner}
            onPress={() => Linking.openURL('https://www.lawhelp.org')}
            accessibilityRole="link"
            accessibilityLabel="Find free legal help near you — opens lawhelp.org in browser"
          >
            <MaterialIcons name="people" size={20} color={Colors.info} />
            <View style={styles.legalAidContent}>
              <Text style={styles.legalAidTitle}>Find Free Legal Help Near You</Text>
              <Text style={styles.legalAidSub}>
                For serious situations, free legal aid clinics can help at no cost.
                lawhelp.org finds one in your area.
              </Text>
            </View>
            <MaterialIcons name="open-in-new" size={16} color={Colors.info} />
          </TouchableOpacity>
        )}

        {/* Anomaly flags */}
        {(anomalies.length > 0 || anomalyLoading) && (
          <View style={styles.anomalyCard}>
            <TouchableOpacity
              style={styles.anomalyHeader}
              onPress={() => setShowAnomalies(s => !s)}
            >
              {anomalyLoading ? (
                <ActivityIndicator size="small" color={Colors.error} />
              ) : (
                <MaterialIcons name="warning" size={18} color={Colors.error} />
              )}
              <Text style={styles.anomalyTitle}>
                {anomalyLoading
                  ? 'Scanning for billing errors…'
                  : `${anomalies.length} anomaly${anomalies.length > 1 ? 'ies' : ''} detected`}
              </Text>
              {!anomalyLoading && (
                <MaterialIcons
                  name={showAnomalies ? 'expand-less' : 'expand-more'}
                  size={18} color={Colors.textMuted}
                />
              )}
            </TouchableOpacity>
            {showAnomalies && anomalies.map((a, i) => (
              <View key={i} style={styles.anomalyItem}>
                <View style={[styles.anomalyDot, { backgroundColor: ANOMALY_COLORS[a.type] ?? Colors.warning }]} />
                <View style={styles.anomalyContent}>
                  <Text style={styles.anomalyType}>{a.type.replace(/_/g, ' ')}</Text>
                  <Text style={styles.anomalyDesc}>{a.description}</Text>
                  {a.lineItem && <Text style={styles.anomalyItem2}>Item: {a.lineItem}</Text>}
                  {a.amount != null && <Text style={styles.anomalyItem2}>Amount: ${a.amount.toFixed(2)}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Deadlines */}
        {deadlines.length > 0 && (
          <View style={styles.deadlineCard}>
            <View style={styles.deadlineHeader}>
              <MaterialIcons name="schedule" size={16} color={Colors.warning} />
              <Text style={styles.deadlineCardTitle}>Response Deadlines</Text>
              <TouchableOpacity
                style={[styles.reminderBtn, alertsScheduled && styles.reminderBtnActive]}
                onPress={toggleDeadlineAlerts}
                disabled={schedulingAlerts}
              >
                {schedulingAlerts
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <MaterialIcons
                      name={alertsScheduled ? 'notifications-active' : 'notifications-none'}
                      size={14}
                      color={alertsScheduled ? Colors.primary : Colors.textMuted}
                    />
                }
                <Text style={[styles.reminderBtnText, alertsScheduled && { color: Colors.primary }]}>
                  {alertsScheduled ? 'Reminders On' : 'Set Reminder'}
                </Text>
              </TouchableOpacity>
            </View>
            {deadlines.slice(0, 4).map((dl, i) => {
              const urgent = dl.daysRemaining <= 3
              const passed = dl.daysRemaining < 0
              return (
                <View key={i} style={styles.deadlineRow}>
                  <View style={[styles.deadlineDot, {
                    backgroundColor: passed ? Colors.textMuted : urgent ? Colors.error : Colors.warning
                  }]} />
                  <View style={styles.deadlineInfo}>
                    <Text style={styles.deadlineLabel}>{dl.label}</Text>
                    <Text style={[styles.deadlineDays, {
                      color: passed ? Colors.textMuted : urgent ? Colors.error : Colors.warning
                    }]}>
                      {passed
                        ? `${Math.abs(dl.daysRemaining)} days ago`
                        : dl.daysRemaining === 0
                        ? 'TODAY'
                        : `${dl.daysRemaining} day${dl.daysRemaining > 1 ? 's' : ''} remaining`}
                    </Text>
                    {dl.isStatutory && (
                      <Text style={styles.deadlineStatutory}>Statutory deadline</Text>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        )}

        {/* Action type chips */}
        {analysis && analysis.recommendedActions.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            <View style={styles.chipRow}>
              {[...analysis.recommendedActions]
                .sort((a, b) => a.priority - b.priority)
                .map((action, i) => {
                  const isActive = outputType === action.type
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.chip, isActive && styles.chipActive]}
                      disabled={outputGenerating}
                      onPress={() => doc && analysis && autoGenerate(doc, analysis, action.type as ActionType)}
                    >
                      <MaterialIcons
                        name={(ACTION_ICONS[action.type] ?? 'info') as any}
                        size={14}
                        color={isActive ? Colors.primaryText : Colors.textSecondary}
                      />
                      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                        {ACTION_LABELS[action.type] ?? action.type}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
            </View>
          </ScrollView>
        )}

        {/* Generated output */}
        {analysis && (outputText.length > 0 || outputGenerating) && (
          <View style={styles.outputSection}>
            <View style={styles.outputHeader}>
              <Text style={styles.outputLabel}>
                {outputGenerating ? 'Generating…' : (ACTION_LABELS[outputType ?? ''] ?? 'Document')}
              </Text>
              {!outputGenerating && outputText && (
                <View style={styles.outputActions}>
                  <SpeakButton
                    text={outputText}
                    size={20}
                    accessibilityLabel="Read letter aloud"
                  />
                  <TouchableOpacity onPress={copyText} style={styles.toolBtn}
                    accessibilityLabel={copyFeedback ? 'Copied!' : 'Copy to clipboard'}>
                    <MaterialIcons
                      name={copyFeedback ? 'check' : 'content-copy'}
                      size={18} color={copyFeedback ? Colors.success : Colors.textMuted}
                    />
                    {copyFeedback && <Text style={styles.copiedLabel}>Copied!</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={editing ? saveEdit : startEdit}
                    style={[styles.toolBtn, editing && styles.toolBtnActive]}
                    accessibilityLabel={editing ? 'Save edits' : 'Edit letter'}
                  >
                    <MaterialIcons name={editing ? 'check-circle' : 'edit'} size={18}
                      color={editing ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.toolBtnLabel, editing && { color: Colors.primary }]}>
                      {editing ? 'Save' : 'Edit'}
                    </Text>
                  </TouchableOpacity>
                  {!editing && (
                    <TouchableOpacity
                      onPress={() => doc && analysis && autoGenerate(doc, analysis, outputType ?? undefined)}
                      style={styles.toolBtn} accessibilityLabel="Regenerate">
                      <MaterialIcons name="refresh" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {editing ? (
              <TextInput
                style={styles.editorBox}
                value={editedText}
                onChangeText={setEditedText}
                multiline autoFocus
                textAlignVertical="top"
                selectionColor={Colors.primary}
              />
            ) : (
              <View style={styles.paperBox}>
                {outputGenerating && outputText.length === 0 && (
                  <View style={styles.paperLoading}>
                    <ActivityIndicator color={Colors.primary} />
                    <Text style={styles.paperLoadingText}>Drafting your document…</Text>
                  </View>
                )}
                <Text style={styles.paperText} selectable>{outputText}</Text>
                {outputGenerating && <View style={styles.cursor} />}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      {!analysisLoading && (
        <View style={styles.footer}>
          {analysisError && !analysis ? (
            analysisError.includes('not set up') || analysisError.includes('incomplete') ? (
              <ActionButton
                label={analysisError.includes('corrupt') ? 'Delete & Re-download' : 'Set Up AI'}
                variant="primary" size="lg" style={{ flex: 1 }}
                onPress={() => router.replace('/model-setup')}
                icon={<MaterialIcons name="download" size={20} color={Colors.primaryText} />}
              />
            ) : analysisError.includes('failed to load') ? (
              <>
                <ActionButton
                  label={deleting ? 'Removing…' : 'Delete & Use Smaller'}
                  variant="primary" size="lg" loading={deleting} style={{ flex: 1 }}
                  onPress={deleteAndSwitch}
                  icon={<MaterialIcons name="swap-horiz" size={20} color={Colors.primaryText} />}
                />
                <ActionButton
                  label="Try Again" variant="ghost"
                  onPress={() => doc && runAnalysis(doc)}
                  icon={<MaterialIcons name="refresh" size={18} color={Colors.primary} />}
                />
              </>
            ) : (
              <ActionButton
                label="Try Again" variant="primary" size="lg" style={{ flex: 1 }}
                onPress={() => doc && runAnalysis(doc)}
                icon={<MaterialIcons name="refresh" size={20} color={Colors.primaryText} />}
              />
            )
          ) : (
            <>
              <ActionButton
                label="Talk to Your Advocate"
                variant="primary" size="md" style={{ width: '100%' }}
                onPress={openChat}
                icon={<MaterialIcons name="shield" size={20} color={Colors.primaryText} />}
              />
              <View style={styles.footerRow2}>
                <ActionButton
                  label={pdfPath ? 'Share PDF' : 'Save PDF'}
                  variant="secondary" size="sm" style={{ flex: 1 }}
                  loading={buildingPdf}
                  disabled={!outputText || outputGenerating}
                  onPress={() => confirmAndExport(pdfPath ? sharePDF : downloadPDF)}
                  icon={<MaterialIcons
                    name={pdfPath ? 'share' : 'picture-as-pdf'}
                    size={18} color={Colors.textPrimary}
                  />}
                />
                <ActionButton
                  label={exportingBundle ? '…' : 'Export Case'}
                  variant="ghost" size="sm" style={{ flex: 1 }}
                  loading={exportingBundle}
                  disabled={!doc}
                  onPress={exportCaseBundle}
                  icon={<MaterialIcons name="folder-zip" size={18} color={Colors.primary} />}
                />
              </View>
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 160 },

  demoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.warning,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  demoBannerText: { flex: 1, fontSize: FontSize.sm, color: Colors.warning },

  loadingCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  loadingTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  loadingSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary },

  errorBox: {
    flexDirection: 'column', alignItems: 'center', gap: Spacing.md,
    backgroundColor: '#2D1010', borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.error, padding: Spacing.lg, marginBottom: Spacing.md,
  },
  errorText: { fontSize: FontSize.md, color: Colors.error, textAlign: 'center', lineHeight: 24 },

  summaryHeader: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, gap: Spacing.sm,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  severityBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.sm },
  severityText: { fontSize: FontSize.xs, fontWeight: '800' },
  deadlineText: { fontSize: FontSize.sm, color: Colors.warning, flex: 1 },
  summaryText: { fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 22 },
  findingRow: { flexDirection: 'row', gap: Spacing.xs, paddingLeft: Spacing.xs },
  findingBullet: { color: Colors.primary, fontWeight: '700' },
  findingText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  rightsBox: {
    flexDirection: 'row', gap: Spacing.xs, backgroundColor: '#0D1F2D',
    borderRadius: Radius.sm, padding: Spacing.sm, alignItems: 'flex-start',
  },
  rightsText: { flex: 1, fontSize: FontSize.xs, color: Colors.info, lineHeight: 18 },

  advocateCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primary,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  advocateAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  advocateCardContent: { flex: 1, gap: 2 },
  advocateCardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  advocateCardSub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },

  anomalyCard: {
    backgroundColor: '#2D1010', borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.error, marginBottom: Spacing.md, overflow: 'hidden',
  },
  anomalyHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md,
  },
  anomalyTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '700', color: Colors.error },
  anomalyItem: {
    flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(255,80,80,0.2)',
  },
  anomalyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  anomalyContent: { flex: 1, gap: 2 },
  anomalyType: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.error, textTransform: 'uppercase' },
  anomalyDesc: { fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 18 },
  anomalyItem2: { fontSize: FontSize.xs, color: Colors.textSecondary },

  deadlineCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.warning, marginBottom: Spacing.md, padding: Spacing.md, gap: Spacing.sm,
  },
  deadlineHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  deadlineCardTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '700', color: Colors.warning },
  reminderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  reminderBtnActive: { borderColor: Colors.primary },
  reminderBtnText: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  deadlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  deadlineDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  deadlineInfo: { flex: 1, gap: 2 },
  deadlineLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600' },
  deadlineDays: { fontSize: FontSize.xs, fontWeight: '700' },
  deadlineStatutory: { fontSize: FontSize.xs, color: Colors.textMuted, fontStyle: 'italic' },

  chipScroll: { marginBottom: Spacing.md },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.round, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: Colors.primaryText },

  outputSection: { marginBottom: Spacing.md },
  outputHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm,
  },
  outputLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  outputActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  toolBtnActive: { backgroundColor: Colors.surfaceAlt },
  toolBtnLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  copiedLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '600' },

  editorBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.primary, minHeight: 300,
    fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 26,
  },
  paperBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border, minHeight: 200,
  },
  paperLoading: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.lg },
  paperLoadingText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  paperText: { fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 26 },
  cursor: { width: 2, height: 18, backgroundColor: Colors.primary, marginTop: 4, opacity: 0.8 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'column', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  footerRow2: {
    flexDirection: 'row', gap: Spacing.sm,
  },

  legalAidBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: '#0D1F2D', borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.info,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  legalAidContent: { flex: 1, gap: 2 },
  legalAidTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.info },
  legalAidSub: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17 },
})
