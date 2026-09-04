import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import type {
  AIEngineConfig,
  AnalysisResult,
  ScannedDocument,
  TokenCallback,
} from '../types'
import {
  buildAnalysisPrompt,
  buildLetterPrompt,
  buildCallScriptPrompt,
  buildFormPrompt,
  buildReplyPrompt,
  buildAnomalyPrompt,
  buildChatOpenerPrompt,
  buildChatPrompt,
  setModelFormat,
  getStopTokens,
} from './prompts'
import type { AnomalyFlag, AnomalyType, ExtractedTable, ChatMessage, PromptFormat } from '../types'

// require('llama.rn') succeeds in both Expo Go and native builds — the module
// loads fine either way. The failure only happens inside initLlama() when it
// calls RNLlama.install() and RNLlama is null (Expo Go / no native module).
// We therefore load lazily and detect native availability from the first
// initLlama() attempt rather than at bundle-load time.

let _initLlama: typeof import('llama.rn').initLlama | null = null
let _llamaLoaded = false
// null = not yet determined, true/false = confirmed after first initLlama attempt
let _nativeAvailable: boolean | null = null

function ensureLlamaLoaded() {
  if (_llamaLoaded) return
  _llamaLoaded = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('llama.rn') as typeof import('llama.rn')
    _initLlama = mod.initLlama
  } catch {
    _initLlama = null
  }
}

const MODELS_DIR = (FileSystem.documentDirectory ?? '') + 'models/'
const MODEL_FILENAME = 'model.gguf'
const MODEL_META_FILENAME = 'model-meta.json'

const DEFAULTS: Required<Omit<AIEngineConfig, 'modelPath'>> = {
  contextSize: 2048,
  threads: Platform.OS === 'ios' ? 6 : 4,
  batchSize: Platform.OS === 'ios' ? 256 : 512,
}

// Low RAM: half the default KV cache
const LOW_MEM: Required<Omit<AIEngineConfig, 'modelPath'>> = {
  contextSize: 512,
  threads: 2,
  batchSize: 64,
}

// Ultra-low RAM: bare minimum — works on devices with ~1 GB free
const ULTRA_LOW_MEM: Required<Omit<AIEngineConfig, 'modelPath'>> = {
  contextSize: 256,
  threads: 1,
  batchSize: 32,
}

// ─── File validation ──────────────────────────────────────────────────────────

// Returns true when the file is definitely corrupt (missing GGUF magic or too small).
// GGUF files always start with the 4 ASCII bytes: G G U F (0x47 0x47 0x55 0x46).
async function isFileCorrupt(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists || info.size < 100 * 1024 * 1024) return true  // < 100 MB → definitely wrong

    // Read first 4 bytes as base64 and check for GGUF magic
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 4,
    })
    const decoded = atob(b64)
    return decoded !== 'GGUF'
  } catch {
    // If we can't read the file at all, treat as corrupt
    return true
  }
}

// ─── Engine Singleton ─────────────────────────────────────────────────────────

class AIEngine {
  private ctx: import('llama.rn').LlamaContext | null = null
  private initializing = false
  private initQueue: Array<() => void> = []
  private lastCompletionAt = 0
  private static readonly COOLDOWN_MS = 1500 // min gap between completions

  // True once a successful initLlama() call has confirmed JSI is working.
  get isNativeAvailable(): boolean {
    ensureLlamaLoaded()
    // If _nativeAvailable hasn't been determined yet, optimistically report
    // true when the llama module loaded (it will be confirmed on first use).
    return _initLlama !== null && _nativeAvailable !== false
  }

  // ── Model file management ──────────────────────────────────────────────────

  async modelPath(): Promise<string | null> {
    try {
      const path = MODELS_DIR + MODEL_FILENAME
      const info = await FileSystem.getInfoAsync(path)
      return info.exists ? path : null
    } catch {
      return null
    }
  }

  async isModelReady(): Promise<boolean> {
    ensureLlamaLoaded()
    if (_initLlama === null) return false  // llama.rn module failed to load entirely
    return (await this.modelPath()) !== null
  }

  // ── Initialization ────────────────────────────────────────────────────────

  async initialize(config?: AIEngineConfig): Promise<void> {
    if (this.ctx) return

    ensureLlamaLoaded()
    if (!_initLlama) {
      throw Object.assign(new Error('AI_UNAVAILABLE'), { code: 'AI_UNAVAILABLE' })
    }

    if (this.initializing) {
      await new Promise<void>((resolve) => this.initQueue.push(resolve))
      return
    }

    this.initializing = true
    try {
      const path = config?.modelPath ?? (await this.modelPath())
      if (!path) throw new Error('MODEL_NOT_FOUND')

      const tryLoad = async (
        cfg: Required<Omit<AIEngineConfig, 'modelPath'>>,
        gpuLayers = Platform.OS === 'ios' ? 99 : 0
      ) => {
        this.ctx = await _initLlama!({
          model: path,
          use_mlock: false,
          n_ctx: cfg.contextSize,
          n_batch: cfg.batchSize,
          n_threads: cfg.threads,
          n_gpu_layers: gpuLayers,
        })
      }

      try {
        await tryLoad({
          contextSize: config?.contextSize ?? DEFAULTS.contextSize,
          threads: config?.threads ?? DEFAULTS.threads,
          batchSize: config?.batchSize ?? DEFAULTS.batchSize,
        })
        _nativeAvailable = true
        // Read model-meta.json to set the correct prompt format, then delete it
        // so it doesn't linger as unencrypted model metadata on disk.
        try {
          const metaPath = MODELS_DIR + MODEL_META_FILENAME
          const metaInfo = await FileSystem.getInfoAsync(metaPath)
          if (metaInfo.exists) {
            const raw = await FileSystem.readAsStringAsync(metaPath)
            const meta = JSON.parse(raw) as { format?: string }
            if (meta.format) setModelFormat(meta.format as PromptFormat)
            await FileSystem.deleteAsync(metaPath, { idempotent: true })
          }
        } catch { /* keep default chatml if meta unreadable */ }
      } catch (loadErr) {
        const msg = String(loadErr)
        // JSI install failure = Expo Go or missing native module.
        if (msg.includes('install') || msg.includes('JSI') || msg.includes('RNLlama')) {
          _nativeAvailable = false
          throw Object.assign(new Error('AI_UNAVAILABLE'), { code: 'AI_UNAVAILABLE' })
        }
        // Corrupt / partial download — delete and ask user to re-download.
        const corrupt = await isFileCorrupt(path)
        if (corrupt) {
          await FileSystem.deleteAsync(path, { idempotent: true })
          throw new Error('MODEL_CORRUPT')
        }
        // Retry 1: low RAM (n_ctx=512), CPU-only forced
        try {
          await tryLoad(LOW_MEM, 0)
          _nativeAvailable = true
          return
        } catch { /* fall through */ }
        // Retry 2: ultra-low RAM (n_ctx=256, 1 thread), CPU-only forced
        try {
          await tryLoad(ULTRA_LOW_MEM, 0)
          _nativeAvailable = true
        } catch (finalErr) {
          // File is valid but device cannot load it — do NOT delete the file.
          throw new Error(`MODEL_RUNTIME_ERROR: ${String(finalErr)}`)
        }
      }
    } finally {
      this.initializing = false
      this.initQueue.forEach((r) => r())
      this.initQueue = []
    }
  }

  // ── Inference helpers ─────────────────────────────────────────────────────

  private async complete(
    prompt: string,
    maxTokens: number,
    temperature: number,
    onToken?: TokenCallback
  ): Promise<string> {
    // Rate limiting: enforce minimum gap between completions to protect battery/CPU
    const now = Date.now()
    const wait = AIEngine.COOLDOWN_MS - (now - this.lastCompletionAt)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))

    await this.initialize()
    if (!this.ctx) throw new Error('ENGINE_NOT_READY')

    const result = await this.ctx.completion(
      {
        prompt,
        n_predict: maxTokens,
        temperature,
        top_p: 0.9,
        penalty_repeat: 1.1,
        stop: getStopTokens(),
      },
      onToken ? (data: { token: string }) => onToken(data.token) : undefined
    )

    this.lastCompletionAt = Date.now()
    return result.text
      .replace(/^```[a-z]*\n?/i, '')  // strip opening code fence
      .replace(/\n?```\s*$/i, '')      // strip closing code fence
      .trim()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async analyzeDocument(
    doc: ScannedDocument,
    onToken?: TokenCallback
  ): Promise<AnalysisResult> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoAnalysis(doc)

    const prompt = buildAnalysisPrompt(doc.type, doc.rawText, doc.metadata)
    const raw = await this.complete(prompt, 700, 0.1, onToken)
    return parseAnalysisJSON(raw)
  }

  async detectAnomalies(
    doc: ScannedDocument,
    tables: ExtractedTable[] = [],
    onToken?: TokenCallback
  ): Promise<AnomalyFlag[]> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return []

    const prompt = buildAnomalyPrompt(doc.type, doc.rawText, tables)
    const raw = await this.complete(prompt, 500, 0.05, onToken)
    return parseAnomalyJSON(raw)
  }

  async generateLetter(
    doc: ScannedDocument,
    letterType: string,
    onToken?: TokenCallback
  ): Promise<string> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoLetter(doc, letterType)

    const prompt = letterType === 'FORM_FILL'
      ? buildFormPrompt(doc)
      : buildLetterPrompt(doc, letterType)
    return this.complete(prompt, 1100, 0.2, onToken)
  }

  async generateReply(
    doc: ScannedDocument,
    originalLetter: string,
    institutionReply: string,
    onToken?: TokenCallback
  ): Promise<string> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoReply(doc)
    const prompt = buildReplyPrompt(doc, originalLetter, institutionReply)
    return this.complete(prompt, 1200, 0.2, onToken)
  }

  async generateCallScript(
    doc: ScannedDocument,
    onToken?: TokenCallback
  ): Promise<string> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoCallScript(doc)

    const prompt = buildCallScriptPrompt(doc)
    return this.complete(prompt, 600, 0.15, onToken)
  }

  async generateChatOpener(
    doc: ScannedDocument,
    onToken?: TokenCallback
  ): Promise<string> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoChatOpener(doc)
    const prompt = buildChatOpenerPrompt(doc)
    return this.complete(prompt, 250, 0.35, onToken)
  }

  async chat(
    doc: ScannedDocument,
    history: ChatMessage[],
    userMessage: string,
    onToken?: TokenCallback
  ): Promise<string> {
    ensureLlamaLoaded()
    if (_initLlama === null || _nativeAvailable === false) return buildDemoChatResponse(doc, userMessage)
    const prompt = buildChatPrompt(doc, history, userMessage)
    return this.complete(prompt, 350, 0.4, onToken)
  }

  async release(): Promise<void> {
    if (this.ctx) {
      await this.ctx.release()
      this.ctx = null
    }
  }

  async deleteModel(): Promise<void> {
    await this.release()
    const path = MODELS_DIR + MODEL_FILENAME
    await FileSystem.deleteAsync(path, { idempotent: true })
  }
}

// ─── Demo mode (Expo Go / no native module) ───────────────────────────────────

export const DEMO_MODE_NOTICE = '⚠️ Demo mode — on-device AI requires a native build.'

function buildDemoAnalysis(doc: ScannedDocument): AnalysisResult {
  const typeMap: Record<string, { severity: AnalysisResult['severity']; summary: string }> = {
    MEDICAL_BILL: {
      severity: 'HIGH',
      summary: 'This appears to be a medical bill. You may have the right to request an itemized statement and dispute any charges you do not recognize.',
    },
    INSURANCE_DENIAL: {
      severity: 'URGENT',
      summary: 'This document appears to be an insurance denial. You have the right to appeal this decision. Deadlines for appeals are typically 30–180 days.',
    },
    EVICTION_NOTICE: {
      severity: 'URGENT',
      summary: 'This appears to be an eviction notice. You may have legal rights including a court hearing. Seek legal aid immediately.',
    },
    WELFARE_FORM: {
      severity: 'MEDIUM',
      summary: 'This appears to be a benefits or welfare form. Ensure all required fields are completed accurately to avoid delays.',
    },
  }
  const mapped = typeMap[doc.type] ?? {
    severity: 'MEDIUM' as const,
    summary: 'Document received. In a production build, the on-device AI will provide a detailed analysis of this document and suggest next steps.',
  }

  return {
    summary: mapped.summary,
    severity: mapped.severity,
    keyFindings: [
      'Document type auto-detected from content',
      'Full AI analysis available in the production native build',
      DEMO_MODE_NOTICE,
    ],
    recommendedActions: [
      {
        type: 'DISPUTE_LETTER',
        title: 'Generate a Response Letter',
        description: 'Tap below to generate a draft response letter (demo content in Expo Go).',
        priority: 1,
      },
      {
        type: 'INFORMATION',
        title: 'Know Your Rights',
        description: 'You have the right to request documentation, ask for extensions, and appeal most decisions in writing.',
        priority: 2,
      },
    ],
    rightsReminder: 'In the United States, you have the right to appeal most government and insurance decisions in writing within a specified timeframe.',
  }
}

function buildDemoLetter(doc: ScannedDocument, letterType: string): string {
  return `[${DEMO_MODE_NOTICE}]

[Your Name]
[Your Address]
[City, State ZIP]
[Date]

To Whom It May Concern,

Re: ${letterType.replace(/_/g, ' ')} — ${doc.type.replace(/_/g, ' ')}

I am writing regarding the document I received. I am requesting a full review of this matter and ask that you provide me with a written response within 30 days.

Please contact me at the address above with any questions.

Sincerely,
[Your Name]

---
Note: This is a demo letter. The production build generates fully personalized letters using on-device AI based on the specific content of your document.`
}

function buildDemoReply(doc: ScannedDocument): string {
  return `[${DEMO_MODE_NOTICE}]

[Your Name]
[Your Address]
[City, State ZIP]
[Date]

Re: Follow-Up Response

Dear ${doc.metadata.institution ?? 'To Whom It May Concern'},

Thank you for your response to my previous letter regarding this ${doc.type.replace(/_/g, ' ')} matter.

After reviewing your reply, I must respectfully maintain my original position. I require the previously requested action to be taken and a written response within 30 days.

Respectfully,
The Undersigned

---
Note: This is a demo reply. The production build generates personalized counter-responses based on the institution's specific reply.`
}

function buildDemoChatOpener(doc: ScannedDocument): string {
  const institution = doc.metadata.institution ?? 'the sender'
  const amount = doc.metadata.amount != null ? ` of $${doc.metadata.amount.toFixed(2)}` : ''
  const openers: Partial<Record<string, string>> = {
    MEDICAL_BILL: `I've reviewed your medical bill${amount} from ${institution}. Medical bills often contain errors and overcharges, and many people qualify for financial assistance they never knew about — so you may owe much less than this shows. You're not alone in this, and you have real options. Can you tell me a bit about what happened? For example, was this visit planned or unexpected, and do you have insurance?`,
    INSURANCE_DENIAL: `I've looked at your insurance denial from ${institution}. A denial is not the final word — you have the right to appeal, and many appeals succeed when they're done in writing with the right information. I'm here to help you through this step by step. Can you tell me what the denial was for, and when did you first receive it?`,
    EVICTION_NOTICE: `I've reviewed the eviction notice from ${institution}. I know this is really stressful, and I want you to know: receiving this notice does not mean you have to leave immediately — you have legal rights and time to respond. Let's figure this out together. Can you tell me when you received this and what reason they gave for it?`,
    UTILITY_BILL: `I've reviewed your utility bill${amount} from ${institution}. There are several assistance programs that could help with this, and you may qualify for more support than you realize. Let me help you explore your options. Can you tell me whether this is higher than usual, or have you been struggling to keep up with payments lately?`,
    WELFARE_FORM: `I've reviewed the benefits form from ${institution}. These forms can be confusing on purpose, and missing even one detail can delay or deny your benefits — so I want to help you get this right. Can you tell me what you're applying for and whether there's anything specific you're unsure about?`,
  }
  return openers[doc.type] ?? `I've reviewed your document${amount} from ${institution}. I'm here as your personal advocate to help you understand what this means and figure out the best path forward. You don't have to deal with this alone. Can you tell me what happened and what your biggest concern is right now?`
}

function buildDemoChatResponse(_doc: ScannedDocument, userMessage: string): string {
  const lower = userMessage.toLowerCase()
  if (lower.includes('letter') || lower.includes('write') || lower.includes('respond')) {
    return `Absolutely — writing a formal letter is one of the most powerful things you can do because it creates a paper trail and forces them to respond in writing. I can draft a complete letter for you right now based on your document. Would you like a dispute letter, an appeal, or a general response? I can have a draft ready for you to review.`
  }
  if (lower.includes('call') || lower.includes('phone')) {
    return `Good thinking — sometimes a phone call can move things faster than a letter. I can prepare a step-by-step call script for you so you know exactly what to say and what to ask for. The key is to stay calm, get the representative's name, and always ask for confirmation in writing. Want me to prepare that script for you?`
  }
  if (lower.includes('right') || lower.includes('law') || lower.includes('legal')) {
    return `You have more rights than most people realize. The key protections for your situation include the right to a written explanation of any decision, the right to appeal within a set timeframe, and the right to request documentation that was used to make any decision against you. Would you like me to help you put any of these rights into action with a formal letter?`
  }
  return `Thank you for sharing that with me — what you're going through sounds genuinely difficult, and it makes sense that you're looking for answers. Based on what you've told me and the document I reviewed, you do have options here. The most important thing is to respond in writing so there's a clear record. Would you like me to help you draft a response, or would it be more helpful to prepare you for a phone call first?`
}

function buildDemoCallScript(doc: ScannedDocument): string {
  return `[${DEMO_MODE_NOTICE}]

CALL SCRIPT — ${doc.type.replace(/_/g, ' ')}

When the representative answers:
"Hello, my name is [Your Name] and I am calling about [document reference]. I would like to understand my options and next steps."

Key questions to ask:
1. "Can you explain the reason for this [bill/denial/notice]?"
2. "What is the deadline for me to respond or appeal?"
3. "Can you send me this information in writing?"
4. "Who is the best person to speak with about appealing this decision?"

Remember to: Write down the representative's name, the date and time of the call, and any reference numbers they give you.`
}

// ─── JSON response parser ─────────────────────────────────────────────────────

// Coerce any value to a plain non-empty string, or return null.
function toStr(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object') {
    // Model sometimes wraps findings as {text:"..."} or {finding:"..."}
    const obj = v as Record<string, unknown>
    const inner = obj.text ?? obj.finding ?? obj.description ?? obj.content ?? Object.values(obj)[0]
    return inner != null ? String(inner).trim() || null : null
  }
  return String(v).trim() || null
}

function parseAnalysisJSON(raw: string): AnalysisResult {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

  try {
    // Grab the outermost {...} block
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      const obj = JSON.parse(match[0])

      const summary = toStr(obj.summary) ?? ''
      // Reject if the model echoed the placeholder text back verbatim
      const safeSummary = summary.startsWith('<') ? '' : summary

      const findings: string[] = Array.isArray(obj.keyFindings)
        ? (obj.keyFindings.map(toStr).filter(Boolean) as string[])
        : []

      const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
      const severity = VALID_SEVERITIES.includes(obj.severity) ? obj.severity : 'MEDIUM'

      const VALID_ACTION_TYPES = ['DISPUTE_LETTER', 'APPEAL_LETTER', 'FORM_FILL', 'CALL_SCRIPT', 'INFORMATION'] as const
      const actions = Array.isArray(obj.recommendedActions)
        ? obj.recommendedActions
            .map((a: Record<string, unknown>) => ({
              type: (VALID_ACTION_TYPES.includes(a.type as any) ? a.type : 'INFORMATION') as AnalysisResult['recommendedActions'][0]['type'],
              title: toStr(a.title) ?? '',
              description: toStr(a.description) ?? '',
              priority: Number(a.priority ?? 3),
            }))
            .filter((a: { title: string }) => a.title)
        : []

      return {
        summary: safeSummary,
        severity,
        keyFindings: findings,
        recommendedActions: actions,
        rightsReminder: toStr(obj.rightsReminder) ?? undefined,
        deadline: toStr(obj.deadline) ?? undefined,
      }
    }
  } catch {
    // fall through to plain-text fallback
  }

  // Fallback: show raw model output as summary so user sees something
  const plain = cleaned.replace(/<[^>]+>/g, '').trim()
  return {
    summary: plain.length > 400 ? plain.slice(0, 400) + '…' : plain,
    severity: 'MEDIUM',
    keyFindings: [],
    recommendedActions: [],
  }
}

// ─── Anomaly JSON parser ──────────────────────────────────────────────────────

const VALID_ANOMALY_TYPES: AnomalyType[] = [
  'OVERCHARGE', 'DUPLICATE_CHARGE', 'UNAUTHORIZED', 'ILLEGAL_TERM',
  'MISSING_DISCLOSURE', 'UNBUNDLING',
]
const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

function parseAnomalyJSON(raw: string): AnomalyFlag[] {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  try {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      const obj = JSON.parse(match[0])
      const arr = Array.isArray(obj.anomalies) ? obj.anomalies : []
      return arr
        .map((a: Record<string, unknown>) => ({
          type: VALID_ANOMALY_TYPES.includes(a.type as AnomalyType)
            ? (a.type as AnomalyType)
            : 'UNAUTHORIZED' as AnomalyType,
          description: typeof a.description === 'string' ? a.description : '',
          lineItem: typeof a.lineItem === 'string' ? a.lineItem : undefined,
          amount: typeof a.amount === 'number' ? a.amount : undefined,
          severity: VALID_SEVERITIES.includes(a.severity as any) ? a.severity as AnomalyFlag['severity'] : 'MEDIUM',
        }))
        .filter((a: { description: string }) => a.description)
    }
  } catch {
    // return empty on parse failure
  }
  return []
}

export const aiEngine = new AIEngine()
export { MODELS_DIR, MODEL_FILENAME }
