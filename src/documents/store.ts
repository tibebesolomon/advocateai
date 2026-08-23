import * as SQLite from 'expo-sqlite'
import { encryptField, decryptField } from './encryption'
import type {
  ScannedDocument,
  GeneratedLetter,
  DocumentRow,
  LetterRow,
  AlertRow,
  DocumentType,
  ActionType,
  ThreadRow,
  ThreadMessageRow,
  Thread,
  ThreadMessage,
  ScheduledAlert,
  ChatMessage,
  ChatMessageRow,
} from '../types'

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS documents (
    id          TEXT    PRIMARY KEY,
    type        TEXT    NOT NULL,
    raw_text    TEXT    NOT NULL,
    table_text  TEXT,
    image_uri   TEXT,
    metadata    TEXT    NOT NULL DEFAULT '{}',
    analysis    TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS letters (
    id          TEXT    PRIMARY KEY,
    document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    pdf_path    TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_letters_doc ON letters(document_id);

  CREATE TABLE IF NOT EXISTS threads (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS thread_messages (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    sender      TEXT NOT NULL,
    content     TEXT NOT NULL,
    is_ai       INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tmsg_thread ON thread_messages(thread_id);

  CREATE TABLE IF NOT EXISTS scheduled_alerts (
    id             TEXT PRIMARY KEY,
    document_id    TEXT NOT NULL,
    notif_ids      TEXT NOT NULL,
    deadline_label TEXT NOT NULL,
    deadline_date  TEXT NOT NULL,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_doc ON chat_messages(document_id);
`

// ─── DB Singleton ─────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null

function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('advocateai.db')
    _db.execSync(SCHEMA)
    // Add columns introduced in v2 (idempotent — ALTER TABLE ignores existing columns)
    try { _db.execSync('ALTER TABLE documents ADD COLUMN table_text TEXT') } catch { /* already exists */ }
  }
  return _db
}

// ─── Documents (async — raw_text is AES-GCM encrypted) ───────────────────────

export async function saveDocument(doc: ScannedDocument): Promise<void> {
  const encText = await encryptField(doc.rawText)
  const encAnalysis = doc.analysisResult
    ? await encryptField(JSON.stringify(doc.analysisResult))
    : null

  db().runSync(
    `INSERT OR REPLACE INTO documents
      (id, type, raw_text, table_text, image_uri, metadata, analysis, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      doc.id,
      doc.type,
      encText,
      doc.tableText ?? null,
      doc.imageUri ?? null,
      JSON.stringify(doc.metadata),
      encAnalysis,
      doc.createdAt,
    ]
  )
}

export async function getDocument(id: string): Promise<ScannedDocument | null> {
  const row = db().getFirstSync<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])
  return row ? rowToDocument(row) : null
}

export async function getAllDocuments(): Promise<ScannedDocument[]> {
  const rows = db().getAllSync<DocumentRow>('SELECT * FROM documents ORDER BY created_at DESC')
  return Promise.all(rows.map(rowToDocument))
}

export function deleteDocument(id: string): void {
  db().runSync('DELETE FROM documents WHERE id = ?', [id])
}

export async function updateDocumentAnalysis(id: string, analysis: object): Promise<void> {
  const enc = await encryptField(JSON.stringify(analysis))
  db().runSync('UPDATE documents SET analysis = ? WHERE id = ?', [enc, id])
}

async function rowToDocument(row: DocumentRow): Promise<ScannedDocument> {
  const rawText = await decryptField(row.raw_text)
  const analysisStr = row.analysis ? await decryptField(row.analysis) : null
  return {
    id: row.id,
    type: row.type as DocumentType,
    rawText,
    tableText: row.table_text ?? undefined,
    imageUri: row.image_uri ?? undefined,
    metadata: JSON.parse(row.metadata),
    analysisResult: analysisStr ? JSON.parse(analysisStr) : undefined,
    createdAt: row.created_at,
  }
}

// ─── Letters ─────────────────────────────────────────────────────────────────

export function saveLetter(letter: GeneratedLetter): void {
  db().runSync(
    `INSERT OR REPLACE INTO letters
      (id, document_id, type, content, pdf_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [letter.id, letter.documentId, letter.type, letter.content, letter.pdfPath ?? null, letter.createdAt]
  )
}

export function getLettersForDocument(documentId: string): GeneratedLetter[] {
  const rows = db().getAllSync<LetterRow>(
    'SELECT * FROM letters WHERE document_id = ? ORDER BY created_at DESC',
    [documentId]
  )
  return rows.map(rowToLetter)
}

export function getAllLetters(): GeneratedLetter[] {
  const rows = db().getAllSync<LetterRow>('SELECT * FROM letters ORDER BY created_at DESC')
  return rows.map(rowToLetter)
}

export function updateLetterContent(id: string, content: string): void {
  db().runSync('UPDATE letters SET content = ? WHERE id = ?', [content, id])
}

export function updateLetterPdfPath(id: string, pdfPath: string): void {
  db().runSync('UPDATE letters SET pdf_path = ? WHERE id = ?', [pdfPath, id])
}

export function deleteLetter(id: string): void {
  db().runSync('DELETE FROM letters WHERE id = ?', [id])
}

function rowToLetter(row: LetterRow): GeneratedLetter {
  return {
    id: row.id,
    documentId: row.document_id,
    type: row.type as ActionType,
    content: row.content,
    pdfPath: row.pdf_path ?? undefined,
    createdAt: row.created_at,
  }
}

// ─── Scheduled Alerts ─────────────────────────────────────────────────────────

export function saveScheduledAlert(alert: ScheduledAlert): void {
  db().runSync(
    `INSERT OR REPLACE INTO scheduled_alerts
      (id, document_id, notif_ids, deadline_label, deadline_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [alert.id, alert.documentId, JSON.stringify(alert.notifIds),
     alert.deadlineLabel, alert.deadlineDate, alert.createdAt]
  )
}

export function getAlertsForDocument(documentId: string): ScheduledAlert[] {
  const rows = db().getAllSync<AlertRow>(
    'SELECT * FROM scheduled_alerts WHERE document_id = ?',
    [documentId]
  )
  return rows.map(r => ({
    id: r.id,
    documentId: r.document_id,
    notifIds: JSON.parse(r.notif_ids) as string[],
    deadlineLabel: r.deadline_label,
    deadlineDate: r.deadline_date,
    createdAt: r.created_at,
  }))
}

export function deleteAlertsForDocument(documentId: string): void {
  db().runSync('DELETE FROM scheduled_alerts WHERE document_id = ?', [documentId])
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export function getOrCreateThread(documentId: string): Thread {
  const existing = db().getFirstSync<ThreadRow>(
    'SELECT * FROM threads WHERE document_id = ?', [documentId]
  )
  if (existing) {
    return { id: existing.id, documentId, messages: getThreadMessages(existing.id), createdAt: existing.created_at }
  }
  const id = makeId()
  const createdAt = Date.now()
  db().runSync('INSERT INTO threads (id, document_id, created_at) VALUES (?, ?, ?)', [id, documentId, createdAt])
  return { id, documentId, messages: [], createdAt }
}

export function getThreadForDocument(documentId: string): Thread | null {
  const row = db().getFirstSync<ThreadRow>('SELECT * FROM threads WHERE document_id = ?', [documentId])
  if (!row) return null
  return { id: row.id, documentId, messages: getThreadMessages(row.id), createdAt: row.created_at }
}

export function getThreadMessages(threadId: string): ThreadMessage[] {
  const rows = db().getAllSync<ThreadMessageRow>(
    'SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [threadId]
  )
  return rows.map(r => ({
    id: r.id,
    threadId: r.thread_id,
    sender: r.sender as 'user' | 'institution',
    content: r.content,
    isAiGenerated: r.is_ai === 1,
    createdAt: r.created_at,
  }))
}

export function addThreadMessage(msg: Omit<ThreadMessage, 'id'>): ThreadMessage {
  const id = makeId()
  db().runSync(
    'INSERT INTO thread_messages (id, thread_id, sender, content, is_ai, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, msg.threadId, msg.sender, msg.content, msg.isAiGenerated ? 1 : 0, msg.createdAt]
  )
  return { id, ...msg }
}

// ─── Advocate Chat ────────────────────────────────────────────────────────────

export function getChatMessages(documentId: string): ChatMessage[] {
  const rows = db().getAllSync<ChatMessageRow>(
    'SELECT * FROM chat_messages WHERE document_id = ? ORDER BY created_at ASC',
    [documentId]
  )
  return rows.map(r => ({
    id: r.id,
    documentId: r.document_id,
    role: r.role as 'advocate' | 'user',
    content: r.content,
    createdAt: r.created_at,
  }))
}

export function addChatMessage(msg: Omit<ChatMessage, 'id'>): ChatMessage {
  const id = makeId()
  db().runSync(
    'INSERT INTO chat_messages (id, document_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, msg.documentId, msg.role, msg.content, msg.createdAt]
  )
  return { id, ...msg }
}

export function clearChatMessages(documentId: string): void {
  db().runSync('DELETE FROM chat_messages WHERE document_id = ?', [documentId])
}

// ─── ID generator ─────────────────────────────────────────────────────────────

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
