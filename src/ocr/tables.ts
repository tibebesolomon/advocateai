import type { OCRBlock, ExtractedTable, TableRow, TableCell } from '../types'

// Blocks whose Y-centers fall within this many pixels belong to the same row.
// Calibrated for US Letter at 2000px width ≈ 12pt font → ~16px line height.
const ROW_Y_TOLERANCE = 14

// X-gap larger than this separates adjacent columns.
const COL_X_GAP = 38

// ─── Public API ──────────────────────────────────────────────────────────────

export function extractTables(blocks: OCRBlock[]): ExtractedTable[] {
  if (blocks.length < 6) return []

  const rows = groupBlocksIntoRows(blocks)
  // Require at least 3 rows where most have 2+ cells (not just paragraph text)
  const multiColRows = rows.filter(r => r.length >= 2)
  if (multiColRows.length < 3) return []

  const columns = detectColumnCenters(multiColRows)
  if (columns.length < 2) return []

  const structuredRows: TableRow[] = multiColRows.map((rowBlocks, rowIndex) => {
    const cells: TableCell[] = rowBlocks.map(block => ({
      text: block.text,
      colIndex: nearestColumn(block.bounds.x + block.bounds.width / 2, columns),
      bounds: block.bounds,
    }))
    cells.sort((a, b) => a.colIndex - b.colIndex)

    const minY = Math.min(...rowBlocks.map(b => b.bounds.y))
    const maxY = Math.max(...rowBlocks.map(b => b.bounds.y + b.bounds.height))
    return { rowIndex, cells, bounds: { y: minY, height: maxY - minY } }
  })

  const allBlocks = multiColRows.flat()
  const minX = Math.min(...allBlocks.map(b => b.bounds.x))
  const maxX = Math.max(...allBlocks.map(b => b.bounds.x + b.bounds.width))
  const minY = Math.min(...allBlocks.map(b => b.bounds.y))
  const maxY = Math.max(...allBlocks.map(b => b.bounds.y + b.bounds.height))

  return [{
    rows: structuredRows,
    columnCount: columns.length,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }]
}

// Render a table as pipe-delimited text suitable for the AI prompt.
export function tableToText(table: ExtractedTable): string {
  return table.rows.map(row => {
    const cells = Array<string>(table.columnCount).fill('')
    for (const cell of row.cells) {
      if (cell.colIndex < cells.length) cells[cell.colIndex] = cell.text
    }
    return cells.join(' | ')
  }).join('\n')
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function groupBlocksIntoRows(blocks: OCRBlock[]): OCRBlock[][] {
  const sorted = [...blocks].sort((a, b) => a.bounds.y - b.bounds.y)
  const rows: OCRBlock[][] = []

  for (const block of sorted) {
    const cy = block.bounds.y + block.bounds.height / 2
    const last = rows[rows.length - 1]

    if (!last) { rows.push([block]); continue }

    const lastCy = last[0].bounds.y + last[0].bounds.height / 2
    if (Math.abs(cy - lastCy) <= ROW_Y_TOLERANCE) {
      last.push(block)
    } else {
      rows.push([block])
    }
  }

  return rows
}

function detectColumnCenters(rows: OCRBlock[][]): number[] {
  const xCenters = rows.flat().map(b => b.bounds.x + b.bounds.width / 2).sort((a, b) => a - b)

  const clusters: number[][] = []
  for (const x of xCenters) {
    const last = clusters[clusters.length - 1]
    if (!last || x - last[last.length - 1] > COL_X_GAP) {
      clusters.push([x])
    } else {
      last.push(x)
    }
  }

  return clusters.map(c => c.reduce((a, b) => a + b) / c.length)
}

function nearestColumn(cx: number, columns: number[]): number {
  return columns.reduce(
    (best, col, i) =>
      Math.abs(cx - col) < Math.abs(cx - columns[best]) ? i : best,
    0
  )
}
