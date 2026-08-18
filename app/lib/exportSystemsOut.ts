// ─────────────────────────────────────────────────────────────────────────────
// Systems Out → Excel export
//
// Builds a formatted .xlsx workbook from the outage rows currently shown on the
// Systems Out screen and triggers a browser download. Everything here runs in
// the browser using data already loaded into React state — no extra Supabase
// queries, no server route, no new environment variables.
//
// ExcelJS is loaded with a dynamic import() inside the function so it is only
// downloaded by the browser the first time someone actually clicks Export.
// ─────────────────────────────────────────────────────────────────────────────

type OutageRow = {
  sys: any        // row from `systems`
  prop: any       // row from `properties`
  st: any         // most recent row from `status_updates`
  status: string  // 'out-of-service' | 'maintenance'
  since: string | null
}

type ExportArgs = {
  outRows: OutageRow[]                    // already scoped, filtered and sorted
  maintRows: OutageRow[]                  // already scoped, filtered and sorted
  eventCosts: Record<number, any>         // keyed by status_update id
  eventVendors: Record<number, any[]>     // keyed by status_update id
  stateAbbr: (state: string) => string    // the app's abbr() helper
  scopeLabel: string                      // e.g. "All properties · Filtered by State: Texas"
  exportedBy: string                      // display name of whoever clicked
}

// Excel colors are ARGB strings with no leading '#'
const C = {
  navy:        'FF0F172A',
  white:       'FFFFFFFF',
  slate:       'FF64748B',
  gridline:    'FFE2E8F0',
  bandRow:     'FFF8FAFC',
  outFill:     'FFFEF2F2', // light red   — matches the Out of Service badge
  outText:     'FFB91C1C',
  maintFill:   'FFFFFBEB', // light amber — matches the Maintenance badge
  maintText:   'FFB45309',
  sectionOut:  'FFDC2626',
  sectionMnt:  'FFD97706',
}

const COLUMNS: { header: string; width: number }[] = [
  { header: 'Property',          width: 30 },
  { header: 'ID',                width: 7  },
  { header: 'State',             width: 8  },
  { header: 'City',              width: 18 },
  { header: 'Regional Manager',  width: 20 },
  { header: 'Regional Svc Mgr',  width: 20 },
  { header: 'System',            width: 24 },
  { header: 'Type',              width: 16 },
  { header: 'Status',            width: 16 },
  { header: 'Reason',            width: 26 },
  { header: 'Affected Units',    width: 22 },
  { header: 'Days Down',         width: 11 },
  { header: 'Date Reported',     width: 20 },
  { header: 'Reported By',       width: 20 },
  { header: 'Vendor',            width: 24 },
  { header: 'Est. Cost',         width: 13 },
  { header: 'Est. Completion',   width: 16 },
  { header: 'Notes',             width: 50 },
]

const titleCase = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const daysDownNumber = (ts: string | null): number | null => {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d < 0 ? 0 : d
}

const asDate = (ts: string | null): Date | null => {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d
}

export async function exportSystemsOutToExcel(args: ExportArgs): Promise<void> {
  const { outRows, maintRows, eventCosts, eventVendors, stateAbbr, scopeLabel, exportedBy } = args

  const ExcelJS: any = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PEM Dashboard'
  wb.created = new Date()

  const ws = wb.addWorksheet('Systems Out', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const lastCol = COLUMNS.length
  ws.columns = COLUMNS.map((c) => ({ width: c.width }))

  // ── Row 1: title ───────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, lastCol)
  const title = ws.getCell(1, 1)
  title.value = 'PEM Dashboard — Systems Out'
  title.font = { name: 'Calibri', size: 16, bold: true, color: { argb: C.white } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 26

  // ── Row 2: scope + timestamp ───────────────────────────────────────────────
  ws.mergeCells(2, 1, 2, lastCol)
  const sub = ws.getCell(2, 1)
  const stamp = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
  const total = outRows.length + maintRows.length
  sub.value =
    `${scopeLabel}  ·  ${outRows.length} out of service (red), ${maintRows.length} in maintenance (amber) ` +
    `— ${total} total  ·  Exported ${stamp} by ${exportedBy}`
  sub.font = { name: 'Calibri', size: 10, color: { argb: C.slate } }
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 18

  // Row 3 left blank as a spacer
  ws.getRow(3).height = 6

  // ── Row 4: column headers ──────────────────────────────────────────────────
  const headerRow = ws.getRow(4)
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: C.navy } } }
  })
  headerRow.height = 22

  // ── Data rows ──────────────────────────────────────────────────────────────
  // One continuous table — no merged section headers or blank spacer rows, so
  // Excel's own Sort and Filter tools work on the whole block without complaint.
  // The two groups stay visually separated by their red / amber row shading.
  let r = 5

  const writeDataRow = (row: OutageRow, fill: string, textColor: string) => {
    const st = row.st || {}
    const cost = st.id != null ? eventCosts[st.id] : null
    const vendors = (st.id != null ? eventVendors[st.id] : null) || []
    const days = daysDownNumber(row.since)

    const values: any[] = [
      row.prop?.name || '',
      row.prop?.id || '',
      stateAbbr(row.prop?.state || ''),
      row.prop?.city || '',
      row.prop?.rm || '',
      row.prop?.rsm || '',
      row.sys?.name || '',
      titleCase(row.sys?.system_type || ''),
      row.status === 'out-of-service' ? 'Out of Service' : 'Maintenance',
      st.reason || '',
      st.affected_units || '',
      days,
      asDate(row.since),
      st.reported_by || '',
      vendors.map((v: any) => v.vendor_name).filter(Boolean).join(', '),
      cost?.estimated_cost != null && cost.estimated_cost !== '' ? Number(cost.estimated_cost) : null,
      cost?.estimated_completion ? asDate(cost.estimated_completion) : null,
      st.notes || '',
    ]

    const excelRow = ws.getRow(r)
    values.forEach((v, i) => {
      const cell = excelRow.getCell(i + 1)
      cell.value = v === null || v === undefined ? '' : v
      cell.font = { name: 'Calibri', size: 10, color: { argb: textColor } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.alignment = { vertical: 'top', wrapText: i === 17 || i === 10 }
      cell.border = {
        top:    { style: 'hair', color: { argb: C.gridline } },
        bottom: { style: 'hair', color: { argb: C.gridline } },
        left:   { style: 'hair', color: { argb: C.gridline } },
        right:  { style: 'hair', color: { argb: C.gridline } },
      }
    })

    // Status cell reads as a bold badge
    excelRow.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: textColor } }
    // Days Down — whole number, centered
    excelRow.getCell(12).numFmt = '0'
    excelRow.getCell(12).alignment = { vertical: 'top', horizontal: 'center' }
    // Date Reported
    excelRow.getCell(13).numFmt = 'mm/dd/yyyy h:mm AM/PM'
    // Est. Cost — currency, blank when unknown
    excelRow.getCell(16).numFmt = '$#,##0;[Red]-$#,##0;""'
    // Est. Completion
    excelRow.getCell(17).numFmt = 'mm/dd/yyyy'

    r++
  }

  if (outRows.length === 0 && maintRows.length === 0) {
    ws.mergeCells(r, 1, r, lastCol)
    const cell = ws.getCell(r, 1)
    cell.value = 'No systems are currently out of service or under maintenance.'
    cell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: C.slate } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    r++
  } else {
    outRows.forEach((row) => writeDataRow(row, C.outFill, C.outText))
    maintRows.forEach((row) => writeDataRow(row, C.maintFill, C.maintText))
  }

  // Filter dropdowns on the header row (skipped when there is nothing to filter)
  if (total > 0) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: lastCol } }
  }

  // ── Trigger the download ───────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fileName =
    `Systems-Out_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}