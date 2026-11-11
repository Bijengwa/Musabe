// Excel files: every list can be downloaded, and some can be uploaded.
// Same look for every file: green header row, frozen, with filters, money as 36,000.
const ExcelJS = require('exceljs');
const { HttpError } = require('./util');

const GREEN = 'FF16794A';

// sheets: [{ name, title?, columns: [{ header, key, width?, type?: 'money'|'date'|'text'|'int' }], rows: [...] }]
async function sendExcel(res, filename, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Musabe Schools System';
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: sh.title ? 2 : 1 }] });
    if (sh.title) {
      ws.addRow([sh.title]).font = { bold: true, size: 13 };
      ws.mergeCells(1, 1, 1, sh.columns.length);
    }
    const head = ws.addRow(sh.columns.map((c) => c.header));
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      cell.alignment = { vertical: 'middle' };
    });
    sh.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width || Math.max(12, c.header.length + 4);
      if (c.type === 'money' || c.type === 'int') col.numFmt = '#,##0';
      if (c.type === 'date') col.numFmt = 'dd mmm yyyy hh:mm';
    });
    for (const r of sh.rows) ws.addRow(sh.columns.map((c) => (r[c.key] === undefined ? null : r[c.key])));
    ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: sh.columns.length } };
    if (sh.notes) {
      // Instructions go on their own sheet, so they are never read back as data.
      const help = wb.addWorksheet('How to fill');
      help.getColumn(1).width = 100;
      help.addRow(['How to fill this file']).font = { bold: true, size: 13 };
      for (const n of sh.notes) help.addRow([n]);
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}-${stamp}.xlsx"`,
  });
  await wb.xlsx.write(res);
  res.end();
}

// Read the first sheet of an uploaded file. Finds the header row (the first row with `need` in it),
// and returns [{ _row, <header in lower case>: value }].
async function readExcel(buffer, need) {
  if (!buffer || !buffer.length) throw new HttpError(400, 'Choose an Excel file (.xlsx).');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not an Excel file (.xlsx). In Excel, use File → Save As → Excel Workbook.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'The Excel file is empty.');
  const text = (v) => {
    if (v == null) return '';
    if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : '')).trim();
    return String(v).trim();
  };
  let headerRow = null, headers = [];
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const vals = row.values.slice(1).map((v) => text(v).toLowerCase());
    if (vals.includes(need)) { headerRow = n; headers = vals; }
  });
  if (!headerRow) throw new HttpError(400, `Could not find the "${need}" column. Download the template and fill it in.`);
  const rows = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const o = { _row: n };
    let any = false;
    headers.forEach((h, i) => { if (!h) return; const v = text(row.getCell(i + 1).value); o[h] = v; if (v) any = true; });
    if (any) rows.push(o);
  });
  return rows;
}

module.exports = { sendExcel, readExcel };
