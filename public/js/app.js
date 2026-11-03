/**
 * TIA CHỚP ERP - FRONTEND CORE CONTROLLER
 * Quản lý toàn diện: Dashboard, Pricing Engine, Orders, Suppliers, CRM, Finance, RBAC
 */

const App = {
  // State
  state: {
    activeTab: 'dashboard',
    currentRole: 'ADMIN',
    theme: 'dark',
    customers: [],
    suppliers: [],
    orders: [],
    settings: {}, // Cấu hình công ty (hotline, tên cty...)
    supplierJobs: [], // Cache danh sách lệnh in của xưởng
    supplierJobsView: 'grouped', // 'grouped' hoặc 'flat'
    filters: {
      status: 'ALL',
      type: null,
      q: ''
    },
    currentPricingCalc: null,
    orderModalMode: 'CREATE',
    currentActiveOrderId: null,
    editingOrder: null,
    editingOrderId: null
  },

  // Menu (tab) được phép truy cập theo vai trò
  ROLE_TABS: {
    ADMIN: ['dashboard', 'pricing', 'orders', 'suppliers', 'customers', 'finance', 'management', 'admin'],
    SALES: ['dashboard', 'pricing', 'orders', 'customers'],
    ACCOUNTANT: ['dashboard', 'orders', 'customers', 'finance', 'management'],
    COORDINATOR: ['dashboard', 'orders', 'suppliers']
  },

  ROLE_LABELS: {
    ADMIN: 'Giám Đốc (Admin)',
    SALES: 'Nhân Viên Sales',
    ACCOUNTANT: 'Kế Toán (Finance)',
    COORDINATOR: 'Điều Phối Xưởng'
  },

  canAccessTab(tabId, role = this.state.currentRole) {
    return (this.ROLE_TABS[role] || []).includes(tabId);
  },

  // Ẩn/hiện menu sidebar theo vai trò
  applyMenuPermissions(role) {
    document.querySelectorAll('#main-nav .nav-item').forEach(item => {
      item.style.display = this.canAccessTab(item.getAttribute('data-tab'), role) ? '' : 'none';
    });
    if (!this.canAccessTab(this.state.activeTab, role)) this.switchTab('dashboard');
    const chkBtn = document.getElementById('btn-save-price-check');
    if (chkBtn) chkBtn.style.display = role === 'ADMIN' ? '' : 'none';
  },

  // Khởi tạo ứng dụng — được gọi bởi auth.js sau khi đăng nhập thành công
  init(user) {
    console.log('⚡ Tia Chớp ERP Frontend initializing...', user?.username);
    if (user) {
      this.state.currentRole = user.role || 'ADMIN';
      this.state.currentUser = user;
      const name = user.full_name || user.username || 'Admin';
      const nameEl = document.getElementById('user-display-name');
      if (nameEl) nameEl.textContent = name;
      const avatarEl = document.getElementById('user-avatar');
      if (avatarEl) avatarEl.textContent = name.slice(0, 2).toUpperCase();
      const roleEl = document.getElementById('role-selector');
      if (roleEl) roleEl.value = user.role || 'ADMIN';
      const roleLbl = document.getElementById('user-role-label');
      if (roleLbl) roleLbl.textContent = this.ROLE_LABELS[user.role] || user.role;
      // Chỉ Admin mới được dùng bộ chuyển vai trò (xem thử giao diện)
      const switcher = document.querySelector('.role-switcher-container');
      if (switcher) switcher.style.display = user.role === 'ADMIN' ? '' : 'none';
      this.applyMenuPermissions(user.role);
      document.querySelectorAll('.rbac-admin-coord').forEach(el => {
        el.style.display = ['ADMIN', 'COORDINATOR'].includes(user.role) ? '' : 'none';
      });
      document.querySelectorAll('.rbac-admin-only').forEach(el => {
        el.style.display = (user.role === 'ADMIN') ? '' : 'none';
      });
      const offVariantLabel = document.getElementById('label-off-variant');
      if (offVariantLabel) {
        offVariantLabel.textContent = (user.role === 'ADMIN') ? 'Giấy / Biến thể (bảng giá In Thành Danh)' : 'Giấy / Biến thể sản phẩm';
      }
    }
    this.bindEvents();
    this.setupShortcuts();
    this.loadInitialData();
    this.setupPricingListeners();
  },

  // ==========================================
  // EVENT LISTENERS & NAVIGATION
  // ==========================================
  bindEvents() {
    // Navigation items
    document.querySelectorAll('#main-nav .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // RBAC Switcher
    const roleSelector = document.getElementById('role-selector');
    if (roleSelector) {
      roleSelector.addEventListener('change', (e) => {
        this.setRole(e.target.value);
      });
    }

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Global Search
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) {
      let debounceTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          this.state.filters.q = e.target.value.trim();
          this.loadOrders();
        }, 300);
      });
    }

    // Quick buttons
    const btnQuickOrder = document.getElementById('btn-quick-new-order');
    if (btnQuickOrder) btnQuickOrder.addEventListener('click', () => this.openNewOrderModal());

    const btnQuickPricing = document.getElementById('btn-quick-pricing');
    if (btnQuickPricing) btnQuickPricing.addEventListener('click', () => this.switchTab('pricing'));

    // Filter Buttons in Orders Tab
    document.querySelectorAll('#tab-orders .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tab-orders .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const statusFilter = btn.getAttribute('data-filter-status');
        const typeFilter = btn.getAttribute('data-filter-type');

        if (statusFilter) {
          this.state.filters.status = statusFilter;
          this.state.filters.type = null;
        } else if (typeFilter) {
          this.state.filters.type = typeFilter;
          this.state.filters.status = 'ALL';
        }

        this.loadOrders();
      });
    });

    // Apply Pricing result to Order
    const btnApplyOrder = document.getElementById('btn-apply-to-order');
    if (btnApplyOrder) {
      btnApplyOrder.addEventListener('click', () => this.transferPricingToOrder());
    }
  },

  // Bắt phím tắt nhanh
  setupShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Bỏ qua nếu đang gõ trong input/textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') this.closeModals();
        return;
      }

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.openNewOrderModal();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.switchTab('pricing');
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.switchTab('dashboard');
      } else if (e.key === '/') {
        e.preventDefault();
        const search = document.getElementById('global-search-input');
        if (search) search.focus();
      } else if (e.key === 'Escape') {
        this.closeModals();
      }
    });
  },

  // Chuyển Tab
  switchTab(tabId) {
    if (!this.canAccessTab(tabId)) tabId = 'dashboard';
    this.state.activeTab = tabId;

    // Cập nhật nav active
    document.querySelectorAll('#main-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });

    // Cập nhật tab view active
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `tab-${tabId}`);
    });

    // Cập nhật tiêu đề trang
    const titles = {
      dashboard: 'Tổng Quan Doanh Nghiệp',
      pricing: 'Công Cụ Tính Giá & Bình Bài (30 Giây)',
      orders: 'Quản Lý Báo Giá & Đơn Hàng',
      suppliers: 'Xưởng In Gia Công & SRM',
      customers: 'Quản Lý Khách Hàng (CRM)',
      finance: 'Dòng Tiền, Sổ Công Nợ & Thuế',
      management: 'Báo Cáo Quản Trị & Chỉ Số Điều Hành (BI Analytics)',
      admin: 'Quản Trị Hệ Thống'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[tabId] || 'Tia Chớp ERP';

    // Refresh dữ liệu theo tab
    if (tabId === 'dashboard') this.loadDashboard();
    if (tabId === 'orders') {
      // Reset filter về ALL khi chuyển sang tab orders để đảm bảo thấy đủ đơn hàng
      this.state.filters.status = 'ALL';
      this.state.filters.type = null;
      this.state.filters.q = '';
      // Đồng bộ UI filter button
      document.querySelectorAll('#tab-orders .filter-btn').forEach(b => b.classList.remove('active'));
      const allBtn = document.querySelector('#tab-orders .filter-btn[data-filter-status="ALL"]');
      if (allBtn) allBtn.classList.add('active');
      const searchInput = document.getElementById('global-search-input');
      if (searchInput) searchInput.value = '';
      this.loadOrders();
    }
    if (tabId === 'pricing') this.triggerPricingCalculation();
    if (tabId === 'suppliers') this.loadSuppliers();
    if (tabId === 'customers') this.loadCustomers();
    if (tabId === 'finance') { this.loadFinance(); if (window.Reports) Reports.init(); }
    if (tabId === 'management' && window.Management) Management.init();
    if (tabId === 'admin' && window.Admin) Admin.load();
  },

  // Phân quyền RBAC Switcher
  setRole(role) {
    this.state.currentRole = role;
    const roleLabels = {
      ADMIN: 'Giám Đốc (Admin)',
      SALES: 'Nhân Viên Sales',
      ACCOUNTANT: 'Kế Toán (Finance)',
      COORDINATOR: 'Điều Phối Xưởng'
    };

    const labelEl = document.getElementById('user-role-label');
    if (labelEl) labelEl.textContent = roleLabels[role] || role;

    // Ẩn/Hiện các cột và dữ liệu nhạy cảm
    const costElements = document.querySelectorAll('.col-cost-profit');
    const isSales = (role === 'SALES');

    costElements.forEach(el => {
      if (isSales) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });

    const statProfitCard = document.getElementById('card-stat-profit');
    this.applyMenuPermissions(role);
    if (statProfitCard) {
      statProfitCard.style.display = isSales ? 'none' : '';
    }

    // Ẩn/hiện nút Import/Export theo phân quyền
    document.querySelectorAll('.rbac-admin-coord').forEach(el => {
      el.style.display = ['ADMIN', 'COORDINATOR'].includes(role) ? '' : 'none';
    });
    // Ẩn/hiện các phần chỉ dành riêng cho Admin (thông tin xưởng gia công dự kiến)
    const isAdmin = (role === 'ADMIN');
    document.querySelectorAll('.rbac-admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
    const offVariantLabel = document.getElementById('label-off-variant');
    if (offVariantLabel) {
      offVariantLabel.textContent = isAdmin ? 'Giấy / Biến thể (bảng giá In Thành Danh)' : 'Giấy / Biến thể sản phẩm';
    }

    // Ẩn cột Tiến Độ Xưởng In với Sales
    const workshopCol = document.getElementById('dashboard-workshop-col');
    if (workshopCol) workshopCol.style.display = isSales ? 'none' : '';
    // Ẩn card KPI "Đơn Đang In ở Xưởng"
    const producingCard = document.getElementById('card-stat-producing');
    if (producingCard) producingCard.style.display = isSales ? 'none' : '';
    // Điều chỉnh grid dashboard: Sales chỉ hiện 1 cột, Admin hiện 2 cột
    const dashGrid = workshopCol?.parentElement;
    if (dashGrid) dashGrid.style.gridTemplateColumns = isSales ? '1fr' : '1.6fr 1fr';

    // Refresh views to apply masking
    if (this.state.activeTab === 'orders') this.renderOrdersTable();
    if (this.state.activeTab === 'dashboard') this.loadDashboard();
    if (this.state.activeTab === 'pricing') this.triggerPricingCalculation();
  },

  // Toggle Theme
  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.textContent = this.state.theme === 'dark' ? '🌙' : '☀️';
  },

  // ==========================================
  // LOAD DỮ LIỆU BAN ĐẦU
  // ==========================================
  async loadInitialData() {
    try {
      await Promise.all([
        this.loadSettings(),
        this.loadCustomers(),
        this.loadSuppliers(),
        this.loadDashboard()
      ]);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  },

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        this.state.settings = await res.json();
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  },

  // ==========================================
  // 1. DASHBOARD
  // ==========================================
  async loadDashboard() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();

      // Stats KPI
      document.getElementById('stat-revenue').textContent = this.formatCurrency(data.summary.total_revenue);
      document.getElementById('stat-orders-sub').textContent = `${data.summary.total_orders} đơn hàng chốt in`;

      document.getElementById('stat-profit').textContent = this.formatCurrency(data.summary.total_profit);
      const margin = data.summary.total_revenue > 0 ? Math.round((data.summary.total_profit / data.summary.total_revenue) * 100) : 0;
      document.getElementById('stat-margin-sub').textContent = `Biên lợi nhuận gộp ~${margin}%`;

      document.getElementById('stat-debt').textContent = this.formatCurrency(data.summary.total_receivable_debt);
      document.getElementById('stat-producing-count').textContent = data.summary.in_production_count;

      // Badge count
      const badgeCount = document.getElementById('badge-orders-count');
      if (badgeCount) badgeCount.textContent = data.summary.total_orders;

      // Cashflow
      document.getElementById('dash-cashflow-in').textContent = this.formatCurrency(data.cashflow.total_income);
      document.getElementById('dash-cashflow-out').textContent = this.formatCurrency(data.cashflow.total_expense);

      // Render recent orders
      this.renderDashboardRecentOrders(data.recentOrders);

      // Render suppliers load
      this.renderDashboardSuppliersLoad(data.suppliersLoad);

      // Ẩn cột Xưởng In với SALES
      const isSales = (this.state.currentRole === 'SALES');
      const workshopCol = document.getElementById('dashboard-workshop-col');
      if (workshopCol) workshopCol.style.display = isSales ? 'none' : '';
      const producingCard = document.getElementById('card-stat-producing');
      if (producingCard) producingCard.style.display = isSales ? 'none' : '';
      const dashGrid = workshopCol?.parentElement;
      if (dashGrid) dashGrid.style.gridTemplateColumns = isSales ? '1fr' : '1.6fr 1fr';
    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  },

  renderDashboardRecentOrders(orders) {
    const tbody = document.querySelector('#dashboard-recent-orders-table tbody');
    if (!tbody) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Chưa có đơn hàng nào</td></tr>`;
      return;
    }

    const isSales = (this.state.currentRole === 'SALES');

    // Cập nhật header bảng
    document.querySelectorAll('#dashboard-recent-orders-table th.col-cost-profit').forEach(th => {
      th.style.display = isSales ? 'none' : '';
    });

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><strong>${o.code}</strong></td>
        <td>
          <div style="font-weight:600;">${o.customer_name}</div>
          <div style="font-size:11px; color:var(--text-dim);">${o.customer_code}</div>
        </td>
        <td style="font-weight:700; color:var(--primary-light);">${this.formatCurrency(o.total_selling)}</td>
        <td class="col-cost-profit" style="${isSales ? 'display:none;' : ''} color:var(--accent-green); font-weight:600;">
          ${this.formatCurrency(o.gross_profit)}
        </td>
        <td>${this.renderStatusBadge(o.status)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="App.viewOrderDetails('${o.id}')">Xem</button>
        </td>
      </tr>
    `).join('');
  },

  // Xem chi tiết đơn hàng từ Dashboard -> chuyển sang tab Orders và highlight đơn đó
  async viewOrderDetails(orderId) {
    // 1. Chuyển sang tab orders (sẽ tự gọi loadOrders)
    this.switchTab('orders');

    // 2. Chờ loadOrders hoàn thành rồi scroll + highlight
    try {
      await this.loadOrders();
    } catch (e) { /* ignore, đã load xong từ switchTab */ }

    // 3. Tìm row chứa đơn hàng đó và highlight
    const tbody = document.getElementById('orders-table-tbody');
    if (!tbody) return;

    // Tìm tất cả nút trong tbody, lấy row có onclick chứa orderId
    let targetRow = null;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const btns = row.querySelectorAll('button[onclick]');
      btns.forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(orderId)) {
          targetRow = row;
        }
      });
      // Thêm kiểm tra qua select (changeOrderStatus cũng có orderId)
      const selects = row.querySelectorAll('select[onchange]');
      selects.forEach(sel => {
        if (sel.getAttribute('onchange') && sel.getAttribute('onchange').includes(orderId)) {
          targetRow = row;
        }
      });
    });

    if (targetRow) {
      // Scroll mượt đến row
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight animation
      targetRow.style.transition = 'background 0.3s ease';
      targetRow.style.background = 'rgba(56, 189, 248, 0.18)';
      targetRow.style.boxShadow = '0 0 0 2px var(--primary-light)';
      setTimeout(() => {
        targetRow.style.background = '';
        targetRow.style.boxShadow = '';
      }, 2500);
    }
  },

  renderDashboardSuppliersLoad(suppliers) {
    const container = document.getElementById('dashboard-suppliers-list');
    if (!container) return;

    container.innerHTML = suppliers.map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-elevated); padding:10px 14px; border-radius:var(--radius-md);">
        <div>
          <div style="font-weight:600; font-size:13px;">${s.name}</div>
          <div style="font-size:11px; color:var(--text-dim);">${s.specialties}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:12px; color:var(--text-muted);">${s.active_jobs} đơn đang chạy</span>
          <span class="badge ${s.active_jobs > 0 ? 'badge-producing' : 'badge-draft'}">
            ${s.active_jobs > 0 ? 'Đang In' : 'Rảnh'}
          </span>
        </div>
      </div>
    `).join('');
  },

  // ==========================================
  // 2. PRICING & IMPOSITION ENGINE
  // ==========================================
  setupPricingListeners() {
    this.state.pricingGroup = this.state.pricingGroup || 'DIGITAL';
    const card = document.querySelector('#tab-pricing .calculator-card');
    if (!card) return;

    let timer = null;
    const trigger = () => { clearTimeout(timer); timer = setTimeout(() => this.triggerPricingCalculation(), 150); };

    document.querySelectorAll('[data-pricing-group]').forEach(btn => {
      btn.addEventListener('click', () => this.setPricingGroup(btn.dataset.pricingGroup));
    });

    document.getElementById('calc-preset').addEventListener('change', (e) => {
      const p = this.pricingPresets[this.state.pricingGroup].find(x => x.key === e.target.value);
      if (p) this.applyPricingPreset(p);
      trigger();
    });

    card.querySelectorAll('input, select').forEach(el => {
      if (el.id === 'calc-preset') return;
      el.addEventListener(el.type === 'number' || el.type === 'range' ? 'input' : 'change', () => {
        if (el.id === 'calc-doc-size' || el.id === 'calc-doc-ruot-print') {
          this.updateDocRuotPriceTag();
        }
        trigger();
      });
    });

    document.getElementById('calc-margin-slider').addEventListener('input', (e) => {
      document.getElementById('margin-slider-value').textContent = `${e.target.value}%`;
    });

    this.setPricingGroup(this.state.pricingGroup);
    this.updateDocRuotPriceTag();
  },

  // Cập nhật tag đơn giá in ruột hiển thị trực quan ngay trên form nhập liệu
  updateDocRuotPriceTag() {
    const tag = document.getElementById('doc-ruot-price-tag');
    if (!tag) return;
    const size = (document.getElementById('calc-doc-size')?.value || 'A5').toUpperCase();
    const ruotPrint = (document.getElementById('calc-doc-ruot-print')?.value || '').toLowerCase();
    const isColor = ruotPrint.includes('màu');
    const is2S = ruotPrint.includes('2 mặt');
    
    let priceText = '350 đ/tờ';
    if (!isColor) {
      if (size === 'A5') priceText = is2S ? '200 đ/tờ' : '225 đ/tờ';
      else if (size === 'A3') priceText = is2S ? '700 đ/tờ' : '500 đ/tờ';
      else priceText = is2S ? '350 đ/tờ' : '250 đ/tờ'; // A4
    } else {
      if (size === 'A5') priceText = is2S ? '1.500 đ/tờ' : '1.000 đ/tờ';
      else if (size === 'A3') priceText = is2S ? '5.000 đ/tờ' : '3.500 đ/tờ';
      else priceText = is2S ? '2.800 đ/tờ' : '1.800 đ/tờ'; // A4
    }
    tag.textContent = `${priceText} (${size})`;
  },

  // Sản phẩm mẫu theo 3 nhóm (kích thước mm)
  pricingPresets: {
    DIGITAL: [
      { key: 'NAMECARD', name: 'Name card 9 x 5.4 cm (hộp 100 con)', w: 90, h: 54, qty: 5, pcs: 100, unit: 'hộp', paper: 'C300', lam: 'MATTE_2S' },
      { key: 'FLYER_A5', name: 'Tờ rơi A5', w: 148, h: 210, qty: 500, pcs: 1, unit: 'tờ', paper: 'C150' },
      { key: 'FLYER_A4', name: 'Tờ rơi / tài liệu A4', w: 210, h: 297, qty: 200, pcs: 1, unit: 'tờ', paper: 'C150' },
      { key: 'A3', name: 'Poster / tài liệu A3', w: 297, h: 420, qty: 50, pcs: 1, unit: 'tờ', paper: 'C200' },
      { key: 'MENU_A4', name: 'Menu A4 cán màng', w: 210, h: 297, qty: 30, pcs: 1, unit: 'tờ', paper: 'C300', lam: 'MATTE_2S' },
      { key: 'VOUCHER', name: 'Voucher 7 x 15 cm', w: 70, h: 150, qty: 500, pcs: 1, unit: 'phiếu', paper: 'C250' },
      { key: 'DECAL_LABEL', name: 'Tem nhãn decal 5 x 5 cm', w: 50, h: 50, qty: 1000, pcs: 1, unit: 'con', paper: 'DECAL', sides: 1, fin: ['DIE_CUT_DEMI'] },
      { key: 'CUSTOM', name: 'Kích thước tùy chỉnh', custom: true }
    ],
    OFFSET: [
      { key: 'FLYER_A5', table: 'FLYER_A5', name: 'Tờ rơi A5 15x21 in 2 mặt', w: 150, h: 210, qty: 1000, unit: 'tờ', variants: ['C100', 'C150', 'C200', 'C300'], def: 'C150' },
      { key: 'FLYER_A4', table: 'FLYER_A4', name: 'Tờ rơi / Brochure A4 in 2 mặt', w: 210, h: 297, qty: 1000, unit: 'tờ', variants: ['C100', 'C150', 'C200', 'C300'], def: 'C150' },
      { key: 'NAMECARD', table: 'NAMECARD', name: 'Namecard C300 cán mờ 2 mặt (hộp 100 cái)', w: 90, h: 54, qty: 5, unit: 'hộp', variants: ['C300'] },
      { key: 'FOLDER', table: 'FOLDER', name: 'Folder / Bìa hồ sơ 22x31x7 cm', w: 220, h: 310, qty: 500, unit: 'cái', variants: ['C300'] },
      { key: 'ENVELOPE_S', table: 'ENVELOPE_S', name: 'Bao thư nhỏ 12 x 22 cm', w: 120, h: 220, qty: 1000, unit: 'cái', variants: ['F100'] },
      { key: 'ENVELOPE_M', table: 'ENVELOPE_M', name: 'Bao thư trung 17 x 23 cm', w: 170, h: 230, qty: 1000, unit: 'cái', variants: ['F100'] },
      { key: 'ENVELOPE_L', table: 'ENVELOPE_L', name: 'Bao thư lớn A4 25 x 34 cm', w: 250, h: 340, qty: 1000, unit: 'cái', variants: ['F100'] },
      { key: 'LETTERHEAD', table: 'LETTERHEAD', name: 'Tiêu đề thư A4 in 1 mặt', w: 210, h: 297, qty: 1000, unit: 'tờ', variants: ['F100', 'F120'] },
      { key: 'CATALOGUE', table: 'CATALOGUE', name: 'Catalogue A4 bấm ghim', w: 210, h: 297, qty: 500, unit: 'cuốn', variants: ['P8', 'P16', 'P24', 'P32'], def: 'P16' },
      { key: 'VOUCHER', table: 'VOUCHER', name: 'Voucher 5.4 x 18.5 cm', w: 54, h: 185, qty: 1000, unit: 'cái', variants: ['C300'] },
      { key: 'TAG', table: 'TAG', name: 'Tag treo 4.5 x 4.5 cm', w: 45, h: 45, qty: 1000, unit: 'cái', variants: ['C300'] },
      { key: 'CUSTOM', name: 'Kích thước tùy chỉnh (tính theo công thức kẽm/giấy)', custom: true }
    ],
    LARGE_FORMAT: [
      { key: 'BANNER', name: 'Băng rôn bạt 0.8 x 5 m', w: 5000, h: 800, qty: 2, unit: 'tấm', material: 'HIFLEX', fin: ['EYELET', 'HEM'] },
      { key: 'BILLBOARD', name: 'Bạt pano 3 x 6 m', w: 6000, h: 3000, qty: 1, unit: 'tấm', material: 'HIFLEX', fin: ['EYELET', 'HEM'] },
      { key: 'STANDEE', name: 'Standee PP 0.6 x 1.6 m', w: 600, h: 1600, qty: 2, unit: 'bộ', material: 'PP', fin: ['LAMINATE', 'STANDEE'] },
      { key: 'POSTER', name: 'Poster A1 (594 x 841)', w: 594, h: 841, qty: 5, unit: 'tấm', material: 'POSTER' },
      { key: 'DECAL_GLASS', name: 'Decal dán kính 1.2 x 2 m', w: 1200, h: 2000, qty: 2, unit: 'tấm', material: 'DECAL' },
      { key: 'LIGHTBOX', name: 'Hộp đèn backlit 0.6 x 0.9 m', w: 600, h: 900, qty: 1, unit: 'hộp', material: 'BACKLIT', fin: ['LIGHTBOX'] },
      { key: 'CANVAS', name: 'Tranh canvas 0.4 x 0.6 m', w: 400, h: 600, qty: 3, unit: 'tấm', material: 'CANVAS', fin: ['FRAME'] },
      { key: 'SIGN', name: 'Bảng hiệu bạt khung 1.2 x 4 m', w: 4000, h: 1200, qty: 1, unit: 'bảng', material: 'HIFLEX', fin: ['FRAME', 'INSTALL'] },
      { key: 'CUSTOM', name: 'Kích thước tùy chỉnh', custom: true }
    ],
    DOCUMENT_SPIRAL: [
      {
        key: 'A4_BIA_CUNG_LOXO_KINH',
        name: 'Tài liệu A4 - Bìa cứng + Lò xo + Đóng kính (80 tờ F80)',
        w: 210, h: 297, qty: 10, unit: 'cuốn',
        size: 'A4', pages: 160, ruotPrint: '2 mặt Trắng Đen',
        bindingPackage: 'HARD_SPIRAL_GLASS',
        frontPrint: 'In màu 1 mặt', backPrint: 'Không in / Bìa trơn'
      },
      {
        key: 'A4_BIA_CUNG_LOXO',
        name: 'Tài liệu A4 - Bìa cứng + Đóng lò xo (80 tờ F80)',
        w: 210, h: 297, qty: 10, unit: 'cuốn',
        size: 'A4', pages: 160, ruotPrint: '2 mặt Trắng Đen',
        bindingPackage: 'HARD_SPIRAL',
        frontPrint: 'In màu 1 mặt', backPrint: 'Không in / Bìa trơn'
      },
      {
        key: 'A5_BIA_CUNG_LOXO',
        name: 'Tài liệu A5 - Bìa cứng + Đóng lò xo (80 tờ F80)',
        w: 148, h: 210, qty: 10, unit: 'cuốn',
        size: 'A5', pages: 160, ruotPrint: '2 mặt Trắng Đen',
        bindingPackage: 'HARD_SPIRAL',
        frontPrint: 'In màu 1 mặt', backPrint: 'Không in / Bìa trơn'
      },
      {
        key: 'KN_GIAO_TIEP_FEDEX',
        name: 'KN GIAO TIEP HIEU QUA_ FEDEX_FINAL (A5)',
        w: 148, h: 210, qty: 27, unit: 'cuốn',
        size: 'A5', pages: 67, ruotPrint: '1 mặt Trắng Đen',
        bindingPackage: 'HARD_SPIRAL',
        frontPrint: 'In màu 1 mặt', backPrint: 'In thêm bìa sau'
      },
      { key: 'CUSTOM', name: 'Tùy chỉnh tài liệu đóng cuốn', custom: true }
    ]
  },

  setPricingGroup(group) {
    this.state.pricingGroup = group;
    document.querySelectorAll('[data-pricing-group]').forEach(b => b.classList.toggle('active', b.dataset.pricingGroup === group));
    document.querySelectorAll('.pricing-group-fields').forEach(el => { el.style.display = el.dataset.group === group ? '' : 'none'; });
    document.getElementById('fg-pcs-per-unit').style.display = group === 'DIGITAL' ? '' : 'none';
    const isDoc = (group === 'DOCUMENT_SPIRAL');
    const widthEl = document.getElementById('calc-width');
    if (widthEl) {
      const dimRow = widthEl.closest('.form-row');
      if (dimRow) dimRow.style.display = isDoc ? 'none' : '';
    }
    const supplierDefault = { DIGITAL: 'ncc_ngocminh', OFFSET: 'ncc_thanhdanh', LARGE_FORMAT: 'ncc_sackim', DOCUMENT_SPIRAL: 'ncc_ttl' };
    const supEl = document.getElementById('calc-supplier');
    if (supEl) supEl.value = supplierDefault[group] || 'ncc_ngocminh';

    const presets = this.pricingPresets[group];
    document.getElementById('calc-preset').innerHTML = presets.map(p => `<option value="${p.key}">${p.name}</option>`).join('');
    this.applyPricingPreset(presets[0]);
    this.triggerPricingCalculation();
  },

  applyPricingPreset(p) {
    if (this.state.pricingGroup === 'OFFSET') {
      const isTable = !!(p && p.table);
      document.getElementById('fg-off-variant').style.display = isTable ? '' : 'none';
      document.getElementById('off-tech-fields').style.display = isTable ? 'none' : '';
      if (isTable) {
        const label = (k) => k.startsWith('P') ? `${k.slice(1)} trang` : k;
        document.getElementById('calc-off-variant').innerHTML = p.variants.map(k => `<option value="${k}"${k === (p.def || p.variants[0]) ? ' selected' : ''}>${label(k)}</option>`).join('');
      }
    }
    if (!p || p.custom) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
    set('calc-width', p.w); set('calc-height', p.h); set('calc-quantity', p.qty);
    const fields = document.querySelector(`.pricing-group-fields[data-group="${this.state.pricingGroup}"]`);
    fields.querySelectorAll('input[type="checkbox"][value]').forEach(c => { c.checked = (p.fin || []).includes(c.value); });
    if (this.state.pricingGroup === 'DIGITAL') {
      set('calc-pcs-per-unit', p.pcs || 1); set('calc-dig-paper', p.paper || 'C150');
      set('calc-dig-sides', p.sides || 2); set('calc-dig-lam', p.lam || 'NONE');
    } else if (this.state.pricingGroup === 'OFFSET') {
      set('calc-off-gsm', p.gsm || 150); set('calc-off-paper', p.paperType || 'COUCHE');
      set('calc-off-cf', p.cf ?? 4); set('calc-off-cb', p.cb ?? 4); set('calc-off-lam', p.lam || 'NONE');
      const wt = document.getElementById('calc-off-wt'); if (wt) wt.checked = false;
    } else if (this.state.pricingGroup === 'DOCUMENT_SPIRAL') {
      set('calc-doc-size', p.size || 'A5');
      set('calc-doc-pages', p.pages || 67);
      set('calc-doc-ruot-print', p.ruotPrint || '2 mặt Trắng Đen');
      set('calc-doc-binding-package', p.bindingPackage || 'HARD_SPIRAL');
      set('calc-doc-front-print', p.frontPrint || 'In màu 1 mặt');
      set('calc-doc-back-print', p.backPrint || 'Không in / Bìa trơn');
      this.updateDocRuotPriceTag();
    } else {
      set('calc-lf-material', p.material || 'HIFLEX');
    }
    const lbl = document.getElementById('calc-qty-label');
    lbl.textContent = `Số lượng (${p.unit || 'sản phẩm'})`;
    this.state.pricingUnit = p.unit;
    this.state.pricingProductName = p.name;
  },

  collectPricingInput() {
    const g = this.state.pricingGroup;
    const v = (id) => document.getElementById(id)?.value;
    const fields = document.querySelector(`.pricing-group-fields[data-group="${g}"]`);
    const finishing = [...fields.querySelectorAll('input[type="checkbox"][value]:checked')].map(c => c.value);
    const presetSel = document.getElementById('calc-preset');
    const preset = this.pricingPresets[g].find(x => x.key === presetSel.value);
    const input = {
      group: g,
      productName: preset && !preset.custom ? preset.name : `Sản phẩm ${v('calc-width')}x${v('calc-height')}mm`,
      unit: preset && !preset.custom ? preset.unit : (g === 'LARGE_FORMAT' ? 'tấm' : 'cái'),
      quantity: parseInt(v('calc-quantity')) || 1,
      width: parseFloat(v('calc-width')) || 0,
      height: parseFloat(v('calc-height')) || 0,
      overheadPercent: parseFloat(v('calc-overhead')) || 0,
      marginPercent: parseInt(v('calc-margin-slider')) || 40,
      finishing
    };
    if (g === 'DIGITAL') Object.assign(input, {
      pcsPerUnit: parseInt(v('calc-pcs-per-unit')) || 1, sheetSize: v('calc-dig-sheet'),
      paper: v('calc-dig-paper'), printSides: parseInt(v('calc-dig-sides')), lamination: v('calc-dig-lam')
    });
    if (g === 'OFFSET') Object.assign(input, {
      sheetSize: v('calc-off-sheet'), paperType: v('calc-off-paper'), gsm: parseFloat(v('calc-off-gsm')),
      colorsFront: parseInt(v('calc-off-cf')), colorsBack: parseInt(v('calc-off-cb')),
      workAndTurn: document.getElementById('calc-off-wt').checked, lamination: v('calc-off-lam'),
      offsetProduct: preset && preset.table ? preset.table : null, offsetVariant: v('calc-off-variant')
    });
    if (g === 'LARGE_FORMAT') input.material = v('calc-lf-material');
    if (g === 'DOCUMENT_SPIRAL') {
      const docSize = v('calc-doc-size') || 'A5';
      const sizeDims = { A5: { w: 148, h: 210 }, A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
      input.width = sizeDims[docSize]?.w || 148;
      input.height = sizeDims[docSize]?.h || 210;
      input.size = docSize;
      input.kho_thanh_pham = docSize;
      input.unit = 'cuốn';
      
      const pkg = v('calc-doc-binding-package') || 'HARD_SPIRAL';
      const isHard = pkg.startsWith('HARD');
      const hasGlass = pkg.endsWith('GLASS');

      input.hasGlass = hasGlass;
      input.ruot = {
        pages: parseInt(v('calc-doc-pages')) || 1,
        so_trang: parseInt(v('calc-doc-pages')) || 1,
        printMode: v('calc-doc-ruot-print'),
        che_do_in: v('calc-doc-ruot-print'),
        paper: 'F80'
      };
      input.front = {
        paper: isHard ? 'Bìa cứng' : 'Bìa mềm',
        loai_giay: isHard ? 'Bìa cứng' : 'Bìa mềm',
        printMode: v('calc-doc-front-print'),
        che_do_in: v('calc-doc-front-print')
      };
      input.back = {
        paper: 'Couche / Ivory',
        loai_giay: 'Couche / Ivory',
        printMode: v('calc-doc-back-print'),
        che_do_in: v('calc-doc-back-print')
      };
    }
    return input;
  },

  async triggerPricingCalculation() {
    if (!document.getElementById('calc-preset') || !this.state.pricingGroup) return;
    const input = this.collectPricingInput();
    const errBox = document.getElementById('calc-error');

    try {
      const res = await fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi tính giá');
      errBox.style.display = 'none';
      this.state.currentPricingCalc = data;

      const isAdmin = (this.state.currentRole === 'ADMIN');
      const isSales = (this.state.currentRole === 'SALES');

      // Với quyền không phải Admin: lọc bỏ hoặc ẩn tên xưởng, tên bảng giá xưởng (NCC)
      let metrics = data.metrics || [];
      let impositionNote = data.impositionNote || '';

      if (!isAdmin) {
        metrics = metrics
          .filter(m => {
            const lbl = (m.label || '').toLowerCase();
            return !lbl.includes('ncc') && !lbl.includes('giá gốc') && !lbl.includes('cách tính');
          })
          .map(m => {
            let val = m.value || '';
            // Ẩn tên xưởng và tên bảng giá xưởng nếu có trong nội dung
            val = val.replace(/(?:bảng giá|xưởng|nhà cung cấp|ncc)\s*(?:in\s+)?(?:thành danh|ngọc minh|sắc kim|ttl copier|đại nam)[^—\–\-\,]*/gi, 'Tiêu chuẩn kỹ thuật')
                     .replace(/\(tính giá NCC\)/gi, '')
                     .replace(/\s+/g, ' ')
                     .trim();
            return { ...m, value: val };
          });

        impositionNote = impositionNote
          .replace(/(?:theo bảng giá|theo bảng|tại xưởng|xưởng)\s*(?:in\s+)?(?:thành danh|ngọc minh|sắc kim|ttl copier|đại nam)[^\.\,]*/gi, 'theo tiêu chuẩn sản xuất')
          .replace(/(?:thành danh|ngọc minh|sắc kim|ttl copier|đại nam)/gi, 'xưởng đối tác')
          .trim();
      }

      document.getElementById('calc-metrics').innerHTML = metrics.map(m => `
        <div class="calc-row"><span>${m.label}:</span><span style="font-weight:600; color: var(--text-main); text-align:right;">${m.value}</span></div>
      `).join('');

      document.getElementById('calc-cost-lines').innerHTML = data.lines.map(l => `
        <div class="calc-row"><span><small style="color:var(--text-dim);">[${l.group}]</small> ${l.name}</span><span>${this.formatCurrency(l.cost)}</span></div>
      `).join('') + `
        <div class="calc-row"><span>Chi phí trực tiếp:</span><span>${this.formatCurrency(data.directCost)}</span></div>
        <div class="calc-row"><span>Chi phí phân bổ (${input.overheadPercent}%):</span><span>${this.formatCurrency(data.overheadCost)}</span></div>
        <div class="calc-row highlight"><span>Tổng giá vốn:</span><span style="color: var(--accent-amber);">${this.formatCurrency(data.totalCost)} (${this.formatCurrency(data.unitCost)} / ${data.baseUnit})</span></div>
      `;

      document.getElementById('res-suggested-total').textContent = this.formatCurrency(data.suggestedSellingPrice);
      let unitTxt = `Đơn giá bán: ${this.formatCurrency(data.unitPrice)} / ${data.baseUnit}`;
      if (data.volumeDiscountPct) unitTxt += ` · đã giảm ${data.volumeDiscountPct}% theo lô`;
      if (data.minOrderApplied) unitTxt += ` · áp giá tối thiểu ${this.formatCurrency(data.minOrder)}`;
      document.getElementById('res-unit-rate').textContent = unitTxt;
      document.getElementById('res-profit-margin').textContent = `Lợi nhuận gộp dự kiến: ${this.formatCurrency(data.grossProfit)} (Margin ${data.actualMargin}%)`;
      document.getElementById('imposition-sheet-note').textContent = impositionNote;
      this.renderImpositionSvg(data.layout, data.group);

      document.querySelectorAll('.col-cost-profit').forEach(el => { el.style.display = isSales ? 'none' : ''; });
    } catch (err) {
      this.state.currentPricingCalc = null;
      errBox.textContent = `⚠️ ${err.message}`;
      errBox.style.display = 'block';
    }
  },

  // Vẽ sơ đồ bình bài theo đúng tỷ lệ (tờ in hoặc khổ cuộn)
  renderImpositionSvg(layout, group) {
    const svg = document.getElementById('imposition-svg');
    if (!svg || !layout) return;
    const tag = document.getElementById('sheet-title-tag');
    let W, H, rects = [], border = '';

    if (layout.type === 'roll') {
      W = layout.roll;
      const rowsShown = Math.min(layout.rowsNeeded, 6);
      H = rowsShown * layout.itemH;
      for (let r = 0; r < rowsShown; r++) for (let c = 0; c < layout.perRow; c++) {
        rects.push({ x: c * layout.itemW, y: r * layout.itemH, w: Math.min(layout.itemW, W), h: layout.itemH });
      }
      tag.textContent = `KHỔ CUỘN ${layout.roll} MM${layout.rowsNeeded > rowsShown ? ` (hiển thị ${rowsShown}/${layout.rowsNeeded} hàng)` : ''}`;
    } else if (group === 'DOCUMENT_SPIRAL') {
      W = layout.sheetW; H = layout.sheetH;
      tag.textContent = `TÀI LIỆU KHỔ ${document.getElementById('calc-doc-size')?.value || 'A5'} — ĐÓNG LÒ XO XOẮN`;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      // Vẽ mô phỏng cuốn sách với gáy lò xo bên trái
      const wireCount = 12;
      const wirePitch = (H - 20) / wireCount;
      let wiresSvg = '';
      for (let i = 0; i < wireCount; i++) {
        const wy = 10 + i * wirePitch + wirePitch / 2;
        wiresSvg += `<ellipse cx="14" cy="${wy}" rx="5" ry="3.5" fill="none" stroke="#f59e0b" stroke-width="2.5"/>`;
      }
      svg.innerHTML = `
        <rect x="12" y="8" width="${W - 18}" height="${H - 16}" rx="3" fill="#ffffff" fill-opacity="0.12" stroke="#6366f1" stroke-width="2"/>
        <rect x="18" y="14" width="${W - 30}" height="${H - 28}" rx="2" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-dasharray="3,3"/>
        <line x1="26" y1="8" x2="26" y2="${H - 8}" stroke="#475569" stroke-width="1.5"/>
        <text x="${W / 2 + 5}" y="${H / 2 - 8}" font-size="${Math.round(W / 11)}" fill="#e2e8f0" text-anchor="middle" font-weight="600">RUỘT ${document.getElementById('calc-doc-pages')?.value || 67} TRANG</text>
        <text x="${W / 2 + 5}" y="${H / 2 + 16}" font-size="${Math.round(W / 14)}" fill="#94a3b8" text-anchor="middle">${document.getElementById('calc-doc-size')?.value || 'A5'} • LÒ XO XOẮN</text>
        ${wiresSvg}
      `;
      return;
    } else {
      W = layout.sheetW; H = layout.sheetH;
      const iw = layout.rotated ? layout.itemH : layout.itemW;
      const ih = layout.rotated ? layout.itemW : layout.itemH;
      const usedW = layout.cols * iw + (layout.cols - 1) * layout.gap;
      const usedH = layout.rows * ih + (layout.rows - 1) * layout.gap;
      const ox = (W - usedW) / 2, oy = (H - usedH) / 2;
      for (let r = 0; r < layout.rows; r++) for (let c = 0; c < layout.cols; c++) {
        rects.push({ x: ox + c * (iw + layout.gap), y: oy + r * (ih + layout.gap), w: iw, h: ih });
      }
      border = `<rect x="${layout.margin}" y="${layout.margin}" width="${W - 2 * layout.margin}" height="${H - 2 * layout.margin}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-dasharray="${W / 80}" stroke-width="${W / 400}"/>`;
      tag.textContent = `${group === 'OFFSET' ? 'TỜ IN OFFSET' : 'KHỔ IN'} ${W / 10} x ${H / 10} CM — ${layout.ups} CON`;
    }

    const sw = Math.max(W, H) / 300;
    const fs = Math.min(...rects.map(r => Math.min(r.w, r.h))) / 4;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.4)" stroke-width="${sw}"/>
      ${border}
      ${rects.map((r, i) => `
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(99,102,241,0.35)" stroke="#a5b4fc" stroke-width="${sw}"/>
        ${rects.length <= 60 ? `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="${fs}" fill="#e0e7ff" text-anchor="middle" dominant-baseline="middle">${i + 1}</text>` : ''}
      `).join('')}
    `;
  },

  // Helper: Lọc bỏ thông tin kỹ thuật nội bộ xưởng (khổ in, lượt in, màu kẽm...) để không lộ cho khách
  cleanSpecsForCustomer(specs) {
    if (!specs) return '';
    return specs
      .replace(/,?\s*in\s+(?:4\/[04]|1\/[01]|2\/[02]|trở nhíp|\d+\s*màu[^\,\;]*)/gi, '')
      .replace(/,?\s*(?:tờ in\s*)?Khổ\s*[\d\.\,x\s]+(?:cm|mm)/gi, '')
      .replace(/,?\s*khổ cuộn\s*[\d\.\,x\s]+(?:cm|mm)/gi, '')
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim();
  },

  // Chuyển kết quả tính giá sang modal tạo đơn hàng (1 click)
  transferPricingToOrder() {
    if (!this.state.currentPricingCalc) return;
    const p = this.state.currentPricingCalc;
    const input = this.collectPricingInput();
    const supplierId = document.getElementById('calc-supplier').value;

    let paper = '';
    if (input.group === 'DIGITAL') paper = input.paper;
    else if (input.group === 'OFFSET') paper = input.offsetProduct ? input.offsetVariant : `${input.paperType} ${input.gsm}gsm`;
    else if (input.group === 'DOCUMENT_SPIRAL') paper = `Bìa: ${input.front?.paper || 'Ivory'} / Ruột: Fort 80gsm`;
    else paper = input.material;

    // Quy cách gửi khách hàng: loại bỏ thông tin kỹ thuật xưởng
    let specs = `[${p.groupLabel}] ${this.cleanSpecsForCustomer(p.specs) || p.specs}`;
    if (input.lamination && input.lamination !== 'NONE') specs += `, cán ${input.lamination.startsWith('MATTE') ? 'mờ' : 'bóng'} ${input.lamination.endsWith('_1S') ? '1' : '2'} mặt`;
    if (input.finishing.length) specs += `, gia công: ${input.finishing.join(', ')}`;

    // Thông tin kỹ thuật nội bộ xưởng & bình bài
    const technicalWorkshopInfo = `[${p.specs}] | ${p.impositionNote || ''}`;

    this.openNewOrderModal({
      items: [{
        item_name: p.productName,
        size: `${input.width}x${input.height}mm`,
        quantity: p.quantity,
        unit: p.baseUnit,
        paper_gsm: paper,
        specs,
        imposition_info: technicalWorkshopInfo,
        supplier_id: supplierId,
        unit_cost: p.unitCost,
        unit_price: p.unitPrice,
        file_url: ''
      }]
    });
  },

  // Copy nội dung báo giá nhanh để gửi khách hàng qua Zalo / Tin nhắn / Email
  async copyPricingQuote() {
    if (!this.state.currentPricingCalc) {
      return alert('Chưa có kết quả tính giá để copy!');
    }

    const p = this.state.currentPricingCalc;
    const input = this.collectPricingInput();
    const settings = this.state.settings || (window.Admin && Admin.settings) || {};
    const companyName = settings.company_name || 'IN TIA CHỚP';
    
    // Ưu tiên SĐT của user đang đăng nhập (nhân viên kinh doanh/tư vấn), nếu không có thì lấy hotline công ty
    const currentUserPhone = this.state.currentUser?.phone;
    const currentUserName = this.state.currentUser?.full_name;
    const hotline = currentUserPhone || settings.company_hotline || '0917 667 937';
    const supportContactText = currentUserPhone 
      ? `${currentUserPhone} (${currentUserName || 'Tư vấn viên'})`
      : hotline;

    let paperText = '';
    if (input.group === 'DIGITAL') paperText = `Giấy ${input.paper || 'C150'}`;
    else if (input.group === 'OFFSET') paperText = input.offsetProduct ? input.offsetVariant : `${input.paperType} ${input.gsm}gsm`;
    else if (input.group === 'DOCUMENT_SPIRAL') paperText = `Bìa trước: ${input.front?.paper || 'Ivory 300gsm'} • Bìa sau: ${input.back?.paper || 'Couche/Ivory'} • Ruột: ${input.ruot?.pages || 67} trang (${input.ruot?.printMode || '1 mặt Trắng Đen'})`;
    else paperText = input.material || 'Bạt / Decal';

    let lamText = 'Không cán';
    if (input.lamination && input.lamination !== 'NONE') {
      const type = input.lamination.startsWith('MATTE') ? 'màng mờ' : 'màng bóng';
      const side = input.lamination.endsWith('_1S') ? '1 mặt' : '2 mặt';
      lamText = `Cán ${type} ${side}`;
    }

    let finishText = '';
    if (input.finishing && input.finishing.length) {
      finishText = `\n• Gia công: ${input.finishing.join(', ')}`;
    }

    // Loại bỏ thông tin kỹ thuật xưởng "in 4/4, Khổ ..." khi gửi cho khách
    const cleanSpecs = this.cleanSpecsForCustomer(p.specs);

    const quoteText = 
`⚡ BÁO GIÁ IN ẤN - ${companyName.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━
📦 Sản phẩm: ${p.productName}
📐 Kích thước: ${input.width} × ${input.height} mm
🔢 Số lượng: ${this.formatNumber(p.quantity)} ${p.baseUnit}
📄 Chất liệu: ${paperText}
${cleanSpecs ? `✨ Quy cách: ${cleanSpecs}\n` : ''}🛡️ Màng: ${lamText}${finishText}
━━━━━━━━━━━━━━━━━━━━━━
💰 Đơn giá: ${this.formatCurrency(p.unitPrice)} / ${p.baseUnit}
💵 TỔNG TIỀN: ${this.formatCurrency(p.suggestedSellingPrice)} (chưa gồm VAT)
━━━━━━━━━━━━━━━━━━━━━━
⏱️ Thời gian sản xuất: 1 - 2 ngày làm việc
📞 Hotline / Zalo hỗ trợ: ${supportContactText}
Cảm ơn Quý khách đã tin tưởng đồng hành cùng ${companyName}!`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(quoteText);
      } else {
        // Fallback cho trình duyệt cũ
        const ta = document.createElement('textarea');
        ta.value = quoteText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      // Hiệu ứng đổi nhãn nút tạm thời
      const btn = document.getElementById('btn-copy-pricing-quote');
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ ĐÃ COPY BÁO GIÁ!';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-accent');
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.classList.remove('btn-accent');
          btn.classList.add('btn-secondary');
        }, 2200);
      }
    } catch (err) {
      alert('Không thể tự động copy: ' + err.message + '\n\nNội dung:\n' + quoteText);
    }
  },

  // ==========================================
  // 3. ORDERS & QUOTES MANAGEMENT
  // ==========================================
  async loadOrders() {
    try {
      const { status, type, q } = this.state.filters;
      let url = '/api/orders?';
      if (status && status !== 'ALL') url += `status=${encodeURIComponent(status)}&`;
      if (type) url += `type=${encodeURIComponent(type)}&`;
      if (q) url += `q=${encodeURIComponent(q)}&`;

      console.log('[loadOrders] Gọi URL:', url, '| Role:', this.state.currentRole, '| Filters:', JSON.stringify(this.state.filters));

      const res = await fetch(url);
      console.log('[loadOrders] HTTP status:', res.status, res.ok);

      if (!res.ok) {
        const errText = await res.text();
        console.error('[loadOrders] Server lỗi:', res.status, errText);
        return;
      }
      const orders = await res.json();
      console.log('[loadOrders] Nhận được', Array.isArray(orders) ? orders.length : 'KHÔNG PHẢI ARRAY', 'đơn hàng:', orders);
      // Bảo vệ: chỉ gán nếu server trả về array hợp lệ
      this.state.orders = Array.isArray(orders) ? orders : [];

      this.renderOrdersTable();
      console.log('[loadOrders] renderOrdersTable() hoàn tất, state.orders.length =', this.state.orders.length);
    } catch (err) {
      console.error('[loadOrders] Exception:', err);
    }
  },


  renderOrdersTable() {
    const tbody = document.getElementById('orders-table-tbody');
    console.log('[renderOrdersTable] tbody exists:', !!tbody, '| orders count:', this.state.orders?.length, '| role:', this.state.currentRole);
    if (!tbody) return;

    if (!this.state.orders || this.state.orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:var(--text-muted);">Không tìm thấy đơn hàng nào</td></tr>`;
      return;
    }

    const isSales = (this.state.currentRole === 'SALES');

    // Cập nhật header bảng
    document.querySelectorAll('#orders-main-table th.col-cost-profit').forEach(th => {
      th.style.display = isSales ? 'none' : '';
    });
    // Ẩn cột xưởng in / file in với Sales
    document.querySelectorAll('#orders-main-table th.col-supplier-info').forEach(th => {
      th.style.display = isSales ? 'none' : '';
    });

    try {
      tbody.innerHTML = this.state.orders.map(o => {
        const itemsList = (o.items || []).map(it => `
          <div style="margin-bottom:4px;">
            <strong>• ${it.item_name}</strong> (${it.quantity} ${it.unit})
            <div style="font-size:11px; color:var(--text-dim);">${it.specs || ''}</div>
          </div>
        `).join('');

        const firstItem = (o.items || [])[0] || {};
        const fileLink = firstItem.file_url ? `
          <a href="${firstItem.file_url}" target="_blank" style="color:var(--primary-light); text-decoration:none;" title="Mở file in">🔗 Link File</a>
        ` : '<span style="color:var(--text-dim);">Chưa có</span>';

        const supplierName = firstItem.supplier_name || 'Chưa gán';
        // Escape customer_name để tránh lỗi onclick string
        const safeCustomerName = (o.customer_name || '').replace(/'/g, '\\&apos;');

        return `
          <tr>
            <td>
              <strong>${o.code}</strong>
              <div style="font-size:11px; color:var(--text-dim);">${new Date(o.created_at).toLocaleDateString('vi-VN')}</div>
            </td>
            <td>
              <span class="badge ${o.type === 'QUOTE' ? 'badge-quote' : 'badge-confirmed'}">
                ${o.type === 'QUOTE' ? 'BÁO GIÁ' : 'ĐƠN HÀNG'}
              </span>
            </td>
            <td>
              <div style="font-weight:600;">${o.customer_name || ''}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">
                ${o.contact_name ? `👤 ${o.contact_name}` : ''} ${o.customer_phone || ''}
              </div>
            </td>
            <td style="max-width:220px; white-space:normal;">
              ${itemsList || '<span style="color:var(--text-dim);">Không có chi tiết</span>'}
            </td>
            <td class="col-supplier-info" style="${isSales ? 'display:none;' : ''}">${fileLink}</td>
            <td class="col-supplier-info" style="${isSales ? 'display:none;' : ''}">
              <span style="font-weight:600; color:var(--accent-amber);">${supplierName}</span>
            </td>
            <td style="font-weight:700; color:var(--primary-light);">
              ${this.formatCurrency(o.total_selling)}
              ${o.shipping_fee > 0 ? `<div style="font-size:10px; color:var(--primary-light);">🚚 Ship: +${this.formatCurrency(o.shipping_fee)}</div>` : ''}
              ${o.vat_rate > 0 ? `<div style="font-size:10px; color:var(--text-dim);">Gồm VAT ${o.vat_rate}%</div>` : ''}
            </td>
            <td class="col-cost-profit" style="${isSales ? 'display:none;' : ''} color:var(--accent-amber); font-weight:600;">
              ${this.formatCurrency(o.total_cost)}
            </td>
            <td class="col-cost-profit" style="${isSales ? 'display:none;' : ''} color:var(--accent-green); font-weight:700;">
              ${this.formatCurrency(o.gross_profit)}
            </td>
            <td>
              <div style="font-size:12px;">
                ${o.payment_status === 'PAID' ? '<span class="badge badge-paid">Đã TT Đủ</span>' : (o.payment_status === 'PARTIAL' ? '<span class="badge badge-partial">Đã Cọc</span>' : '<span class="badge badge-unpaid">Chưa TT</span>')}
              </div>
              ${o.remaining_amount > 0 ? `<div style="font-size:11px; color:var(--accent-rose); margin-top:2px;">Còn nợ: ${this.formatCurrency(o.remaining_amount)}</div>` : ''}
            </td>
            <td>
              <select class="role-select" onchange="App.changeOrderStatus('${o.id}', this.value)" style="font-size:11.5px; padding:3px 6px;">
                <option value="DRAFT" ${o.status === 'DRAFT' ? 'selected' : ''}>Nháp</option>
                <option value="QUOTE_SENT" ${o.status === 'QUOTE_SENT' ? 'selected' : ''}>Đã Gửi Báo Giá</option>
                <option value="ORDER_CONFIRMED" ${o.status === 'ORDER_CONFIRMED' ? 'selected' : ''}>Đã Chốt Đơn</option>
                <option value="IN_PRODUCTION" ${o.status === 'IN_PRODUCTION' ? 'selected' : ''}>Đang In Xưởng</option>
                <option value="PRODUCED" ${o.status === 'PRODUCED' ? 'selected' : ''}>Xưởng Đã Xong</option>
                <option value="DELIVERING" ${o.status === 'DELIVERING' ? 'selected' : ''}>🚚 Đang Giao</option>
                <option value="DELIVERED" ${o.status === 'DELIVERED' ? 'selected' : ''}>📦 Đã Giao</option>
                <option value="COMPLETED" ${o.status === 'COMPLETED' ? 'selected' : ''}>Hoàn Thành</option>
              </select>
              ${o.shipping_method ? `
                <div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;">
                  🚚 ${o.shipping_method}${o.tracking_code ? ` - ${o.tracking_code}` : ''}
                </div>
              ` : ''}
            </td>
            <td>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${o.type === 'QUOTE' ? `
                  <button class="btn btn-accent btn-sm" onclick="App.convertToOrder('${o.id}')" title="Chốt thành đơn hàng">⚡ Chốt</button>
                ` : ''}
                ${!['COMPLETED', 'CANCELLED'].includes(o.status) ? `
                  <button class="btn btn-secondary btn-sm" onclick="App.editOrder('${o.id}')" title="Sửa thông tin đơn hàng" style="color:var(--accent-amber);">✏️ Sửa</button>
                ` : ''}
                <button class="btn btn-secondary btn-sm" onclick="App.openDeliveryModal('${o.id}')" title="Cập nhật giao hàng & phí ship" style="color:var(--primary-light);">🚚 Giao</button>
                <button class="btn btn-secondary btn-sm" onclick="App.openPaymentModal('${o.id}', '${o.code}', '${safeCustomerName}', ${o.remaining_amount || 0})" title="Thu cọc / Thanh toán">💳 Thu</button>
                <button class="btn btn-secondary btn-sm" onclick="App.printQuote('${o.id}')" title="In Báo Giá / Đơn Hàng PDF">🖨️ Phiếu Bán</button>
                <button class="btn btn-secondary btn-sm" onclick="App.printDeliveryNote('${o.id}')" title="In Phiếu Giao Hàng Cho Tài Xế / Khách">📦 Phiếu Giao</button>
                ${!isSales ? `<button class="btn btn-secondary btn-sm" onclick="App.printJobTicket('${o.id}')" title="In Phiếu Lệnh In Gửi Xưởng">🏭 Lệnh Xưởng</button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch(renderErr) {
      console.error('[renderOrdersTable] Lỗi khi render HTML:', renderErr);
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:var(--accent-rose);">Lỗi hiển thị danh sách. Vui lòng tải lại trang.</td></tr>`;
    }
  },

  renderStatusBadge(status) {
    const badges = {
      DRAFT: '<span class="badge badge-draft">Bản Nháp</span>',
      QUOTE_SENT: '<span class="badge badge-quote">Đã Báo Giá</span>',
      ORDER_CONFIRMED: '<span class="badge badge-confirmed">Đã Chốt Đơn</span>',
      IN_PRODUCTION: '<span class="badge badge-producing">Đang In Xưởng</span>',
      PRODUCED: '<span class="badge badge-delivering">Xưởng Xong</span>',
      DELIVERING: '<span class="badge badge-delivering">Đang Giao</span>',
      COMPLETED: '<span class="badge badge-completed">Hoàn Thành</span>',
      CANCELLED: '<span class="badge badge-unpaid">Đã Hủy</span>'
    };
    return badges[status] || `<span class="badge badge-draft">${status}</span>`;
  },

  async changeOrderStatus(orderId, newStatus) {
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      this.loadOrders();
      this.loadDashboard();
    } catch (err) {
      alert('Lỗi cập nhật trạng thái: ' + err.message);
    }
  },

  async convertToOrder(orderId) {
    if (!confirm('Chuyển Báo Giá này thành Đơn Hàng chính thức?')) return;
    try {
      await fetch(`/api/orders/${orderId}/convert-to-order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });
      alert('Đã chuyển thành Đơn Hàng chính thức!');
      this.loadOrders();
      this.loadDashboard();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  // ==========================================
  // MODAL ĐƠN HÀNG (CREATE / EDIT)
  // ==========================================
  openNewOrderModal(prefill = {}) {
    this.state.orderModalMode = 'CREATE';
    this.state.editingOrderId = null;
    document.getElementById('modal-order-title').textContent = '+ Tạo Đơn Hàng / Báo Giá Mới (30s)';
    document.getElementById('modal-order').querySelector('.btn-primary').textContent = '💾 Lưu Đơn Hàng';

    // Reset Form
    document.getElementById('order-form').reset();
    document.getElementById('form-order-discount').value = 0;
    document.getElementById('form-order-vat-rate').value = 8;
    document.getElementById('form-order-shipping-fee').value = 0;
    document.getElementById('form-order-shipping-method').value = 'Ahamove';
    document.getElementById('form-order-tracking-code').value = '';
    document.getElementById('form-order-recipient-name').value = '';
    document.getElementById('form-order-recipient-phone').value = '';
    document.getElementById('form-order-deposit').value = 0;
    const now = new Date();
    document.getElementById('form-order-deadline').value =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.toggleQuickContact(false);
    this.toggleQuickCustomer(false);

    // Populate Customers dropdown
    this.populateCustomerSelect();

    // Populate Items
    const container = document.getElementById('order-items-container');
    container.innerHTML = '';

    if (prefill.items && prefill.items.length > 0) {
      prefill.items.forEach(it => this.addOrderItemRow(it));
    } else {
      this.addOrderItemRow(); // 1 default row
    }

    this.calculateOrderTotals();
    document.getElementById('modal-order').classList.add('active');
  },

  async editOrder(orderId) {
    try {
      // Fetch đầy đủ thông tin đơn hàng từ server
      const res = await fetch(`/api/orders/${orderId}`);
      const o = await res.json();

      if (!o || !o.id) {
        alert('Không tìm thấy đơn hàng!');
        return;
      }

      if (['COMPLETED', 'CANCELLED'].includes(o.status)) {
        alert('Đơn hàng đã hoàn thành hoặc đã hủy, không thể chỉnh sửa!');
        return;
      }

      // Chuyển sang mode EDIT
      this.state.orderModalMode = 'EDIT';
      this.state.editingOrderId = orderId;

      document.getElementById('modal-order-title').textContent = `✏️ Sửa Đơn Hàng [${o.code}]`;
      document.getElementById('modal-order').querySelector('.btn-primary').textContent = '💾 Cập Nhật Đơn Hàng';

      // Điền dữ liệu vào form
      document.getElementById('order-form').reset();
      this.populateCustomerSelect();

      // Đợi 1 tick để dropdown render xong
      await new Promise(r => setTimeout(r, 50));

      document.getElementById('form-order-type').value = o.type || 'ORDER';
      document.getElementById('form-order-customer').value = o.customer_id || '';

      // Trigger để load contacts của khách hàng
      this.onCustomerSelected(o.customer_id);
      await new Promise(r => setTimeout(r, 50));

      document.getElementById('form-order-contact').value = o.contact_id || '';
      document.getElementById('form-order-deadline').value = o.delivery_deadline ? o.delivery_deadline.substring(0, 10) : '';
      document.getElementById('form-order-address').value = o.shipping_address || '';
      document.getElementById('form-order-shipping-fee').value = o.shipping_fee || 0;
      document.getElementById('form-order-shipping-method').value = o.shipping_method || 'Ahamove';
      document.getElementById('form-order-tracking-code').value = o.tracking_code || '';
      document.getElementById('form-order-recipient-name').value = o.recipient_name || '';
      document.getElementById('form-order-recipient-phone').value = o.recipient_phone || '';
      document.getElementById('form-order-discount').value = o.discount_amount || 0;
      document.getElementById('form-order-vat-rate').value = o.vat_rate ?? 0;
      // Ô deposit ẩn khi edit (không tạo giao dịch mới tự động)
      document.getElementById('form-order-deposit').value = 0;
      document.getElementById('form-order-notes').value = o.notes || '';

      // Điền items
      const container = document.getElementById('order-items-container');
      container.innerHTML = '';
      if (o.items && o.items.length > 0) {
        o.items.forEach(it => this.addOrderItemRow(it));
      } else {
        this.addOrderItemRow();
      }

      this.calculateOrderTotals();
      document.getElementById('modal-order').classList.add('active');
    } catch (err) {
      alert('Lỗi khi tải đơn hàng: ' + err.message);
    }
  },

  toggleQuickContact(show) {
    const box = document.getElementById('quick-contact-box');
    if (!box) return;
    const open = typeof show === 'boolean' ? show : box.style.display === 'none';
    if (open && !document.getElementById('form-order-customer').value) {
      alert('Vui lòng chọn khách hàng trước khi thêm người đặt hàng!');
      return;
    }
    box.style.display = open ? 'block' : 'none';
    if (open) document.getElementById('qct-name').focus();
    else ['qct-name', 'qct-phone'].forEach(id => document.getElementById(id).value = '');
  },

  async saveQuickContact() {
    const customerId = document.getElementById('form-order-customer').value;
    const name = document.getElementById('qct-name').value.trim();
    if (!customerId) { alert('Vui lòng chọn khách hàng trước!'); return; }
    if (!name) { alert('Vui lòng nhập tên người đặt hàng!'); return; }
    const phone = document.getElementById('qct-phone').value.trim();
    try {
      const res = await fetch(`/api/customers/${customerId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể thêm người đặt hàng');
      const addr = document.getElementById('form-order-address').value;
      await this.loadCustomers();
      this.onCustomerSelected(customerId);
      document.getElementById('form-order-address').value = addr;
      const newId = data.id || data.contact?.id;
      if (newId) document.getElementById('form-order-contact').value = newId;
      this.toggleQuickContact(false);
    } catch (err) {
      alert('Lỗi thêm người đặt hàng: ' + err.message);
    }
  },

  toggleQuickCustomer(show) {
    const box = document.getElementById('quick-customer-box');
    if (!box) return;
    const open = typeof show === 'boolean' ? show : box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    if (open) document.getElementById('qc-name').focus();
    else ['qc-name', 'qc-phone', 'qc-address'].forEach(id => document.getElementById(id).value = '');
  },

  async saveQuickCustomer() {
    const name = document.getElementById('qc-name').value.trim();
    if (!name) {
      alert('Vui lòng nhập tên khách hàng!');
      return;
    }
    const phone = document.getElementById('qc-phone').value.trim();
    const address = document.getElementById('qc-address').value.trim();
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, address, customer_group: 'RETAIL', default_discount: 0 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể tạo khách hàng');
      await this.loadCustomers();
      this.populateCustomerSelect();
      const newId = data.id || data.customer?.id;
      const select = document.getElementById('form-order-customer');
      if (newId) {
        select.value = newId;
        this.onCustomerSelected(newId);
      }
      this.toggleQuickCustomer(false);
    } catch (err) {
      alert('Lỗi tạo nhanh khách hàng: ' + err.message);
    }
  },

  populateCustomerSelect() {
    const select = document.getElementById('form-order-customer');
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn khách hàng --</option>' +
      this.state.customers.map(c => `
        <option value="${c.id}">${c.name} (${c.code || 'KH'}) - ${c.phone || ''}</option>
      `).join('');
  },

  onCustomerSelected(customerId) {
    const contactSelect = document.getElementById('form-order-contact');
    const addressInput = document.getElementById('form-order-address');
    const discountInput = document.getElementById('form-order-discount');

    contactSelect.innerHTML = '<option value="">-- Chọn người đặt (hoặc để trống) --</option>';

    if (!customerId) return;

    const customer = this.state.customers.find(c => c.id === customerId);
    if (!customer) return;

    if (addressInput && customer.address) addressInput.value = customer.address;

    // Populate contacts
    if (customer.contacts && customer.contacts.length > 0) {
      customer.contacts.forEach(ct => {
        contactSelect.innerHTML += `<option value="${ct.id}">👤 ${ct.name} (${ct.phone || ct.position || ''})</option>`;
      });
    }

    // Auto set discount
    if (customer.default_discount > 0) {
      // Sẽ tính theo % khi tổng đơn được tính
    }

    this.calculateOrderTotals();
  },

  addOrderItemRow(data = {}) {
    const container = document.getElementById('order-items-container');
    if (!container) return;

    const rowId = 'item_row_' + Date.now() + '_' + Math.floor(Math.random() * 100);

    const suppliersOptions = this.state.suppliers.map(s => `
      <option value="${s.id}" ${data.supplier_id === s.id ? 'selected' : ''}>${s.name}</option>
    `).join('');

    const isSales = (this.state.currentRole === 'SALES');

    const rowHtml = `
      <div id="${rowId}" class="order-item-row" style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px;">
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto; gap:10px; align-items:end;">
          <div>
            <label class="form-label" style="font-size:11px;">Tên Ấn Phẩm *</label>
            <input type="text" class="form-control item-name" value="${data.item_name || ''}" placeholder="Namecard, Tờ rơi..." required>
          </div>
          <div>
            <label class="form-label" style="font-size:11px;">Số Lượng *</label>
            <input type="number" class="form-control item-qty" value="${data.quantity || 100}" min="1" oninput="App.calculateOrderTotals()">
          </div>
          <div>
            <label class="form-label" style="font-size:11px;">Đơn Vị</label>
            <input type="text" class="form-control item-unit" value="${data.unit || 'tờ'}" placeholder="tờ/hộp">
          </div>
          <div class="col-cost-profit" style="${isSales ? 'display:none;' : ''}">
            <label class="form-label" style="font-size:11px; color:var(--accent-amber);">Giá Vốn/Cái (đ)</label>
            <input type="number" class="form-control item-cost" value="${data.unit_cost || 0}" min="0" oninput="App.calculateOrderTotals()">
          </div>
          <div>
            <label class="form-label" style="font-size:11px; color:var(--primary-light);">Giá Bán/Cái (đ) *</label>
            <input type="number" class="form-control item-price" value="${data.unit_price || 0}" min="0" oninput="App.calculateOrderTotals()">
          </div>
          <div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('${rowId}').remove(); App.calculateOrderTotals();" style="color:var(--accent-rose);">✕</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: ${isSales ? '1fr' : '2fr 1.5fr 1.5fr'}; gap:10px; margin-top:10px;">
          <div>
            <label class="form-label" style="font-size:11px;">Quy Cách Kỹ Thuật (Báo Cho Khách)</label>
            <input type="text" class="form-control item-specs" value="${data.specs || ''}" placeholder="C300, cán màng mờ 2 mặt...">
          </div>
          ${!isSales ? `
          <div>
            <label class="form-label" style="font-size:11px;">Nơi Làm (Xưởng Gia Công)</label>
            <select class="form-control item-supplier">
              <option value="">-- Chọn xưởng gia công --</option>
              ${suppliersOptions}
            </select>
          </div>
          <div>
            <label class="form-label" style="font-size:11px;">Link File In (Drive / Cloud)</label>
            <input type="text" class="form-control item-file" value="${data.file_url || ''}" placeholder="https://drive.google.com/...">
          </div>
          ` : `
          <input type="hidden" class="item-supplier" value="">
          <input type="hidden" class="item-file" value="">
          `}
        </div>

        ${!isSales ? `
        <div style="margin-top:8px;">
          <label class="form-label" style="font-size:11px; color:var(--primary-light);">📐 Quy Cách Kỹ Thuật Xưởng & Bình Bài (Ẩn Với Khách - Chỉ Gửi Xưởng)</label>
          <input type="text" class="form-control item-imposition" value="${data.imposition_info || ''}" placeholder="Khổ in, trở nhíp, bình bài, số con/tờ, chạy kẽm...">
        </div>
        ` : `
        <input type="hidden" class="item-imposition" value="${data.imposition_info || ''}">
        `}
      </div>
    `;

    container.insertAdjacentHTML('beforeend', rowHtml);
    this.calculateOrderTotals();
  },

  calculateOrderTotals() {
    let subtotal = 0;
    let totalCost = 0;

    const rows = document.querySelectorAll('.order-item-row');
    rows.forEach(r => {
      const qty = parseInt(r.querySelector('.item-qty').value) || 1;
      const unitCost = parseFloat(r.querySelector('.item-cost').value) || 0;
      const unitPrice = parseFloat(r.querySelector('.item-price').value) || 0;

      subtotal += (unitPrice * qty);
      totalCost += (unitCost * qty);
    });

    const discountAmount = parseFloat(document.getElementById('form-order-discount').value) || 0;
    const vatRate = parseFloat(document.getElementById('form-order-vat-rate').value) || 0;
    const shippingFee = parseFloat(document.getElementById('form-order-shipping-fee')?.value) || 0;

    const afterDiscount = Math.max(0, subtotal - discountAmount);
    const vatAmount = (afterDiscount * vatRate) / 100;
    const grandTotal = afterDiscount + vatAmount + Math.max(0, shippingFee);
    const grossProfit = afterDiscount - totalCost;

    document.getElementById('order-calc-subtotal').textContent = this.formatCurrency(subtotal);
    document.getElementById('order-calc-vat').textContent = this.formatCurrency(vatAmount);
    const shippingFeeEl = document.getElementById('order-calc-shipping-fee');
    if (shippingFeeEl) shippingFeeEl.textContent = this.formatCurrency(shippingFee);
    document.getElementById('order-calc-grand-total').textContent = this.formatCurrency(grandTotal);
    document.getElementById('order-calc-total-cost').textContent = this.formatCurrency(totalCost);
    document.getElementById('order-calc-gross-profit').textContent = this.formatCurrency(grossProfit);
  },

  async saveOrder() {
    const customerId = document.getElementById('form-order-customer').value;
    if (!customerId) {
      alert('Vui lòng chọn khách hàng!');
      return;
    }

    const type = document.getElementById('form-order-type').value;
    const contactId = document.getElementById('form-order-contact').value;
    const deadline = document.getElementById('form-order-deadline').value;
    const address = document.getElementById('form-order-address').value;
    const shippingFee = parseFloat(document.getElementById('form-order-shipping-fee')?.value) || 0;
    const shippingMethod = document.getElementById('form-order-shipping-method')?.value || '';
    const trackingCode = document.getElementById('form-order-tracking-code')?.value || '';
    const recipientName = document.getElementById('form-order-recipient-name')?.value || '';
    const recipientPhone = document.getElementById('form-order-recipient-phone')?.value || '';
    const discount = parseFloat(document.getElementById('form-order-discount').value) || 0;
    const vatRate = parseFloat(document.getElementById('form-order-vat-rate').value) || 0;
    const deposit = parseFloat(document.getElementById('form-order-deposit').value) || 0;
    const notes = document.getElementById('form-order-notes').value;

    const items = [];
    document.querySelectorAll('.order-item-row').forEach(r => {
      const name = r.querySelector('.item-name').value.trim();
      if (name) {
        items.push({
          item_name: name,
          quantity: parseInt(r.querySelector('.item-qty').value) || 1,
          unit: r.querySelector('.item-unit').value || 'tờ',
          unit_cost: parseFloat(r.querySelector('.item-cost').value) || 0,
          unit_price: parseFloat(r.querySelector('.item-price').value) || 0,
          specs: r.querySelector('.item-specs').value || '',
          imposition_info: r.querySelector('.item-imposition')?.value || '',
          supplier_id: r.querySelector('.item-supplier').value || null,
          file_url: r.querySelector('.item-file').value || ''
        });
      }
    });

    if (items.length === 0) {
      alert('Vui lòng thêm ít nhất 1 ấn phẩm in!');
      return;
    }

    try {
      const isEdit = this.state.orderModalMode === 'EDIT';

      // Guard: nếu mode EDIT mà không có ID thì báo lỗi ngay
      if (isEdit && !this.state.editingOrderId) {
        alert('Lỗi: Không xác định được đơn hàng cần sửa. Vui lòng thử lại.');
        return;
      }

      const url = isEdit ? `/api/orders/${this.state.editingOrderId}` : '/api/orders';
      const method = isEdit ? 'PUT' : 'POST';

      const body = {
        customer_id: customerId,
        contact_id: contactId,
        delivery_deadline: deadline,
        shipping_address: address,
        shipping_fee: shippingFee,
        shipping_method: shippingMethod,
        tracking_code: trackingCode,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        discount_amount: discount,
        vat_rate: vatRate,
        notes,
        items
      };

      // Chỉ gửi deposit khi tạo mới
      if (!isEdit) {
        body.type = type;
        body.deposit_amount = deposit;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        alert('Lỗi: ' + (data.error || 'Không thể lưu đơn hàng'));
        return;
      }

      if (data.success) {
        const verb = isEdit ? 'Cập nhật' : 'Tạo';
        alert(`${verb} [${data.code}] thành công!`);
        this.state.orderModalMode = 'CREATE';
        this.state.editingOrderId = null;
        this.closeModals();
        // Đợi modal đóng xong rồi mới switch tab & load lại danh sách
        setTimeout(() => {
          this.switchTab('orders');
          this.loadDashboard();
        }, 100);
      }
    } catch (err) {
      alert('Lỗi lưu đơn hàng: ' + err.message);
    }
  },

  // ==========================================
  // PAYMENT / THU CỌC MODAL
  // ==========================================
  openPaymentModal(orderId, orderCode, customerName, remaining) {
    this.state.currentActiveOrderId = orderId;
    document.getElementById('pay-order-code').textContent = orderCode;
    document.getElementById('pay-customer-name').textContent = customerName;
    document.getElementById('pay-remaining-amount').textContent = this.formatCurrency(remaining);
    document.getElementById('pay-amount').value = remaining > 0 ? remaining : '';

    document.getElementById('modal-payment').classList.add('active');
  },

  async submitPayment() {
    const orderId = this.state.currentActiveOrderId;
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const type = document.getElementById('pay-type').value;
    const method = document.getElementById('pay-method').value;
    const refCode = document.getElementById('pay-ref').value;

    if (!amount || amount <= 0) {
      alert('Vui lòng nhập số tiền hợp lệ!');
      return;
    }

    try {
      const res = await fetch(`/api/orders/${orderId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          type,
          payment_method: method,
          ref_code: refCode
        })
      });

      const data = await res.json();
      if (data.success) {
        alert('Ghi nhận thanh toán thành công!');
        this.closeModals();
        this.loadOrders();
        this.loadDashboard();
      }
    } catch (err) {
      alert('Lỗi thu tiền: ' + err.message);
    }
  },

  // ==========================================
  // DELIVERY MANAGEMENT MODAL & LOGIC
  // ==========================================
  async openDeliveryModal(orderId) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const o = await res.json();
      if (!o || !o.id) {
        alert('Không tìm thấy thông tin đơn hàng!');
        return;
      }

      document.getElementById('delivery-order-id').value = o.id;
      document.getElementById('delivery-info-code').textContent = o.code;
      document.getElementById('delivery-info-customer').textContent = `${o.customer_name} (${o.customer_phone || ''})`;
      document.getElementById('delivery-info-remaining').textContent = this.formatCurrency(o.remaining_amount || 0);
      document.getElementById('delivery-info-total').textContent = this.formatCurrency(o.total_selling || 0);

      document.getElementById('delivery-form-status').value = ['PRODUCED', 'DELIVERING', 'DELIVERED', 'COMPLETED'].includes(o.status) ? o.status : 'DELIVERING';
      document.getElementById('delivery-form-fee').value = o.shipping_fee || 0;
      document.getElementById('delivery-form-method').value = o.shipping_method || 'Ahamove';
      document.getElementById('delivery-form-tracking').value = o.tracking_code || '';
      document.getElementById('delivery-form-recipient-name').value = o.recipient_name || o.contact_name || o.customer_name || '';
      document.getElementById('delivery-form-recipient-phone').value = o.recipient_phone || o.contact_phone || o.customer_phone || '';
      document.getElementById('delivery-form-address').value = o.shipping_address || o.customer_full_address || '';
      document.getElementById('delivery-form-notes').value = o.delivery_notes || '';

      document.getElementById('modal-delivery').classList.add('active');
    } catch (err) {
      alert('Lỗi khi mở giao diện giao hàng: ' + err.message);
    }
  },

  async saveDeliveryInfo() {
    const orderId = document.getElementById('delivery-order-id').value;
    if (!orderId) return;

    const status = document.getElementById('delivery-form-status').value;
    const shipping_fee = parseFloat(document.getElementById('delivery-form-fee').value) || 0;
    const shipping_method = document.getElementById('delivery-form-method').value;
    const tracking_code = document.getElementById('delivery-form-tracking').value.trim();
    const recipient_name = document.getElementById('delivery-form-recipient-name').value.trim();
    const recipient_phone = document.getElementById('delivery-form-recipient-phone').value.trim();
    const shipping_address = document.getElementById('delivery-form-address').value.trim();
    const delivery_notes = document.getElementById('delivery-form-notes').value.trim();

    try {
      const res = await fetch(`/api/orders/${orderId}/delivery`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          shipping_fee,
          shipping_method,
          tracking_code,
          recipient_name,
          recipient_phone,
          shipping_address,
          delivery_notes
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        alert('Lỗi cập nhật giao hàng: ' + (data.error || 'Có lỗi xảy ra'));
        return;
      }

      alert('Đã cập nhật thông tin vận chuyển thành công!');
      this.closeModals();
      this.loadOrders();
      this.loadDashboard();
    } catch (err) {
      alert('Lỗi kết nối máy chủ: ' + err.message);
    }
  },

  // ==========================================
  // 4. SUPPLIERS (SRM)
  // ==========================================
  async loadSuppliers() {
    try {
      const res = await fetch('/api/suppliers');
      const suppliers = await res.json();
      this.state.suppliers = suppliers;

      // Cập nhật dropdown lọc xưởng in nếu có
      const supFilter = document.getElementById('supplier-jobs-filter-sup');
      if (supFilter) {
        const currentVal = supFilter.value;
        supFilter.innerHTML = '<option value="ALL">-- Tất cả xưởng in --</option>' +
          suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        if (currentVal) supFilter.value = currentVal;
      }

      const container = document.getElementById('suppliers-cards-grid');
      if (container) {
        container.innerHTML = suppliers.map(s => `
          <div class="card-panel" style="margin-bottom:0; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <h3 style="font-size:16px; font-weight:700; color:var(--primary-light);">${s.name}</h3>
                <span class="badge ${s.printing_count > 0 ? 'badge-producing' : 'badge-draft'}">
                  ${s.printing_count} job đang in
                </span>
              </div>
              <div style="font-size:12.5px; color:var(--text-muted); margin:8px 0;">
                <strong>🎯 Thế mạnh:</strong> ${s.specialties || 'Đa dạng'}
              </div>
              <div style="font-size:12px; color:var(--text-dim); line-height:1.6;">
                <div>📞 <strong>SĐT:</strong> ${s.phone || 'Chưa có'}</div>
                <div>📍 <strong>Địa chỉ:</strong> ${s.address || 'TP.HCM'}</div>
                <div>🏦 <strong>TK Ngân Hàng:</strong> ${s.bank_info || 'Chưa cập nhật'}</div>
                <div>🧾 <strong>Hóa đơn VAT:</strong> ${s.vat_supported ? 'Có hỗ trợ VAT' : 'Không có VAT'}</div>
              </div>
            </div>
            <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; color:var(--text-dim);">Tổng tiền đã làm:</span>
              <span style="font-weight:700; color:var(--accent-amber);">${this.formatCurrency(s.total_worked_amount)}</span>
            </div>
          </div>
        `).join('');
      }

      // Tải danh sách lệnh chuyển xưởng
      await this.loadSupplierJobs();
    } catch (err) {
      console.error('Error loading suppliers:', err);
    }
  },

  setSupplierJobsView(view) {
    this.state.supplierJobsView = view;
    const btnGrouped = document.getElementById('btn-view-grouped');
    const btnFlat = document.getElementById('btn-view-flat');
    const containerGrouped = document.getElementById('supplier-jobs-grouped-container');
    const containerFlat = document.getElementById('supplier-jobs-flat-container');

    if (view === 'grouped') {
      if (btnGrouped) { btnGrouped.className = 'btn btn-sm btn-primary'; }
      if (btnFlat) { btnFlat.className = 'btn btn-sm btn-secondary'; }
      if (containerGrouped) containerGrouped.style.display = 'flex';
      if (containerFlat) containerFlat.style.display = 'none';
    } else {
      if (btnGrouped) { btnGrouped.className = 'btn btn-sm btn-secondary'; }
      if (btnFlat) { btnFlat.className = 'btn btn-sm btn-primary'; }
      if (containerGrouped) containerGrouped.style.display = 'none';
      if (containerFlat) containerFlat.style.display = 'block';
    }
    this.loadSupplierJobs();
  },

  async loadSupplierJobs() {
    const groupedContainer = document.getElementById('supplier-jobs-grouped-container');
    const tbody = document.getElementById('supplier-jobs-table-tbody');
    if (!groupedContainer && !tbody) return;

    const supFilter = document.getElementById('supplier-jobs-filter-sup')?.value || 'ALL';
    const statusFilter = document.getElementById('supplier-jobs-filter-status')?.value || 'ALL';

    const params = new URLSearchParams();
    if (supFilter !== 'ALL') params.append('supplier_id', supFilter);
    if (statusFilter !== 'ALL') params.append('status', statusFilter);

    try {
      const res = await fetch(`/api/suppliers/jobs?${params.toString()}`);
      if (!res.ok) throw new Error('Không thể tải danh sách lệnh in');
      const jobs = await res.json();
      this.state.supplierJobs = jobs || [];

      const isSales = (this.state.currentRole === 'SALES');
      document.querySelectorAll('#supplier-jobs-table th.col-cost-profit').forEach(th => {
        th.style.display = isSales ? 'none' : '';
      });

      const statusBadges = {
        PENDING: '<span class="badge badge-draft">Chờ gửi xưởng</span>',
        PRINTING: '<span class="badge badge-producing">Đang in xưởng</span>',
        DONE: '<span class="badge badge-completed">Đã xong</span>'
      };

      // 1. RENDER DẠNG GÔM NHÓM THEO XƯỞNG
      if (groupedContainer) {
        if (!jobs || jobs.length === 0) {
          groupedContainer.innerHTML = `
            <div style="text-align:center; padding:32px; background:var(--bg-surface); border:1px dashed var(--border-subtle); border-radius:var(--radius-md); color:var(--text-muted);">
              Không có lệnh chuyển qua xưởng nào phù hợp bộ lọc
            </div>
          `;
        } else {
          // Nhóm các job theo supplier_id
          const groups = {};
          jobs.forEach(j => {
            const sId = j.supplier_id || 'unassigned';
            if (!groups[sId]) {
              groups[sId] = {
                supplier_id: j.supplier_id,
                supplier_name: j.supplier_name || 'Chưa gán xưởng',
                supplier_phone: j.supplier_phone || '',
                items: []
              };
            }
            groups[sId].items.push(j);
          });

          groupedContainer.innerHTML = Object.values(groups).map(g => {
            const pendingJobs = g.items.filter(it => it.status === 'PENDING');
            const printingJobs = g.items.filter(it => it.status === 'PRINTING');
            const doneJobs = g.items.filter(it => it.status === 'DONE');
            const totalGroupCost = g.items.reduce((sum, it) => sum + (it.total_cost || 0), 0);
            const safeSupId = (g.supplier_id || '').replace(/'/g, '');

            const rowsHtml = g.items.map(j => {
              const fileHtml = j.file_url 
                ? `<a href="${j.file_url}" target="_blank" style="color:var(--primary-light); text-decoration:none; font-weight:600;" title="Mở file in">🔗 Mở File In</a>`
                : `<span style="color:var(--text-dim); font-size:11.5px;">Chưa đính kèm</span>`;

              const deadlineText = j.delivery_deadline 
                ? new Date(j.delivery_deadline).toLocaleDateString('vi-VN')
                : '<span style="color:var(--text-dim);">-</span>';

              const orderDate = j.order_created_at 
                ? new Date(j.order_created_at).toLocaleDateString('vi-VN')
                : '';

              const badgeHtml = statusBadges[j.status] || `<span class="badge badge-draft">${j.status}</span>`;

              return `
                <tr style="${j.status === 'PENDING' ? 'background:rgba(245, 158, 11, 0.04);' : ''}">
                  <td>
                    <strong style="color:var(--primary-light);">${j.order_code}</strong>
                    <div style="font-size:11px; color:var(--text-dim);">${orderDate}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${j.customer_name || ''}</div>
                  </td>
                  <td style="max-width:280px; white-space:normal;">
                    <strong>${j.item_name}</strong>
                    <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${j.specs || ''}</div>
                    ${j.imposition_info ? `<div style="font-size:11px; color:var(--primary-light); margin-top:2px;">📐 ${j.imposition_info}</div>` : ''}
                  </td>
                  <td style="text-align:center; font-weight:700;">
                    ${this.formatNumber(j.quantity)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">${j.unit || ''}</span>
                  </td>
                  <td>${fileHtml}</td>
                  <td style="white-space:nowrap; font-weight:500;">${deadlineText}</td>
                  <td class="col-cost-profit" style="${isSales ? 'display:none;' : ''} text-align:right; font-weight:600; color:var(--accent-amber);">
                    ${this.formatCurrency(j.total_cost)}
                  </td>
                  <td style="text-align:center;">${badgeHtml}</td>
                  <td style="text-align:center;">
                    <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                      ${j.status === 'PENDING' ? `
                        <button class="btn btn-accent btn-sm" onclick="App.sendJobToSupplier('${j.id}')" title="Gửi riêng lệnh này cho xưởng">🚀 Gửi</button>
                      ` : (j.status === 'PRINTING' ? `
                        <button class="btn btn-primary btn-sm" onclick="App.updateSupplierJobStatus('${j.id}', 'DONE')" title="Đánh dấu đã sản xuất xong">✅ Xong</button>
                      ` : `
                        <button class="btn btn-secondary btn-sm" onclick="App.updateSupplierJobStatus('${j.id}', 'PRINTING')" title="Chuyển lại về trạng thái đang in">↩️ Đang In</button>
                      `)}
                      <button class="btn btn-secondary btn-sm" onclick="App.printJobTicket('${j.order_id}')" title="In phiếu Lệnh xưởng">🖨️ Phiếu</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('');

            return `
              <div class="card-panel" style="margin-bottom:0; border:1px solid var(--border-subtle); padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border-subtle);">
                  <div>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <h3 style="font-size:16px; font-weight:700; color:var(--accent-amber); margin:0;">🏭 ${g.supplier_name}</h3>
                      ${g.supplier_phone ? `<span style="font-size:12px; color:var(--text-muted);">📞 ${g.supplier_phone}</span>` : ''}
                    </div>
                    <div style="font-size:12px; color:var(--text-dim); margin-top:4px;">
                      Tổng số: <strong>${g.items.length}</strong> lệnh &nbsp;|&nbsp;
                      <span style="color:var(--accent-amber);">⏳ Chờ gửi: <strong>${pendingJobs.length}</strong></span> &nbsp;|&nbsp;
                      <span style="color:var(--primary-light);">⚙️ Đang in: <strong>${printingJobs.length}</strong></span> &nbsp;|&nbsp;
                      <span style="color:var(--accent-green);">✅ Đã xong: <strong>${doneJobs.length}</strong></span>
                      ${!isSales ? ` &nbsp;|&nbsp; Tiền gia công: <strong style="color:var(--accent-amber);">${this.formatCurrency(totalGroupCost)}</strong>` : ''}
                    </div>
                  </div>
                  <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick="App.printSupplierBatchTicket('${safeSupId}', '${g.supplier_name}')" style="font-weight:600;" title="In phiếu tổng hợp gôm nhiều món của xưởng này">
                      🖨️ In Phiếu Tổng Hợp (${g.items.length} Món)
                    </button>
                    ${pendingJobs.length > 0 && g.supplier_id ? `
                      <button class="btn btn-accent" onclick="App.batchSendToSupplier('${safeSupId}', '${g.supplier_name}')" style="font-weight:700; box-shadow:0 2px 8px rgba(245, 158, 11, 0.3);" title="Gửi toàn bộ lệnh đang chờ và tùy chọn in phiếu gửi kèm">
                        ⚡ GỬI TOÀN BỘ (${pendingJobs.length} LỆNH)
                      </button>
                    ` : (pendingJobs.length === 0 ? `
                      <span class="badge badge-completed" style="padding:6px 12px; font-size:12px;">✅ Không có lệnh chờ gửi</span>
                    ` : '')}
                  </div>
                </div>

                <div class="table-responsive">
                  <table class="data-table" style="margin-bottom:0;">
                    <thead>
                      <tr>
                        <th>Mã Đơn / Ngày</th>
                        <th>Tên Ấn Phẩm & Quy Cách</th>
                        <th style="text-align: center;">SL</th>
                        <th>File In</th>
                        <th>Hạn Giao</th>
                        <th class="col-cost-profit" style="${isSales ? 'display:none;' : ''} text-align: right;">Tiền Gia Công</th>
                        <th style="text-align: center;">Trạng Thái</th>
                        <th style="text-align: center;">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsHtml}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 2. RENDER DẠNG BẢNG PHẲNG (FLAT)
      if (tbody) {
        if (!jobs || jobs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--text-muted);">Không có lệnh chuyển qua xưởng nào phù hợp bộ lọc</td></tr>`;
        } else {
          tbody.innerHTML = jobs.map(j => {
            const fileHtml = j.file_url 
              ? `<a href="${j.file_url}" target="_blank" style="color:var(--primary-light); text-decoration:none; font-weight:600;" title="Mở file in">🔗 Mở File In</a>`
              : `<span style="color:var(--text-dim); font-size:11.5px;">Chưa đính kèm</span>`;

            const deadlineText = j.delivery_deadline 
              ? new Date(j.delivery_deadline).toLocaleDateString('vi-VN')
              : '<span style="color:var(--text-dim);">-</span>';

            const orderDate = j.order_created_at 
              ? new Date(j.order_created_at).toLocaleDateString('vi-VN')
              : '';

            const badgeHtml = statusBadges[j.status] || `<span class="badge badge-draft">${j.status}</span>`;

            return `
              <tr>
                <td>
                  <strong style="color:var(--primary-light);">${j.order_code}</strong>
                  <div style="font-size:11px; color:var(--text-dim);">${orderDate}</div>
                  <div style="font-size:11px; color:var(--text-muted);">${j.customer_name || ''}</div>
                </td>
                <td>
                  <strong style="color:var(--accent-amber);">${j.supplier_name || 'Chưa gán xưởng'}</strong>
                  ${j.supplier_phone ? `<div style="font-size:11px; color:var(--text-dim);">📞 ${j.supplier_phone}</div>` : ''}
                </td>
                <td style="max-width:280px; white-space:normal;">
                  <strong>${j.item_name}</strong>
                  <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${j.specs || ''}</div>
                  ${j.imposition_info ? `<div style="font-size:11px; color:var(--primary-light); margin-top:2px;">📐 ${j.imposition_info}</div>` : ''}
                </td>
                <td style="text-align:center; font-weight:700;">
                  ${this.formatNumber(j.quantity)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">${j.unit || ''}</span>
                </td>
                <td>${fileHtml}</td>
                <td style="white-space:nowrap; font-weight:500;">${deadlineText}</td>
                <td class="col-cost-profit" style="${isSales ? 'display:none;' : ''} text-align:right; font-weight:600; color:var(--accent-amber);">
                  ${this.formatCurrency(j.total_cost)}
                </td>
                <td style="text-align:center;">${badgeHtml}</td>
                <td style="text-align:center;">
                  <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                    ${j.status === 'PENDING' ? `
                      <button class="btn btn-accent btn-sm" onclick="App.sendJobToSupplier('${j.id}')" title="Gửi lệnh này cho xưởng in">🚀 Gửi Xưởng</button>
                    ` : (j.status === 'PRINTING' ? `
                      <button class="btn btn-primary btn-sm" onclick="App.updateSupplierJobStatus('${j.id}', 'DONE')" title="Đánh dấu xưởng đã sản xuất xong">✅ Đã Xong</button>
                    ` : `
                      <button class="btn btn-secondary btn-sm" onclick="App.updateSupplierJobStatus('${j.id}', 'PRINTING')" title="Chuyển lại về trạng thái đang in">↩️ Đang In</button>
                    `)}
                    <button class="btn btn-secondary btn-sm" onclick="App.printJobTicket('${j.order_id}')" title="In phiếu Lệnh xưởng">🖨️ Phiếu</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (err) {
      console.error('Error loading supplier jobs:', err);
      if (groupedContainer) groupedContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--accent-rose);">Lỗi khi tải danh sách lệnh in: ${err.message}</div>`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--accent-rose);">Lỗi khi tải danh sách lệnh in: ${err.message}</td></tr>`;
    }
  },

  async batchSendToSupplier(supplierId, supplierName) {
    if (!confirm(`Xác nhận GỬI 1 LẦN TOÀN BỘ các lệnh đang chờ cho xưởng [${supplierName}]?\n\nTất cả lệnh chờ sẽ chuyển sang trạng thái "Đang in xưởng" và đơn hàng sẽ được kích hoạt sản xuất.`)) {
      return;
    }

    try {
      const res = await fetch('/api/suppliers/jobs/batch-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi gửi xưởng hàng loạt');

      const shouldPrint = confirm(`✅ Đã gửi thành công ${data.count} lệnh in cho xưởng [${supplierName}]!\n\nBạn có muốn IN PHIẾU GỬI XƯỞNG TỔNG HỢP (Job Ticket gôm nhiều món) cho xưởng ngay bây giờ không?`);
      if (shouldPrint) {
        this.printSupplierBatchTicket(supplierId, supplierName, 'ALL');
      }

      await this.loadSuppliers();
      this.loadDashboard();
      this.loadOrders();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  printSupplierBatchTicket(supplierId, supplierName, filterStatus = 'ALL') {
    let items = (this.state.supplierJobs || []).filter(j => j.supplier_id === supplierId);
    if (filterStatus && filterStatus !== 'ALL') {
      items = items.filter(j => j.status === filterStatus);
    }
    if (items.length === 0) {
      alert(`Không có món hàng nào của xưởng [${supplierName}] để in phiếu!`);
      return;
    }

    const supplier = (this.state.suppliers || []).find(s => s.id === supplierId) || {};
    const printable = document.getElementById('printable-area');
    if (!printable) return;

    const S = (window.Admin && Admin.settings) || {};
    const C = S.primary_color || '#0284c7';
    const totalQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const totalCost = items.reduce((sum, it) => sum + (Number(it.total_cost) || 0), 0);
    const isSales = (this.state.currentRole === 'SALES');

    // Gom danh sách mã đơn
    const uniqueOrders = Array.from(new Set(items.map(it => it.order_code))).filter(Boolean);

    printable.innerHTML = `
      <div class="print-header" style="border-bottom-color:${C};">
        <div class="print-logo-box">
          <img src="/assets/logo.png" style="height:50px;" alt="In Tia Chớp" onerror="this.style.display='none'">
          <div>
            <h2 style="font-size:15pt; color:${C}; margin:0;">PHIẾU ĐIỀU PHỐI & LỆNH GỬI XƯỞNG IN</h2>
            <div style="font-size:9.5pt; color:#555; font-weight:600;">(BẢNG TỔNG HỢP GIA CÔNG GÔM NHIỀU MÓN THEO XƯỞNG)</div>
          </div>
        </div>
        <div class="print-company-info" style="font-size:9pt; line-height:1.5;">
          <div>Xưởng Nhận: <strong style="font-size:11pt; color:#0f172a;">${supplierName}</strong></div>
          ${supplier.phone ? `<div>SĐT Liên Hệ: <strong>${supplier.phone}</strong></div>` : ''}
          ${supplier.address ? `<div>Địa Chỉ Xưởng: ${supplier.address}</div>` : ''}
          <div>Ngày Xuất Phiếu: <strong>${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})}</strong></div>
          <div>Số Lượng Món: <strong>${items.length} hạng mục</strong> | Đơn liên quan: <strong>${uniqueOrders.join(', ')}</strong></div>
        </div>
      </div>

      <table class="print-table" style="margin-top:14px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="width:30px; text-align:center;">STT</th>
            <th style="width:110px;">Mã Đơn / Khách</th>
            <th>Tên Ấn Phẩm & Quy Cách Kỹ Thuật</th>
            <th style="width:65px; text-align:center;">Số Lượng</th>
            <th style="width:50px; text-align:center;">ĐVT</th>
            <th style="width:85px; text-align:center;">Hạn Giao</th>
            <th>File Thiết Kế & Bình Bài</th>
            ${!isSales ? `<th style="width:90px; text-align:right;">Tiền GC (đ)</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td style="text-align:center; font-weight:600;">${idx + 1}</td>
              <td>
                <strong style="color:#0284c7;">${it.order_code}</strong>
                <div style="font-size:8.5pt; color:#555; margin-top:2px;">${it.customer_name || ''}</div>
              </td>
              <td>
                <strong style="font-size:10.5pt; color:#111;">${it.item_name}</strong>
                <div style="font-size:9pt; color:#333; margin-top:3px; line-height:1.35;">${it.specs || 'In chuẩn'}</div>
                ${it.imposition_info ? `<div style="font-size:8.5pt; color:#0284c7; margin-top:2px; font-weight:600;">📐 ${it.imposition_info}</div>` : ''}
              </td>
              <td style="text-align:center; font-weight:bold; font-size:11pt;">${this.formatNumber(it.quantity)}</td>
              <td style="text-align:center; font-size:9pt;">${it.unit || ''}</td>
              <td style="text-align:center; font-size:9pt; font-weight:600; color:#b45309;">
                ${it.delivery_deadline ? new Date(it.delivery_deadline).toLocaleDateString('vi-VN') : 'Hỏa tốc'}
              </td>
              <td style="font-size:9pt; word-break:break-all;">
                ${it.file_url ? `<div>Link file: <strong>${it.file_url}</strong></div>` : '<div>File chuyển qua Zalo/Drive</div>'}
              </td>
              ${!isSales ? `
                <td style="text-align:right; font-weight:bold; color:#333;">
                  ${this.formatNumber(it.total_cost)}
                </td>
              ` : ''}
            </tr>
          `).join('')}
          <tr style="background:#f8fafc; font-weight:bold;">
            <td colspan="3" style="text-align:right; font-size:10pt;">TỔNG CỘNG (${items.length} MÓN):</td>
            <td style="text-align:center; font-size:11pt; color:#0284c7;">${this.formatNumber(totalQty)}</td>
            <td colspan="3"></td>
            ${!isSales ? `
              <td style="text-align:right; font-size:11pt; color:#b45309;">
                ${this.formatNumber(totalCost)} đ
              </td>
            ` : ''}
          </tr>
        </tbody>
      </table>

      <div style="margin-top:16px; border:1px solid #cbd5e1; border-radius:4px; padding:10px 12px; font-size:9pt; background:#f8fafc; line-height:1.5;">
        <strong style="color:#0f172a;">Yêu cầu kỹ thuật & chất lượng từ Tia Chớp:</strong>
        ${((window.Admin && Admin.settings && Admin.settings.job_ticket_requirements) || '').split('\n').filter(Boolean).map((l, i) => `<div>${i + 1}. ${l}</div>`).join('')}
        <div style="margin-top:4px; color:#64748b; font-style:italic;">* Xưởng vui lòng kiểm tra file in, kiểm tra màu sắc bản in mẫu và bàn giao đúng tiến độ cam kết.</div>
      </div>

      <div class="print-signatures" style="margin-top:24px;">
        <div class="sig-col" style="text-align:center;">
          <strong>ĐIỀU PHỐI SẢN XUẤT (TIA CHỚP)</strong>
          <div style="font-size:8.5pt; color:#777; margin-top:4px;">(Ký & bàn giao file/vật tư)</div>
          <div style="font-size:9.5pt; color:#333; margin-top:50px; font-weight:600;">Dương Trân</div>
        </div>
        <div class="sig-col" style="text-align:center;">
          <strong>ĐẠI DIỆN XƯỞNG IN (${supplierName.toUpperCase()})</strong>
          <div style="font-size:8.5pt; color:#777; margin-top:4px;">(Ký nhận lệnh in & xác nhận tiến độ)</div>
          <div style="font-size:9pt; color:#999; margin-top:50px;">...................................................</div>
        </div>
      </div>
    `;

    window.print();
  },

  async printDeliveryNote(orderId) {
    try {
      let order = this.state.orders.find(o => o.id === orderId);
      if (!order || !order.items || order.items.length === 0) {
        const res = await fetch(`/api/orders/${orderId}`);
        order = await res.json();
      }
      if (!order || !order.id) {
        alert('Không tìm thấy thông tin đơn hàng để in phiếu giao hàng!');
        return;
      }

      const S = (window.Admin && Admin.settings) || {};
      const C = S.primary_color || '#0284c7';
      const printable = document.getElementById('printable-area');

      const recipientName = order.recipient_name || order.contact_name || order.customer_name || 'Khách hàng';
      const recipientPhone = order.recipient_phone || order.contact_phone || order.customer_phone || '';
      const deliveryAddress = order.shipping_address || order.customer_full_address || 'Nhận tại văn phòng';
      const shippingMethod = order.shipping_method || 'Giao hàng';
      const trackingCode = order.tracking_code ? ` - Vận đơn / BKS: <strong>${order.tracking_code}</strong>` : '';

      printable.innerHTML = `
        <div class="print-header" style="border-bottom-color:${C};">
          <div class="print-logo-box">
            <img src="/assets/logo.png" style="height:55px;" alt="In Tia Chớp">
            <div>
              <h2 style="font-size:16pt; color:${C}; margin:0;">${S.company_name || 'CÔNG TY IN TIA CHỚP'}</h2>
              <div style="font-size:9pt; color:#111; font-weight:700;">${S.company_slogan || ''}</div>
              <div style="font-size:9pt; color:#555;">Hotline giao nhận: ${S.company_hotline || '0903 000 000'} • Email: ${S.company_email || ''}</div>
              ${S.company_address ? `<div style="font-size:9pt; color:#555;">Địa chỉ xuất kho: ${S.company_address}</div>` : ''}
            </div>
          </div>
          <div class="print-company-info">
            <div style="font-size:14pt; font-weight:bold; color:${C};">PHIẾU GIAO HÀNG (DELIVERY SLIP)</div>
            <div>Mã Đơn: <strong>${order.code}</strong></div>
            <div>Ngày Giao: ${new Date().toLocaleDateString('vi-VN')}</div>
            <div>Hình Thức: <strong>${shippingMethod}</strong>${trackingCode}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; margin-bottom:14px; background:#f8fafc; padding:12px; border:1px solid #e2e8f0; font-size:10pt;">
          <div>
            <div><strong>Người nhận hàng:</strong> ${recipientName}</div>
            <div><strong>Điện thoại:</strong> <span style="font-size:11pt; font-weight:bold; color:#0284c7;">${recipientPhone}</span></div>
            <div><strong>Địa chỉ giao:</strong> ${deliveryAddress}</div>
          </div>
          <div>
            <div><strong>Khách hàng / Công ty:</strong> ${order.customer_name}</div>
            <div><strong>Hạn giao / Hẹn khách:</strong> ${order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleDateString('vi-VN') : 'Trong ngày'}</div>
            ${order.delivery_notes ? `<div style="color:#c00; font-weight:600;"><strong>Dặn dò shipper:</strong> ${order.delivery_notes}</div>` : ''}
          </div>
        </div>

        <table class="print-table">
          <thead>
            <tr>
              <th style="width:35px; text-align:center;">STT</th>
              <th>Tên Ấn Phẩm Bàn Giao & Quy Cách</th>
              <th style="width:90px; text-align:center;">Số Lượng</th>
              <th style="width:70px; text-align:center;">ĐVT</th>
              <th style="width:180px; text-align:center;">Tình Trạng Hàng Khi Bàn Giao</th>
            </tr>
          </thead>
          <tbody>
            ${(order.items || []).map((it, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td>
                  <strong style="font-size:10.5pt;">${it.item_name}</strong>
                  <div style="font-size:9pt; color:#555;">${this.cleanSpecsForCustomer(it.specs) || it.specs || 'Thành phẩm đóng gói cẩn thận'}</div>
                </td>
                <td style="text-align:center; font-weight:bold; font-size:11pt;">${this.formatNumber(it.quantity)}</td>
                <td style="text-align:center;">${it.unit || 'bộ'}</td>
                <td style="text-align:center; color:#555; font-size:9pt;">[  ] Đầy đủ, nguyên vẹn</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:flex-start; background:#fff7ed; padding:12px; border:1px solid #fed7aa; border-radius:4px;">
          <div style="font-size:9.5pt; color:#9a3412;">
            <div>• Quý khách vui lòng kiểm tra kỹ số lượng và tình trạng ấn phẩm trước khi ký nhận.</div>
            <div>• Mọi thắc mắc về đơn hàng xin vui lòng gọi hotline <strong>${S.company_hotline || '0903 000 000'}</strong> để được hỗ trợ tức thì.</div>
          </div>
          <div style="text-align:right; font-size:10pt;">
            ${order.shipping_fee > 0 ? `<div>Cước phí vận chuyển: <strong>${this.formatCurrency(order.shipping_fee)}</strong></div>` : ''}
            <div style="font-size:12pt; font-weight:bold; color:#c00; margin-top:4px;">
              TIỀN THU HỘ (COD): ${order.remaining_amount > 0 ? this.formatCurrency(order.remaining_amount) : '0 đ (Đã thanh toán đủ)'}
            </div>
          </div>
        </div>

        <div class="print-signatures" style="margin-top:24px;">
          <div class="sig-col">
            <strong>NGƯỜI GIAO HÀNG / TÀI XẾ</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Ghi rõ họ tên)</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI ĐIỀU PHỐI XUẤT KHO</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">${order.created_by || 'Dương Trân'}</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI NHẬN HÀNG</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Xác nhận đã nhận đủ hàng)</div>
          </div>
        </div>
      `;

      window.print();
    } catch (err) {
      alert('Lỗi in phiếu giao hàng: ' + err.message);
    }
  },

  async sendJobToSupplier(itemId) {
    if (!confirm('Xác nhận GỬI XƯỞNG cho lệnh in này? (Trạng thái sẽ chuyển sang Đang in xưởng)')) return;
    try {
      const res = await fetch(`/api/suppliers/jobs/${itemId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PRINTING' })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi gửi xưởng');
      }
      alert('Đã gửi lệnh qua xưởng in thành công!');
      await this.loadSuppliers();
      this.loadDashboard();
      this.loadOrders();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  async updateSupplierJobStatus(itemId, newStatus) {
    try {
      const res = await fetch(`/api/suppliers/jobs/${itemId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi cập nhật');
      }
      await this.loadSuppliers();
      this.loadDashboard();
      this.loadOrders();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  },

  openNewSupplierModal() {
    document.getElementById('modal-supplier').classList.add('active');
  },

  async saveSupplier() {
    const name = document.getElementById('sup-name').value.trim();
    if (!name) {
      alert('Vui lòng nhập tên xưởng in!');
      return;
    }
    const phone = document.getElementById('sup-phone').value;
    const specialties = document.getElementById('sup-specs').value;
    const address = document.getElementById('sup-address').value;
    const bank_info = document.getElementById('sup-bank').value;

    try {
      await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, specialties, address, bank_info, vat_supported: 1 })
      });
      this.closeModals();
      this.loadSuppliers();
    } catch (err) {
      alert('Lỗi lưu xưởng: ' + err.message);
    }
  },

  // ==========================================
  // 5. CUSTOMERS (CRM)
  // ==========================================
  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      const customers = await res.json();
      this.state.customers = customers;

      const tbody = document.getElementById('customers-table-tbody');
      if (!tbody) return;

      tbody.innerHTML = customers.map(c => {
        const contactsList = c.contacts.map(ct => `
          <span style="display:inline-block; background:var(--bg-elevated); padding:2px 6px; border-radius:4px; font-size:11px; margin:2px;">
            👤 ${ct.name} (${ct.phone || ''})
          </span>
        `).join('');

        return `
          <tr>
            <td><strong>${c.code || 'KH'}</strong></td>
            <td>
              <div style="font-weight:600; font-size:13.5px;">${c.name}</div>
              <div style="font-size:11.5px; color:var(--text-dim);">${c.address || ''}</div>
            </td>
            <td>${c.phone || ''}</td>
            <td style="max-width:240px; white-space:normal;">${contactsList || '<span style="color:var(--text-dim);">Chưa có</span>'}</td>
            <td>
              <span class="badge badge-quote">${c.default_discount || 0}%</span>
            </td>
            <td style="font-size:11.5px;">
              ${c.tax_code ? `<div><strong>MST:</strong> ${c.tax_code}</div><div>${c.tax_company || ''}</div>` : '<span style="color:var(--text-dim);">Không lấy HĐ</span>'}
            </td>
            <td>
              <span style="font-weight:700; color:${c.total_debt > 0 ? 'var(--accent-rose)' : 'var(--accent-green)'};">
                ${this.formatCurrency(c.total_debt)}
              </span>
            </td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.openNewOrderForCustomer('${c.id}')">+ Lên Đơn</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Error loading customers:', err);
    }
  },

  openNewCustomerModal() {
    document.getElementById('modal-customer').classList.add('active');
  },

  async saveCustomer() {
    const name = document.getElementById('cust-name').value.trim();
    if (!name) {
      alert('Vui lòng nhập tên khách hàng!');
      return;
    }
    const code = document.getElementById('cust-code').value.trim();
    const group = document.getElementById('cust-group').value;
    const phone = document.getElementById('cust-phone').value;
    const discount = parseFloat(document.getElementById('cust-discount').value) || 0;
    const address = document.getElementById('cust-address').value;
    const taxCompany = document.getElementById('cust-tax-company').value;
    const taxCode = document.getElementById('cust-tax-code').value;
    const taxEmail = document.getElementById('cust-tax-email').value;

    try {
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, code, customer_group: group, phone, default_discount: discount,
          address, tax_company: taxCompany, tax_code: taxCode, tax_email: taxEmail
        })
      });
      this.closeModals();
      this.loadCustomers();
    } catch (err) {
      alert('Lỗi lưu khách hàng: ' + err.message);
    }
  },

  openNewOrderForCustomer(customerId) {
    this.openNewOrderModal();
    const select = document.getElementById('form-order-customer');
    if (select) {
      select.value = customerId;
      this.onCustomerSelected(customerId);
    }
  },

  // ==========================================
  // 6. FINANCE & CÔNG NỢ
  // ==========================================
  async loadFinance() {
    try {
      const res = await fetch('/api/finance');
      const data = await res.json();

      // Debt Table
      const debtTbody = document.querySelector('#finance-debt-table tbody');
      if (debtTbody) {
        debtTbody.innerHTML = data.customerDebts.map(d => `
          <tr>
            <td>
              <strong>${d.name}</strong>
              <div style="font-size:11px; color:var(--text-dim);">${d.code} - ${d.phone || ''}</div>
            </td>
            <td><span class="badge badge-unpaid">${d.unpaid_orders_count} đơn</span></td>
            <td>${this.formatCurrency(d.total_ordered)}</td>
            <td style="color:var(--accent-green);">${this.formatCurrency(d.total_deposited)}</td>
            <td style="font-weight:700; color:var(--accent-rose); font-size:14px;">${this.formatCurrency(d.current_debt)}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.switchTab('orders'); App.state.filters.customer_id='${d.id}'; App.loadOrders();">Xem Các Đơn Nợ</button>
            </td>
          </tr>
        `).join('');
      }

      // VAT Report
      document.getElementById('finance-vat-count').textContent = `${data.vatReport.vat_orders_count} đơn hàng`;
      document.getElementById('finance-vat-total').textContent = this.formatCurrency(data.vatReport.total_vat_collected);

      // Transactions Ledger
      const txTbody = document.querySelector('#finance-tx-table tbody');
      if (txTbody) {
        txTbody.innerHTML = data.transactions.map(t => `
          <tr>
            <td>
              <strong>${t.order_code || 'Vãng lai'}</strong>
              <div style="font-size:11px; color:var(--text-dim);">${t.customer_name || ''}</div>
            </td>
            <td>
              <span class="badge ${t.type.includes('INCOME') ? 'badge-paid' : 'badge-unpaid'}">
                ${t.type === 'INCOME_DEPOSIT' ? 'Cọc Đơn' : (t.type === 'INCOME_BALANCE' ? 'Tất Toán' : 'Chi Xưởng')}
              </span>
            </td>
            <td style="font-weight:700; color:${t.type.includes('INCOME') ? 'var(--accent-green)' : 'var(--accent-rose)'};">
              ${t.type.includes('INCOME') ? '+' : '-'}${this.formatCurrency(t.amount)}
            </td>
            <td style="font-size:11px; color:var(--text-dim);">${t.payment_method === 'BANK_TRANSFER' ? 'Chuyển Khoản' : 'Tiền Mặt'}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Error loading finance:', err);
    }
  },

  // ==========================================
  // IN ẤN: PRINT QUOTE & JOB TICKET
  // ==========================================
  async printQuote(orderId) {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return;

    const S = (window.Admin && Admin.settings) || {};
    const C = S.primary_color || '#0284c7';
    const lines = t => (t || '').split('\n').filter(Boolean).map(l => `<div>• ${l}</div>`).join('');
    const printable = document.getElementById('printable-area');
    printable.innerHTML = `
      <div class="print-header" style="border-bottom-color:${C};">
        <div class="print-logo-box">
          <img src="/assets/logo.png" style="height:55px;" alt="In Tia Chớp">
          <div>
            <h2 style="font-size:16pt; color:${C}; margin:0;">${S.company_name || 'CÔNG TY IN TIA CHỚP'}</h2>
            <div style="font-size:9pt; color:#111; font-weight:700;">${S.company_slogan || ''}</div>
            <div style="font-size:9pt; color:#555;">Hotline / Zalo: ${S.company_hotline || ''} • Email: ${S.company_email || ''}</div>
            ${S.company_address ? `<div style="font-size:9pt; color:#555;">Địa chỉ: ${S.company_address}${S.company_tax_code ? ' • MST: ' + S.company_tax_code : ''}</div>` : ''}
          </div>
        </div>
        <div class="print-company-info">
          <div style="font-size:13pt; font-weight:bold; color:${C};">${order.type === 'QUOTE' ? 'PHIẾU BÁO GIÁ' : 'XÁC NHẬN ĐƠN HÀNG'}</div>
          <div>Mã Phiếu: <strong>${order.code}</strong></div>
          <div>Ngày Lập: ${new Date(order.created_at).toLocaleDateString('vi-VN')}</div>
          ${order.delivery_deadline ? `<div>Hạn Giao: ${new Date(order.delivery_deadline).toLocaleDateString('vi-VN')}</div>` : ''}
        </div>
      </div>

      <div style="margin-bottom:16px; background:#f8fafc; padding:12px; border:1px solid #e2e8f0; font-size:10pt;">
        <div><strong>Kính gửi:</strong> ${order.customer_name}</div>
        ${order.contact_name ? `<div><strong>Người liên hệ:</strong> ${order.contact_name} - ${order.contact_phone || ''}</div>` : ''}
        <div><strong>Địa chỉ giao hàng:</strong> ${order.shipping_address || 'Theo thỏa thuận'}</div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width:35px; text-align:center;">STT</th>
            <th>Tên Ấn Phẩm & Quy Cách Kỹ Thuật</th>
            <th style="width:70px; text-align:center;">Số Lượng</th>
            <th style="width:60px; text-align:center;">ĐVT</th>
            <th style="width:100px; text-align:right;">Đơn Giá (đ)</th>
            <th style="width:110px; text-align:right;">Thành Tiền (đ)</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map((it, idx) => `
            <tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td>
                <strong>${it.item_name}</strong>
                <div style="font-size:9pt; color:#555;">${this.cleanSpecsForCustomer(it.specs) || it.specs || ''}</div>
              </td>
              <td style="text-align:center;">${it.quantity}</td>
              <td style="text-align:center;">${it.unit}</td>
              <td style="text-align:right;">${this.formatNumber(it.unit_price)}</td>
              <td style="text-align:right; font-weight:bold;">${this.formatNumber(it.total_price)}</td>
            </tr>
          `).join('')}
          ${order.discount_amount > 0 ? `
            <tr>
              <td colspan="5" style="text-align:right;">Chiết khấu:</td>
              <td style="text-align:right; color:#c00;">-${this.formatNumber(order.discount_amount)}</td>
            </tr>
          ` : ''}
          ${order.vat_rate > 0 ? `
            <tr>
              <td colspan="5" style="text-align:right;">Thuế GTGT (${order.vat_rate}%):</td>
              <td style="text-align:right;">${this.formatNumber(order.vat_amount)}</td>
            </tr>
          ` : ''}
          ${order.shipping_fee > 0 ? `
            <tr>
              <td colspan="5" style="text-align:right;">Phí vận chuyển (${order.shipping_method || 'Giao hàng'}):</td>
              <td style="text-align:right;">${this.formatNumber(order.shipping_fee)}</td>
            </tr>
          ` : ''}
          <tr>
            <td colspan="5" style="text-align:right; font-weight:bold; font-size:11pt;">TỔNG CỘNG:</td>
            <td style="text-align:right; font-weight:bold; font-size:11pt; color:#0284c7;">${this.formatNumber(order.total_selling)} đ</td>
          </tr>
          ${order.deposit_amount > 0 ? `
            <tr>
              <td colspan="5" style="text-align:right;">Đã đặt cọc:</td>
              <td style="text-align:right; color:green;">${this.formatNumber(order.deposit_amount)} đ</td>
            </tr>
            <tr>
              <td colspan="5" style="text-align:right; font-weight:bold;">CÒN LẠI PHẢI THU:</td>
              <td style="text-align:right; font-weight:bold; color:#c00;">${this.formatNumber(order.remaining_amount)} đ</td>
            </tr>
          ` : ''}
        </tbody>
      </table>

      <div style="font-size:9.5pt; color:#444; margin-top:14px; line-height:1.5;">
        <div><strong>Điều khoản thanh toán & Giao nhận:</strong></div>
        ${lines(order.type === 'QUOTE' ? S.quote_terms : S.order_terms)}
        <div>• Thông tin tài khoản: <strong>${S.bank_name || ''} ${S.bank_account || ''} - ${S.bank_holder || ''}</strong>.</div>
      </div>

      <div class="print-signatures">
        <div class="sig-col">
          <strong>${S.sign_customer_label || 'ĐẠI DIỆN KHÁCH HÀNG'}</strong>
          <div style="font-size:9pt; color:#777; margin-top:50px;">(Ký & Ghi rõ họ tên)</div>
        </div>
        <div class="sig-col">
          <strong>${S.sign_company_label || 'ĐẠI DIỆN IN TIA CHỚP'}</strong>
          <div style="font-size:9pt; color:#777; margin-top:50px;">${S.sign_company_name || '(Ký & Ghi rõ họ tên)'}</div>
        </div>
      </div>
    `;

    window.print();
  },

  async printDeliveryNote(orderId) {
    try {
      let order = this.state.orders.find(o => o.id === orderId);
      if (!order || !order.items || order.items.length === 0) {
        const res = await fetch(`/api/orders/${orderId}`);
        order = await res.json();
      }
      if (!order || !order.id) {
        alert('Không tìm thấy thông tin đơn hàng để in phiếu giao hàng!');
        return;
      }

      const S = (window.Admin && Admin.settings) || {};
      const C = S.primary_color || '#0284c7';
      const printable = document.getElementById('printable-area');

      const recipientName = order.recipient_name || order.contact_name || order.customer_name || 'Khách hàng';
      const recipientPhone = order.recipient_phone || order.contact_phone || order.customer_phone || '';
      const deliveryAddress = order.shipping_address || order.customer_full_address || 'Nhận tại văn phòng';
      const shippingMethod = order.shipping_method || 'Giao hàng';
      const trackingCode = order.tracking_code ? ` - Vận đơn / BKS: <strong>${order.tracking_code}</strong>` : '';

      printable.innerHTML = `
        <div class="print-header" style="border-bottom-color:${C};">
          <div class="print-logo-box">
            <img src="/assets/logo.png" style="height:55px;" alt="In Tia Chớp">
            <div>
              <h2 style="font-size:16pt; color:${C}; margin:0;">${S.company_name || 'CÔNG TY IN TIA CHỚP'}</h2>
              <div style="font-size:9pt; color:#111; font-weight:700;">${S.company_slogan || ''}</div>
              <div style="font-size:9pt; color:#555;">Hotline giao nhận: ${S.company_hotline || '0903 000 000'} • Email: ${S.company_email || ''}</div>
              ${S.company_address ? `<div style="font-size:9pt; color:#555;">Địa chỉ xuất kho: ${S.company_address}</div>` : ''}
            </div>
          </div>
          <div class="print-company-info">
            <div style="font-size:14pt; font-weight:bold; color:${C};">PHIẾU GIAO HÀNG (DELIVERY SLIP)</div>
            <div>Mã Đơn: <strong>${order.code}</strong></div>
            <div>Ngày Giao: ${new Date().toLocaleDateString('vi-VN')}</div>
            <div>Hình Thức: <strong>${shippingMethod}</strong>${trackingCode}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; margin-bottom:14px; background:#f8fafc; padding:12px; border:1px solid #e2e8f0; font-size:10pt;">
          <div>
            <div><strong>Người nhận hàng:</strong> ${recipientName}</div>
            <div><strong>Điện thoại:</strong> <span style="font-size:11pt; font-weight:bold; color:#0284c7;">${recipientPhone}</span></div>
            <div><strong>Địa chỉ giao:</strong> ${deliveryAddress}</div>
          </div>
          <div>
            <div><strong>Khách hàng / Công ty:</strong> ${order.customer_name}</div>
            <div><strong>Hạn giao / Hẹn khách:</strong> ${order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleDateString('vi-VN') : 'Trong ngày'}</div>
            ${order.delivery_notes ? `<div style="color:#c00; font-weight:600;"><strong>Dặn dò shipper:</strong> ${order.delivery_notes}</div>` : ''}
          </div>
        </div>

        <table class="print-table">
          <thead>
            <tr>
              <th style="width:35px; text-align:center;">STT</th>
              <th>Tên Ấn Phẩm Bàn Giao & Quy Cách</th>
              <th style="width:90px; text-align:center;">Số Lượng</th>
              <th style="width:70px; text-align:center;">ĐVT</th>
              <th style="width:180px; text-align:center;">Tình Trạng Hàng Khi Bàn Giao</th>
            </tr>
          </thead>
          <tbody>
            ${(order.items || []).map((it, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td>
                  <strong style="font-size:10.5pt;">${it.item_name}</strong>
                  <div style="font-size:9pt; color:#555;">${this.cleanSpecsForCustomer(it.specs) || it.specs || 'Thành phẩm đóng gói cẩn thận'}</div>
                </td>
                <td style="text-align:center; font-weight:bold; font-size:11pt;">${this.formatNumber(it.quantity)}</td>
                <td style="text-align:center;">${it.unit || 'bộ'}</td>
                <td style="text-align:center; color:#555; font-size:9pt;">[  ] Đầy đủ, nguyên vẹn</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:flex-start; background:#fff7ed; padding:12px; border:1px solid #fed7aa; border-radius:4px;">
          <div style="font-size:9.5pt; color:#9a3412;">
            <div>• Quý khách vui lòng kiểm tra kỹ số lượng và tình trạng ấn phẩm trước khi ký nhận.</div>
            <div>• Mọi thắc mắc về đơn hàng xin vui lòng gọi hotline <strong>${S.company_hotline || '0903 000 000'}</strong> để được hỗ trợ tức thì.</div>
          </div>
          <div style="text-align:right; font-size:10pt;">
            ${order.shipping_fee > 0 ? `<div>Cước phí vận chuyển: <strong>${this.formatCurrency(order.shipping_fee)}</strong></div>` : ''}
            <div style="font-size:12pt; font-weight:bold; color:#c00; margin-top:4px;">
              TIỀN THU HỘ (COD): ${order.remaining_amount > 0 ? this.formatCurrency(order.remaining_amount) : '0 đ (Đã thanh toán đủ)'}
            </div>
          </div>
        </div>

        <div class="print-signatures" style="margin-top:24px;">
          <div class="sig-col">
            <strong>NGƯỜI GIAO HÀNG / TÀI XẾ</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Ghi rõ họ tên)</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI ĐIỀU PHỐI XUẤT KHO</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">${order.created_by || 'Dương Trân'}</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI NHẬN HÀNG</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Xác nhận đã nhận đủ hàng)</div>
          </div>
        </div>
      `;

      window.print();
    } catch (err) {
      alert('Lỗi in phiếu giao hàng: ' + err.message);
    }
  },

  printJobTicket(orderId) {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return;

    const printable = document.getElementById('printable-area');
    printable.innerHTML = `
      <div class="print-header">
        <div class="print-logo-box">
          <img src="/assets/logo.png" style="height:50px;" alt="In Tia Chớp">
          <div>
            <h2 style="font-size:15pt; color:#0284c7; margin:0;">LỆNH IN & GIA CÔNG XƯỞNG</h2>
            <div style="font-size:9pt; color:#555;">(PHIẾU JOB TICKET ĐIỀU PHỐI GIA CÔNG)</div>
          </div>
        </div>
        <div class="print-company-info">
          <div>Mã Đơn: <strong>${order.code}</strong></div>
          <div>Ngày Đặt: ${new Date(order.created_at).toLocaleDateString('vi-VN')}</div>
          <div><strong>HẠN GIAO XƯỞNG: ${order.delivery_deadline || 'Hỏa tốc'}</strong></div>
        </div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width:35px; text-align:center;">STT</th>
            <th>Tên Ấn Phẩm & Quy Cách Kỹ Thuật</th>
            <th style="width:70px; text-align:center;">Số Lượng</th>
            <th style="width:60px; text-align:center;">ĐVT</th>
            <th style="width:130px;">Xưởng Gia Công</th>
            <th>File Thiết Kế & Ghi Chú</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map((it, idx) => `
            <tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td>
                <strong style="font-size:11pt;">${it.item_name}</strong>
                <div style="font-size:9.5pt; color:#333; margin-top:4px;">Quy cách: ${it.specs || 'In chuẩn'}</div>
                ${it.imposition_info ? `<div style="font-size:9pt; color:#0284c7;">Bình bài: ${it.imposition_info}</div>` : ''}
              </td>
              <td style="text-align:center; font-weight:bold; font-size:11pt;">${it.quantity}</td>
              <td style="text-align:center;">${it.unit}</td>
              <td><strong>${it.supplier_name || 'Xưởng đối tác'}</strong></td>
              <td>
                ${it.file_url ? `<div>Link file: <strong>${it.file_url}</strong></div>` : '<div>File đính kèm qua Zalo/Drive</div>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top:20px; border:1px solid #ccc; padding:10px; font-size:9.5pt;">
        <strong>Yêu cầu chất lượng từ Tia Chớp:</strong>
        ${((window.Admin && Admin.settings && Admin.settings.job_ticket_requirements) || '').split('\n').filter(Boolean).map((l, i) => `<div>${i + 1}. ${l}</div>`).join('')}
      </div>

      <div class="print-signatures">
        <div class="sig-col">
          <strong>ĐIỀU PHỐI SẢN XUẤT</strong>
          <div style="font-size:9pt; color:#777; margin-top:50px;">Dương Trân</div>
        </div>
        <div class="sig-col">
          <strong>XÁC NHẬN TỪ XƯỞNG</strong>
          <div style="font-size:9pt; color:#777; margin-top:50px;">(Ký nhận lệnh in)</div>
        </div>
      </div>
    `;

    window.print();
  },

  async printDeliveryNote(orderId) {
    try {
      let order = this.state.orders.find(o => o.id === orderId);
      if (!order || !order.items || order.items.length === 0) {
        const res = await fetch(`/api/orders/${orderId}`);
        order = await res.json();
      }
      if (!order || !order.id) {
        alert('Không tìm thấy thông tin đơn hàng để in phiếu giao hàng!');
        return;
      }

      const S = (window.Admin && Admin.settings) || {};
      const C = S.primary_color || '#0284c7';
      const printable = document.getElementById('printable-area');

      const recipientName = order.recipient_name || order.contact_name || order.customer_name || 'Khách hàng';
      const recipientPhone = order.recipient_phone || order.contact_phone || order.customer_phone || '';
      const deliveryAddress = order.shipping_address || order.customer_full_address || 'Nhận tại văn phòng';
      const shippingMethod = order.shipping_method || 'Giao hàng';
      const trackingCode = order.tracking_code ? ` - Vận đơn / BKS: <strong>${order.tracking_code}</strong>` : '';

      printable.innerHTML = `
        <div class="print-header" style="border-bottom-color:${C};">
          <div class="print-logo-box">
            <img src="/assets/logo.png" style="height:55px;" alt="In Tia Chớp">
            <div>
              <h2 style="font-size:16pt; color:${C}; margin:0;">${S.company_name || 'CÔNG TY IN TIA CHỚP'}</h2>
              <div style="font-size:9pt; color:#111; font-weight:700;">${S.company_slogan || ''}</div>
              <div style="font-size:9pt; color:#555;">Hotline giao nhận: ${S.company_hotline || '0903 000 000'} • Email: ${S.company_email || ''}</div>
              ${S.company_address ? `<div style="font-size:9pt; color:#555;">Địa chỉ xuất kho: ${S.company_address}</div>` : ''}
            </div>
          </div>
          <div class="print-company-info">
            <div style="font-size:14pt; font-weight:bold; color:${C};">PHIẾU GIAO HÀNG (DELIVERY SLIP)</div>
            <div>Mã Đơn: <strong>${order.code}</strong></div>
            <div>Ngày Giao: ${new Date().toLocaleDateString('vi-VN')}</div>
            <div>Hình Thức: <strong>${shippingMethod}</strong>${trackingCode}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; margin-bottom:14px; background:#f8fafc; padding:12px; border:1px solid #e2e8f0; font-size:10pt;">
          <div>
            <div><strong>Người nhận hàng:</strong> ${recipientName}</div>
            <div><strong>Điện thoại:</strong> <span style="font-size:11pt; font-weight:bold; color:#0284c7;">${recipientPhone}</span></div>
            <div><strong>Địa chỉ giao:</strong> ${deliveryAddress}</div>
          </div>
          <div>
            <div><strong>Khách hàng / Công ty:</strong> ${order.customer_name}</div>
            <div><strong>Hạn giao / Hẹn khách:</strong> ${order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleDateString('vi-VN') : 'Trong ngày'}</div>
            ${order.delivery_notes ? `<div style="color:#c00; font-weight:600;"><strong>Dặn dò shipper:</strong> ${order.delivery_notes}</div>` : ''}
          </div>
        </div>

        <table class="print-table">
          <thead>
            <tr>
              <th style="width:35px; text-align:center;">STT</th>
              <th>Tên Ấn Phẩm Bàn Giao & Quy Cách</th>
              <th style="width:90px; text-align:center;">Số Lượng</th>
              <th style="width:70px; text-align:center;">ĐVT</th>
              <th style="width:180px; text-align:center;">Tình Trạng Hàng Khi Bàn Giao</th>
            </tr>
          </thead>
          <tbody>
            ${(order.items || []).map((it, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td>
                  <strong style="font-size:10.5pt;">${it.item_name}</strong>
                  <div style="font-size:9pt; color:#555;">${this.cleanSpecsForCustomer(it.specs) || it.specs || 'Thành phẩm đóng gói cẩn thận'}</div>
                </td>
                <td style="text-align:center; font-weight:bold; font-size:11pt;">${this.formatNumber(it.quantity)}</td>
                <td style="text-align:center;">${it.unit || 'bộ'}</td>
                <td style="text-align:center; color:#555; font-size:9pt;">[  ] Đầy đủ, nguyên vẹn</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:flex-start; background:#fff7ed; padding:12px; border:1px solid #fed7aa; border-radius:4px;">
          <div style="font-size:9.5pt; color:#9a3412;">
            <div>• Quý khách vui lòng kiểm tra kỹ số lượng và tình trạng ấn phẩm trước khi ký nhận.</div>
            <div>• Mọi thắc mắc về đơn hàng xin vui lòng gọi hotline <strong>${S.company_hotline || '0903 000 000'}</strong> để được hỗ trợ tức thì.</div>
          </div>
          <div style="text-align:right; font-size:10pt;">
            ${order.shipping_fee > 0 ? `<div>Cước phí vận chuyển: <strong>${this.formatCurrency(order.shipping_fee)}</strong></div>` : ''}
            <div style="font-size:12pt; font-weight:bold; color:#c00; margin-top:4px;">
              TIỀN THU HỘ (COD): ${order.remaining_amount > 0 ? this.formatCurrency(order.remaining_amount) : '0 đ (Đã thanh toán đủ)'}
            </div>
          </div>
        </div>

        <div class="print-signatures" style="margin-top:24px;">
          <div class="sig-col">
            <strong>NGƯỜI GIAO HÀNG / TÀI XẾ</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Ghi rõ họ tên)</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI ĐIỀU PHỐI XUẤT KHO</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">${order.created_by || 'Dương Trân'}</div>
          </div>
          <div class="sig-col">
            <strong>NGƯỜI NHẬN HÀNG</strong>
            <div style="font-size:9pt; color:#777; margin-top:55px;">(Ký & Xác nhận đã nhận đủ hàng)</div>
          </div>
        </div>
      `;

      window.print();
    } catch (err) {
      alert('Lỗi in phiếu giao hàng: ' + err.message);
    }
  },

  // ==========================================
  // XUẤT / NHẬP EXCEL DỮ LIỆU (IMPORT & EXPORT)
  // ==========================================
  exportOrdersExcel() {
    window.location.href = '/api/excel/orders/export';
  },

  exportSupplierJobsExcel() {
    const sup = document.getElementById('supplier-jobs-filter-sup')?.value || 'ALL';
    const status = document.getElementById('supplier-jobs-filter-status')?.value || 'ALL';
    window.location.href = `/api/excel/supplier-jobs/export?supplier_id=${encodeURIComponent(sup)}&status=${encodeURIComponent(status)}`;
  },

  exportCustomersExcel() {
    window.location.href = '/api/excel/customers/export';
  },

  triggerImportCustomers() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!confirm(`Xác nhận nhập danh sách khách hàng từ file [${file.name}]?`)) return;

      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/excel/customers/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          body: buf
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi nhập dữ liệu');

        alert(`✅ ${data.message}`);
        await this.loadCustomers();
      } catch (err) {
        alert('Lỗi nhập Excel: ' + err.message);
      }
    };
    input.click();
  },

  exportSuppliersExcel() {
    window.location.href = '/api/excel/suppliers/export';
  },

  triggerImportSuppliers() {
    if (!['ADMIN', 'COORDINATOR'].includes(this.state.currentRole)) {
      return alert('Chỉ Quản trị viên (Admin) hoặc Điều phối xưởng mới có quyền nhập danh sách xưởng in.');
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!confirm(`Xác nhận nhập danh sách xưởng in từ file [${file.name}]?`)) return;

      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/excel/suppliers/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          body: buf
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi nhập dữ liệu');

        alert(`✅ ${data.message}`);
        await this.loadSuppliers();
      } catch (err) {
        alert('Lỗi nhập Excel: ' + err.message);
      }
    };
    input.click();
  },

  // ==========================================
  // HELPERS
  // ==========================================
  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  },

  formatCurrency(amount) {
    if (isNaN(amount) || amount === null || amount === undefined) return '0 đ';
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' đ';
  },

  formatNumber(amount) {
    if (isNaN(amount) || amount === null || amount === undefined) return '0';
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
  }
};

// App.init() được gọi bởi Auth sau khi đăng nhập thành công (xem /js/auth.js)
