import type { DocumentType, DocumentMetadata } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  type: DocumentType
  confidence: number // 0–1
  metadata: DocumentMetadata
}

// ─── Keyword Patterns ─────────────────────────────────────────────────────────

// Ordered from most-specific to least-specific to prevent shadowing.
const PATTERNS: Array<{ type: DocumentType; triggers: RegExp[] }> = [
  {
    type: 'EVICTION_NOTICE',
    triggers: [
      /eviction\s+notice/i, /unlawful\s+detainer/i, /pay\s+or\s+quit/i,
      /notice\s+to\s+quit/i, /vacate\s+the\s+premises/i,
      /\b3[\s-]day\s+notice/i, /\b30[\s-]day\s+notice/i,
    ],
  },
  {
    type: 'INSURANCE_DENIAL',
    triggers: [
      /claim\s+(?:has\s+been\s+)?denied/i, /not\s+medically\s+necessary/i,
      /prior\s+authorization/i, /out[\s-]of[\s-]network/i,
      /appeal\s+your\s+(?:claim|denial)/i, /explanation\s+of\s+benefits/i,
      /\bEOB\b/,
    ],
  },
  {
    type: 'MEDICAL_BILL',
    triggers: [
      /patient\s+account/i, /total\s+amount\s+due/i, /insurance\s+adjustment/i,
      /(?:CPT|ICD)[\s-]?\d/i, /hospital\s+bill/i, /diagnosis\s+code/i,
      /co[\s-]?pay/i, /medical\s+center|health\s+system|hospital/i,
    ],
  },
  {
    type: 'WELFARE_FORM',
    triggers: [
      /\bSNAP\b/, /\bTANF\b/, /\bMedicaid\b/i, /food\s+stamp/i,
      /supplemental\s+nutrition/i, /cash\s+assistance/i,
      /department\s+of\s+human\s+services/i, /eligibility\s+determination/i,
      /public\s+benefits/i,
    ],
  },
  {
    type: 'HOUSING_NOTICE',
    triggers: [
      /lease\s+violation/i, /rent\s+increase/i, /landlord/i,
      /rental\s+agreement/i, /security\s+deposit/i, /notice\s+to\s+pay/i,
      /housing\s+authority/i,
    ],
  },
  {
    type: 'LEGAL_NOTICE',
    triggers: [
      /\bsummons\b/i, /\bsubpoena\b/i, /court\s+order/i,
      /failure\s+to\s+appear/i, /\bjudgment\b/i, /\bplaintiff\b/i,
      /\bdefendant\b/i, /you\s+are\s+hereby\s+(?:ordered|required)/i,
    ],
  },
  {
    type: 'UTILITY_BILL',
    triggers: [
      /meter\s+reading/i, /kilowatt[\s-]?hour/i, /gas\s+usage/i,
      /water\s+usage/i, /utility\s+services/i, /\bPGE\b|\bConEdison\b|\bComEd\b/i,
      /service\s+address/i,
    ],
  },
]

// ─── Public Classifier ────────────────────────────────────────────────────────

export function classifyDocument(text: string): ClassificationResult {
  let bestType: DocumentType = 'GENERAL'
  let bestScore = 0

  for (const { type, triggers } of PATTERNS) {
    const hits = triggers.filter((p) => p.test(text)).length
    if (hits === 0) continue
    const score = hits / triggers.length
    if (score > bestScore) {
      bestScore = score
      bestType = type
    }
  }

  return {
    type: bestType,
    confidence: bestScore,
    metadata: extractMetadata(text, bestType),
  }
}

// ─── Metadata Extraction ──────────────────────────────────────────────────────

function extractMetadata(text: string, type: DocumentType): DocumentMetadata {
  return {
    amount: extractAmount(text),
    dueDate: extractDueDate(text),
    referenceNumber: extractReference(text),
    institution: extractInstitution(text),
    dates: extractAllDates(text),
    keyPhrases: extractUrgentPhrases(text),
  }
}

function extractAmount(text: string): number | undefined {
  const candidates = [
    /total\s+(?:amount\s+)?due[:\s]+\$?([\d,]+\.?\d*)/i,
    /amount\s+owed[:\s]+\$?([\d,]+\.?\d*)/i,
    /balance\s+(?:due|forward)[:\s]+\$?([\d,]+\.?\d*)/i,
    /you\s+owe[:\s]+\$?([\d,]+\.?\d*)/i,
    // generic last resort: find the largest dollar amount in the doc
    /\$\s*([\d,]+\.\d{2})/g,
  ]

  for (const pattern of candidates.slice(0, -1)) {
    const m = text.match(pattern)
    if (m?.[1]) return parseFloat(m[1].replace(/,/g, ''))
  }

  // Fallback: largest dollar amount
  const allAmounts = [...text.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => n < 1_000_000) // sanity cap

  return allAmounts.length ? Math.max(...allAmounts) : undefined
}

function extractDueDate(text: string): string | undefined {
  const m = text.match(
    /(?:due|pay\s+by|respond\s+by|deadline)[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/i
  )
  return m?.[1]
}

function extractAllDates(text: string): string[] {
  const pattern =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b/g
  return [...new Set(text.match(pattern) ?? [])]
}

function extractReference(text: string): string | undefined {
  const candidates = [
    /(?:invoice|account|reference|claim|case|ticket|bill)\s+(?:number|#|no\.?)[:\s]+([A-Z0-9\-]{4,})/i,
    /(?:acct|ref|claim|inv)\s*[#:]\s*([A-Z0-9\-]{4,})/i,
    /#\s*([A-Z]{1,4}[\-]?\d{4,})/,
  ]
  for (const p of candidates) {
    const m = text.match(p)
    if (m?.[1]) return m[1].trim()
  }
}

function extractInstitution(text: string): string | undefined {
  // Look in the first 10 lines for a likely sender name
  const lines = text.split('\n').slice(0, 10)
  return lines.find((line) => {
    const l = line.trim()
    return (
      l.length >= 5 &&
      l.length <= 80 &&
      /[A-Z]/.test(l) &&
      !/^\d/.test(l) &&
      !/^dear\b/i.test(l) &&
      !/^to\s+whom/i.test(l)
    )
  })?.trim()
}

function extractUrgentPhrases(text: string): string[] {
  const patterns = [
    /respond\s+(?:in\s+writing\s+)?(?:within|by)\s+[\w\s,]+/i,
    /you\s+have\s+\d+\s+(?:days?|hours?)/i,
    /final\s+notice/i,
    /immediate\s+(?:action|attention)\s+required/i,
    /do\s+not\s+ignore\s+this/i,
    /failure\s+to\s+(?:respond|act|pay)/i,
  ]
  return patterns.map((p) => text.match(p)?.[0]).filter(Boolean) as string[]
}
