// Field-level AES-256-GCM encryption for sensitive SQLite columns (rawText, analysis).
// Uses @noble/ciphers (AES-GCM) + @noble/hashes (PBKDF2) — pure JS, no Web Crypto needed.
// The encryption key is derived from a static app salt. In a hardened build, replace
// KEY_MATERIAL with a value fetched from expo-secure-store on first launch.

import { gcm } from '@noble/ciphers/aes.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { getRandomBytes } from 'expo-crypto'

const KEY_MATERIAL = new TextEncoder().encode('advocateai-field-enc-v1')
const SALT = new TextEncoder().encode('advocateai-salt-2024')
const ENC_PREFIX = 'aes:'

let _key: Uint8Array | null = null

function getKey(): Uint8Array {
  if (_key) return _key
  // PBKDF2-SHA256 with static material — one-time cost, cached for the session.
  const derived = pbkdf2(sha256, KEY_MATERIAL, SALT, { c: 100_000, dkLen: 32 })
  _key = derived
  return derived
}

export async function encryptField(plaintext: string): Promise<string> {
  const key = getKey()
  const iv = getRandomBytes(12)
  const data = new TextEncoder().encode(plaintext)

  const cipher = gcm(key, iv)
  const ciphertext = cipher.encrypt(data)  // ciphertext || 16-byte GCM auth tag

  return `${ENC_PREFIX}${uint8ToB64(iv)}.${uint8ToB64(ciphertext)}`
}

export async function decryptField(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored  // legacy unencrypted row

  const key = getKey()
  const payload = stored.slice(ENC_PREFIX.length)
  const dotIdx = payload.indexOf('.')
  if (dotIdx < 0) throw new Error('ENCRYPTION_FORMAT_ERROR')

  const iv = b64ToUint8(payload.slice(0, dotIdx))
  const ciphertext = b64ToUint8(payload.slice(dotIdx + 1))

  const cipher = gcm(key, iv)
  const plaintext = cipher.decrypt(ciphertext)  // verifies auth tag, throws on tamper
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
