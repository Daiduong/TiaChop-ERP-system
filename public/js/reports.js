/**
 * TIA CHỚP ERP - BÁO CÁO CÔNG NỢ • ĐỀ NGHỊ THANH TOÁN • THEO DÕI HĐ VAT
 */
window.Reports = {
  customers: [],
  tpl: null,
  columnDefs: {},

  esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  money: n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)),

  async init() {
    try {
      const res = await fetch('/api/customers');
      this.customers = await res.json();
      const sel = document.getElementById('rp-customer');
      const cur = sel.value;
      sel.innerHTML = '<option value="">-- Chọn khách hàng --</option>' +
        this.customers.map(c => `<option value="${c.id}">${this.esc(c.name)}${c.total_debt > 0 ? ' • nợ ' + this.money(c.total_debt) : ''}</option>`).join('');
      sel.value = cur;
      const vsel = document.getElementById('vat-customer');
      if (vsel) {
        const vcur = vsel.value;
        vsel.innerHTML = '<option value="">Tất cả khách hàng</option>' +
          this.customers.map(c => `<option value="${c.id}">${this.esc(c.name)}</option>`).join('');
        vsel.value = vcur;
      }
      sel.onchange = () => { document.getElementById('rp-template-box').style.display = 'none'; };
    } catch (e) { console.error(e); }
    this.loadVat();
  },

  query(extra = {}) {
    const id = document.getElementById('rp-customer').value;
    if (!id) { alert('Vui lòng chọn khách hàng'); return null; }
    const p = new URLSearchParams({ customer_id: id, ...extra });
    const f = document.getElementById('rp-from').value, t = document.getElementById('rp-to').value;
    if (f) p.set('from', f);
    if (t) p.set('to', t);
    p.set('include_paid', document.getElementById('rp-include-paid').checked ? '1' : '0');
    return p;
  },

  // Mở Excel (tải về) hoặc trang in/PDF ở tab mới
  open(kind, format) {
    const p = this.query(format ? { format } : {});
    if (!p) return;
    if (format === 'xlsx') window.location.href = `/api/reports/${kind}?${p}`;
    else window.open(`/api/reports/${kind}?${p}`, '_blank');
  },

  async view() {
    const p = this.query({ format: 'json' });
    if (!p) return;
    const box = document.getElementById('rp-result');
    box.innerHTML = '<p style="color:var(--text-dim)">Đang tải…</p>';
    const res = await fetch(`/api/reports/debt?${p}`);
    const d = await res.json();
    if (d.error) { box.innerHTML = `<p style="color:var(--accent-rose)">${this.esc(d.error)}</p>`; return; }
    const cols = d.tpl.columns;
    const fmt = (c, r) => c === 'date' ? new Date(String(r.date).replace(' ', 'T') + 'Z').toLocaleDateString('vi-VN')
      : d.columnDefs[c].money ? this.money(r[c]) : this.esc(r[c]);
    box.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px;color:var(--text-muted)">Template: <strong>${d.custom ? 'Riêng của khách hàng' : 'Mặc định'}</strong> • ${d.rows.length} đơn</div>
      <div class="table-responsive"><table class="data-table">
        <thead><tr>${cols.map(c => `<th>${d.columnDefs[c].label}</th>`).join('')}</tr></thead>
        <tbody>${d.rows.map(r => `<tr>${cols.map(c => `<td>${fmt(c, r)}</td>`).join('')}</tr>`).join('') ||
          `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--text-dim)">Không có công nợ</td></tr>`}</tbody>
      </table></div>
      <div style="margin-top:8px;font-weight:700">Tổng còn nợ: <span style="color:var(--accent-rose)">${this.money(d.totals.remaining)} đ</span></div>`;
  },

  // ---------- Template ----------
  async openTemplate() {
    const customerId = document.getElementById('rp-customer').value;
    const res = await fetch(`/api/reports/template/${customerId || 'DEFAULT'}`);
    const d = await res.json();
    this.tpl = d.tpl; this.columnDefs = d.columnDefs;
    const t = d.tpl, e = this.esc;
    const box = document.getElementById('rp-template-box');
    const custName = customerId ? e(document.getElementById('rp-customer').selectedOptions[0].textContent.split(' • nợ')[0]) : '';
    box.style.display = 'block';
    box.innerHTML = `
      <h3 style="font-size:14px;margin-bottom:10px">⚙️ Chỉnh Template Báo Cáo</h3>
      <div style="margin-bottom:10px">
        <label class="form-label">Áp dụng cho</label>
        <select class="form-control" id="tpl-scope" style="max-width:360px">
          <option value="DEFAULT">Mặc định (mọi khách hàng)</option>
          ${customerId ? `<option value="${customerId}" ${d.custom ? 'selected' : ''}>Riêng: ${custName}</option>` : ''}
        </select>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Chọn khách hàng ở trên rồi mở lại để tạo template riêng. Template riêng sẽ ghi đè mặc định.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="form-label">Tiêu đề báo cáo</label><input class="form-control" id="tpl-title" value="${e(t.title)}"></div>
        <div><label class="form-label">Hạn thanh toán (ngày, cho giấy đề nghị)</label><input type="number" class="form-control" id="tpl-days" value="${t.pr_deadline_days}"></div>
        <div style="grid-column:1/-1"><label class="form-label">Cột hiển thị</label><div style="display:flex;flex-wrap:wrap;gap:12px">
          ${Object.keys(this.columnDefs).map(c => `<label style="font-size:12px"><input type="checkbox" class="tpl-col" value="${c}" ${t.columns.includes(c) ? 'checked' : ''}> ${this.columnDefs[c].label}</label>`).join('')}
        </div></div>
        <div><label class="form-label">Ghi chú đầu bảng</label><textarea class="form-control" id="tpl-note" rows="2">${e(t.note)}</textarea></div>
        <div><label class="form-label">Lời dẫn giấy đề nghị thanh toán</label><textarea class="form-control" id="tpl-intro" rows="2">${e(t.pr_intro)}</textarea></div>
        <div><label class="form-label">Thông tin chuyển khoản</label><textarea class="form-control" id="tpl-bank" rows="3">${e(t.bank_info)}</textarea></div>
        <div><label class="form-label">Ghi chú cuối trang</label><textarea class="form-control" id="tpl-footer" rows="3">${e(t.footer_note)}</textarea></div>
        <div><label class="form-label">Chữ ký bên trái</label><input class="form-control" id="tpl-sigl" value="${e(t.signature_left)}"></div>
        <div><label class="form-label">Chữ ký bên phải</label><input class="form-control" id="tpl-sigr" value="${e(t.signature_right)}"></div>
        <label style="font-size:12px"><input type="checkbox" id="tpl-sig" ${t.show_signature ? 'checked' : ''}> Hiển thị khối chữ ký</label>
        <label style="font-size:12px"><input type="checkbox" id="tpl-paid" ${t.include_paid ? 'checked' : ''}> Mặc định gồm cả đơn đã thanh toán</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary btn-sm" id="tpl-save" onclick="Reports.saveTemplate()">💾 Lưu Template</button>
        ${d.custom ? `<button class="btn btn-secondary btn-sm" id="tpl-reset" onclick="Reports.resetTemplate('${customerId}')">↩️ Bỏ template riêng</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('rp-template-box').style.display='none'">Đóng</button>
      </div>`;
  },

  async saveTemplate() {
    const v = id => document.getElementById(id).value;
    const body = {
      title: v('tpl-title'), pr_deadline_days: Number(v('tpl-days')) || 0, note: v('tpl-note'),
      pr_intro: v('tpl-intro'), bank_info: v('tpl-bank'), footer_note: v('tpl-footer'),
      signature_left: v('tpl-sigl'), signature_right: v('tpl-sigr'),
      show_signature: document.getElementById('tpl-sig').checked,
      include_paid: document.getElementById('tpl-paid').checked,
      columns: [...document.querySelectorAll('.tpl-col:checked')].map(i => i.value),
    };
    if (!body.columns.length) { alert('Chọn ít nhất 1 cột'); return; }
    const res = await fetch(`/api/reports/template/${v('tpl-scope')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) { alert('Đã lưu template'); this.openTemplate(); }
  },

  async resetTemplate(id) {
    if (!confirm('Bỏ template riêng và dùng lại mặc định?')) return;
    await fetch(`/api/reports/template/${id}`, { method: 'DELETE' });
    this.openTemplate();
  },

  // ---------- VAT: xuất hóa đơn theo đơn hàng / theo bảng kê công nợ ----------
  vatRows: [],

  async loadVat() {
    const status = document.getElementById('vat-filter')?.value || 'pending';
    const cust = document.getElementById('vat-customer')?.value || '';
    const res = await fetch(`/api/reports/vat?status=${status}${cust ? '&customer_id=' + encodeURIComponent(cust) : ''}`);
    if (!res.ok) return;
    const d = await res.json();
    this.vatRows = d.rows;
    document.getElementById('vat-summary').textContent = `Đã xuất: ${d.summary.invoiced} đơn • Chưa xuất: ${d.summary.pending} đơn`;
    const e = this.esc;
    document.querySelector('#vat-table tbody').innerHTML = d.rows.map(r => {
      const done = !!r.vat_invoice_no;
      return `<tr>
        <td>${done ? '' : `<input type="checkbox" class="vat-sel" value="${r.id}">`}</td>
        <td><strong>${e(r.code)}</strong></td>
        <td>${e(r.customer_name)}</td>
        <td>${r.vat_rate}% • ${this.money(r.vat_amount)} đ<div style="font-size:11px;color:var(--text-dim)">Tổng ${this.money(r.total_selling)} đ</div></td>
        <td>${done ? `<span class="badge badge-paid">${e(r.vat_invoice_no)}</span>` : '<span class="badge badge-unpaid">Chưa xuất</span>'}</td>
        <td>${e(r.vat_invoiced_at || '')}</td>
        <td>${done
          ? `${r.vat_invoice_id ? `<button class="btn btn-secondary btn-sm" onclick="window.open('/api/reports/vat-invoices/${r.vat_invoice_id}/print','_blank')">🖨️ Bảng kê</button> <button class="btn btn-secondary btn-sm" onclick="Reports.cancelInvoice('${r.vat_invoice_id}')">Hủy HĐ</button>` : ''}`
          : `<button class="btn btn-primary btn-sm" onclick="Reports.issueOrder('${r.id}')">Xuất HĐ theo đơn</button>`}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">Không có đơn nào</td></tr>';
  },

  async createInvoice(payload) {
    const no = prompt('Nhập số hóa đơn VAT:');
    if (!no) return;
    const date = prompt('Ngày xuất hóa đơn (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!date) return;
    const res = await fetch('/api/reports/vat-invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, invoice_no: no, invoice_date: date }),
    });
    const d = await res.json();
    if (!res.ok) { alert(d.error || 'Xuất hóa đơn thất bại'); return; }
    this.loadVat();
    if (payload.mode === 'STATEMENT' && confirm('Đã ghi nhận hóa đơn. In bảng kê kèm theo?')) {
      window.open(`/api/reports/vat-invoices/${d.id}/print`, '_blank');
    }
  },

  issueOrder(orderId) {
    const r = this.vatRows.find(x => x.id === orderId);
    this.createInvoice({ mode: 'ORDER', customer_id: r.customer_id, order_ids: [orderId] });
  },

  issueStatement() {
    const ids = [...document.querySelectorAll('.vat-sel:checked')].map(i => i.value);
    if (!ids.length) { alert('Tích chọn các đơn (cùng một khách hàng) cần gộp vào bảng kê'); return; }
    const custs = new Set(ids.map(id => this.vatRows.find(x => x.id === id).customer_id));
    if (custs.size > 1) { alert('Các đơn được chọn phải cùng một khách hàng'); return; }
    this.createInvoice({ mode: 'STATEMENT', customer_id: [...custs][0], order_ids: ids });
  },

  async cancelInvoice(id) {
    if (!confirm('Hủy hóa đơn này? Các đơn liên quan sẽ trở lại trạng thái chưa xuất HĐ.')) return;
    await fetch(`/api/reports/vat-invoices/${id}`, { method: 'DELETE' });
    this.loadVat();
  },
};
