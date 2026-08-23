// AudioRecorder is exported as 'export type' from expo-audio's index (type-only),
// so we must get the runtime class from the native module directly.
import AudioModule from 'expo-audio/build/AudioModule'
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import type { AudioRecorder } from 'expo-audio/build/AudioModule.types'
import * as FileSystem from 'expo-file-system/legacy'
import type { STTLanguage } from '../types'

// Lazy-load whisper.rn using the same pattern as llama.rn — the module resolves
// in both Expo Go and native builds, but native availability is only confirmed
// on the first initWhisper() call.
let _initWhisper: typeof import('whisper.rn').initWhisper | null = null
let _whisperLoaded = false
let _nativeAvailable: boolean | null = null

function ensureWhisperLoaded() {
  if (_whisperLoaded) return
  _whisperLoaded = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('whisper.rn/index') as typeof import('whisper.rn')
    _initWhisper = mod.initWhisper
  } catch {
    _initWhisper = null
  }
}

export const WHISPER_DIR = (FileSystem.documentDirectory ?? '') + 'whisper/'
// ggml-tiny.en is ~75 MB — fast on device, English-only.
// Swap for ggml-small to support multilingual transcription (~466 MB).
export const WHISPER_FILENAME = 'ggml-tiny.en.bin'

let _whisperCtx: import('whisper.rn').WhisperContext | null = null
let _recorder: AudioRecorder | null = null

const HIGH_QUALITY_OPTIONS = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitRate: 128000,
  android: {
    outputFormat: 'mpeg4' as const,
    audioEncoder: 'aac' as const,
    sampleRate: 44100,
  },
  ios: {
    audioQuality: 127, // IOSAudioQuality.MAX
    sampleRate: 44100,
    outputFormat: 'aac ',
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
}

// ─── Model management ────────────────────────────────────────────────────────

export async function isSTTModelReady(): Promise<boolean> {
  ensureWhisperLoaded()
  if (!_initWhisper) return false
  const info = await FileSystem.getInfoAsync(WHISPER_DIR + WHISPER_FILENAME)
  return info.exists
}

export function isSTTNativeAvailable(): boolean {
  ensureWhisperLoaded()
  return _initWhisper !== null && _nativeAvailable !== false
}

// ─── Recording ───────────────────────────────────────────────────────────────

export async function startRecording(): Promise<void> {
  const { granted } = await requestRecordingPermissionsAsync()
  if (!granted) throw new Error('MICROPHONE_PERMISSION_DENIED')

  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
  })

  _recorder = new AudioModule.AudioRecorder(HIGH_QUALITY_OPTIONS)
  await _recorder.prepareToRecordAsync()
  _recorder.record()
}

export async function stopRecording(): Promise<string | null> {
  if (!_recorder) return null

  await _recorder.stop()
  await setAudioModeAsync({ allowsRecording: false })

  const uri = _recorder.uri
  _recorder = null
  return uri ?? null
}

export function isCurrentlyRecording(): boolean {
  return _recorder !== null
}

// ─── Transcription ───────────────────────────────────────────────────────────

export async function transcribeAudio(
  audioUri: string,
  language: STTLanguage = 'en',
  onProgress?: (progress: number) => void
): Promise<string> {
  ensureWhisperLoaded()

  if (!_initWhisper || _nativeAvailable === false) {
    return ''  // demo mode — caller shows fallback message
  }

  if (!_whisperCtx) {
    const modelPath = WHISPER_DIR + WHISPER_FILENAME
    const info = await FileSystem.getInfoAsync(modelPath)
    if (!info.exists) {
      throw Object.assign(new Error('WHISPER_MODEL_NOT_FOUND'), { code: 'WHISPER_MODEL_NOT_FOUND' })
    }
    try {
      _whisperCtx = await _initWhisper({ filePath: modelPath })
      _nativeAvailable = true
    } catch (err) {
      const msg = String(err)
      if (msg.includes('install') || msg.includes('JSI') || msg.includes('RNWhisper')) {
        _nativeAvailable = false
        return ''
      }
      throw err
    }
  }

  // transcribe() returns { stop, promise } — not a direct Promise
  const { promise } = _whisperCtx.transcribe(audioUri, {
    language: language === 'en' ? undefined : language,  // undefined = auto-detect for tiny.en
  })

  const result = await promise
  if (onProgress) onProgress(1)

  return (result.result ?? '').trim()
}

export async function releaseWhisper(): Promise<void> {
  if (_whisperCtx) {
    await _whisperCtx.release()
    _whisperCtx = null
  }
}
