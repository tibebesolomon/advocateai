// ─── Document Classification ──────────────────────────────────────────────────

export type DocumentType =
  | 'MEDICAL_BILL'
  | 'INSURANCE_DENIAL'
  | 'EVICTION_NOTICE'
  | 'HOUSING_NOTICE'
  | 'WELFARE_FORM'
  | 'LEGAL_NOTICE'
  | 'UTILITY_BILL'
  | 'GENERAL'

export type ActionType =
  | 'DISPUTE_LETTER'
  | 'APPEAL_LETTER'
  | 'FORM_FILL'
  | 'CALL_SCRIPT'
  | 'INFORMATION'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

// ─── OCR ─────────────────────────────────────────────────────────────────────

export interface OCRBlock {
  text: string
  bounds: { x: number; y: number; width: number; height: number }
}

// Reconstructed table structure from spatial block analysis
export interface TableCell {
  text: string
  colIndex: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface TableRow {
  rowIndex: number
  cells: TableCell[]
  bounds: { y: number; height: number }
}

export interface ExtractedTable {
  rows: TableRow[]
  columnCount: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface OCRResult {
  text: string
  confidence: number
  blocks: OCRBlock[]
  tables: ExtractedTable[]
  quality?: 'good' | 'fair' | 'poor'
  issues?: string[]
}

// ─── Documents ───────────────────────────────────────────────────────────────

export interface DocumentMetadata {
  institution?: string
  amount?: number
  dueDate?: string
  referenceNumber?: string
  dates?: string[]
  keyPhrases?: string[]
}

export interface ScannedDocument {
  id: string
  type: DocumentType
  rawText: string
  tableText?: string       // table-formatted representation of detected tables
  imageUri?: string
  metadata: DocumentMetadata
  createdAt: number
  analysisResult?: AnalysisResult
}

// ─── Anomaly Detection ───────────────────────────────────────────────────────

export type AnomalyType =
  | 'OVERCHARGE'
  | 'DUPLICATE_CHARGE'
  | 'UNAUTHORIZED'
  | 'ILLEGAL_TERM'
  | 'MISSING_DISCLOSURE'
  | 'UNBUNDLING'

export interface AnomalyFlag {
  type: AnomalyType
  description: string
  lineItem?: string
  amount?: number
  severity: Severity
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

export type DeadlineType = 'RESPONSE' | 'APPEAL' | 'PAYMENT' | 'COURT_DATE' | 'CURE_PERIOD'

export interface DeadlineInfo {
  type: DeadlineType
  label: string
  date: string           // ISO date string
  daysRemaining: number
  isStatutory: boolean   // true = derived from law, false = extracted from document
}

export interface ScheduledAlert {
  id: string
  documentId: string
  notifIds: string[]     // expo-notifications identifiers
  deadlineLabel: string
  deadlineDate: string
  createdAt: number
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

export interface RecommendedAction {
  type: ActionType
  title: string
  description: string
  priority: number
}

export interface AnalysisResult {
  summary: string
  severity: Severity
  keyFindings: string[]
  recommendedActions: RecommendedAction[]
  rightsReminder?: string
  deadline?: string
  anomalies?: AnomalyFlag[]
  deadlines?: DeadlineInfo[]
}

// ─── Generated Letters ────────────────────────────────────────────────────────

export interface GeneratedLetter {
  id: string
  documentId: string
  type: ActionType
  content: string
  pdfPath?: string
  createdAt: number
}

// ─── AI Engine ───────────────────────────────────────────────────────────────

export interface AIEngineConfig {
  modelPath?: string
  contextSize?: number
  threads?: number
  batchSize?: number
}

export type TokenCallback = (token: string) => void

// ─── Store (DB rows) ─────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string
  type: string
  raw_text: string
  table_text: string | null
  image_uri: string | null
  metadata: string
  analysis: string | null
  created_at: number
}

export interface LetterRow {
  id: string
  document_id: string
  type: string
  content: string
  pdf_path: string | null
  created_at: number
}

export interface AlertRow {
  id: string
  document_id: string
  notif_ids: string
  deadline_label: string
  deadline_date: string
  created_at: number
}

// ─── Thread / Conversation ───────────────────────────────────────────────────

export interface ThreadMessage {
  id: string
  threadId: string
  sender: 'user' | 'institution'
  content: string
  isAiGenerated: boolean
  createdAt: number
}

export interface Thread {
  id: string
  documentId: string
  messages: ThreadMessage[]
  createdAt: number
}

export interface ThreadRow {
  id: string
  document_id: string
  created_at: number
}

export interface ThreadMessageRow {
  id: string
  thread_id: string
  sender: string
  content: string
  is_ai: number
  created_at: number
}

// ─── AI Model ────────────────────────────────────────────────────────────────

// Each model family uses a different chat template wire format.
export type PromptFormat = 'chatml' | 'llama3' | 'gemma' | 'mistral'

// ─── Advocate Chat ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  documentId: string
  role: 'advocate' | 'user'
  content: string
  createdAt: number
}

export interface ChatMessageRow {
  id: string
  document_id: string
  role: string
  content: string
  created_at: number
}

// ─── Voice STT ───────────────────────────────────────────────────────────────

export type STTLanguage = 'en' | 'es' | 'zh' | 'ar' | 'fr' | 'am'
