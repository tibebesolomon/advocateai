import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as FileSystem from 'expo-file-system/legacy'
import type { ScannedDocument, GeneratedLetter, Thread } from '../types'

const EXPORT_DIR = (FileSystem.documentDirectory ?? '') + 'exports/'
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 72
const BODY_SIZE = 10
const H1_SIZE = 14
const H2_SIZE = 12
const LINE_H = 15

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateCaseBundle(
  doc: ScannedDocument,
  letters: GeneratedLetter[],
  thread: Thread | null
): Promise<string> {
  await ensureDir()

  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const state: PageState = { pdf, regular, bold, page: null as any, y: 0, pageNum: 0 }
  newPage(state)

  // Cover block
  drawH1(state, 'ADVOCATEAI — CASE BUNDLE')
  drawLine(state)
  drawField(state, 'Document Type', doc.type.replace(/_/g, ' '))
  drawField(state, 'Received', new Date(doc.createdAt).toLocaleDateString())
  if (doc.metadata.institution) drawField(state, 'Institution', doc.metadata.institution)
  if (doc.metadata.amount != null) drawField(state, 'Amount', `$${doc.metadata.amount.toFixed(2)}`)
  if (doc.metadata.dueDate) drawField(state, 'Due Date', doc.metadata.dueDate)
  if (doc.metadata.referenceNumber) drawField(state, 'Reference #', doc.metadata.referenceNumber)
  spacer(state)

  // AI Analysis
  if (doc.analysisResult) {
    drawH2(state, 'AI ANALYSIS')
    drawLine(state)
    drawBodyText(state, doc.analysisResult.summary)
    spacer(state)

    if (doc.analysisResult.keyFindings.length > 0) {
      drawLabel(state, 'Key Findings:')
      for (const f of doc.analysisResult.keyFindings) {
        drawBodyText(state, `• ${f}`)
      }
      spacer(state)
    }

    if (doc.analysisResult.anomalies && doc.analysisResult.anomalies.length > 0) {
      drawLabel(state, 'Detected Anomalies:')
      for (const a of doc.analysisResult.anomalies) {
        drawBodyText(state, `• [${a.type}] ${a.description}`)
      }
      spacer(state)
    }

    if (doc.analysisResult.deadline) {
      drawField(state, 'Deadline', doc.analysisResult.deadline)
      spacer(state)
    }

    if (doc.analysisResult.rightsReminder) {
      drawLabel(state, 'Rights:')
      drawBodyText(state, doc.analysisResult.rightsReminder)
      spacer(state)
    }
  }

  // Original Document Text
  drawH2(state, 'ORIGINAL DOCUMENT TEXT')
  drawLine(state)
  drawBodyText(state, doc.rawText)
  spacer(state)

  // Table data if present
  if (doc.tableText) {
    drawH2(state, 'DOCUMENT LINE ITEMS (TABLE)')
    drawLine(state)
    drawBodyText(state, doc.tableText)
    spacer(state)
  }

  // Generated Documents
  for (const letter of letters) {
    drawH2(state, letter.type.replace(/_/g, ' '))
    drawLabel(state, new Date(letter.createdAt).toLocaleDateString())
    drawLine(state)
    drawBodyText(state, letter.content)
    spacer(state)
  }

  // Correspondence Thread
  if (thread && thread.messages.length > 0) {
    drawH2(state, 'CORRESPONDENCE THREAD')
    drawLine(state)
    for (const msg of thread.messages) {
      const from = msg.sender === 'user' ? 'You' : (doc.metadata.institution ?? 'Institution')
      const date = new Date(msg.createdAt).toLocaleDateString()
      drawLabel(state, `${from} — ${date}${msg.isAiGenerated ? ' (AI-drafted)' : ''}`)
      drawBodyText(state, msg.content)
      spacer(state)
    }
  }

  // Footer on all pages
  drawFooter(state)

  const bytes = await pdf.save()
  const path = EXPORT_DIR + `case-${doc.id}-${Date.now()}.pdf`
  await FileSystem.writeAsStringAsync(path, uint8ToB64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  })
  return path
}

// ─── Internal page state ─────────────────────────────────────────────────────

interface PageState {
  pdf: PDFDocument
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>
  page: ReturnType<PDFDocument['addPage']>
  y: number
  pageNum: number
}

function newPage(s: PageState) {
  s.page = s.pdf.addPage([PAGE_W, PAGE_H])
  s.pageNum++
  s.y = PAGE_H - MARGIN

  // Header bar
  s.page.drawRectangle({ x: 0, y: PAGE_H - 28, width: PAGE_W, height: 28, color: rgb(0.05, 0.05, 0.05) })
  s.page.drawText('AdvocateAI Case Bundle — Confidential — Do Not Distribute', {
    x: MARGIN, y: PAGE_H - 18, size: 7, font: s.regular, color: rgb(0.55, 0.55, 0.55),
  })

  s.y = PAGE_H - MARGIN - 12
}

function checkOverflow(s: PageState, needed = LINE_H * 2) {
  if (s.y < MARGIN + needed) {
    s.page.drawText(`Page ${s.pageNum}`, {
      x: PAGE_W / 2 - 18, y: MARGIN / 2, size: 8, font: s.regular, color: rgb(0.5, 0.5, 0.5),
    })
    newPage(s)
  }
}

function drawH1(s: PageState, text: string) {
  checkOverflow(s, H1_SIZE * 2)
  s.page.drawText(text, { x: MARGIN, y: s.y, size: H1_SIZE, font: s.bold, color: rgb(0.08, 0.08, 0.08) })
  s.y -= H1_SIZE + 6
}

function drawH2(s: PageState, text: string) {
  checkOverflow(s, H2_SIZE * 3)
  s.y -= 4
  s.page.drawText(text, { x: MARGIN, y: s.y, size: H2_SIZE, font: s.bold, color: rgb(0.08, 0.08, 0.08) })
  s.y -= H2_SIZE + 4
}

function drawLabel(s: PageState, text: string) {
  checkOverflow(s)
  s.page.drawText(text, { x: MARGIN, y: s.y, size: BODY_SIZE, font: s.bold, color: rgb(0.2, 0.2, 0.2) })
  s.y -= LINE_H
}

function drawField(s: PageState, label: string, value: string) {
  checkOverflow(s)
  const labelW = s.bold.widthOfTextAtSize(`${label}: `, BODY_SIZE)
  s.page.drawText(`${label}: `, { x: MARGIN, y: s.y, size: BODY_SIZE, font: s.bold, color: rgb(0.2, 0.2, 0.2) })
  s.page.drawText(value, { x: MARGIN + labelW, y: s.y, size: BODY_SIZE, font: s.regular, color: rgb(0.1, 0.1, 0.1) })
  s.y -= LINE_H
}

function drawLine(s: PageState) {
  s.page.drawLine({
    start: { x: MARGIN, y: s.y }, end: { x: PAGE_W - MARGIN, y: s.y },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  })
  s.y -= 8
}

function drawBodyText(s: PageState, text: string) {
  const maxW = PAGE_W - MARGIN * 2
  const paragraphs = text.split(/\n{2,}/)
  for (const para of paragraphs) {
    const lines = wrapText(para.replace(/\n/g, ' '), s.regular, BODY_SIZE, maxW)
    for (const line of lines) {
      checkOverflow(s)
      s.page.drawText(line, { x: MARGIN, y: s.y, size: BODY_SIZE, font: s.regular, color: rgb(0.1, 0.1, 0.1) })
      s.y -= LINE_H
    }
    s.y -= 4
  }
}

function spacer(s: PageState) { s.y -= 10 }

function drawFooter(s: PageState) {
  s.page.drawText(`Page ${s.pageNum}`, {
    x: PAGE_W / 2 - 18, y: MARGIN / 2, size: 8, font: s.regular, color: rgb(0.5, 0.5, 0.5),
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wrapText(
  text: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(EXPORT_DIR)
  if (!info.exists) await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true })
}

function uint8ToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
