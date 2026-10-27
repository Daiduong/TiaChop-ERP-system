/**
 * TIA CHỚP ERP - PHÂN HỆ QUẢN TRỊ HỆ THỐNG
 * Người dùng & phân quyền • Thông tin mẫu in • Bảng giá vật tư
 */
window.Admin = {
  users: [],
  settings: {},
  prices: [],

  ROLE_INFO: {
    ADMIN: { label: '👑 Admin', cls: 'badge-producing', desc: 'Toàn quyền: Đơn hàng, Giá vốn, Lợi nhuận, Sổ quỹ, Quản trị hệ thống.' },
    SALES: { label: '💼 Sales', cls: 'badge-quote', desc: 'Tạo/sửa Báo giá & Đơn hàng, xem Khách hàng. ẨN HOÀN TOÀN giá vốn xưởng và lợi nhuận.' },
    ACCOUNTANT: { label: '📊 Kế toán', cls: 'badge-paid', desc: 'Dòng tiền, Thu chi, Công nợ, Xuất hoá đơn VAT.' },
    COORDINATOR: { label: '🏭 Điều phối', cls: 'badge-confirmed', desc: 'Xem quy cách in, giao việc xưởng (Nơi làm), cập nhật Giá làm & tiến độ sản xuất.' }
  },

  CATEGORY_LABEL: {
    BASE_SIZE: '📐 Khổ in', PRINT_RUN: '🖨️ Lượt in', PAPER: '📄 Giấy', FINISHING: '✂️ Gia công'
  },

  init() {
    document.querySelectorAll('#admin-subtabs .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchSub(btn.dataset.adminSub));
    });
    document.getElementById('user-role')?.addEventListener('change', e => this.showRoleDesc(e.target.value));
  },

  load() {
    this.loadUsers();
    this.loadSettings();
    this.loadPrices();
    this.runChecks(true);
    this.loadPriceHistory();
  },

  switchSub(sub) {
    document.querySelectorAll('#admin-subtabs .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.adminSub === sub));
    document.querySelectorAll('.admin-sub').forEach(el => { el.style.display = el.id === `admin-sub-${sub}` ? '' : 'none'; });
  },

  async api(url, method = 'GET', body) {
    const res = await fetch(`/api/admin${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi máy chủ');
    return data;
  },

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // ================= USERS =================
  async loadUsers() {
    this.users = await this.api('/users');
    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = this.users.map(u => {
      const r = this.ROLE_INFO[u.role] || { label: u.role, cls: 'badge-draft' };
      return `
        <tr>
          <td><strong>${this.esc(u.username)}</strong></td>
          <td>${this.esc(u.full_name)}</td>
          <td style="font-size:12px;">${this.esc(u.phone)}<div style="color:var(--text-dim);">${this.esc(u.email)}</div></td>
          <td><span class="badge ${r.cls}">${r.label}</span></td>
          <td>${u.is_active ? '<span class="badge badge-paid">Hoạt động</span>' : '<span class="badge badge-unpaid">Đã khoá</span>'}</td>
          <td style="font-size:12px; color:var(--text-dim);">${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="Admin.openUserModal('${u.id}')">✏️ Sửa</button>
              <button class="btn btn-secondary btn-sm" onclick="Admin.toggleUser('${u.id}')">${u.is_active ? '🔒 Khoá' : '🔓 Mở'}</button>
              <button class="btn btn-secondary btn-sm" style="color:var(--accent-rose);" onclick="Admin.deleteUser('${u.id}')">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  showRoleDesc(role) {
    const el = document.getElementById('user-role-desc');
    if (el) el.innerHTML = `<strong>Quyền hạn:</strong> ${this.ROLE_INFO[role]?.desc || ''}`;
  },

  openUserModal(id) {
    const u = this.users.find(x => x.id === id);
    document.getElementById('modal-user-title').textContent = u ? '✏️ Sửa Người Dùng' : '+ Thêm Người Dùng';
    document.getElementById('user-id').value = u?.id || '';
    const un = document.getElementById('user-username');
    un.value = u?.username || ''; un.disabled = !!u;
    document.getElementById('user-fullname').value = u?.full_name || '';
    document.getElementById('user-email').value = u?.email || '';
    document.getElementById('user-phone').value = u?.phone || '';
    document.getElementById('user-role').value = u?.role || 'SALES';
    document.getElementById('user-active').value = u ? String(u.is_active) : '1';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password-label').textContent = u ? 'Đổi mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu *';
    this.showRoleDesc(u?.role || 'SALES');
    document.getElementById('modal-user').classList.add('active');
  },

  async saveUser() {
    const id = document.getElementById('user-id').value;
    const payload = {
      username: document.getElementById('user-username').value.trim(),
      full_name: document.getElementById('user-fullname').value.trim(),
      email: document.getElementById('user-email').value.trim(),
      phone: document.getElementById('user-phone').value.trim(),
      role: document.getElementById('user-role').value,
      is_active: document.getElementById('user-active').value === '1',
      password: document.getElementById('user-password').value
    };
    if (!payload.full_name || (!id && !payload.username)) return alert('Vui lòng nhập tên đăng nhập và họ tên!');
    if ((!id || payload.password) && payload.password.length < 6) return alert('Mật khẩu tối thiểu 6 ký tự!');
    try {
      if (id) await this.api(`/users/${id}`, 'PUT', payload);
      else await this.api('/users', 'POST', payload);
      App.closeModals();
      this.loadUsers();
    } catch (e) { alert(e.message); }
  },

  async toggleUser(id) {
    const u = this.users.find(x => x.id === id);
    try { await this.api(`/users/${id}`, 'PUT', { is_active: !u.is_active }); this.loadUsers(); }
    catch (e) { alert(e.message); }
  },

  async deleteUser(id) {
    const u = this.users.find(x => x.id === id);
    if (!confirm(`Xoá người dùng "${u.full_name}"?`)) return;
    try { await this.api(`/users/${id}`, 'DELETE'); this.loadUsers(); }
    catch (e) { alert(e.message); }
  },

  // ================= SETTINGS / MẪU IN =================
  async loadSettings() {
    this.settings = await this.api('/settings');
    const form = document.getElementById('admin-settings-form');
    if (!form) return;
    Object.entries(this.settings).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v; });
    this.renderTemplatePreview();
  },

  readForm() {
    const form = document.getElementById('admin-settings-form');
    const out = {};
    Array.from(form.elements).forEach(el => { if (el.name) out[el.name] = el.value; });
    return out;
  },

  async saveSettings() {
    try {
      const data = this.readForm();
      await this.api('/settings', 'PUT', data);
      this.settings = { ...this.settings, ...data };
      alert('Đã lưu thông tin mẫu in! Các phiếu Báo giá / Lệnh xưởng sẽ dùng thông tin mới.');
    } catch (e) { alert(e.message); }
  },

  renderTemplatePreview() {
    const el = document.getElementById('admin-template-preview');
    if (!el) return;
    const S = this.readForm();
    const C = S.primary_color || '#0284c7';
    const e = v => this.esc(v);
    const lines = t => (t || '').split('\n').filter(Boolean).map(l => `<div>• ${e(l)}</div>`).join('');
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; border-bottom:2px solid ${C}; padding-bottom:10px; margin-bottom:12px;">
        <div style="display:flex; gap:10px; align-items:center;">
          <img src="/assets/logo.png" style="height:40px;">
          <div>
            <div style="font-size:14px; font-weight:800; color:${C};">${e(S.company_name)}</div>
            <div style="color:#555;">${e(S.company_slogan)}</div>
            <div style="color:#555;">Hotline: ${e(S.company_hotline)} • ${e(S.company_email)}</div>
            ${S.company_address ? `<div style="color:#555;">${e(S.company_address)}${S.company_tax_code ? ' • MST: ' + e(S.company_tax_code) : ''}</div>` : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800; color:${C};">PHIẾU BÁO GIÁ</div>
          <div>Mã: <strong>BG_XXXX</strong></div>
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
        <tr style="background:#f1f5f9;"><th style="border:1px solid #ddd; padding:4px; text-align:left;">Ấn phẩm</th><th style="border:1px solid #ddd; padding:4px;">SL</th><th style="border:1px solid #ddd; padding:4px; text-align:right;">Thành tiền</th></tr>
        <tr><td style="border:1px solid #ddd; padding:4px;">Namecard C300 cán mờ</td><td style="border:1px solid #ddd; padding:4px; text-align:center;">10</td><td style="border:1px solid #ddd; padding:4px; text-align:right;">850.000</td></tr>
      </table>
      <div><strong>Điều khoản:</strong></div>
      ${lines(S.quote_terms)}
      <div>• Tài khoản: <strong>${e(S.bank_name)} ${e(S.bank_account)} - ${e(S.bank_holder)}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-top:16px; text-align:center;">
        <div><strong>${e(S.sign_customer_label)}</strong><div style="color:#888; margin-top:24px;">(Ký & ghi rõ họ tên)</div></div>
        <div><strong>${e(S.sign_company_label)}</strong><div style="color:#888; margin-top:24px;">${e(S.sign_company_name)}</div></div>
      </div>`;
  },

  // ================= BẢNG GIÁ =================
  async loadPrices() {
    this.prices = await this.api('/price-configs');
    document.getElementById('admin-prices-tbody').innerHTML = this.prices.map(p => `
      <tr data-id="${p.id}">
        <td>${this.CATEGORY_LABEL[p.category] || p.category}</td>
        <td><code style="font-size:11px; color:var(--text-dim);">${this.esc(p.code)}</code></td>
        <td><input class="form-control price-name" value="${this.esc(p.name)}" style="min-width:240px;"></td>
        <td><input type="number" min="0" step="50" class="form-control price-cost" value="${p.base_cost}" style="width:130px;" ${p.category === 'BASE_SIZE' ? 'disabled' : ''}></td>
        <td><input class="form-control price-unit" value="${this.esc(p.unit)}" style="width:110px;"></td>
      </tr>`).join('');
  },

  // Gom các đơn giá đang sửa trên bảng (chưa lưu): { CODE: giá mới }
  collectChanges() {
    const changes = {};
    document.querySelectorAll('#admin-prices-tbody tr').forEach(r => {
      const orig = this.prices.find(p => p.id === r.dataset.id);
      const input = r.querySelector('.price-cost');
      if (!orig || input.disabled) return;
      const v = Number(input.value) || 0;
      if (v !== orig.base_cost) changes[orig.code] = v;
    });
    return changes;
  },

  statusBadge(s) {
    const m = {
      OK: ['badge-paid', '✅ ĐÚNG'],
      LECH: ['badge-unpaid', '⚠️ LỆCH'],
      LOI: ['badge-unpaid', '❌ LỖI'],
      CHUA_CHUAN: ['badge-draft', '❓ CHƯA CÓ CHUẨN']
    }[s] || ['badge-draft', s];
    return `<span class="badge ${m[0]}">${m[1]}</span>`;
  },

  fmtMoney(n) { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('vi-VN'); },
  fmtDiff(n, pct) {
    if (n === null || n === undefined) return '—';
    const color = n === 0 ? 'var(--text-dim)' : (n > 0 ? 'var(--accent-amber)' : 'var(--accent-rose)');
    return `<span style="color:${color};">${n > 0 ? '+' : ''}${this.fmtMoney(n)}${pct !== null && pct !== undefined ? ` (${n > 0 ? '+' : ''}${pct}%)` : ''}</span>`;
  },

  // Xem trước tác động của các thay đổi chưa lưu lên các ca kiểm tra
  async previewImpact() {
    const changes = this.collectChanges();
    const panel = document.getElementById('admin-sub-prices-impact');
    const box = document.getElementById('admin-price-impact');
    if (!Object.keys(changes).length) {
      panel.style.display = '';
      box.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Chưa có đơn giá nào được thay đổi.</p>';
      return null;
    }
    try {
      const rows = await this.api('/price-checks/simulate', 'POST', { changes });
      const changedList = Object.entries(changes).map(([code, v]) => {
        const p = this.prices.find(x => x.code === code);
        return `<div>• <strong>${this.esc(p?.name || code)}</strong>: ${this.fmtMoney(p?.base_cost)} → <strong>${this.fmtMoney(v)}</strong></div>`;
      }).join('');
      const newlyBad = rows.filter(r => r.status === 'OK' && r.sim_status !== 'OK');
      box.innerHTML = `
        <div style="font-size:12px; margin-bottom:10px;">${changedList}</div>
        ${rows.length ? `<div class="table-responsive"><table class="data-table">
          <thead><tr><th>Ca kiểm tra</th><th>Giá chuẩn</th><th>Giá hiện tại</th><th>Giá sau khi đổi</th><th>Thay đổi</th><th>Kết quả sau đổi</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${this.esc(r.name)}</td>
            <td>${this.fmtMoney(r.expected)}</td>
            <td>${this.fmtMoney(r.price)}</td>
            <td><strong>${this.fmtMoney(r.sim_price)}</strong>${r.sim_error ? `<div style="color:var(--accent-rose); font-size:11px;">${this.esc(r.sim_error)}</div>` : ''}</td>
            <td>${this.fmtDiff(r.sim_change, r.sim_change_pct)}</td>
            <td>${this.statusBadge(r.sim_status)}</td>
          </tr>`).join('')}</tbody></table></div>`
          : '<p style="color:var(--text-muted); font-size:13px;">Chưa có ca kiểm tra nào để đối chiếu.</p>'}
        ${newlyBad.length ? `<p style="margin-top:10px; color:var(--accent-rose); font-weight:600;">⚠️ ${newlyBad.length} ca sẽ lệch khỏi giá chuẩn nếu lưu thay đổi này.</p>` : ''}`;
      panel.style.display = '';
      return { rows, newlyBad };
    } catch (e) { alert(e.message); return null; }
  },

  async savePrices() {
    const rows = document.querySelectorAll('#admin-prices-tbody tr');
    try {
      // Cảnh báo nếu thay đổi làm lệch các ca đang đúng
      const impact = Object.keys(this.collectChanges()).length ? await this.previewImpact() : null;
      if (impact && impact.newlyBad.length &&
          !confirm(`${impact.newlyBad.length} ca kiểm tra sẽ bị LỆCH khỏi giá chuẩn:\n- ${impact.newlyBad.map(r => r.name).join('\n- ')}\n\nVẫn lưu bảng giá?`)) return;
      for (const r of rows) {
        const orig = this.prices.find(p => p.id === r.dataset.id);
        const body = {
          name: r.querySelector('.price-name').value,
          base_cost: Number(r.querySelector('.price-cost').value) || 0,
          unit: r.querySelector('.price-unit').value
        };
        if (body.name !== orig.name || body.base_cost !== orig.base_cost || body.unit !== orig.unit) {
          await this.api(`/price-configs/${orig.id}`, 'PUT', body);
        }
      }
      await this.loadPrices();
      await this.runChecks(true);
      alert('Đã lưu bảng giá! Bộ Tính Giá sẽ áp dụng đơn giá mới ngay. Xem kết quả đối chiếu tại tab "Kiểm Tra & Lịch Sử Giá".');
    } catch (e) { alert(e.message); }
  },

  // ================= KIỂM TRA & LỊCH SỬ GIÁ =================
  async runChecks(silent) {
    try {
      const rows = await this.api('/price-checks/run');
      this.checks = rows;
      const bad = rows.filter(r => r.status === 'LECH' || r.status === 'LOI');
      const unset = rows.filter(r => r.status === 'CHUA_CHUAN');
      document.getElementById('admin-check-summary').innerHTML = rows.length
        ? `<strong>${rows.length - bad.length - unset.length}/${rows.length}</strong> ca đúng` +
          (bad.length ? ` · <span style="color:var(--accent-rose); font-weight:700;">${bad.length} ca lệch/lỗi — cần kiểm tra lại bảng giá hoặc công thức</span>` : ' · <span style="color:var(--accent-green);">toàn bộ khớp giá chuẩn ✅</span>') +
          (unset.length ? ` · ${unset.length} ca chưa có giá chuẩn` : '')
        : 'Chưa có ca kiểm tra nào.';
      document.getElementById('admin-checks-tbody').innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
          <td><strong>${this.esc(r.name)}</strong>${r.note ? `<div style="font-size:11px; color:var(--text-dim);">${this.esc(r.note)}</div>` : ''}</td>
          <td style="font-size:12px;">${this.esc(r.group || '')}</td>
          <td><input type="number" class="form-control chk-expected" value="${r.expected ?? ''}" style="width:120px;"></td>
          <td><input type="number" step="0.5" min="0" class="form-control chk-tol" value="${r.tolerance_pct ?? 2}" style="width:70px;"></td>
          <td>${r.error ? `<span style="color:var(--accent-rose); font-size:12px;">${this.esc(r.error)}</span>` : `<strong>${this.fmtMoney(r.price)}</strong>`}</td>
          <td>${this.fmtDiff(r.diff, r.diff_pct)}</td>
          <td>${this.statusBadge(r.status)}</td>
          <td><div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="Admin.saveCheck('${r.id}')" title="Lưu giá chuẩn / dung sai">💾</button>
            <button class="btn btn-secondary btn-sm" onclick="Admin.acceptCheck('${r.id}')" title="Chấp nhận giá hệ thống làm giá chuẩn mới">✔ Nhận giá HT</button>
            <button class="btn btn-secondary btn-sm" style="color:var(--accent-rose);" onclick="Admin.deleteCheck('${r.id}')">🗑️</button>
          </div></td>
        </tr>`).join('');
      if (!silent && bad.length) alert(`⚠️ ${bad.length} ca kiểm tra lệch giá chuẩn!`);
    } catch (e) { alert(e.message); }
  },

  async saveCheck(id) {
    const tr = document.querySelector(`#admin-checks-tbody tr[data-id="${id}"]`);
    try {
      await this.api(`/price-checks/${id}`, 'PUT', {
        expected_price: tr.querySelector('.chk-expected').value,
        tolerance_pct: tr.querySelector('.chk-tol').value
      });
      await this.runChecks(true);
    } catch (e) { alert(e.message); }
  },

  async acceptCheck(id) {
    if (!confirm('Đặt giá hệ thống hiện tại làm giá chuẩn mới? Chỉ làm khi bạn đã đối chiếu và xác nhận giá này đúng.')) return;
    try { await this.api(`/price-checks/${id}/accept`, 'POST'); await this.runChecks(true); }
    catch (e) { alert(e.message); }
  },

  async deleteCheck(id) {
    if (!confirm('Xoá ca kiểm tra này?')) return;
    try { await this.api(`/price-checks/${id}`, 'DELETE'); await this.runChecks(true); }
    catch (e) { alert(e.message); }
  },

  // Lưu cấu hình đang tính ở tab Tính Giá thành một ca kiểm tra
  async saveCheckFromPricing() {
    const input = App.collectPricingInput();
    const calc = App.state.currentPricingCalc;
    if (!calc) return alert('Chưa có kết quả tính giá hợp lệ để lưu.');
    const name = prompt('Tên ca kiểm tra:', `${input.productName} - SL ${input.quantity}`);
    if (!name) return;
    const raw = prompt(`Giá bán CHUẨN (đ) đã đối chiếu tính tay/báo giá xưởng.\nĐể trống = dùng giá hệ thống hiện tại (${this.fmtMoney(calc.suggestedSellingPrice)}):`, '');
    if (raw === null) return;
    const expected = raw.replace(/[^\d]/g, '');
    try {
      await this.api('/price-checks', 'POST', { name, input, expected_price: expected === '' ? undefined : Number(expected) });
      alert('Đã thêm ca kiểm tra! Xem tại Quản Trị → Kiểm Tra & Lịch Sử Giá.');
    } catch (e) { alert(e.message); }
  },

  async loadPriceHistory() {
    try {
      const rows = await this.api('/price-history?limit=100');
      document.getElementById('admin-price-history-tbody').innerHTML = rows.length ? rows.map(h => {
        const d = (h.new_cost ?? 0) - (h.old_cost ?? 0);
        const unitChanged = h.old_unit !== h.new_unit;
        return `<tr>
          <td style="font-size:12px;">${new Date(h.changed_at + 'Z').toLocaleString('vi-VN')}</td>
          <td>${this.esc(h.changed_by)}</td>
          <td>${this.esc(h.name)}<div><code style="font-size:11px; color:var(--text-dim);">${this.esc(h.code)}</code></div></td>
          <td>${this.fmtMoney(h.old_cost)}${unitChanged ? ` <small>${this.esc(h.old_unit)}</small>` : ''}</td>
          <td><strong>${this.fmtMoney(h.new_cost)}</strong>${unitChanged ? ` <small>${this.esc(h.new_unit)}</small>` : ''}</td>
          <td>${this.fmtDiff(d, h.old_cost ? Math.round(d / h.old_cost * 1000) / 10 : null)}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" style="color:var(--text-muted);">Chưa có thay đổi nào.</td></tr>';
    } catch (e) { alert(e.message); }
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Admin.init());
else Admin.init();
