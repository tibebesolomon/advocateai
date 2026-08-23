import type { DocumentType, DocumentMetadata, ScannedDocument, ExtractedTable, ChatMessage, PromptFormat } from '../types'

// ─── Model Chat Templates ─────────────────────────────────────────────────────

// Active prompt format — updated by setModelFormat() when the engine loads a model.
let _fmt: PromptFormat = 'chatml'

export function setModelFormat(f: PromptFormat) { _fmt = f }
export function getModelFormat(): PromptFormat { return _fmt }

// Stop tokens differ across model families.
// STOP_TOKENS is exported for backward compat; prefer getStopTokens() at call sites.
export const STOP_TOKENS = ['</s>', '<|im_end|>', '<|end|>', '<|eot_id|>', '<end_of_turn>', 'User:', 'Human:']

export function getStopTokens(): string[] {
  switch (_fmt) {
    case 'llama3':
      return ['<|eot_id|>', '<|end_of_text|>', '<|start_header_id|>', 'User:', 'Human:']
    case 'gemma':
      return ['<end_of_turn>', '<start_of_turn>', '</s>', 'User:', 'Human:']
    case 'mistral':
      return ['</s>', '[INST]', 'User:', 'Human:']
    default: // chatml — Qwen2.5, Phi-3.x
      return ['</s>', '<|im_end|>', '<|end|>', '<|eot_id|>', 'User:', 'Human:']
  }
}

// Single-turn: system prompt + one user message → ready for assistant completion.
export function formatPrompt(systemMessage: string, userMessage: string): string {
  switch (_fmt) {
    case 'llama3':
      return (
        `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n` +
        `${systemMessage}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n` +
        `${userMessage}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`
      )
    case 'gemma':
      // Gemma has no dedicated system turn; prepend system to first user message.
      return (
        `<bos><start_of_turn>user\n${systemMessage}\n\n${userMessage}<end_of_turn>\n` +
        `<start_of_turn>model\n`
      )
    case 'mistral':
      // Mistral v0.3 wraps system + user together in [INST].
      return `<s>[INST] ${systemMessage}\n\n${userMessage} [/INST]`
    default: // chatml
      return (
        `<|im_start|>system\n${systemMessage}\n<|im_end|>\n` +
        `<|im_start|>user\n${userMessage}\n<|im_end|>\n` +
        `<|im_start|>assistant\n`
      )
  }
}

const SYSTEM_ADVOCATE = `You are AdvocateAI, a compassionate legal and administrative assistant \
helping low-income, elderly, and underserved people understand official documents and take action. \
Always use plain, simple language. Never use legal jargon without explaining it. \
Be direct about urgency when deadlines or rights are at stake. \
Respond ONLY in valid JSON — no prose outside the JSON object.`

const SYSTEM_LETTER_WRITER = `You are AdvocateAI, an expert letter writer helping underserved \
individuals draft professional dispute, appeal, and response letters. \
Write clearly, politely, but firmly. Reference specific document details. \
Assert legal rights without being aggressive. Output only the letter text — no JSON, no preamble.`

// ─── Document Context Hints ──────────────────────────────────────────────────

const DOC_CONTEXT: Record<DocumentType, string> = {
  MEDICAL_BILL:
    'Medical bill. Patient rights: (1) itemized bill on request (HIPAA), (2) hospital Charity Care / financial assistance for uninsured or low-income patients, (3) dispute any charge within 30–180 days in writing. Flag any per-item charge that is unreasonably high (e.g. $10+ for a Tylenol, $20+ for a bandage, administrative "supply surcharges"). Note if patient is listed as Uninsured or Self-Pay — they almost always qualify for free or reduced-cost care under the hospital\'s Charity Care policy.',
  INSURANCE_DENIAL:
    'Insurance claim denial. Patient rights: internal appeal within 180 days (ACA), external review, and emergency care coverage regardless of network.',
  EVICTION_NOTICE:
    'EVICTION NOTICE — urgent. Tenant rights: proper written notice period (typically 3–30 days by law), right to cure, right to respond in writing before court date.',
  HOUSING_NOTICE:
    'Housing notice from landlord. Tenant rights: habitability standards, anti-retaliation protections, and written lease terms enforcement.',
  WELFARE_FORM:
    'Government benefits form. Applicant rights: right to appeal any denial within 90 days, right to request a fair hearing, and right to assistance completing forms.',
  LEGAL_NOTICE:
    'Legal notice. Recipient rights: right to respond, right to legal counsel, and right to contest claims within the stated deadline.',
  UTILITY_BILL:
    'Utility bill. Programs available: LIHEAP (heating/cooling assistance), utility arrearage forgiveness, and payment plans for low-income customers.',
  GENERAL:
    'Official document. Review carefully for deadlines, amounts owed, and required responses.',
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

export function buildAnalysisPrompt(
  type: DocumentType,
  rawText: string,
  metadata: DocumentMetadata
): string {
  const truncated = rawText.length > 1400 ? rawText.slice(0, 1400) + '\n[...truncated]' : rawText

  const userMessage = `Analyze this ${type.replace('_', ' ')} document and reply with a single JSON object.

CONTEXT: ${DOC_CONTEXT[type]}

DOCUMENT:
${truncated}

Key facts already extracted:
Institution: ${metadata.institution ?? 'Unknown'}
Amount: ${metadata.amount != null ? `$${metadata.amount.toFixed(2)}` : 'not found'}
Reference: ${metadata.referenceNumber ?? 'not found'}
Due date: ${metadata.dueDate ?? 'not found'}

Rules:
- summary: 1-2 plain English sentences explaining what this means for the person
- severity: one of LOW, MEDIUM, HIGH, URGENT
- keyFindings: array of plain English strings, each a separate finding (3-5 items)
- For MEDICAL_BILL: each overpriced line item gets its own finding string naming the item and amount. If Uninsured/Self-Pay, include a finding about Charity Care eligibility.
- recommendedActions: array of action objects
- Each action has: type (one of DISPUTE_LETTER, APPEAL_LETTER, CALL_SCRIPT, INFORMATION), title (short), description (one sentence), priority (1=highest)
- rightsReminder: one sentence about a legal right, or null
- deadline: the due date if found, or null

Example of correct output format:
{"summary":"You owe $500 on a hospital bill due in 2 weeks. You may be able to reduce or eliminate this bill.","severity":"HIGH","keyFindings":["Total amount due is $500 by January 15","You may qualify for hospital financial assistance","$50 charge for aspirin appears unreasonably high"],"recommendedActions":[{"type":"DISPUTE_LETTER","title":"Request Itemized Bill","description":"Write to the hospital asking for a full itemized statement of all charges.","priority":1},{"type":"CALL_SCRIPT","title":"Call Billing Department","description":"Call to ask about financial assistance programs.","priority":2}],"rightsReminder":"You have the right to request a fully itemized bill under HIPAA at any time.","deadline":"January 15"}

Now output the JSON for the document above:`

  return formatPrompt(SYSTEM_ADVOCATE, userMessage)
}

// ─── Anomaly Detection Prompt ─────────────────────────────────────────────────

const SYSTEM_ANOMALY = `You are AdvocateAI, a billing and legal anomaly detector. \
Identify overcharges, duplicate line items, unauthorized fees, unbundled charges, \
and illegal clauses. Be specific: name the exact item and amount. \
Respond ONLY in valid JSON — no prose outside the JSON object.`

export function buildAnomalyPrompt(
  type: DocumentType,
  rawText: string,
  tables: ExtractedTable[]
): string {
  const truncated = rawText.length > 1400 ? rawText.slice(0, 1400) + '\n[...truncated]' : rawText
  const tableSection = tables.length > 0
    ? '\n\nLINE ITEMS (TABULAR):\n' + tables.map(t =>
        t.rows.map(r => r.cells.map(c => c.text).join(' | ')).join('\n')
      ).join('\n\n')
    : ''

  const userMessage = `Detect billing errors, illegal terms, and anomalies in this ${type.replace(/_/g, ' ')}.

DOCUMENT:
${truncated}${tableSection}

Return a JSON object with a single key "anomalies" containing an array. Each element has:
- type: one of OVERCHARGE, DUPLICATE_CHARGE, UNAUTHORIZED, ILLEGAL_TERM, MISSING_DISCLOSURE, UNBUNDLING
- description: plain English explanation of the problem (1-2 sentences)
- lineItem: the exact item name from the document, or null
- amount: the dollar amount if applicable, or null
- severity: one of LOW, MEDIUM, HIGH, URGENT

Rules for MEDICAL_BILL:
- Flag any supply/medication priced >5× typical retail (e.g. $20+ per Tylenol, $15+ per saline bag)
- Flag facility fees added to already-itemized line items (unbundling)
- Flag "self-pay" patients who were not informed of charity care (MISSING_DISCLOSURE)
- Flag duplicate CPT codes for the same procedure

Rules for EVICTION_NOTICE:
- Flag self-help eviction threats (illegal in all US states)
- Flag fees not specified in the lease (UNAUTHORIZED)
- Flag illegal lease terms (waiver of right to habitable premises, etc.)

Output ONLY the JSON. If no anomalies found, return {"anomalies":[]}.`

  return formatPrompt(SYSTEM_ANOMALY, userMessage)
}

export function buildLetterPrompt(document: ScannedDocument, letterType: string): string {
  const { type, rawText, metadata } = document
  const excerpt = rawText.length > 1000 ? rawText.slice(0, 1000) + '\n[...]' : rawText
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const isMedicalBill = type === 'MEDICAL_BILL'
  const medicalExtra = isMedicalBill ? `
MEDICAL BILL SPECIFIC REQUIREMENTS:
- Identify and name each individual line item that appears unreasonably priced (e.g. $65 for Tylenol, $85 for a bandage/supply surcharge) and challenge it by name and amount
- Demand a fully itemized bill with CPT code descriptions
- If the patient appears to be Uninsured or Self-Pay, explicitly request a Charity Care / Financial Assistance application and state that federal law requires hospitals to screen uninsured patients
- Request that all charges be reviewed against fair market rates` : ''

  const userMessage = `Write a complete ${letterType} letter for the following ${type.replace('_', ' ')} document.

TODAY'S DATE: ${today}
INSTITUTION: ${metadata.institution ?? '[Institution Name]'}
REFERENCE #: ${metadata.referenceNumber ?? '[Reference Number]'}
AMOUNT IN QUESTION: ${metadata.amount != null ? `$${metadata.amount.toFixed(2)}` : '[Amount]'}
DUE DATE MENTIONED: ${metadata.dueDate ?? 'Not specified'}

ORIGINAL DOCUMENT EXCERPT:
${excerpt}
${medicalExtra}
LETTER REQUIREMENTS:
1. Start with today's date and sender block (use "The Undersigned" — no real name)
2. Address to ${metadata.institution ?? 'To Whom It May Concern'}
3. Opening paragraph: state purpose clearly
4. Body: cite specific document details, assert relevant rights
5. Resolution request: what you want them to do, in plain terms
6. State that a written response is required within 30 days
7. Close: "Respectfully, The Undersigned"

Write the full letter now:`

  return formatPrompt(SYSTEM_LETTER_WRITER, userMessage)
}

export function buildCallScriptPrompt(document: ScannedDocument): string {
  const userMessage = `Create a simple phone call script for someone calling ${
    document.metadata.institution ?? 'the institution'
  } about a ${document.type.replace('_', ' ')} issue.

Document summary: ${document.analysisResult?.summary ?? 'See original document.'}
Reference #: ${document.metadata.referenceNumber ?? 'N/A'}

Write a step-by-step call script as a numbered list. Use simple, calm language.
Include: what to say when answered, what information to have ready, what to ask for, and how to end the call.`

  return formatPrompt(SYSTEM_ADVOCATE, userMessage)
}

export function buildFormPrompt(doc: ScannedDocument): string {
  const { type, rawText, metadata } = doc
  const excerpt = rawText.length > 1000 ? rawText.slice(0, 1000) + '\n[...]' : rawText
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const userMessage = `Create a complete, printable form for this ${type.replace(/_/g, ' ')} document.

TODAY'S DATE: ${today}
INSTITUTION: ${metadata.institution ?? '[Institution Name]'}
REFERENCE #: ${metadata.referenceNumber ?? '[Reference Number]'}

ORIGINAL DOCUMENT:
${excerpt}

FORMAT RULES:
- Title in ALL CAPS at the top
- Organize into sections with ALL CAPS headers
- Each field on its own line: Label: ________________________
- Pre-fill any information already found in the document
- Leave unknown fields as blank underlines
- End with: DATE: __________ SIGNATURE: __________________________

Write the complete form now:`

  return formatPrompt(SYSTEM_LETTER_WRITER, userMessage)
}

// ─── Advocate Chat Prompts ────────────────────────────────────────────────────

// Builds a multi-turn prompt in whichever format the active model expects.
function formatMultiTurnPrompt(
  systemMessage: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  switch (_fmt) {
    case 'llama3': {
      let p = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemMessage}<|eot_id|>`
      for (const t of turns) {
        const role = t.role === 'assistant' ? 'assistant' : 'user'
        p += `<|start_header_id|>${role}<|end_header_id|>\n\n${t.content}<|eot_id|>`
      }
      return p + `<|start_header_id|>assistant<|end_header_id|>\n\n`
    }
    case 'gemma': {
      // System prepended to first user turn; no standalone system tag.
      let p = '<bos>'
      let systemAdded = false
      for (const t of turns) {
        if (t.role === 'user') {
          const content = systemAdded ? t.content : `${systemMessage}\n\n${t.content}`
          systemAdded = true
          p += `<start_of_turn>user\n${content}<end_of_turn>\n`
        } else {
          p += `<start_of_turn>model\n${t.content}<end_of_turn>\n`
        }
      }
      return p + `<start_of_turn>model\n`
    }
    case 'mistral': {
      // Alternating [INST]…[/INST] pattern; system prepended to first user turn.
      let p = '<s>'
      let systemAdded = false
      for (const t of turns) {
        if (t.role === 'user') {
          const content = systemAdded ? t.content : `${systemMessage}\n\n${t.content}`
          systemAdded = true
          p += `[INST] ${content} [/INST]`
        } else {
          p += ` ${t.content}</s>`
        }
      }
      return p
    }
    default: { // chatml
      let p = `<|im_start|>system\n${systemMessage}\n<|im_end|>\n`
      for (const t of turns) {
        p += `<|im_start|>${t.role}\n${t.content}\n<|im_end|>\n`
      }
      return p + `<|im_start|>assistant\n`
    }
  }
}

const SYSTEM_ADVOCATE_CHAT = (doc: ScannedDocument) => {
  const analysis = doc.analysisResult
  const institution = doc.metadata.institution ?? 'the sender'
  const amount = doc.metadata.amount != null ? `$${doc.metadata.amount.toFixed(2)}` : null
  const findings = (analysis?.keyFindings ?? []).slice(0, 3).join('; ')

  return `You are a warm, compassionate personal advocate helping someone deal with a difficult situation involving a ${doc.type.replace(/_/g, ' ')}.

Document context you already know:
- From: ${institution}${amount ? ` — Amount: ${amount}` : ''}
- Summary: ${analysis?.summary ?? 'Document received and under review'}
${findings ? `- Key findings: ${findings}` : ''}
- Their legal rights: ${DOC_CONTEXT[doc.type]}

Your conversation style:
- Warm, human, and empathetic — never clinical or robotic
- Short responses: 2-4 sentences per turn, conversational not essay-like
- Always acknowledge the person's feelings before giving advice
- Ask one focused follow-up question per response to understand their situation better
- Explain rights in plain simple language ("You have the right to..." not "Pursuant to...")
- Give specific actionable next steps, not vague suggestions
- When the time is right, offer to help write a letter or prepare for a phone call
- Never make up legal specifics you don't know — say "it depends" and recommend seeking local legal aid for complex cases
- Output ONLY the advocate's conversational response — no JSON, no preamble, no labels`
}

export function buildChatOpenerPrompt(doc: ScannedDocument): string {
  const institution = doc.metadata.institution ?? 'the sender'
  const amount = doc.metadata.amount != null ? ` — $${doc.metadata.amount.toFixed(2)}` : ''
  const analysis = doc.analysisResult

  const userMsg = `Generate a warm opening message for someone who just submitted their ${doc.type.replace(/_/g, ' ')} from ${institution}${amount} for review.

What I know about their document:
- Summary: ${analysis?.summary ?? 'Document received'}
- Severity: ${analysis?.severity ?? 'MEDIUM'}
- Top finding: ${analysis?.keyFindings?.[0] ?? ''}
- Rights context: ${DOC_CONTEXT[doc.type]}

Write a single opening message (3-5 sentences) that:
1. Acknowledges you've reviewed their document and state the main issue in ONE plain sentence
2. Reassures them they have real options and are not alone
3. Ends with a warm open question asking them to tell you what happened or share their situation

Output only the message text — no quotes, no labels:`

  return formatMultiTurnPrompt(SYSTEM_ADVOCATE_CHAT(doc), [{ role: 'user', content: userMsg }])
}

export function buildChatPrompt(
  doc: ScannedDocument,
  history: ChatMessage[],
  userMessage: string
): string {
  // Keep last 10 messages to stay within context window
  const recent = history.slice(-10)

  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = recent.map(m => ({
    role: m.role === 'advocate' ? 'assistant' : 'user',
    content: m.content,
  }))

  turns.push({ role: 'user', content: userMessage })

  return formatMultiTurnPrompt(SYSTEM_ADVOCATE_CHAT(doc), turns)
}

export function buildReplyPrompt(
  doc: ScannedDocument,
  originalLetter: string,
  institutionReply: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const origExcerpt = originalLetter.length > 800 ? originalLetter.slice(0, 800) + '\n[...]' : originalLetter
  const replyExcerpt = institutionReply.length > 600 ? institutionReply.slice(0, 600) + '\n[...]' : institutionReply

  const userMessage = `Write a professional follow-up response letter.

TODAY'S DATE: ${today}
INSTITUTION: ${doc.metadata.institution ?? 'The Institution'}
DOCUMENT TYPE: ${doc.type.replace(/_/g, ' ')}

ORIGINAL LETTER SENT BY THE UNDERSIGNED:
${origExcerpt}

INSTITUTION'S REPLY:
${replyExcerpt}

REQUIREMENTS:
1. Start with today's date and sender block (use "The Undersigned" — no real name)
2. Reference the institution's reply and acknowledge its key points
3. Firmly maintain or update the position based on their response
4. Challenge any unacceptable points with specific reasoning
5. State clearly what action you require next
6. Request written response within 30 days
7. Close: "Respectfully, The Undersigned"

Write the complete follow-up letter now:`

  return formatPrompt(SYSTEM_LETTER_WRITER, userMessage)
}
