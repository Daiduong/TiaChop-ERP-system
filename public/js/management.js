/**
 * PUBLIC/JS/MANAGEMENT.JS
 * Bộ điều khiển Báo cáo Quản trị Doanh nghiệp (Management Reports & BI Analytics)
 */

window.Management = {
  data: null,

  esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  money: n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)) + ' đ',
  num: n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)),

  init() {
    this.setDefaultDates();
    this.loadData();
  },

  setDefaultDates() {
    const fromEl = document.getElementById('mgmt-date-from');
    const toEl = document.getElementById('mgmt-date-to');
    if (!fromEl || !toEl) return;

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    fromEl.value = this.formatDateInput(firstDay);
    toEl.value = this.formatDateInput(now);
  },

  formatDateInput(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  onQuickPeriodChange(period) {
    const fromEl = document.getElementById('mgmt-date-from');
    const toEl = document.getElementById('mgmt-date-to');
    const now = new Date();

    if (period === 'ALL') {
      fromEl.value = '';
      toEl.value = '';
    } else if (period === 'THIS_MONTH') {
      fromEl.value = this.formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
      toEl.value = this.formatDateInput(now);
    } else if (period === 'LAST_MONTH') {
      fromEl.value = this.formatDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      toEl.value = this.formatDateInput(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (period === 'THIS_QUARTER') {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      fromEl.value = this.formatDateInput(new Date(now.getFullYear(), qMonth, 1));
      toEl.value = this.formatDateInput(now);
    } else if (period === 'THIS_YEAR') {
      fromEl.value = `${now.getFullYear()}-01-01`;
      toEl.value = this.formatDateInput(now);
    }

    this.loadData();
  },

  async loadData() {
    const from = document.getElementById('mgmt-date-from')?.value || '';
    const to = document.getElementById('mgmt-date-to')?.value || '';

    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
      const res = await fetch(`/api/management-reports/analytics?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi khi tải dữ liệu báo cáo');
      }

      this.data = await res.json();
      this.render();
    } catch (e) {
      console.error('Error loading management reports:', e);
      alert('Lỗi tải báo cáo quản trị: ' + e.message);
    }
  },

  render() {
    if (!this.data) return;
    const { kpi, salesReport, topCustomers, suppliersReport, customerGroups, cashflowReport } = this.data;

    // 1. KPI Cards
    document.getElementById('mgmt-kpi-revenue').textContent = this.money(kpi.total_revenue);
    document.getElementById('mgmt-kpi-orders-count').textContent = `${kpi.total_orders} đơn hàng chốt • ${kpi.total_quotes} báo giá (${kpi.conversionRate}% chốt)`;

    document.getElementById('mgmt-kpi-profit').textContent = this.money(kpi.total_profit);
    document.getElementById('mgmt-kpi-margin').textContent = `Tỷ suất LN gộp: ~${kpi.profitMargin}%`;

    document.getElementById('mgmt-kpi-cost').textContent = this.money(kpi.total_cost);
    document.getElementById('mgmt-kpi-cost-sub').textContent = `Phí ship thu hộ: ${this.money(kpi.total_shipping_fee)}`;

    document.getElementById('mgmt-kpi-debt').textContent = this.money(kpi.total_debt);
    document.getElementById('mgmt-kpi-avg-order').textContent = `Giá trị TB: ${this.money(kpi.avgOrderValue)} / đơn`;

    // 2. Sales Performance Table
    const salesTbody = document.getElementById('mgmt-sales-tbody');
    if (salesTbody) {
      if (!salesReport || salesReport.length === 0) {
        salesTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">Chưa có dữ liệu kinh doanh trong kỳ này</td></tr>`;
      } else {
        salesTbody.innerHTML = salesReport.map((s, idx) => {
          const margin = s.total_revenue > 0 ? Math.round((s.total_profit / s.total_revenue) * 100) : 0;
          const rankIcon = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `${idx + 1}`));
          return `
            <tr>
              <td style="font-weight:700; text-align:center;">${rankIcon}</td>
              <td>
                <strong>${this.esc(s.sales_name)}</strong>
                ${s.username ? `<div style="font-size:11px; color:var(--text-dim);">@${this.esc(s.username)}</div>` : ''}
              </td>
              <td style="text-align:center; font-weight:600;">${this.num(s.order_count)}</td>
              <td style="text-align:center; color:var(--text-muted);">${this.num(s.quote_count)}</td>
              <td style="text-align:right; font-weight:700; color:var(--primary-light);">${this.money(s.total_revenue)}</td>
              <td style="text-align:right; font-weight:700; color:var(--accent-green);">${this.money(s.total_profit)}</td>
              <td style="text-align:center;"><span class="badge ${margin >= 40 ? 'badge-completed' : (margin >= 25 ? 'badge-confirmed' : 'badge-draft')}">${margin}%</span></td>
              <td style="text-align:right; font-weight:600; color:var(--accent-rose);">${this.money(s.debt_amount)}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 3. Top Customers Table
    const custTbody = document.getElementById('mgmt-cust-tbody');
    if (custTbody) {
      if (!topCustomers || topCustomers.length === 0) {
        custTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">Không có khách hàng phát sinh đơn</td></tr>`;
      } else {
        custTbody.innerHTML = topCustomers.map((c, idx) => `
          <tr>
            <td style="max-width: 220px;">
              <strong style="color:var(--text-main); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.esc(c.name)}">${this.esc(c.name)}</strong>
              <div style="font-size:11px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.esc(c.code || '')}${c.phone ? ' • ' + this.esc(c.phone) : ''}</div>
            </td>
            <td style="text-align:center; font-weight:600;">${c.order_count}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary-light); white-space:nowrap;">${this.money(c.total_revenue)}</td>
            <td style="text-align:right; font-weight:600; color:var(--accent-green); white-space:nowrap;">${this.money(c.total_profit)}</td>
            <td style="text-align:right; color:var(--accent-rose); white-space:nowrap;">${this.money(c.current_debt)}</td>
          </tr>
        `).join('');
      }
    }

    // 4. Suppliers Breakdown Table
    const supTbody = document.getElementById('mgmt-sup-tbody');
    if (supTbody) {
      if (!suppliersReport || suppliersReport.length === 0) {
        supTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">Chưa có chi phí xưởng</td></tr>`;
      } else {
        supTbody.innerHTML = suppliersReport.map(s => `
          <tr>
            <td style="max-width: 220px;">
              <strong style="color:var(--accent-amber); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.esc(s.supplier_name)}">${this.esc(s.supplier_name)}</strong>
              ${s.specialties ? `<div style="font-size:11px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.esc(s.specialties)}">${this.esc(s.specialties)}</div>` : ''}
            </td>
            <td style="text-align:center; font-weight:600;">${s.item_count}</td>
            <td style="text-align:right; font-weight:700; color:var(--accent-amber); white-space:nowrap;">${this.money(s.total_cost)}</td>
            <td style="text-align:right; color:var(--text-muted); white-space:nowrap;">${this.money(s.total_selling_value)}</td>
          </tr>
        `).join('');
      }
    }

    // 5. Customer Groups Table
    const groupTbody = document.getElementById('mgmt-group-tbody');
    if (groupTbody) {
      const groupLabels = {
        B2B_CHAIN: '🍔 Chuỗi F&B / Nhà Hàng',
        CORPORATE: '🏢 Doanh Nghiệp / Công Ty',
        SCHOOL: '🏫 Trường Học / Giáo Dục',
        RETAIL: '👤 Khách Lẻ / Cá Nhân'
      };
      if (!customerGroups || customerGroups.length === 0) {
        groupTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">Chưa có dữ liệu</td></tr>`;
      } else {
        groupTbody.innerHTML = customerGroups.map(g => `
          <tr>
            <td><strong>${groupLabels[g.group_name] || g.group_name}</strong></td>
            <td style="text-align:center;">${g.customer_count}</td>
            <td style="text-align:center; font-weight:600;">${g.order_count}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary-light);">${this.money(g.total_revenue)}</td>
            <td style="text-align:right; font-weight:700; color:var(--accent-green);">${this.money(g.total_profit)}</td>
          </tr>
        `).join('');
      }
    }

    // 6. Cash Flow Table
    const cashTbody = document.getElementById('mgmt-cash-tbody');
    if (cashTbody) {
      const typeLabels = {
        INCOME_DEPOSIT: 'Thu Tiền Cọc Đơn Hàng',
        INCOME_BALANCE: 'Thu Tiền Tất Toán Còn Lại',
        EXPENSE_SUPPLIER: 'Chi Tiền Xưởng Gia Công',
        EXPENSE_OTHER: 'Chi Phí Hoạt Động Khác'
      };
      const methodLabels = {
        BANK_TRANSFER: 'Chuyển Khoản Ngân Hàng',
        CASH: 'Tiền Mặt'
      };
      if (!cashflowReport || cashflowReport.length === 0) {
        cashTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">Chưa có giao dịch dòng tiền trong kỳ</td></tr>`;
      } else {
        cashTbody.innerHTML = cashflowReport.map(c => {
          const isIncome = c.type.includes('INCOME');
          return `
            <tr>
              <td>
                <span class="badge ${isIncome ? 'badge-paid' : 'badge-unpaid'}">
                  ${typeLabels[c.type] || c.type}
                </span>
              </td>
              <td>${methodLabels[c.payment_method] || c.payment_method}</td>
              <td style="text-align:center; font-weight:600;">${c.tx_count}</td>
              <td style="text-align:right; font-weight:700; color:${isIncome ? 'var(--accent-green)' : 'var(--accent-rose)'};">
                ${isIncome ? '+' : '-'}${this.money(c.total_amount)}
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  },

  exportExcel() {
    const from = document.getElementById('mgmt-date-from')?.value || '';
    const to = document.getElementById('mgmt-date-to')?.value || '';
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    window.location.href = `/api/management-reports/export/excel?${params.toString()}`;
  },

  printReport() {
    const from = document.getElementById('mgmt-date-from')?.value || '';
    const to = document.getElementById('mgmt-date-to')?.value || '';
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    window.open(`/api/management-reports/print?${params.toString()}`, '_blank');
  }
};

