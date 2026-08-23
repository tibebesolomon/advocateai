import * as ImageManipulator from 'expo-image-manipulator'
import TextRecognition from '@react-native-ml-kit/text-recognition'
import { extractTables } from './tables'
import type { OCRResult, OCRBlock, ExtractedTable } from '../types'

interface ProcessOptions {
  maxWidth?: number
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function processImageURI(
  imageUri: string,
  options: ProcessOptions = {}
): Promise<OCRResult> {
  const maxWidth = options.maxWidth ?? 3000   // up from 2000 — modern phones capture 4000+px

  // Pass 1: standard preprocessing at high resolution
  const uri1 = await preprocessForOCR(imageUri, maxWidth)
  const result1 = await runMLKitOCR(uri1)
  const score1 = scoreResult(result1)

  // Only exit early if Pass 1 is clearly excellent (lots of clean text)
  const wordCount1 = result1.text.split(/\s+/).filter(Boolean).length
  if (result1.confidence >= 0.82 && wordCount1 >= 60) {
    return result1
  }

  // Pass 2: crop to detected text bounds + higher resolution
  // Triggers whenever we have at least 2 blocks (not the old > 4 requirement)
  let best = result1
  let bestScore = score1

  if (result1.blocks.length >= 2) {
    try {
      const cropped = await cropToTextBounds(imageUri, result1.blocks)
      // Use 3500px on the cropped region — more pixels on the actual text
      const uri2 = await preprocessForOCR(cropped, 3500)
      const result2 = await runMLKitOCR(uri2)
      const score2 = scoreResult(result2)
      if (score2 > bestScore) {
        best = result2
        bestScore = score2
      }
    } catch {
      // fall through
    }
  }

  // Pass 3: full image at higher resolution for small or dense text
  try {
    const uri3 = await preprocessForOCR(imageUri, 4000)
    const result3 = await runMLKitOCR(uri3)
    const score3 = scoreResult(result3)
    if (score3 > bestScore) {
      best = result3
      bestScore = score3
    }
  } catch {
    // fall through
  }

  // Pass 4: JPEG contrast pass — only if still not great.
  // JPEG DCT quantization pushes near-white → white and near-black → black,
  // which improves contrast on ink-on-paper photos without extra libraries.
  if (bestScore < scoreResult(result1) * 2) {
    try {
      const uri4 = await preprocessForOCRJpeg(imageUri, 3000)
      const result4 = await runMLKitOCR(uri4)
      const score4 = scoreResult(result4)
      if (score4 > bestScore) best = result4
    } catch {
      // fall through
    }
  }

  return best
}

// Composite score: word count weighted by confidence, penalised for junk chars
function scoreResult(r: OCRResult): number {
  const words = r.text.split(/\s+/).filter(Boolean).length
  const junk = (r.text.match(/[^\w\s$.,\-:/()'"%#@!?;[\]{}\\^~`=+<>|]/g) ?? []).length
  const junkRatio = junk / Math.max(r.text.length, 1)
  return words * r.confidence * (1 - junkRatio * 5)
}

// ─── Image Preprocessing ──────────────────────────────────────────────────────

async function preprocessForOCR(uri: string, maxWidth: number): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  )
  return result.uri
}

// JPEG at 82% quality — DCT quantization increases contrast for ink-on-paper text
// by clamping near-white background pixels to white and near-black ink to black.
async function preprocessForOCRJpeg(uri: string, maxWidth: number): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
  )
  return result.uri
}

// Crop the source image to the bounding rectangle of all detected text blocks
// plus 5% padding on each side.
async function cropToTextBounds(uri: string, blocks: OCRBlock[]): Promise<string> {
  const xs = blocks.flatMap(b => [b.bounds.x, b.bounds.x + b.bounds.width])
  const ys = blocks.flatMap(b => [b.bounds.y, b.bounds.y + b.bounds.height])

  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  const width = maxX - minX
  const height = maxY - minY

  if (width < 50 || height < 50) return uri

  const pad = 0.05
  const cropX = Math.max(0, minX - width * pad)
  const cropY = Math.max(0, minY - height * pad)
  const cropW = width * (1 + pad * 2)
  const cropH = height * (1 + pad * 2)

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  )
  return result.uri
}

// ─── ML Kit OCR ───────────────────────────────────────────────────────────────

async function runMLKitOCR(uri: string): Promise<OCRResult> {
  let mlResult: Awaited<ReturnType<typeof TextRecognition.recognize>>
  try {
    mlResult = await TextRecognition.recognize(uri)
  } catch {
    throw Object.assign(new Error('OCR_UNAVAILABLE'), { code: 'OCR_UNAVAILABLE' })
  }

  const rawBlocks: OCRBlock[] = (mlResult.blocks ?? []).map((block) => ({
    text: block.text ?? '',
    bounds: {
      x: block.frame?.left ?? 0,
      y: block.frame?.top ?? 0,
      width: block.frame?.width ?? 0,
      height: block.frame?.height ?? 0,
    },
  }))

  const sortedBlocks = sortBlocksByReadingOrder(rawBlocks)
  const tables: ExtractedTable[] = extractTables(sortedBlocks)

  // Apply OCR correction only to prose blocks; table text stays pipe-delimited as-is
  const tableBlockIndices = getTableBlockIndices(tables, sortedBlocks)
  const nonTableBlocks = sortedBlocks.filter((_, i) => !tableBlockIndices.has(i))

  const paragraphText = normalizeText(nonTableBlocks.map(b => b.text).join('\n\n'))
  const tableTexts = tables.map(t => renderTableAsText(t))
  const text = [paragraphText, ...tableTexts].filter(Boolean).join('\n\n')

  const confidence = estimateConfidence(sortedBlocks, text)
  const { quality, issues } = assessQuality(text, sortedBlocks)

  return { text, confidence, blocks: sortedBlocks, tables, quality, issues }
}

// ─── Reading Order ────────────────────────────────────────────────────────────

function sortBlocksByReadingOrder(blocks: OCRBlock[]): OCRBlock[] {
  if (blocks.length < 2) return blocks

  const sorted = [...blocks].sort((a, b) => a.bounds.y - b.bounds.y)
  const bands: OCRBlock[][] = []

  for (const block of sorted) {
    const centerY = block.bounds.y + block.bounds.height / 2
    const lastBand = bands[bands.length - 1]

    if (!lastBand) { bands.push([block]); continue }

    const anchor = lastBand[0]
    const anchorCenterY = anchor.bounds.y + anchor.bounds.height / 2
    const threshold = Math.max(anchor.bounds.height, block.bounds.height) * 0.7

    if (Math.abs(centerY - anchorCenterY) < threshold) {
      lastBand.push(block)
    } else {
      bands.push([block])
    }
  }

  for (const band of bands) {
    band.sort((a, b) => a.bounds.x - b.bounds.x)
  }

  return bands.flat()
}

// ─── Table Rendering ─────────────────────────────────────────────────────────

function renderTableAsText(table: import('../types').ExtractedTable): string {
  return table.rows.map(row => {
    const cells = Array<string>(table.columnCount).fill('')
    for (const cell of row.cells) {
      if (cell.colIndex < cells.length) cells[cell.colIndex] = cell.text
    }
    return cells.join(' | ')
  }).join('\n')
}

function getTableBlockIndices(
  tables: import('../types').ExtractedTable[],
  blocks: OCRBlock[]
): Set<number> {
  const indices = new Set<number>()
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const idx = blocks.findIndex(
          b => b.bounds.x === cell.bounds.x && b.bounds.y === cell.bounds.y
        )
        if (idx >= 0) indices.add(idx)
      }
    }
  }
  return indices
}

// ─── Quality Assessment ───────────────────────────────────────────────────────

function assessQuality(
  text: string,
  blocks: OCRBlock[]
): { quality: 'good' | 'fair' | 'poor'; issues: string[] } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const issues: string[] = []

  // Raised thresholds — short notices/bills with 15-49 words are valid documents
  if (words.length < 15) {
    issues.push('Very little text detected — try better lighting or hold camera steadier')
  } else if (words.length < 50) {
    issues.push('Short document — check nothing is cut off')
  }

  // Raised to 12% — legal/medical docs routinely contain §, —, ©, °, and other
  // Unicode that are valid but outside the ASCII allowed-set above
  const junkChars = (text.match(/[^\w\s$.,\-:/()'"%#@!?;[\]{}\\^~`=+<>|]/g) ?? []).length
  if (junkChars / Math.max(text.length, 1) > 0.12) {
    issues.push('Many unrecognized characters — document may be blurry or photographed at an angle')
  }

  const quality: 'good' | 'fair' | 'poor' =
    issues.length === 0 ? 'good' : issues.length === 1 ? 'fair' : 'poor'

  return { quality, issues }
}

// ─── Text Normalization ───────────────────────────────────────────────────────

function normalizeText(raw: string): string {
  return raw
    // Whitespace cleanup
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\f/g, '\n')

    // Common OCR substitution errors near digits
    // (intentionally NOT applied to `|` since that corrupts table pipe separators)
    .replace(/l(?=\d{3,})/g, '1')          // l1234 → 11234
    .replace(/\bI(?=\d{5,})/g, '1')        // I12345 → 112345 (ZIP, account numbers)
    .replace(/(?<=\$\s{0,2})O/g, '0')       // $O.50 → $0.50
    .replace(/(?<=\d)O(?=\d)/g, '0')        // 1O5 → 105

    // Currency / number formatting fixes
    .replace(/\$\s+(\d)/g, '$$$1')                    // $ 25 → $25
    // Fix comma→period OCR error in dollar amounts: $2.150.00 or $2. 150.00 → $2,150.00
    // Matches $A.BBB.CC where BBB is exactly 3 digits (the misread thousands separator)
    .replace(/\$(\d{1,3})\.\s*(\d{3})\.(\d{2})\b/g, '$$$1,$2.$3')
    // Collapse space-separated thousand: "1, 000" → "1,000"
    // (?!\d) prevents matching "2, 2026" (date) since "202" is followed by digit "6"
    .replace(/(\d{1,3}),\s+(\d{3})(?!\d)/g, '$1,$2')
    .replace(/(\d)\s+\.\s+(\d{2})\b/g, '$1.$2')       // 25 . 00 → 25.00

    // Leader dots — both consecutive ("......") and spaced (". . . . .")
    // (\.\s*){4,} matches any dot optionally followed by whitespace, repeated 4+ times
    .replace(/(\.\s*){4,}/g, ' ')

    // Medical code formatting: "CPT 9 9213" → "CPT 99213"
    .replace(/\b(CPT|ICD)\s*(\d)\s+(\d{3,})/gi, '$1 $2$3')

    // Date normalization: "01 / 15 / 2024" → "01/15/2024"
    .replace(/(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{2,4})/g, '$1/$2/$3')

    .trim()
}

// ─── Confidence Estimation ────────────────────────────────────────────────────

function estimateConfidence(blocks: OCRBlock[], text: string): number {
  if (!text || blocks.length === 0) return 0
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 5) return 0.15

  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length
  const hasNumbers = /\d/.test(text)
  const hasUpperCase = /[A-Z]{2,}/.test(text)
  // Penalise high junk-char ratio
  const junkRatio = (text.match(/[^\w\s$.,\-:/()'"%#@!?;]/g) ?? []).length / text.length

  let conf = Math.min(0.90, 0.35 + words.length * 0.01)
  if (avgWordLen < 2 || avgWordLen > 15) conf *= 0.75
  if (hasNumbers) conf = Math.min(conf + 0.05, 0.95)
  if (hasUpperCase) conf = Math.min(conf + 0.03, 0.95)
  if (junkRatio > 0.05) conf *= (1 - junkRatio * 3)

  return Math.max(0, Math.min(conf, 0.95))
}
