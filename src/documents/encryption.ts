// Field-level AES-256-GCM encryption for sensitive SQLite columns.
// Uses @noble/ciphers (AES-GCM) + @noble/hashes (PBKDF2) — pure JS, no Web Crypto needed.
// Key: 32 random bytes generated on first launch, persisted in expo-secure-store
// (Android Keystore / iOS Secure Enclave).

import { gcm } from '@noble/ciphers/aes.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { getRandomBytes } from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'

const KEY_FILE = (FileSystem.documentDirectory ?? '') + '.enc_key'
const SECURE_STORE_KEY = 'advocateai_enc_key_v1'
const SALT = new TextEncoder().encode('advocateai-field-enc-v1')
const ENC_PREFIX = 'aes:'

// Singleton promise — only one key-load ever happens per session.
let _keyPromise: Promise<Uint8Array> | null = null

async function loadOrCreateKey(): Promise<Uint8Array> {
  // 1. Happy path: key already in SecureStore.
  const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY)
  if (stored) {
    return b64ToUint8(stored.trim())
  }

  // 2. Migration: key exists in the old plain file → move it to SecureStore then delete the file.
  const info = await FileSystem.getInfoAsync(KEY_FILE)
  if (info.exists) {
    const b64 = await FileSystem.readAsStringAsync(KEY_FILE, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const trimmed = b64.trim()
    await SecureStore.setItemAsync(SECURE_STORE_KEY, trimmed)
    await FileSystem.deleteAsync(KEY_FILE, { idempotent: true })
    return b64ToUint8(trimmed)
  }

  // 3. Fresh install: generate 32 random bytes and persist to SecureStore.
  const raw = getRandomBytes(32)
  await SecureStore.setItemAsync(SECURE_STORE_KEY, uint8ToB64(raw))
  return raw
}

async function getKey(): Promise<Uint8Array> {
  if (!_keyPromise) {
    _keyPromise = loadOrCreateKey().then(raw =>
      pbkdf2(sha256, raw, SALT, { c: 600_000, dkLen: 32 })
    )
  }
  return _keyPromise
}

export async function encryptField(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = getRandomBytes(12)
  const data = new TextEncoder().encode(plaintext)
  const cipher = gcm(key, iv)
  const ciphertext = cipher.encrypt(data) // ciphertext || 16-byte GCM auth tag
  return `${ENC_PREFIX}${uint8ToB64(iv)}.${uint8ToB64(ciphertext)}`
}

export async function decryptField(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored // legacy unencrypted row

  const key = await getKey()
  const payload = stored.slice(ENC_PREFIX.length)
  const dotIdx = payload.indexOf('.')
  if (dotIdx < 0) throw new Error('ENCRYPTION_FORMAT_ERROR')

  const iv = b64ToUint8(payload.slice(0, dotIdx))
  const ciphertext = b64ToUint8(payload.slice(dotIdx + 1))
  const cipher = gcm(key, iv)
  const plaintext = cipher.decrypt(ciphertext) // verifies auth tag, throws on tamper
  return new TextDecoder().decode(plaintext)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uint8ToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64ToUint8(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}
