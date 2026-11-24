// Excel files: every list can be downloaded, and some can be uploaded.
// Same look for every file: green header row, frozen, with filters, money as 36,000.
const zlib = require('zlib');
const ExcelJS = () => require('exceljs'); // loaded at first use: it takes about 2 seconds, too long for every start
const { HttpError } = require('./util');

const GREEN = 'FF16794A';

// ---------- Safety of uploaded files ----------
// An .xlsx file is a zip. Before opening it: it must be a zip, and its unpacked size must stay small
// (a tiny "zip bomb" could unpack to gigabytes and stop the server).
const MAX_UNPACKED = 60 * 1024 * 1024; // 60 MB
const MAX_ENTRIES = 3000;
function checkXlsx(buffer) {
  if (!buffer || !buffer.length) throw new HttpError(400, 'Choose an Excel file (.xlsx).');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04)
    throw new HttpError(400, 'This is not an Excel file (.xlsx). In Excel, use File → Save As → Excel Workbook.');
  // End of central directory: last 22..65557 bytes
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new HttpError(400, 'This Excel file is damaged. Open it in Excel and save it again.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) throw new HttpError(400, 'This file has too many parts to be an ordinary Excel file.');
  // The sizes written in the file can be false (a 300 KB file that says "1 KB" but unpacks to gigabytes),
  // so each part is really unpacked here with a hard limit before the Excel reader sees the file.
  let total = 0;
  const tooBig = () => new HttpError(400, 'This Excel file is too big when opened (more than 60 MB). Split it into smaller files.');
  const damaged = () => new HttpError(400, 'This Excel file is damaged. Open it in Excel and save it again.');
  for (let n = 0; n < entries; n++) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== 0x02014b50) throw damaged();
    const method = buffer.readUInt16LE(ptr + 10), packed = buffer.readUInt32LE(ptr + 20), local = buffer.readUInt32LE(ptr + 42);
    if (buffer.readUInt32LE(ptr + 24) > MAX_UNPACKED) throw tooBig(); // the size the file itself says
    if (packed === 0xffffffff || local === 0xffffffff) throw tooBig(); // zip64: far beyond an ordinary school file
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw damaged();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + packed > buffer.length) throw damaged();
    if (method === 0) total += packed;
    else if (method === 8) {
      try { total += zlib.inflateRawSync(buffer.subarray(start, start + packed), { maxOutputLength: MAX_UNPACKED - total + 1 }).length; }
      catch (e) { throw e.code === 'ERR_BUFFER_TOO_LARGE' ? tooBig() : damaged(); }
    } else throw damaged();
    if (total > MAX_UNPACKED) throw tooBig();
    ptr += 46 + buffer.readUInt16LE(ptr + 28) + buffer.readUInt16LE(ptr + 30) + buffer.readUInt16LE(ptr + 32);
  }
}

// Text that Excel could read as a formula when someone edits the cell (=, +, -, @ at the start) gets a ' in front.
// Numbers like -5 stay numbers (they are not text).
const safeText = (v) => (typeof v === 'string' && /^[=+@\t\r]|^-(?!\d)/.test(v) ? `'${v}` : v);

// sheets: [{ name, title?, columns: [{ header, key, width?, type?: 'money'|'date'|'text'|'int' }], rows: [...] }]
async function sendExcel(res, filename, sheets) {
  const wb = new (ExcelJS().Workbook)();
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
    for (const r of sh.rows) ws.addRow(sh.columns.map((c) => (r[c.key] === undefined ? null : safeText(r[c.key]))));
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
  checkXlsx(buffer);
  const wb = new (ExcelJS().Workbook)();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not an Excel file (.xlsx). In Excel, use File → Save As → Excel Workbook.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'The Excel file is empty.');
  if (/^sample/i.test(ws.name)) throw new HttpError(400, 'This is the sample file. It only shows how to arrange the rows. Download the template, put your items in it, and upload that file.');
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

// Read the first sheet as plain rows: [{ row, cells: ['text', ...] }]. For files whose header row
// the caller finds itself (e.g. class lists in the school's own layout).
async function readRows(buffer) {
  checkXlsx(buffer);
  const wb = new (ExcelJS().Workbook)();
  try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This is not an Excel file (.xlsx). In Excel, use File → Save As → Excel Workbook.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'The Excel file is empty.');
  const rows = [];
  ws.eachRow((row, n) => {
    const cells = [];
    for (let i = 1; i <= Math.max(row.cellCount, 1); i++) cells.push(cellText(row.getCell(i).value));
    if (cells.some(Boolean)) rows.push({ row: n, cells });
  });
  return { sheet: ws.name, sheets: wb.worksheets.map((w) => w.name), rows };
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const formula = v.result;
    if (typeof formula === 'number') return String(formula).trim();
    return String(v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : formula ?? '')).trim();
  }
  // Keep Excel numeric phone cells as text and recover leading zero where formatting stored 10 digits numerically.
  if (typeof v === 'number') {
    const raw = String(v).replace(/\.0+$/, '');
    if (/^0[67]\d{8}$/.test(raw)) return raw;
    if (/^[67]\d{8}$/.test(raw)) return `0${raw}`;
    return raw;
  }
  return String(v).trim();
}

module.exports = { sendExcel, readExcel, readRows, checkXlsx, safeText };
