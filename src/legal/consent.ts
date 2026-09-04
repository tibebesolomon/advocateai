import * as FileSystem from 'expo-file-system/legacy'
import { TERMS_VERSION } from './terms'
import { PRIVACY_VERSION } from './privacy'

const CONSENT_PATH = (FileSystem.documentDirectory ?? '') + '.consent.json'

type ConsentRecord = {
  termsVersion: string
  privacyVersion: string
  acceptedAt: number // Unix ms
}

export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(CONSENT_PATH)
    if (!info.exists) return false
    const raw = await FileSystem.readAsStringAsync(CONSENT_PATH)
    const record: ConsentRecord = JSON.parse(raw)
    return (
      record.termsVersion === TERMS_VERSION &&
      record.privacyVersion === PRIVACY_VERSION
    )
  } catch {
    return false
  }
}

export async function recordConsent(): Promise<void> {
  const record: ConsentRecord = {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: Date.now(),
  }
  await FileSystem.writeAsStringAsync(CONSENT_PATH, JSON.stringify(record))
}

export async function revokeConsent(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CONSENT_PATH, { idempotent: true })
  } catch { /* ignore */ }
}
