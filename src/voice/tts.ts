import * as Speech from 'expo-speech'

export type TTSLanguage = 'en-US' | 'es-US' | 'zh-CN' | 'ar' | 'fr-FR' | 'am-ET'

interface TTSOptions {
  language?: TTSLanguage
  rate?: number   // 0.1 – 2.0, default 0.9 (slightly slower for clarity)
  pitch?: number  // 0.5 – 2.0
  onDone?: () => void
}

let currentLanguage: TTSLanguage = 'en-US'

export function setTTSLanguage(lang: TTSLanguage): void {
  currentLanguage = lang
}

export async function speak(text: string, options?: TTSOptions): Promise<void> {
  await Speech.stop()
  Speech.speak(text, {
    language: options?.language ?? currentLanguage,
    rate: options?.rate ?? 0.9,
    pitch: options?.pitch ?? 1.0,
    onDone: options?.onDone,
  })
}

export async function stopSpeaking(): Promise<void> {
  await Speech.stop()
}

export function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync()
}

// Pre-built announcements so UI code stays clean
export const Announce = {
  scanReady: () => speak('Point your camera at the document and tap the capture button.'),
  scanComplete: () => speak('Document scanned. Reviewing the text now.'),
  analyzing: () => speak('Analyzing your document with the local AI. This may take a moment.'),
  analysisReady: () => speak('Analysis complete. Here are your options.'),
  letterReady: () => speak('Your letter is ready. You can download or share it.'),
  noModel: () =>
    speak(
      'The AI model is not set up yet. Please go to Settings to download it. This only needs to happen once.'
    ),
  readSummary: (text: string) => speak(`Summary: ${text}`),
}
