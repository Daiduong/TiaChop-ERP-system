/**
 * BÁO CÁO CÔNG NỢ KHÁCH HÀNG • GIẤY ĐỀ NGHỊ THANH TOÁN • THEO DÕI HÓA ĐƠN VAT
 * Mount tại /api/reports (chỉ ADMIN / ACCOUNTANT).
 */
const express = require('express');
const router = express.Router();
const { db } = require('./db');

// ---------- Schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS report_templates (
    customer_id TEXT PRIMARY KEY, -- 'DEFAULT' hoặc id khách hàng
    config TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
if (!db.prepare('PRAGMA table_info(orders)').all().some(c => c.name === 'vat_invoice_no')) {
  db.exec('ALTER TABLE orders ADD COLUMN vat_invoice_no TEXT');
}

// ---------- Template ----------
const COLUMN_DEFS = {
  stt:        { label: 'STT', align: 'center' },
  code:       { label: 'Mã đơn', align: 'left' },
  date:       { label: 'Ngày đặt', align: 'center' },
  description:{ label: 'Nội dung', align: 'left' },
  total:      { label: 'Tổng tiền', align: 'right', money: true },
  vat:        { label: 'Trong đó VAT', align: 'right', money: true },
  paid:       { label: 'Đã thanh toán', align: 'right', money: true },
  remaining:  { label: 'Còn nợ', align: 'right', money: true },
  vat_invoice:{ label: 'Số HĐ VAT', align: 'center' },
};

const DEFAULT_TEMPLATE = {
  title: 'BẢNG ĐỐI CHIẾU CÔNG NỢ',
  note: '',
  columns: ['stt', 'code', 'date', 'description', 'total', 'paid', 'remaining', 'vat_invoice'],
  include_paid: false,
  show_signature: true,
  signature_left: 'Đại diện khách hàng',
  signature_right: 'Đại diện công ty',
  bank_info: '',
  footer_note: '',
  pr_intro: 'Căn cứ vào các đơn hàng đã giao, chúng tôi trân trọng đề nghị Quý khách hàng thanh toán khoản công nợ sau:',
  pr_deadline_days: 7,
};

function getTemplate(customerId) {
  const base = { ...DEFAULT_TEMPLATE };
  const def = db.prepare("SELECT config FROM report_templates WHERE customer_id = 'DEFAULT'").get();
  if (def) Object.assign(base, safeJson(def.config));
  let custom = false;
  if (customerId && customerId !== 'DEFAULT') {
    const row = db.prepare('SELECT config FROM report_templates WHERE customer_id = ?').get(customerId);
    if (row) { Object.assign(base, safeJson(row.config)); custom = true; }
  }
  base.columns = (base.columns || []).filter(c => COLUMN_DEFS[c]);
  if (!base.columns.length) base.columns = DEFAULT_TEMPLATE.columns;
  return { tpl: base, custom };
}
function safeJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

router.get('/template/:customerId', (req, res) => {
  const { tpl, custom } = getTemplate(req.params.customerId);
  res.json({ tpl, custom, columnDefs: COLUMN_DEFS });
});

router.put('/template/:customerId', (req, res) => {
  const b = req.body || {};
  const cfg = {};
  Object.keys(DEFAULT_TEMPLATE).forEach(k => { if (b[k] !== undefined) cfg[k] = b[k]; });
  if (Array.isArray(cfg.columns)) cfg.columns = cfg.columns.filter(c => COLUMN_DEFS[c]);
  db.prepare(`INSERT INTO report_templates (customer_id, config, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(customer_id) DO UPDATE SET config = excluded.config, updated_at = CURRENT_TIMESTAMP`)
    .run(req.params.customerId, JSON.stringify(cfg));
  res.json({ ok: true });
});

router.delete('/template/:customerId', (req, res) => {
  if (req.params.customerId === 'DEFAULT') return res.status(400).json({ error: 'Không thể xóa template mặc định' });
  db.prepare('DELETE FROM report_templates WHERE customer_id = ?').run(req.params.customerId);
  res.json({ ok: true });
});

// ---------- Dữ liệu công nợ ----------
function loadDebt(customerId, from, to, includePaid) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  let sql = `SELECT * FROM orders WHERE customer_id = ? AND type = 'ORDER' AND status != 'CANCELLED'`;
  const params = [customerId];
  if (!includePaid) sql += " AND payment_status != 'PAID'";
  if (from) { sql += ' AND date(created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(created_at) <= date(?)'; params.push(to); }
  sql += ' ORDER BY created_at ASC';
  const orders = db.prepare(sql).all(...params);
  const itemStmt = db.prepare('SELECT item_name, quantity, unit FROM order_items WHERE order_id = ?');
  const rows = orders.map((o, i) => {
    const items = itemStmt.all(o.id);
    const total = o.total_selling || 0;
    const remaining = o.remaining_amount || 0;
    return {
      stt: i + 1, id: o.id, code: o.code, date: o.created_at,
      description: items.map(it => `${it.item_name} (${it.quantity} ${it.unit || ''})`.replace(' )', ')')).join('; '),
      total, vat: o.vat_amount || 0, paid: Math.max(0, total - remaining), remaining,
      vat_invoice: o.vat_rate > 0 ? (o.vat_invoice_no || 'Chưa xuất') : '—',
    };
  });
  const totals = rows.reduce((a, r) => ({
    total: a.total + r.total, vat: a.vat + r.vat, paid: a.paid + r.paid, remaining: a.remaining + r.remaining,
  }), { total: 0, vat: 0, paid: 0, remaining: 0 });
  return { customer, rows, totals };
}

// ---------- Render helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const fmtDate = d => { if (!d) return ''; const x = new Date(String(d).replace(' ', 'T') + (String(d).length <= 10 ? '' : 'Z')); return isNaN(x) ? String(d) : x.toLocaleDateString('vi-VN'); };
const nl2br = s => esc(s).replace(/\n/g, '<br>');

function getSettings() {
  const o = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { o[r.key] = r.value; });
  return o;
}

function companyHeader(S) {
  const C = S.primary_color || '#0284c7';
  return `<div class="hd" style="border-bottom:2px solid ${C}">
    <img src="/assets/logo.png" style="height:55px">
    <div><div style="font-size:16pt;font-weight:700;color:${C}">${esc(S.company_name || 'CÔNG TY IN TIA CHỚP')}</div>
    <div style="font-weight:700;font-size:9pt">${esc(S.company_slogan || '')}</div>
    <div style="font-size:9pt;color:#555">Hotline: ${esc(S.company_hotline || '')} • Email: ${esc(S.company_email || '')}</div>
    ${S.company_address ? `<div style="font-size:9pt;color:#555">Địa chỉ: ${esc(S.company_address)}${S.company_tax_code ? ' • MST: ' + esc(S.company_tax_code) : ''}</div>` : ''}</div></div>`;
}

function tableHtml(data, tpl, S) {
  const C = S.primary_color || '#0284c7';
  const cols = tpl.columns;
  const head = cols.map(c => `<th style="text-align:${COLUMN_DEFS[c].align}">${COLUMN_DEFS[c].label}</th>`).join('');
  const body = data.rows.map(r => '<tr>' + cols.map(c => {
    const v = c === 'date' ? fmtDate(r.date) : COLUMN_DEFS[c].money ? money(r[c]) : esc(r[c]);
    return `<td style="text-align:${COLUMN_DEFS[c].align}">${v}</td>`;
  }).join('') + '</tr>').join('');
  const sumCols = ['total', 'vat', 'paid', 'remaining'];
  const first = cols.findIndex(c => sumCols.includes(c));
  const foot = first < 0 ? '' : `<tr style="font-weight:700;background:#f1f5f9"><td colspan="${first}" style="text-align:right">TỔNG CỘNG</td>` +
    cols.slice(first).map(c => `<td style="text-align:right">${sumCols.includes(c) ? money(data.totals[c]) : ''}</td>`).join('') + '</tr>';
  return `<table class="tb"><thead><tr style="background:${C};color:#fff">${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

function signatures(tpl) {
  if (!tpl.show_signature) return '';
  return `<div class="sig"><div><b>${esc(tpl.signature_left)}</b><br><i>(Ký, ghi rõ họ tên)</i></div>
    <div><b>${esc(tpl.signature_right)}</b><br><i>(Ký, ghi rõ họ tên, đóng dấu)</i></div></div>`;
}

const PAGE_CSS = `
  body{font-family:'Times New Roman',serif;color:#111;margin:24px;font-size:11pt}
  .hd{display:flex;gap:14px;align-items:center;padding-bottom:10px;margin-bottom:14px}
  h1{text-align:center;font-size:16pt;margin:10px 0 4px}
  .tb{width:100%;border-collapse:collapse;margin:10px 0;font-size:10pt}
  .tb th,.tb td{border:1px solid #444;padding:5px 6px;vertical-align:top}
  .sig{display:flex;justify-content:space-around;text-align:center;margin-top:36px;min-height:110px}
  @media print{body{margin:10mm}}`;

function wrapHtml(title, inner, autoPrint) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>${PAGE_CSS}</style></head><body>${inner}${autoPrint ? '<script>window.onload=()=>setTimeout(()=>window.print(),400)</script>' : ''}</body></html>`;
}

function customerBlock(c) {
  return `<div style="margin:8px 0"><div><b>Khách hàng:</b> ${esc(c.name)} ${c.code ? `(${esc(c.code)})` : ''}</div>
    ${c.tax_company ? `<div><b>Đơn vị:</b> ${esc(c.tax_company)}${c.tax_code ? ' • MST: ' + esc(c.tax_code) : ''}</div>` : ''}
    ${c.address ? `<div><b>Địa chỉ:</b> ${esc(c.address)}</div>` : ''}</div>`;
}

function periodText(from, to) {
  if (!from && !to) return 'Tính đến ngày ' + new Date().toLocaleDateString('vi-VN');
  return `Kỳ: ${from ? fmtDate(from) : '...'} - ${to ? fmtDate(to) : '...'}`;
}

function parseQuery(req) {
  const { customer_id, from, to } = req.query;
  const { tpl, custom } = getTemplate(customer_id);
  const includePaid = req.query.include_paid != null ? req.query.include_paid === '1' : !!tpl.include_paid;
  return { customer_id, from, to, tpl, custom, includePaid };
}

function debtReportHtml(data, q, S) {
  const { tpl } = q;
  return companyHeader(S) + `<h1>${esc(tpl.title)}</h1>
    <div style="text-align:center;font-size:10pt">${esc(periodText(q.from, q.to))}</div>
    ${customerBlock(data.customer)}
    ${tpl.note ? `<div style="margin:6px 0">${nl2br(tpl.note)}</div>` : ''}
    ${tableHtml(data, tpl, S)}
    <div><b>Tổng công nợ còn phải thanh toán: ${money(data.totals.remaining)} đồng</b><br><i>Bằng chữ: ${moneyToWords(data.totals.remaining)}</i></div>
    ${tpl.bank_info ? `<div style="margin-top:8px"><b>Thông tin thanh toán:</b><br>${nl2br(tpl.bank_info)}</div>` : ''}
    ${tpl.footer_note ? `<div style="margin-top:8px;font-size:10pt">${nl2br(tpl.footer_note)}</div>` : ''}
    ${signatures(tpl)}`;
}

// ---------- Báo cáo công nợ: json | xls | html(in/PDF) ----------
router.get('/debt', async (req, res) => {
  const q = parseQuery(req);
  if (!q.customer_id) return res.status(400).json({ error: 'Thiếu customer_id' });
  const data = loadDebt(q.customer_id, q.from, q.to, q.includePaid);
  if (!data) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const S = getSettings();
  const fmt = req.query.format || 'json';
  if (fmt === 'json') return res.json({ ...data, tpl: q.tpl, custom: q.custom, columnDefs: COLUMN_DEFS });
  if (fmt === 'xlsx' || fmt === 'xls') {
    try {
      const buf = await buildXlsx(data, q, S);
      const safe = (data.customer.code || data.customer.name).replace(/[^\w-]+/g, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="CongNo_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
      return res.send(Buffer.from(buf));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.type('html').send(wrapHtml(q.tpl.title, debtReportHtml(data, q, S), true)); // PDF: chọn "Lưu dạng PDF" trong hộp thoại in
});

async function buildXlsx(data, q, S) {
  const ExcelJS = require('exceljs');
  const { tpl } = q;
  const cols = tpl.columns;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Công nợ');
  const n = cols.length;
  const C = (S.primary_color || '#0284c7').replace('#', '').toUpperCase().padStart(6, '0');
  const widths = { stt: 6, code: 18, date: 12, description: 45, total: 16, vat: 16, paid: 16, remaining: 16, vat_invoice: 14 };
  ws.columns = cols.map(c => ({ width: widths[c] || 14 }));
  const merged = (text, font, height) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, n);
    r.getCell(1).font = font;
    r.getCell(1).alignment = { wrapText: true, vertical: 'middle', horizontal: font.center ? 'center' : 'left' };
    if (height) r.height = height;
    return r;
  };
  merged(S.company_name || 'CÔNG TY IN TIA CHỚP', { bold: true, size: 14, color: { argb: 'FF' + C } });
  if (S.company_slogan) merged(S.company_slogan, { bold: true, size: 10 });
  const contact = [S.company_address, S.company_tax_code && 'MST: ' + S.company_tax_code, S.company_hotline && 'Hotline: ' + S.company_hotline].filter(Boolean).join(' • ');
  if (contact) merged(contact, { size: 9, color: { argb: 'FF555555' } });
  ws.addRow([]);
  merged(tpl.title, { bold: true, size: 16, center: true }, 26);
  merged(periodText(q.from, q.to), { italic: true, size: 10, center: true });
  const c = data.customer;
  merged(`Khách hàng: ${c.name}${c.code ? ' (' + c.code + ')' : ''}${c.tax_code ? ' • MST: ' + c.tax_code : ''}`, { bold: true });
  if (c.address) merged('Địa chỉ: ' + c.address, {});
  if (tpl.note) merged(tpl.note, {}, Math.max(18, tpl.note.split('\n').length * 15));
  ws.addRow([]);

  const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const head = ws.addRow(cols.map(k => COLUMN_DEFS[k].label));
  head.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border;
  });
  const fmtMoney = '#,##0';
  data.rows.forEach(r => {
    const row = ws.addRow(cols.map(k => k === 'date' ? fmtDate(r.date) : (COLUMN_DEFS[k].money ? Number(r[k]) : r[k])));
    row.eachCell((cell, i) => {
      const def = COLUMN_DEFS[cols[i - 1]];
      cell.border = border;
      cell.alignment = { horizontal: def.align, vertical: 'top', wrapText: true };
      if (def.money) cell.numFmt = fmtMoney;
    });
  });
  const sumCols = ['total', 'vat', 'paid', 'remaining'];
  const first = cols.findIndex(k => sumCols.includes(k));
  if (first >= 0) {
    const row = ws.addRow(cols.map((k, i) => i === 0 ? 'TỔNG CỘNG' : (sumCols.includes(k) ? data.totals[k] : '')));
    if (first > 0) ws.mergeCells(row.number, 1, row.number, first);
    row.eachCell((cell, i) => {
      cell.font = { bold: true };
      cell.border = border;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      if (i > first) { cell.numFmt = fmtMoney; cell.alignment = { horizontal: 'right' }; }
      else cell.alignment = { horizontal: 'right' };
    });
  }
  ws.addRow([]);
  merged(`Tổng công nợ còn phải thanh toán: ${money(data.totals.remaining)} đồng`, { bold: true });
  merged('Bằng chữ: ' + moneyToWords(data.totals.remaining), { italic: true });
  if (tpl.bank_info) merged('Thông tin thanh toán:\n' + tpl.bank_info, {}, Math.max(18, (tpl.bank_info.split('\n').length + 1) * 15));
  if (tpl.footer_note) merged(tpl.footer_note, { size: 10 }, Math.max(18, tpl.footer_note.split('\n').length * 15));
  if (tpl.show_signature) {
    ws.addRow([]);
    const r = ws.addRow([]);
    const mid = Math.max(1, Math.floor(n / 2));
    r.getCell(1).value = tpl.signature_left;
    r.getCell(mid + 1 > n ? n : mid + 1).value = tpl.signature_right;
    r.eachCell(cell => { cell.font = { bold: true }; cell.alignment = { horizontal: 'left' }; });
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb.xlsx.writeBuffer();
}

// ---------- Giấy đề nghị thanh toán ----------
router.get('/payment-request', (req, res) => {
  const q = parseQuery(req);
  if (!q.customer_id) return res.status(400).json({ error: 'Thiếu customer_id' });
  const data = loadDebt(q.customer_id, q.from, q.to, false);
  if (!data) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const S = getSettings();
  const { tpl } = q;
  const today = new Date();
  const due = new Date(today.getTime() + (Number(tpl.pr_deadline_days) || 0) * 86400000);
  const prCols = ['stt', 'code', 'date', 'vat_invoice', 'remaining'];
  const inner = companyHeader(S) + `
    <h1>GIẤY ĐỀ NGHỊ THANH TOÁN</h1>
    <div style="text-align:center;font-size:10pt">Ngày ${today.getDate()} tháng ${today.getMonth() + 1} năm ${today.getFullYear()}</div>
    <div style="margin:10px 0"><b>Kính gửi:</b> ${esc(data.customer.tax_company || data.customer.name)}</div>
    ${customerBlock(data.customer)}
    <p>${nl2br(tpl.pr_intro)}</p>
    ${tableHtml(data, { ...tpl, columns: prCols }, S)}
    <div><b>Tổng số tiền đề nghị thanh toán: ${money(data.totals.remaining)} đồng</b><br><i>Bằng chữ: ${moneyToWords(data.totals.remaining)}</i></div>
    ${tpl.pr_deadline_days ? `<p>Thời hạn thanh toán: trước ngày <b>${due.toLocaleDateString('vi-VN')}</b>.</p>` : ''}
    ${tpl.bank_info ? `<div><b>Thông tin chuyển khoản:</b><br>${nl2br(tpl.bank_info)}</div>` : ''}
    ${tpl.footer_note ? `<p style="font-size:10pt">${nl2br(tpl.footer_note)}</p>` : ''}
    <p>Trân trọng cảm ơn!</p>
    ${signatures({ ...tpl, show_signature: true })}`;
  res.type('html').send(wrapHtml('Giấy đề nghị thanh toán', inner, true));
});

// ---------- Theo dõi hóa đơn VAT ----------
router.get('/vat', (req, res) => {
  const { status = 'all', customer_id } = req.query;
  let sql = `SELECT o.id, o.code, o.customer_id, o.vat_invoice_id, o.created_at, o.vat_rate, o.vat_amount, o.total_selling, o.vat_invoice_no,
      o.vat_invoiced_at, c.name AS customer_name
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.type = 'ORDER' AND o.vat_rate > 0 AND o.status != 'CANCELLED'`;
  const params = [];
  if (customer_id) { sql += ' AND o.customer_id = ?'; params.push(customer_id); }
  if (status === 'invoiced') sql += " AND COALESCE(o.vat_invoice_no, '') != ''";
  if (status === 'pending') sql += " AND COALESCE(o.vat_invoice_no, '') = ''";
  sql += ' ORDER BY o.created_at DESC LIMIT 300';
  const rows = db.prepare(sql).all(...params);
  const sum = db.prepare(`SELECT
      COUNT(CASE WHEN COALESCE(vat_invoice_no,'') != '' THEN 1 END) AS invoiced,
      COUNT(CASE WHEN COALESCE(vat_invoice_no,'') = '' THEN 1 END) AS pending
    FROM orders WHERE type='ORDER' AND vat_rate > 0 AND status != 'CANCELLED'${customer_id ? ' AND customer_id = ?' : ''}`).get(...(customer_id ? [customer_id] : []));
  res.json({ rows, summary: sum });
});

router.patch('/vat/:orderId', (req, res) => {
  const no = String(req.body?.vat_invoice_no || '').trim();
  const date = no ? (req.body?.vat_invoiced_at || new Date().toISOString().slice(0, 10)) : null;
  const r = db.prepare('UPDATE orders SET vat_invoice_no = ?, vat_invoiced_at = ? WHERE id = ?')
    .run(no || null, date, req.params.orderId);
  if (!r.changes) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  res.json({ ok: true });
});

// ---------- Quản lý xuất hóa đơn VAT (theo đơn hàng / theo bảng kê công nợ) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS vat_invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL,
    invoice_date DATE,
    mode TEXT NOT NULL DEFAULT 'ORDER', -- ORDER | STATEMENT
    customer_id TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    vat_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE | CANCELLED
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
if (!db.prepare('PRAGMA table_info(orders)').all().some(c => c.name === 'vat_invoice_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN vat_invoice_id TEXT');
}

router.get('/vat-invoices', (req, res) => {
  const rows = db.prepare(`SELECT v.*, c.name AS customer_name,
      (SELECT COUNT(*) FROM orders o WHERE o.vat_invoice_id = v.id) AS orders_count
    FROM vat_invoices v JOIN customers c ON c.id = v.customer_id
    ORDER BY v.created_at DESC LIMIT 200`).all();
  res.json(rows);
});

router.post('/vat-invoices', (req, res) => {
  const { mode = 'ORDER', customer_id, order_ids, invoice_no, invoice_date, notes } = req.body || {};
  const no = String(invoice_no || '').trim();
  if (!no) return res.status(400).json({ error: 'Vui lòng nhập số hóa đơn' });
  if (!Array.isArray(order_ids) || !order_ids.length) return res.status(400).json({ error: 'Chưa chọn đơn hàng' });
  if (mode === 'ORDER' && order_ids.length !== 1) return res.status(400).json({ error: 'Xuất theo đơn hàng chỉ gồm 1 đơn' });
  if (db.prepare("SELECT 1 FROM vat_invoices WHERE invoice_no = ? AND status = 'ACTIVE'").get(no)) {
    return res.status(400).json({ error: 'Số hóa đơn đã tồn tại' });
  }
  const orders = order_ids.map(id => db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  if (orders.some(o => !o)) return res.status(404).json({ error: 'Có đơn hàng không tồn tại' });
  const custId = customer_id || orders[0].customer_id;
  if (orders.some(o => o.customer_id !== custId)) return res.status(400).json({ error: 'Các đơn phải cùng một khách hàng' });
  const bad = orders.find(o => !(o.vat_rate > 0) || o.vat_invoice_id || o.vat_invoice_no);
  if (bad) return res.status(400).json({ error: `Đơn ${bad.code} không có VAT hoặc đã xuất hóa đơn` });
  const total = orders.reduce((a, o) => a + (o.total_selling || 0), 0);
  const vat = orders.reduce((a, o) => a + (o.vat_amount || 0), 0);
  const id = `vi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const date = invoice_date || new Date().toISOString().slice(0, 10);
  db.transaction(() => {
    db.prepare(`INSERT INTO vat_invoices (id, invoice_no, invoice_date, mode, customer_id, subtotal, vat_amount, total, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, no, date, mode === 'STATEMENT' ? 'STATEMENT' : 'ORDER', custId, total - vat, vat, total, notes || null, req.user?.full_name || null);
    const up = db.prepare('UPDATE orders SET vat_invoice_id = ?, vat_invoice_no = ?, vat_invoiced_at = ? WHERE id = ?');
    orders.forEach(o => up.run(id, no, date, o.id));
  })();
  res.json({ ok: true, id });
});

router.delete('/vat-invoices/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM vat_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Không tìm thấy hóa đơn' });
  db.transaction(() => {
    db.prepare("UPDATE vat_invoices SET status = 'CANCELLED' WHERE id = ?").run(inv.id);
    db.prepare('UPDATE orders SET vat_invoice_id = NULL, vat_invoice_no = NULL, vat_invoiced_at = NULL WHERE vat_invoice_id = ?').run(inv.id);
  })();
  res.json({ ok: true });
});

// Bảng kê kèm hóa đơn (in / PDF)
router.get('/vat-invoices/:id/print', (req, res) => {
  const inv = db.prepare('SELECT v.*, c.name AS cname FROM vat_invoices v JOIN customers c ON c.id = v.customer_id WHERE v.id = ?').get(req.params.id);
  if (!inv) return res.status(404).send('Không tìm thấy');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
  const S = getSettings();
  const orders = db.prepare('SELECT * FROM orders WHERE vat_invoice_id = ? ORDER BY created_at').all(inv.id);
  const itemStmt = db.prepare('SELECT item_name, quantity, unit FROM order_items WHERE order_id = ?');
  const body = orders.map((o, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc(o.code)}</td><td style="text-align:center">${fmtDate(o.created_at)}</td>
    <td>${esc(itemStmt.all(o.id).map(it => `${it.item_name} (${it.quantity} ${it.unit || ''})`).join('; '))}</td>
    <td style="text-align:right">${money(o.total_selling - o.vat_amount)}</td><td style="text-align:center">${o.vat_rate}%</td>
    <td style="text-align:right">${money(o.vat_amount)}</td><td style="text-align:right">${money(o.total_selling)}</td></tr>`).join('');
  const inner = companyHeader(S) + `<h1>BẢNG KÊ KÈM HÓA ĐƠN GTGT</h1>
    <div style="text-align:center;font-size:10pt">Số hóa đơn: <b>${esc(inv.invoice_no)}</b> • Ngày: ${fmtDate(inv.invoice_date)} ${inv.status === 'CANCELLED' ? '• (ĐÃ HỦY)' : ''}</div>
    ${customerBlock(customer)}
    <table class="tb"><thead><tr style="background:${S.primary_color || '#0284c7'};color:#fff"><th>STT</th><th>Mã đơn</th><th>Ngày</th><th>Nội dung</th><th>Chưa VAT</th><th>Thuế</th><th>Tiền VAT</th><th>Cộng</th></tr></thead>
    <tbody>${body}<tr style="font-weight:700;background:#f1f5f9"><td colspan="4" style="text-align:right">TỔNG CỘNG</td><td style="text-align:right">${money(inv.subtotal)}</td><td></td><td style="text-align:right">${money(inv.vat_amount)}</td><td style="text-align:right">${money(inv.total)}</td></tr></tbody></table>
    <div><b>Tổng thanh toán: ${money(inv.total)} đồng</b><br><i>Bằng chữ: ${moneyToWords(inv.total)}</i></div>
    ${inv.notes ? `<p>Ghi chú: ${nl2br(inv.notes)}</p>` : ''}
    ${signatures({ show_signature: true, signature_left: 'Người mua hàng', signature_right: 'Người bán hàng' })}`;
  res.type('html').send(wrapHtml('Bảng kê hóa đơn ' + inv.invoice_no, inner, true));
});

// ---------- Đọc số thành chữ (tiếng Việt) ----------
function moneyToWords(n) {
  n = Math.round(n || 0);
  if (n === 0) return 'Không đồng.';
  const d = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const three = (x, full) => {
    const h = Math.floor(x / 100), t = Math.floor((x % 100) / 10), u = x % 10;
    let s = '';
    if (h > 0 || full) s += d[h] + ' trăm';
    if (t > 1) { s += ' ' + d[t] + ' mươi'; if (u === 1) s += ' mốt'; else if (u === 5) s += ' lăm'; else if (u > 0) s += ' ' + d[u]; }
    else if (t === 1) { s += ' mười'; if (u === 5) s += ' lăm'; else if (u > 0) s += ' ' + d[u]; }
    else if (u > 0) { if (h > 0 || full) s += ' lẻ'; s += ' ' + d[u]; }
    return s.trim();
  };
  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const full = i < groups.length - 1;
    parts.push(three(groups[i], full) + units[i % 4]);
  }
  const s = parts.join(' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng.';
}

module.exports = router;
