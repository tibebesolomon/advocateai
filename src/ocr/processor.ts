import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system/legacy'
// ML Kit Text Recognition v2 — fully on-device, no network
import TextRecognition from '@react-native-ml-kit/text-recognition'
import { extractTables } from './tables'
import type { OCRResult, OCRBlock, ExtractedTable } from '../types'

// ─── Lazy Skia import (native — falls back gracefully if unavailable) ──────────

let _skia: typeof import('@shopify/react-native-skia') | null | undefined = undefined

async function getSkia() {
  if (_skia !== undefined) return _skia
  try {
    _skia = await import('@shopify/react-native-skia')
  } catch {
    _skia = null
  }
  return _skia
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function processImageURI(
  imageUri: string,
  _options: { maxWidth?: number } = {}
): Promise<OCRResult> {
  const candidates: Array<{ result: OCRResult; score: number }> = []

  const addCandidate = async (uri: string) => {
    try {
      const r = await runMLKitOCR(uri)
      candidates.push({ result: r, score: scoreResult(r) })
    } catch { /* fall through */ }
  }

  // ── Pass 1: Raw PNG at 1800px — ML Kit's sweet spot for printed text ─────────
  try {
    const raw = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1800 } }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG }
    )
    await addCandidate(raw.uri)
    // Early exit only for clearly excellent scans — otherwise run all passes for accuracy
    if (candidates.length > 0) {
      const best = candidates[0]
      const wc = best.result.text.split(/\s+/).filter(Boolean).length
      if (best.score > 150 && wc >= 250) return best.result
    }
  } catch { /* fall through */ }

  // ── Pass 2: Skia grayscale + contrast (best for low-light / colored docs) ────
  const skiaUri = await preprocessWithSkia(imageUri, 2000)
  if (skiaUri) await addCandidate(skiaUri)

  // ── Pass 3: Higher-res Skia (dense text, fine print) ─────────────────────────
  if (skiaUri) {
    const skiaUri2 = await preprocessWithSkia(imageUri, 3200)
    if (skiaUri2) await addCandidate(skiaUri2)
  }

  // ── Pass 4: JPEG at 45% — DCT binarization (shadows / uneven lighting) ───────
  // Low-quality JPEG's DCT quantization pushes near-white → white, ink → black.
  try {
    const jpeg = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 2000 } }],
      { compress: 0.45, format: ImageManipulator.SaveFormat.JPEG }
    )
    await addCandidate(jpeg.uri)
  } catch { /* fall through */ }

  // ── Pass 5: JPEG at 28% — aggressive binarization for very low contrast ──────
  try {
    const jpeg2 = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1600 } }],
      { compress: 0.28, format: ImageManipulator.SaveFormat.JPEG }
    )
    await addCandidate(jpeg2.uri)
  } catch { /* fall through */ }

  // ── Pass 6: Ultra-high res for fine print (receipts, small-font documents) ───
  try {
    const hiRes = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 3600 } }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG }
    )
    await addCandidate(hiRes.uri)
  } catch { /* fall through */ }

  if (candidates.length === 0) {
    throw Object.assign(new Error('OCR_UNAVAILABLE'), { code: 'OCR_UNAVAILABLE' })
  }

  // Pick the candidate with the highest unique-word coverage, not just word count
  return pickBestCandidate(candidates)
}

function pickBestCandidate(
  candidates: Array<{ result: OCRResult; score: number }>
): OCRResult {
  // Primary: highest score
  const byScore = candidates.reduce((best, cur) => cur.score > best.score ? cur : best)

  // If the top two are within 15% of each other, prefer the one with more unique words
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  if (sorted.length >= 2 && sorted[0].score * 0.85 < sorted[1].score) {
    const uniqueWords = (r: OCRResult) =>
      new Set(r.text.toLowerCase().match(/[a-z]{3,}/g) ?? []).size
    const top2 = sorted.slice(0, 2)
    return top2.reduce((a, b) => uniqueWords(b.result) > uniqueWords(a.result) ? b : a).result
  }

  return byScore.result
}

// ─── Skia Preprocessing ───────────────────────────────────────────────────────
// Converts image to grayscale + boosts contrast using Skia's ColorMatrix filter.
// Result is a high-contrast near-binary image — ideal for ML Kit text recognition.

async function preprocessWithSkia(uri: string, targetWidth: number): Promise<string | null> {
  try {
    const Sk = await getSkia()
    if (!Sk) return null

    // Step 1: Resize with expo-image-manipulator (fast native resize)
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: targetWidth } }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG }
    )

    // Step 2: Load into Skia
    const skData = await Sk.Skia.Data.fromURI(resized.uri)
    const srcImage = Sk.Skia.Image.MakeImageFromEncoded(skData)
    if (!srcImage) return null

    const w = srcImage.width()
    const h = srcImage.height()

    const surface = Sk.Skia.Surface.Make(w, h)
    if (!surface) return null

    const canvas = surface.getCanvas()

    // ColorMatrix: grayscale (luminance weights) + contrast boost
    // Applied in normalized [0,1] color space.
    // Formula per channel: out = c * (0.299R + 0.587G + 0.114B) + bias
    // c=1.9 pushes dark ink toward 0 and bright paper toward 1.
    // bias=-0.45 sets the threshold: any luma below 0.237 → black, above 0.76 → white.
    const c = 1.9
    const bias = -0.45
    const m: number[] = [
      c * 0.299, c * 0.587, c * 0.114, 0, bias,
      c * 0.299, c * 0.587, c * 0.114, 0, bias,
      c * 0.299, c * 0.587, c * 0.114, 0, bias,
      0,         0,         0,         1, 0,
    ]

    const colorFilter = Sk.Skia.ColorFilter.MakeMatrix(m)
    const paint = Sk.Skia.Paint()
    paint.setColorFilter(colorFilter)
    canvas.drawImage(srcImage, 0, 0, paint)

    // Step 3: Encode result and save to temp file
    const snapshot = surface.makeImageSnapshot()
    const b64 = snapshot.encodeToBase64()   // built-in base64 PNG encoding

    const destPath = (FileSystem.cacheDirectory ?? '') + `ocr_skia_${Date.now()}_${targetWidth}.png`
    await FileSystem.writeAsStringAsync(destPath, b64, {
      encoding: FileSystem.EncodingType.Base64,
    })

    return destPath
  } catch {
    return null
  }
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
  const tableBlockIndices = getTableBlockIndices(tables, sortedBlocks)
  const nonTableBlocks = sortedBlocks.filter((_, i) => !tableBlockIndices.has(i))

  const paragraphText = normalizeText(nonTableBlocks.map(b => b.text).join('\n\n'))
  const tableTexts = tables.map(t => renderTableAsText(t))
  const text = [paragraphText, ...tableTexts].filter(Boolean).join('\n\n')

  const confidence = estimateConfidence(sortedBlocks, text)
  const { quality, issues } = assessQuality(text, sortedBlocks)

  return { text, confidence, blocks: sortedBlocks, tables, quality, issues }
}

// Composite score: word count × confidence, penalised for junk chars
function scoreResult(r: OCRResult): number {
  const words = r.text.split(/\s+/).filter(w => w.length >= 2)  // min 2-char words (filters noise)
  const junk = (r.text.match(/[^\w\s$.,\-:/()'"%#@!?;[\]{}\\^~`=+<>|]/g) ?? []).length
  const junkRatio = junk / Math.max(r.text.length, 1)
  return words.length * r.confidence * (1 - junkRatio * 5)
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

  for (const band of bands) band.sort((a, b) => a.bounds.x - b.bounds.x)

  return bands.flat()
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

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

  if (words.length < 15) {
    issues.push('Very little text detected — try better lighting or hold camera steadier')
  } else if (words.length < 50) {
    issues.push('Short document — check nothing is cut off')
  }

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
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\f/g, '\n')

    // ── OCR character substitution errors ─────────────────────────────────────
    // Only apply near digits/currency to avoid corrupting real words
    .replace(/l(?=\d{3,})/g, '1')           // l123456 → 1123456
    .replace(/\bI(?=\d{5,})/g, '1')         // I90210 (zip/ID) → 190210
    .replace(/(?<=\$\s{0,2})O/g, '0')        // $O → $0
    .replace(/(?<=\d)O(?=\d)/g, '0')         // 3O5 → 305 (between digits)
    .replace(/\bO(?=\d{4,})/g, '0')          // O1234 → 01234 (account numbers)
    .replace(/(?<=\d)l(?=\d)/g, '1')         // 3l5 → 315 (l between digits)
    .replace(/\brn\b/g, 'm')                 // "rn" standalone → "m" (common OCR split)

    // ── Currency / number formatting ──────────────────────────────────────────
    .replace(/\$\s+(\d)/g, '$$$1')           // $ 50 → $50
    .replace(/(\d{1,3}),\s+(\d{3})(?!\d)/g, '$1,$2')   // 1, 234 → 1,234
    .replace(/(\d)\s+\.\s+(\d{2})\b/g, '$1.$2')         // 5 . 00 → 5.00

    // ── Leader dots (table of contents style) ─────────────────────────────────
    .replace(/(\.\s*){5,}/g, ' ')

    // ── Medical / legal code formatting ───────────────────────────────────────
    .replace(/\b(CPT|ICD)\s*-?\s*(\d)\s+(\d{3,})/gi, '$1 $2$3')

    // ── Date normalization ─────────────────────────────────────────────────────
    .replace(/(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{2,4})/g, '$1/$2/$3')

    // ── Common word-level OCR fixes for medical/legal documents ──────────────
    .replace(/\bPat1ent\b/gi, 'Patient')
    .replace(/\bAm0unt\b/gi, 'Amount')
    .replace(/\bTota1\b/gi, 'Total')
    .replace(/\bBa1ance\b/gi, 'Balance')
    .replace(/\bDue\s+D4te\b/gi, 'Due Date')
    .replace(/\bSe1f[- ]Pay\b/gi, 'Self-Pay')
    .replace(/\bInsu1ance\b/gi, 'Insurance')
    .replace(/\bD1agnosis\b/gi, 'Diagnosis')
    .replace(/\bPh0ne\b/gi, 'Phone')

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
  const junkRatio = (text.match(/[^\w\s$.,\-:/()'"%#@!?;]/g) ?? []).length / text.length

  let conf = Math.min(0.90, 0.35 + words.length * 0.01)
  if (avgWordLen < 2 || avgWordLen > 15) conf *= 0.75
  if (hasNumbers) conf = Math.min(conf + 0.05, 0.95)
  if (hasUpperCase) conf = Math.min(conf + 0.03, 0.95)
  if (junkRatio > 0.05) conf *= (1 - junkRatio * 3)

  return Math.max(0, Math.min(conf, 0.95))
}
