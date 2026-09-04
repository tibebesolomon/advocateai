import * as Speech from 'expo-speech'

export type TTSLanguage = 'en-US' | 'es-US' | 'zh-CN' | 'ar' | 'fr-FR' | 'am-ET'

interface TTSOptions {
  language?: TTSLanguage
  rate?: number   // 0.1 – 2.0, default 0.88 (slightly slower for clarity)
  pitch?: number  // 0.5 – 2.0
  onDone?: () => void
  onStopped?: () => void
}

let currentLanguage: TTSLanguage = 'en-US'

export function setTTSLanguage(lang: TTSLanguage): void {
  currentLanguage = lang
}

/** Strip formatting that sounds bad when read aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/<\|[^|]*\|>/g, '')          // LLM special tokens
    .replace(/#{1,6}\s*/g, '')             // markdown headers
    .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
    .replace(/\*(.*?)\*/g, '$1')           // italic
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')    // markdown links
    .replace(/\[.*?\]/g, '')               // remaining brackets
    .replace(/---+/g, '.')                 // horizontal rules
    .replace(/\|/g, ', ')                  // table pipes
    .replace(/[•‣◦]/g, ',')               // bullet chars
    .replace(/\n{2,}/g, '. ')             // paragraph breaks
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function speak(text: string, options?: TTSOptions): Promise<void> {
  try { await Speech.stop() } catch { /* ignore */ }
  const clean = cleanForSpeech(text)
  if (!clean) return

  return new Promise((resolve) => {
    Speech.speak(clean, {
      language: options?.language ?? currentLanguage,
      rate: options?.rate ?? 0.88,
      pitch: options?.pitch ?? 1.0,
      onDone: () => { options?.onDone?.(); resolve() },
      onStopped: () => { options?.onStopped?.(); resolve() },
      onError: () => resolve(),
    })
  })
}

export async function stopSpeaking(): Promise<void> {
  try { await Speech.stop() } catch { /* ignore */ }
}

export function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync()
}

/** Build spoken text for a full AI analysis result. */
export function buildAnalysisSpeech(params: {
  summary: string
  severity: string
  keyFindings: string[]
  rightsReminder?: string | null
  deadline?: string | null
}): string {
  const severityMap: Record<string, string> = {
    URGENT: 'This is urgent and requires immediate action.',
    HIGH: 'This has high priority and needs attention soon.',
    MEDIUM: 'This needs some attention.',
    LOW: 'This appears to be a routine document with no major concerns.',
  }
  const parts: string[] = [
    severityMap[params.severity] ?? '',
    params.summary,
    params.deadline ? `Important deadline: ${params.deadline}.` : '',
  ]
  if (params.keyFindings.length > 0) {
    parts.push('Key findings.')
    params.keyFindings.forEach((f, i) => parts.push(`${i + 1}. ${f}.`))
  }
  if (params.rightsReminder) parts.push(`Your rights: ${params.rightsReminder}`)
  return parts.filter(Boolean).join(' ')
}

// Pre-built announcements so UI code stays clean
export const Announce = {
  scanReady: () => speak('Point your camera at the document and tap the capture button.'),
  scanComplete: () => speak('Document scanned. Reviewing the text now.'),
  analyzing: () => speak('Analyzing your document with the local AI. This may take a moment.'),
  analysisReady: () => speak('Analysis complete. Here are your options.'),
  letterReady: () => speak('Your letter is ready. You can download or share it.'),
  noModel: () =>
    speak('The AI model is not set up yet. Please go to Settings to download it. This only needs to happen once.'),
  readSummary: (text: string) => speak(`Summary: ${text}`),
}
