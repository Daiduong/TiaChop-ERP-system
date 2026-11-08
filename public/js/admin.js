/**
 * TIA CHỚP ERP - PHÂN HỆ QUẢN TRỊ HỆ THỐNG
 * Người dùng & phân quyền • Thông tin mẫu in • Bảng giá vật tư
 */
window.Admin = {
  users: [],
  settings: {},
  prices: [],
  papers: [],
  currentPaperTypeFilter: 'ALL',
  paperSearchQuery: '',

  ROLE_INFO: {
    ADMIN: { label: '👑 Admin', cls: 'badge-producing', desc: 'Toàn quyền: Đơn hàng, Giá vốn, Lợi nhuận, Sổ quỹ, Quản trị hệ thống.' },
    SALES: { label: '💼 Sales', cls: 'badge-quote', desc: 'Tạo/sửa Báo giá & Đơn hàng, xem Khách hàng. ẨN HOÀN TOÀN giá vốn xưởng và lợi nhuận.' },
    ACCOUNTANT: { label: '📊 Kế toán', cls: 'badge-paid', desc: 'Dòng tiền, Thu chi, Công nợ, Xuất hoá đơn VAT.' },
    COORDINATOR: { label: '🏭 Điều phối', cls: 'badge-confirmed', desc: 'Xem quy cách in, giao việc xưởng (Nơi làm), cập nhật Giá làm & tiến độ sản xuất.' }
  },

  CATEGORY_LABEL: {
    BASE_SIZE: '📐 Khổ in',
    PRINT_RUN: '🖨️ Lượt in',
    PAPER: '📄 Giấy',
    FINISHING: '✂️ Gia công',
    DOCUMENT: '📚 Đóng cuốn tài liệu',
    SHIPPING: '🚚 Vận chuyển & Giao hàng',
    GENERAL: '⚙️ Chung & Phân bổ',
    DIGITAL: '🖨️ KTS Thông số',
    OFFSET: '🏭 Offset Thông số',
    LARGE_FORMAT: '🪧 Bạt/Quảng cáo'
  },

  init() {
    document.querySelectorAll('#admin-subtabs .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchSub(btn.dataset.adminSub));
    });
    document.getElementById('user-role')?.addEventListener('change', e => this.showRoleDesc(e.target.value));
  },

  load() {
    this.loadUsers();
    this.loadPapers();
    this.loadPresets();
    this.loadSettings();
    this.loadPrices();
    this.runChecks(true);
    this.loadPriceHistory();
    this.loadDbInfo();
  },

  switchSub(sub) {
    document.querySelectorAll('#admin-subtabs .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.adminSub === sub));
    document.querySelectorAll('.admin-sub').forEach(el => { el.style.display = el.id === `admin-sub-${sub}` ? '' : 'none'; });
    if (sub === 'backup') this.loadDbInfo();
    if (sub === 'presets') this.loadPresets();
    if (sub === 'papers') this.loadPapers();
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
            <div style="color:#111;font-weight:700;">${e(S.company_slogan)}</div>
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
    document.getElementById('admin-prices-tbody').innerHTML = this.prices.map(p => {
      const isBaseSizeOrPct = p.category === 'BASE_SIZE' || p.unit === '%';
      const cost = Number(p.base_cost) || 0;
      // Giá bán gợi ý với Margin 40%: Giá bán = Giá vốn / (1 - 0.4)
      const sellingSuggested = isBaseSizeOrPct || cost <= 0 ? '—' : Math.round(cost / 0.6).toLocaleString('vi-VN') + ' đ';
      return `
      <tr data-id="${p.id}">
        <td><span class="badge ${p.category === 'DOCUMENT' ? 'badge-producing' : 'badge-draft'}">${this.CATEGORY_LABEL[p.category] || p.category}</span></td>
        <td><code style="font-size:11px; color:var(--text-dim);">${this.esc(p.code)}</code></td>
        <td><input class="form-control price-name" value="${this.esc(p.name)}" style="min-width:240px;"></td>
        <td><input type="number" min="0" step="50" class="form-control price-cost" value="${p.base_cost}" style="width:130px;" ${p.category === 'BASE_SIZE' ? 'disabled' : ''} oninput="Admin.updateRowSellingPrice(this)"></td>
        <td><input class="form-control price-unit" value="${this.esc(p.unit)}" style="width:110px;"></td>
        <td style="text-align:right; font-weight:600; color:var(--accent-green);" class="row-selling-price">${sellingSuggested}</td>
      </tr>`;
    }).join('');
  },

  updateRowSellingPrice(inputEl) {
    const tr = inputEl.closest('tr');
    if (!tr) return;
    const cost = Number(inputEl.value) || 0;
    const targetTd = tr.querySelector('.row-selling-price');
    if (targetTd) {
      targetTd.textContent = cost > 0 ? Math.round(cost / 0.6).toLocaleString('vi-VN') + ' đ' : '—';
    }
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
        ? `<strong>${rows.length - bad.length - unset.length}/${rows.length}</strong> ca đúng giá mua NCC` +
          (bad.length ? ` · <span style="color:var(--accent-rose); font-weight:700;">${bad.length} ca lệch giá vốn NCC — cần kiểm tra lại đơn giá vật tư hoặc cập nhật lại giá chuẩn</span>` : ' · <span style="color:var(--accent-green);">toàn bộ khớp giá mua NCC chuẩn ✅</span>') +
          (unset.length ? ` · ${unset.length} ca chưa có giá chuẩn` : '')
        : 'Chưa có ca kiểm tra nào.';
      document.getElementById('admin-checks-tbody').innerHTML = rows.map(r => {
        const hasExpectedCost = (r.expected_cost !== null && r.expected_cost !== undefined);
        const targetExpected = hasExpectedCost ? r.expected_cost : r.expected;
        const diffVal = hasExpectedCost ? r.cost_diff : r.diff;
        const diffPct = hasExpectedCost ? r.cost_diff_pct : r.diff_pct;

        return `
        <tr data-id="${r.id}">
          <td><strong>${this.esc(r.name)}</strong>${r.note ? `<div style="font-size:11px; color:var(--text-dim);">${this.esc(r.note)}</div>` : ''}</td>
          <td style="font-size:12px;">${this.esc(r.group || '')}</td>
          <td>
            <input type="number" class="form-control chk-expected-cost" value="${targetExpected ?? ''}" style="width:130px; font-weight:600; color:var(--accent-amber);" title="Giá vốn / giá mua từ xưởng">
          </td>
          <td><input type="number" step="0.5" min="0" class="form-control chk-tol" value="${r.tolerance_pct ?? 2}" style="width:65px;"></td>
          <td>${r.error ? `<span style="color:var(--accent-rose); font-size:12px;">${this.esc(r.error)}</span>` : `<strong style="color:var(--text-main);">${this.fmtMoney(r.cost)}</strong>`}</td>
          <td>${this.fmtDiff(diffVal, diffPct)}</td>
          <td style="color:var(--primary-light); font-weight:600;">${this.fmtMoney(r.price)}</td>
          <td>${this.statusBadge(r.status)}</td>
          <td><div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="Admin.saveCheck('${r.id}')" title="Lưu giá mua NCC chuẩn">💾 Lưu</button>
            <button class="btn btn-secondary btn-sm" onclick="Admin.acceptCheck('${r.id}')" title="Nhận giá vốn hệ thống làm giá mua chuẩn mới">✔ Nhận vốn HT</button>
            <button class="btn btn-secondary btn-sm" style="color:var(--accent-rose);" onclick="Admin.deleteCheck('${r.id}')">🗑️</button>
          </div></td>
        </tr>`;
      }).join('');
      if (!silent && bad.length) alert(`⚠️ ${bad.length} ca kiểm tra lệch giá mua từ Nhà Cung Cấp!`);
    } catch (e) { alert(e.message); }
  },

  async saveCheck(id) {
    const tr = document.querySelector(`#admin-checks-tbody tr[data-id="${id}"]`);
    try {
      const costVal = tr.querySelector('.chk-expected-cost').value;
      await this.api(`/price-checks/${id}`, 'PUT', {
        expected_cost: costVal,
        expected_price: costVal ? Math.round(Number(costVal) / 0.6) : null,
        tolerance_pct: tr.querySelector('.chk-tol').value
      });
      await this.runChecks(true);
      alert('Đã cập nhật giá mua NCC chuẩn cho ca kiểm tra!');
    } catch (e) { alert(e.message); }
  },

  async acceptCheck(id) {
    if (!confirm('Đặt giá vốn xưởng hệ thống hiện tại làm giá mua NCC chuẩn mới? Chỉ làm khi bạn đã đối chiếu hóa đơn/báo giá xưởng thực tế.')) return;
    try {
      await this.api(`/price-checks/${id}/accept`, 'POST');
      await this.runChecks(true);
      alert('Đã nhận giá vốn hệ thống làm giá mua chuẩn!');
    } catch (e) { alert(e.message); }
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
    const raw = prompt(`Giá mua / Giá vốn xưởng CHUẨN từ NCC (đ):\nĐể trống = dùng giá vốn hệ thống hiện tại (${this.fmtMoney(calc.totalCost)}):`, '');
    if (raw === null) return;
    const expectedCost = raw.replace(/[^\d]/g, '');
    try {
      await this.api('/price-checks', 'POST', {
        name,
        input,
        expected_cost: expectedCost === '' ? calc.totalCost : Number(expectedCost),
        expected_price: calc.suggestedSellingPrice
      });
      alert('Đã thêm ca kiểm tra so sánh giá mua NCC! Xem tại Quản Trị → Kiểm Tra & Lịch Sử Giá.');
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
  },

  // ==========================================
  // SAO LƯU & KHÔI PHỤC CƠ SỞ DỮ LIỆU (BACKUP & RESTORE)
  // ==========================================
  async loadDbInfo() {
    const el = document.getElementById('admin-db-info');
    if (!el) return;
    try {
      const res = await fetch('/api/admin/backup/info');
      if (!res.ok) throw new Error('Không thể lấy thông tin database');
      const data = await res.json();
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span>Dung lượng Database:</span>
          <strong>${data.database_size_mb} MB (${Number(data.database_size_bytes).toLocaleString()} bytes)</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span>Lần sửa đổi gần nhất:</span>
          <strong>${new Date(data.last_modified).toLocaleString('vi-VN')}</strong>
        </div>
        <div style="margin-top:8px; padding-top:6px; border-top:1px dashed var(--border-subtle); display:flex; gap:12px; flex-wrap:wrap;">
          <span>📦 Đơn hàng: <strong>${data.table_counts.orders}</strong></span>
          <span>👥 Khách hàng: <strong>${data.table_counts.customers}</strong></span>
          <span>🏭 Xưởng in: <strong>${data.table_counts.suppliers}</strong></span>
          <span>👤 Người dùng: <strong>${data.table_counts.users}</strong></span>
          <span>💰 Thu chi: <strong>${data.table_counts.transactions}</strong></span>
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<span style="color:var(--accent-rose);">Lỗi kết nối cơ sở dữ liệu: ${err.message}</span>`;
    }
  },

  downloadBackup() {
    window.location.href = '/api/admin/backup/download';
  },

  async restoreBackup() {
    const fileInput = document.getElementById('admin-restore-file');
    if (!fileInput || !fileInput.files.length) {
      return alert('Vui lòng chọn file sao lưu (.db) cần khôi phục!');
    }

    const file = fileInput.files[0];
    if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite') && !file.name.endsWith('.sqlite3')) {
      return alert('File đã chọn không phải là cơ sở dữ liệu SQLite (.db)!');
    }

    if (!confirm(`⚠️ XÁC NHẬN KHÔI PHỤC DỮ LIỆU?\n\nBạn đang chuẩn bị khôi phục từ file: [${file.name}]\n\nHệ thống sẽ tự động tạo một bản dự phòng tức thời trước khi thay thế. Bạn có chắc chắn muốn tiếp tục không?`)) {
      return;
    }

    try {
      const btn = event?.target;
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang khôi phục...'; }

      const arrayBuffer = await file.arrayBuffer();

      const res = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arrayBuffer
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khôi phục');

      alert(`✅ ${data.message}\nĐã khôi phục thành công ${data.table_count} bảng dữ liệu! Trang web sẽ được tải lại.`);
      window.location.reload();
    } catch (err) {
      alert('Lỗi khôi phục: ' + err.message);
    } finally {
      const btn = document.querySelector('#admin-sub-backup .btn-accent');
      if (btn) { btn.disabled = false; btn.textContent = '⚡ TIẾN HÀNH KHÔI PHỤC DỮ LIỆU'; }
    }
  },

  // ==========================================
  // QUẢN LÝ SẢN PHẨM MẪU (PRESETS)
  // ==========================================
  presets: [],
  presetFilterGroup: 'ALL',
  presetSearchQuery: '',

  async loadPresets() {
    try {
      const res = await fetch('/api/presets');
      if (!res.ok) throw new Error('Không thể tải danh sách sản phẩm mẫu');
      this.presets = await res.json();
      this.renderPresets();
    } catch (err) {
      console.error('Lỗi nạp presets:', err);
    }
  },

  filterPresetGroup(group) {
    this.presetFilterGroup = group;
    document.querySelectorAll('#preset-group-filters .filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.presetGroup === group);
    });
    this.renderPresets();
  },

  searchPresets(query) {
    this.presetSearchQuery = (query || '').toLowerCase().trim();
    this.renderPresets();
  },

  renderPresets() {
    const tbody = document.getElementById('admin-presets-tbody');
    if (!tbody) return;

    let list = this.presets || [];
    if (this.presetFilterGroup !== 'ALL') {
      list = list.filter(p => p.group_type === this.presetFilterGroup);
    }
    if (this.presetSearchQuery) {
      list = list.filter(p =>
        (p.name && p.name.toLowerCase().includes(this.presetSearchQuery)) ||
        (p.code && p.code.toLowerCase().includes(this.presetSearchQuery)) ||
        (p.description && p.description.toLowerCase().includes(this.presetSearchQuery))
      );
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">Không có sản phẩm mẫu nào phù hợp.</td></tr>`;
      return;
    }

    const groupBadges = {
      DIGITAL: '<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);">🖨️ KTS</span>',
      OFFSET: '<span class="badge" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3);">🏭 Offset</span>',
      LARGE_FORMAT: '<span class="badge" style="background:rgba(234,179,8,0.15); color:#facc15; border:1px solid rgba(234,179,8,0.3);">🪧 Quảng Cáo</span>',
      DOCUMENT_SPIRAL: '<span class="badge" style="background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3);">📚 Lò Xo</span>'
    };

    tbody.innerHTML = list.map(p => {
      const sizeStr = (p.width && p.height) ? `${p.width} × ${p.height} mm` : (p.config?.size || 'Tiêu chuẩn');
      let specStr = '';
      const cfg = p.config || {};
      if (p.group_type === 'DIGITAL') {
        const parts = [];
        if (cfg.paper) parts.push(`Giấy: ${cfg.paper}`);
        if (cfg.printSides) parts.push(`In ${cfg.printSides} mặt`);
        if (cfg.lamination && cfg.lamination !== 'NONE') parts.push(`Màng: ${cfg.lamination}`);
        if (cfg.finishing && cfg.finishing.length) parts.push(`Gia công: ${cfg.finishing.join(', ')}`);
        specStr = parts.join(' • ');
      } else if (p.group_type === 'OFFSET') {
        if (cfg.table) {
          specStr = `Ghép bài: <b>${cfg.table}</b> (Biến thể: ${cfg.def || 'Chuẩn'})`;
        } else {
          specStr = `Khổ tờ: ${cfg.sheetSize || ''} • Giấy: ${cfg.paperType || ''} ${cfg.gsm || ''}gsm`;
        }
      } else if (p.group_type === 'LARGE_FORMAT') {
        specStr = `Vật liệu: <b>${cfg.material || 'HIFLEX'}</b>${cfg.finishing ? ' • ' + cfg.finishing.join(', ') : ''}`;
      } else if (p.group_type === 'DOCUMENT_SPIRAL') {
        specStr = `Khổ: ${cfg.size || 'A5'} • ${cfg.pages || 0} trang • ${cfg.ruotPrint || ''} • Gói: ${cfg.bindingPackage || ''}`;
      }

      return `
        <tr>
          <td><code style="font-size:11px; font-weight:700; color:var(--text-primary);">${p.code}</code></td>
          <td>${groupBadges[p.group_type] || p.group_type}</td>
          <td>
            <div style="font-weight:600; color:var(--text-primary);">${p.name}</div>
            ${p.description ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${p.description}</div>` : ''}
          </td>
          <td>${sizeStr}</td>
          <td><b>${(p.quantity || 1).toLocaleString('vi-VN')}</b></td>
          <td>${p.unit || 'cái'}</td>
          <td style="font-size:12px; color:var(--text-secondary); max-width:260px;">${specStr}</td>
          <td style="text-align: center; white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:11px; margin-right:4px;" onclick="Admin.usePresetInPricing('${p.id}')" title="Đưa vào bộ tính giá">⚡ Tính Giá</button>
            <button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:11px; margin-right:4px;" onclick="Admin.openPresetModal('${p.id}')" title="Chỉnh sửa">✏️</button>
            <button class="btn btn-danger btn-sm" style="padding:2px 6px; font-size:11px;" onclick="Admin.deletePreset('${p.id}', '${p.name.replace(/'/g, "\\'")}')" title="Xóa">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  usePresetInPricing(presetId) {
    const p = this.presets.find(x => x.id === presetId);
    if (!p) return;
    // Chuyển sang tab Tính giá
    if (window.App && window.App.switchTab) {
      window.App.switchTab('pricing');
      if (window.App.state.pricingGroup !== p.group_type) {
        window.App.setPricingGroup(p.group_type);
      }
      setTimeout(() => {
        const sel = document.getElementById('calc-preset');
        if (sel) {
          sel.value = p.code;
          window.App.applyPricingPreset(p);
          window.App.triggerPricingCalculation();
        }
      }, 100);
    }
  },

  onPresetGroupChange(group) {
    document.querySelectorAll('.preset-tech-fields').forEach(el => el.style.display = 'none');
    const pcsGroup = document.getElementById('fg-preset-pcs');
    if (pcsGroup) pcsGroup.style.display = group === 'DIGITAL' ? '' : 'none';

    if (group === 'DIGITAL') document.getElementById('preset-tech-digital').style.display = '';
    else if (group === 'OFFSET') document.getElementById('preset-tech-offset').style.display = '';
    else if (group === 'LARGE_FORMAT') document.getElementById('preset-tech-large').style.display = '';
    else if (group === 'DOCUMENT_SPIRAL') document.getElementById('preset-tech-doc').style.display = '';
  },

  onOffsetPresetTableChange(val) {
    const fg = document.getElementById('fg-preset-off-variants');
    if (fg) fg.style.display = val ? '' : 'none';
  },

  openPresetModal(id = null) {
    const isEdit = !!id;
    document.getElementById('modal-preset-title').textContent = isEdit ? '✏️ Chỉnh Sửa Sản Phẩm Mẫu' : '+ Thêm Sản Phẩm Mẫu Mới';
    document.getElementById('preset-id').value = id || '';

    const groupEl = document.getElementById('preset-group');
    const codeEl = document.getElementById('preset-code');
    const nameEl = document.getElementById('preset-name');
    const descEl = document.getElementById('preset-desc');
    const wEl = document.getElementById('preset-width');
    const hEl = document.getElementById('preset-height');
    const qtyEl = document.getElementById('preset-quantity');
    const unitEl = document.getElementById('preset-unit');
    const pcsEl = document.getElementById('preset-pcs');
    const sortEl = document.getElementById('preset-sort');
    const activeEl = document.getElementById('preset-active');

    if (isEdit) {
      const p = this.presets.find(x => x.id === id);
      if (!p) return;
      groupEl.value = p.group_type;
      groupEl.disabled = true; // không đổi nhóm khi edit
      codeEl.value = p.code;
      codeEl.disabled = true;
      nameEl.value = p.name;
      descEl.value = p.description || '';
      wEl.value = p.width || 0;
      hEl.value = p.height || 0;
      qtyEl.value = p.quantity || 1;
      unitEl.value = p.unit || 'cái';
      pcsEl.value = p.pcs_per_unit || 1;
      sortEl.value = p.sort_order || 1;
      activeEl.value = p.is_active ? '1' : '0';

      this.onPresetGroupChange(p.group_type);

      const cfg = p.config || {};
      if (p.group_type === 'DIGITAL') {
        if (cfg.sheetSize) document.getElementById('preset-dig-sheet').value = cfg.sheetSize;
        if (cfg.paper) document.getElementById('preset-dig-paper').value = cfg.paper;
        if (cfg.printSides) document.getElementById('preset-dig-sides').value = cfg.printSides;
        if (cfg.lamination) document.getElementById('preset-dig-lam').value = cfg.lamination;
        document.querySelectorAll('#preset-dig-finishing input').forEach(cb => {
          cb.checked = (cfg.finishing || []).includes(cb.value);
        });
      } else if (p.group_type === 'OFFSET') {
        document.getElementById('preset-off-table').value = cfg.table || '';
        document.getElementById('preset-off-def').value = cfg.def || '';
        this.onOffsetPresetTableChange(cfg.table);
      } else if (p.group_type === 'LARGE_FORMAT') {
        if (cfg.material) document.getElementById('preset-lf-material').value = cfg.material;
        document.querySelectorAll('#preset-lf-finishing input').forEach(cb => {
          cb.checked = (cfg.finishing || []).includes(cb.value);
        });
      } else if (p.group_type === 'DOCUMENT_SPIRAL') {
        if (cfg.size) document.getElementById('preset-doc-size').value = cfg.size;
        if (cfg.pages) document.getElementById('preset-doc-pages').value = cfg.pages;
        if (cfg.ruotPrint) document.getElementById('preset-doc-ruot').value = cfg.ruotPrint;
        if (cfg.bindingPackage) document.getElementById('preset-doc-package').value = cfg.bindingPackage;
        if (cfg.frontPrint) document.getElementById('preset-doc-front').value = cfg.frontPrint;
        if (cfg.backPrint) document.getElementById('preset-doc-back').value = cfg.backPrint;
      }
    } else {
      groupEl.disabled = false;
      groupEl.value = this.presetFilterGroup !== 'ALL' ? this.presetFilterGroup : 'DIGITAL';
      codeEl.disabled = false;
      codeEl.value = `SPM_${Date.now().toString().slice(-6)}`;
      nameEl.value = '';
      descEl.value = '';
      wEl.value = 90;
      hEl.value = 54;
      qtyEl.value = 100;
      unitEl.value = 'cái';
      pcsEl.value = 1;
      sortEl.value = this.presets.length + 1;
      activeEl.value = '1';
      this.onPresetGroupChange(groupEl.value);
    }

    document.getElementById('modal-preset').classList.add('active');
  },

  async savePreset() {
    const id = document.getElementById('preset-id').value;
    const isEdit = !!id;
    const group_type = document.getElementById('preset-group').value;
    const code = document.getElementById('preset-code').value.trim();
    const name = document.getElementById('preset-name').value.trim();
    const description = document.getElementById('preset-desc').value.trim();
    const width = parseFloat(document.getElementById('preset-width').value) || 0;
    const height = parseFloat(document.getElementById('preset-height').value) || 0;
    const quantity = parseInt(document.getElementById('preset-quantity').value) || 1;
    const unit = document.getElementById('preset-unit').value.trim() || 'cái';
    const pcs_per_unit = parseInt(document.getElementById('preset-pcs').value) || 1;
    const sort_order = parseInt(document.getElementById('preset-sort').value) || 1;
    const is_active = parseInt(document.getElementById('preset-active').value) || 1;

    if (!name) return alert('Vui lòng nhập tên sản phẩm mẫu!');

    const config = {};
    if (group_type === 'DIGITAL') {
      config.sheetSize = document.getElementById('preset-dig-sheet').value;
      config.paper = document.getElementById('preset-dig-paper').value;
      config.printSides = parseInt(document.getElementById('preset-dig-sides').value) || 2;
      config.lamination = document.getElementById('preset-dig-lam').value;
      config.finishing = [...document.querySelectorAll('#preset-dig-finishing input:checked')].map(cb => cb.value);
    } else if (group_type === 'OFFSET') {
      const tbl = document.getElementById('preset-off-table').value;
      if (tbl) {
        config.table = tbl;
        config.def = document.getElementById('preset-off-def').value.trim() || 'C150';
      }
    } else if (group_type === 'LARGE_FORMAT') {
      config.material = document.getElementById('preset-lf-material').value;
      config.finishing = [...document.querySelectorAll('#preset-lf-finishing input:checked')].map(cb => cb.value);
    } else if (group_type === 'DOCUMENT_SPIRAL') {
      config.size = document.getElementById('preset-doc-size').value;
      config.pages = parseInt(document.getElementById('preset-doc-pages').value) || 160;
      config.ruotPrint = document.getElementById('preset-doc-ruot').value;
      config.bindingPackage = document.getElementById('preset-doc-package').value;
      config.frontPrint = document.getElementById('preset-doc-front').value;
      config.backPrint = document.getElementById('preset-doc-back').value;
    }

    const payload = {
      group_type,
      code,
      name,
      description,
      width,
      height,
      quantity,
      unit,
      pcs_per_unit,
      config,
      sort_order,
      is_active
    };

    try {
      const url = isEdit ? `/api/presets/${id}` : '/api/presets';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi lưu sản phẩm mẫu');

      alert(isEdit ? '✅ Đã cập nhật sản phẩm mẫu thành công!' : '✅ Đã thêm mới sản phẩm mẫu thành công!');
      if (window.App && window.App.closeModals) window.App.closeModals();
      await this.loadPresets();
      // Đồng bộ lại danh sách presets ở tab tính giá nếu App đang mở
      if (window.App && window.App.loadPresetsFromApi) {
        await window.App.loadPresetsFromApi();
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  async deletePreset(id, name) {
    if (!confirm(`Bạn có chắc muốn xóa sản phẩm mẫu "${name}" không?`)) return;
    try {
      const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi xóa');
      alert('✅ Đã xóa sản phẩm mẫu thành công!');
      await this.loadPresets();
      if (window.App && window.App.loadPresetsFromApi) {
        await window.App.loadPresetsFromApi();
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  // ================= QUẢN LÝ LOẠI GIẤY (PAPERS) =================
  async loadPapers() {
    try {
      this.papers = await this.api('/papers');
      this.renderPapers();
    } catch (err) {
      console.error('Lỗi khi tải danh sách loại giấy:', err);
    }
  },

  filterPaperType(type) {
    this.currentPaperTypeFilter = type;
    document.querySelectorAll('#paper-group-filters .filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.paperType === type);
    });
    this.renderPapers();
  },

  searchPapers(q) {
    this.paperSearchQuery = (q || '').trim().toLowerCase();
    this.renderPapers();
  },

  renderPapers() {
    const tbody = document.getElementById('admin-papers-tbody');
    if (!tbody) return;

    let filtered = (this.papers || []).slice();

    // Lọc theo nhóm giấy
    if (this.currentPaperTypeFilter && this.currentPaperTypeFilter !== 'ALL') {
      filtered = filtered.filter(p => p.paper_type === this.currentPaperTypeFilter);
    }

    // Lọc theo từ khoá tìm kiếm
    if (this.paperSearchQuery) {
      const q = this.paperSearchQuery;
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.paper_type && p.paper_type.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q)) ||
        String(p.gsm).includes(q)
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--text-muted);">Không tìm thấy loại giấy nào phù hợp.</td></tr>`;
      return;
    }

    const typeLabels = {
      COUCHE: '<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);">Couche</span>',
      FORT: '<span class="badge" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);">Fort/Ford</span>',
      IVORY: '<span class="badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);">Ivory</span>',
      BRISTOL: '<span class="badge" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3);">Bristol</span>',
      DECAL: '<span class="badge" style="background:rgba(236,72,153,0.15); color:#f472b6; border:1px solid rgba(236,72,153,0.3);">Decal</span>',
      KRAFT: '<span class="badge" style="background:rgba(217,119,6,0.15); color:#f59e0b; border:1px solid rgba(217,119,6,0.3);">Kraft</span>',
      ART: '<span class="badge" style="background:rgba(99,102,241,0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3);">Mỹ Thuật</span>',
      OTHER: '<span class="badge badge-draft">Khác</span>'
    };

    tbody.innerHTML = filtered.map(p => {
      const typeBadge = typeLabels[p.paper_type] || `<span class="badge badge-draft">${this.esc(p.paper_type)}</span>`;
      const costSheet = Number(p.cost_per_sheet) || 0;
      const costKg = Number(p.cost_per_kg) || 0;
      // Gợi ý giá bán margin 40% (cost / 0.6)
      const suggestedSheet = costSheet > 0 ? Math.round(costSheet / 0.6 / 50) * 50 : 0;
      const statusBadge = p.is_active
        ? '<span class="badge badge-paid">Sử dụng</span>'
        : '<span class="badge badge-unpaid">Ẩn</span>';

      return `
        <tr>
          <td><strong style="color:var(--primary-light); font-family:monospace; font-size:13px;">${this.esc(p.code)}</strong></td>
          <td>${typeBadge}</td>
          <td>
            <div style="font-weight:600; color:var(--text-main);">${this.esc(p.name)}</div>
            ${p.notes ? `<div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${this.esc(p.notes)}</div>` : ''}
          </td>
          <td style="text-align:center;"><strong>${p.gsm || '-'}</strong> <span style="font-size:11px; color:var(--text-dim);">gsm</span></td>
          <td style="font-size:12px; color:var(--text-dim);">${this.esc(p.size_spec || '32x43')}</td>
          <td style="text-align:right; font-weight:700; color:var(--accent-amber);">${costSheet.toLocaleString('vi-VN')} đ</td>
          <td style="text-align:right; font-size:12px; color:var(--text-dim);">${costKg > 0 ? costKg.toLocaleString('vi-VN') + ' đ' : '-'}</td>
          <td style="text-align:right; font-weight:700; color:var(--accent-green);">${suggestedSheet > 0 ? suggestedSheet.toLocaleString('vi-VN') + ' đ' : '-'}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">
            <div style="display:flex; gap:6px; justify-content:center;">
              <button class="btn btn-secondary btn-sm" onclick="Admin.openPaperModal('${p.id}')" title="Sửa thông tin giấy">✏️ Sửa</button>
              <button class="btn btn-secondary btn-sm" style="color:var(--accent-rose);" onclick="Admin.deletePaper('${p.id}', '${this.esc(p.name)}')" title="Xóa loại giấy">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openPaperModal(id) {
    const p = id ? (this.papers || []).find(x => x.id === id) : null;
    const modal = document.getElementById('modal-paper');
    if (!modal) return;

    document.getElementById('modal-paper-title').textContent = p ? '✏️ Sửa Loại Giấy' : '+ Thêm Loại Giấy Mới';
    document.getElementById('paper-id').value = p ? p.id : '';
    document.getElementById('paper-code').value = p ? p.code : '';
    document.getElementById('paper-name').value = p ? p.name : '';
    document.getElementById('paper-type').value = p ? p.paper_type : 'COUCHE';
    document.getElementById('paper-gsm').value = p ? (p.gsm || 150) : 150;
    document.getElementById('paper-sizespec').value = p ? (p.size_spec || '32x43') : '32x43';
    document.getElementById('paper-unit').value = p ? (p.unit || 'tờ') : 'tờ';
    document.getElementById('paper-cost-sheet').value = p ? (p.cost_per_sheet || 0) : 0;
    document.getElementById('paper-cost-kg').value = p ? (p.cost_per_kg || 0) : 0;
    document.getElementById('paper-notes').value = p ? (p.notes || '') : '';
    document.getElementById('paper-active').value = (p && p.is_active === 0) ? '0' : '1';

    modal.classList.add('active');
  },

  async savePaper() {
    const id = document.getElementById('paper-id').value;
    const code = document.getElementById('paper-code').value.trim();
    const name = document.getElementById('paper-name').value.trim();
    const paper_type = document.getElementById('paper-type').value;
    const gsm = parseInt(document.getElementById('paper-gsm').value) || 150;
    const size_spec = document.getElementById('paper-sizespec').value.trim() || '32x43';
    const unit = document.getElementById('paper-unit').value.trim() || 'tờ';
    const cost_per_sheet = parseFloat(document.getElementById('paper-cost-sheet').value) || 0;
    const cost_per_kg = parseFloat(document.getElementById('paper-cost-kg').value) || 0;
    const notes = document.getElementById('paper-notes').value.trim();
    const is_active = parseInt(document.getElementById('paper-active').value) || 1;

    if (!name) {
      alert('Vui lòng nhập tên hiển thị của loại giấy!');
      return;
    }

    const payload = { code, name, paper_type, gsm, size_spec, unit, cost_per_sheet, cost_per_kg, notes, is_active };

    try {
      const url = id ? `/papers/${id}` : '/papers';
      const method = id ? 'PUT' : 'POST';
      await this.api(url, method, payload);

      alert(id ? '✅ Đã cập nhật loại giấy thành công!' : '✅ Đã thêm loại giấy mới thành công!');
      if (window.App && window.App.closeModals) window.App.closeModals();
      await this.loadPapers();
      // Tải lại bảng giá vật tư chung & cập nhật dropdown giấy tính giá nếu có
      this.loadPrices();
      if (window.App && window.App.refreshPaperDropdowns) {
        window.App.refreshPaperDropdowns();
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  async deletePaper(id, name) {
    if (!confirm(`Bạn có chắc muốn xóa loại giấy "${name}" không?`)) return;
    try {
      await this.api(`/papers/${id}`, 'DELETE');
      alert('✅ Đã xóa loại giấy thành công!');
      await this.loadPapers();
      this.loadPrices();
      if (window.App && window.App.refreshPaperDropdowns) {
        window.App.refreshPaperDropdowns();
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Admin.init());
else Admin.init();
