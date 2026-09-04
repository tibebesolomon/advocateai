import * as FileSystem from 'expo-file-system/legacy'

/**
 * Extracts selectable text from a digital PDF.
 * Works for typed/exported PDFs (bills, letters, notices).
 * Returns null for scanned-image PDFs (no embedded text).
 *
 * Algorithm: parse raw PDF content streams for BT…ET blocks,
 * decode literal strings from Tj/TJ operators — no extra packages needed.
 */
export async function extractPDFText(pdfUri: string): Promise<string | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(pdfUri, {
      encoding: FileSystem.EncodingType.Base64,
    })

    // atob → binary string of the PDF bytes
    const binary = atob(b64)

    if (!binary.startsWith('%PDF')) return null   // not a valid PDF

    const paragraphs: string[] = []
    let prevY: number | null = null

    // Each BT…ET block is one text frame on the page
    const blockRe = /BT([\s\S]{1,20000}?)ET/g
    let bm: RegExpExecArray | null

    while ((bm = blockRe.exec(binary)) !== null) {
      const block = bm[1]
      const tokens: string[] = []

      // ── Literal strings: (Hello World) Tj  or  (text) '  or  (text) " ─────
      const tjRe = /\(((?:[^\\()]|\\[\s\S])*)\)\s*(?:Tj|'|")/g
      let m: RegExpExecArray | null
      while ((m = tjRe.exec(block)) !== null) {
        const decoded = decodeLiteral(m[1])
        if (decoded.trim()) tokens.push(decoded)
      }

      // ── Array format: [(Hello) -80 (World)] TJ ──────────────────────────────
      const tjArrRe = /\[((?:[^[\]]|\\.)*)\]\s*TJ/g
      while ((m = tjArrRe.exec(block)) !== null) {
        const inner = m[1]
        const parts = inner.match(/\(((?:[^\\()]|\\[\s\S])*)\)/g) ?? []
        const joined = parts.map(p => decodeLiteral(p.slice(1, -1))).join('')
        if (joined.trim()) tokens.push(joined)
      }

      // ── Hex strings: <48656c6c6f> Tj ────────────────────────────────────────
      const hexRe = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g
      while ((m = hexRe.exec(block)) !== null) {
        const hex = m[1].replace(/\s/g, '')
        let str = ''
        for (let i = 0; i < hex.length; i += 2) {
          str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
        }
        if (str.trim()) tokens.push(str)
      }

      // Detect explicit line breaks from text-positioning operators
      const hasNewline = /Td|TD|T\*|Tm/.test(block)

      if (tokens.length > 0) {
        const line = tokens.join(' ').replace(/\s{2,}/g, ' ').trim()
        if (line) paragraphs.push(line)
        if (hasNewline && paragraphs.length > 0) {
          paragraphs.push('')  // blank line between paragraphs
        }
      }

      // Safety: stop after extracting enough text (avoid huge PDFs locking the thread)
      if (paragraphs.join(' ').length > 40_000) break
    }

    // Collapse excess blank lines
    const text = paragraphs
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return text.length > 30 ? text : null
  } catch {
    return null
  }
}

// Decode PDF literal string escape sequences
function decodeLiteral(raw: string): string {
  return raw
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\./g, '')     // drop remaining escape sequences
}
