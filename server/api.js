const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { calculatePrice } = require('./pricing');

// Helper sinh ID ngẫu nhiên và mã chứng từ
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function generateOrderCode(type = 'ORDER') {
  const timestamp = Date.now().toString().slice(-8);
  const randomPart = Math.floor(100 + Math.random() * 900);
  return type === 'QUOTE' ? `BG_${timestamp}` : `DH_${timestamp}`;
}

// ==========================================
// PHÂN QUYỀN DỮ LIỆU: SALES chỉ thấy dữ liệu do chính mình tạo
// ==========================================
const isSalesUser = req => req.user?.role === 'SALES';

// Chặn Sales truy cập đơn hàng / khách hàng của người khác (theo :id)
router.use('/orders/:id', (req, res, next) => {
  if (!isSalesUser(req)) return next();
  const row = db.prepare('SELECT created_by_user_id FROM orders WHERE id = ?').get(req.params.id);
  if (row && row.created_by_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Bạn chỉ được thao tác trên đơn hàng do mình tạo' });
  }
  next();
});
router.use('/customers/:id', (req, res, next) => {
  if (!isSalesUser(req)) return next();
  const row = db.prepare('SELECT created_by_user_id FROM customers WHERE id = ?').get(req.params.id);
  if (row && row.created_by_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Bạn chỉ được thao tác trên khách hàng do mình tạo' });
  }
  next();
});

// ==========================================
// 1. DASHBOARD & STATS
// ==========================================
router.get('/stats', (req, res) => {
  try {
    const salesOnly = isSalesUser(req);
    const ownParams = salesOnly ? [req.user.id] : [];
    const ordersSummary = db.prepare(`
      SELECT 
        COUNT(CASE WHEN type = 'ORDER' THEN 1 END) as total_orders,
        COUNT(CASE WHEN type = 'QUOTE' THEN 1 END) as total_quotes,
        COUNT(CASE WHEN status = 'IN_PRODUCTION' THEN 1 END) as in_production_count,
        COUNT(CASE WHEN status = 'ORDER_CONFIRMED' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN status = 'DELIVERING' THEN 1 END) as delivering_count,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count,
        COALESCE(SUM(CASE WHEN type = 'ORDER' THEN total_selling ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN type = 'ORDER' THEN total_cost ELSE 0 END), 0) as total_cost,
        COALESCE(SUM(CASE WHEN type = 'ORDER' THEN gross_profit ELSE 0 END), 0) as total_profit,
        COALESCE(SUM(CASE WHEN type = 'ORDER' AND payment_status != 'PAID' THEN remaining_amount ELSE 0 END), 0) as total_receivable_debt
      FROM orders${salesOnly ? ' WHERE created_by_user_id = ?' : ''}
    `).get(...ownParams);

    // Thu chi tháng này
    const cashflow = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type LIKE 'INCOME%' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type LIKE 'EXPENSE%' THEN amount ELSE 0 END), 0) as total_expense
      FROM transactions${salesOnly ? ' WHERE order_id IN (SELECT id FROM orders WHERE created_by_user_id = ?)' : ''}
    `).get(...ownParams);

    // 5 đơn hàng mới nhất cần chú ý
    const recentOrders = db.prepare(`
      SELECT o.*, c.name as customer_name, c.code as customer_code
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      ${salesOnly ? 'WHERE o.created_by_user_id = ?' : ''}
      ORDER BY o.created_at DESC
      LIMIT 6
    `).all(...ownParams);

    // Danh sách xưởng in và số job đang chạy
    const suppliersLoad = db.prepare(`
      SELECT s.id, s.name, s.specialties, s.phone,
        COUNT(oi.id) as active_jobs
      FROM suppliers s
      LEFT JOIN order_items oi ON oi.supplier_id = s.id AND oi.status = 'PRINTING'
      GROUP BY s.id
    `).all();

    res.json({
      summary: ordersSummary,
      cashflow,
      recentOrders,
      suppliersLoad
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. KHÁCH HÀNG (CRM) & NGƯỜI LIÊN HỆ
// ==========================================
router.get('/customers', (req, res) => {
  try {
    const customers = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as orders_count,
        (SELECT COALESCE(SUM(remaining_amount), 0) FROM orders WHERE customer_id = c.id AND payment_status != 'PAID') as total_debt
      FROM customers c
      ${isSalesUser(req) ? 'WHERE c.created_by_user_id = ?' : ''}
      ORDER BY c.created_at DESC
    `).all(...(isSalesUser(req) ? [req.user.id] : []));

    const contacts = db.prepare('SELECT * FROM customer_contacts').all();
    const contactsByCustomer = {};
    contacts.forEach(ct => {
      if (!contactsByCustomer[ct.customer_id]) contactsByCustomer[ct.customer_id] = [];
      contactsByCustomer[ct.customer_id].push(ct);
    });

    const result = customers.map(c => ({
      ...c,
      contacts: contactsByCustomer[c.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers', (req, res) => {
  try {
    const { code, name, phone, email, address, customer_group, tax_company, tax_code, tax_email, default_discount, notes, contacts } = req.body;
    const id = generateId('kh');
    const autoCode = code || `KH${Date.now().toString().slice(-4)}`;

    const insert = db.prepare(`
      INSERT INTO customers (id, code, name, phone, email, address, customer_group, tax_company, tax_code, tax_email, default_discount, notes, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(id, autoCode, name, phone || '', email || '', address || '', customer_group || 'RETAIL', tax_company || '', tax_code || '', tax_email || '', default_discount || 0, notes || '', req.user?.id || null);

    // Lưu người liên hệ nếu có
    if (Array.isArray(contacts)) {
      const insertContact = db.prepare(`
        INSERT INTO customer_contacts (id, customer_id, name, phone, position, email)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      contacts.forEach(c => {
        if (c.name) {
          insertContact.run(generateId('ct'), id, c.name, c.phone || '', c.position || '', c.email || '');
        }
      });
    }

    res.json({ success: true, id, code: autoCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm người liên hệ vào KH
router.post('/customers/:id/contacts', (req, res) => {
  try {
    const customerId = req.params.id;
    const { name, phone, position, email } = req.body;
    const contactId = generateId('ct');
    db.prepare(`
      INSERT INTO customer_contacts (id, customer_id, name, phone, position, email)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contactId, customerId, name, phone || '', position || '', email || '');
    res.json({ success: true, id: contactId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. NHÀ CUNG CẤP & XƯỞNG IN (SRM)
// ==========================================
router.get('/suppliers', (req, res) => {
  try {
    const suppliers = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM order_items WHERE supplier_id = s.id AND status = 'PRINTING') as printing_count,
        (SELECT COALESCE(SUM(total_cost), 0) FROM order_items WHERE supplier_id = s.id) as total_worked_amount
      FROM suppliers s
      ORDER BY s.name ASC
    `).all();
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers', (req, res) => {
  try {
    const { name, phone, address, specialties, vat_supported, bank_info, notes } = req.body;
    const id = generateId('ncc');
    db.prepare(`
      INSERT INTO suppliers (id, name, phone, address, specialties, vat_supported, bank_info, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, phone || '', address || '', specialties || '', vat_supported ? 1 : 0, bank_info || '', notes || '');
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. BÁO GIÁ & ĐƠN HÀNG (ORDERS & QUOTES)
// ==========================================
router.get('/orders', (req, res) => {
  try {
    const { status, type, customer_id, q } = req.query;
    let query = `
      SELECT o.*, c.name as customer_name, c.code as customer_code, c.phone as customer_phone,
        ct.name as contact_name, ct.phone as contact_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN customer_contacts ct ON o.contact_id = ct.id
      WHERE 1=1
    `;
    const params = [];
    if (isSalesUser(req)) {
      query += ` AND o.created_by_user_id = ?`;
      params.push(req.user.id);
    }

    if (type) {
      query += ` AND o.type = ?`;
      params.push(type);
    }
    if (status && status !== 'ALL') {
      query += ` AND o.status = ?`;
      params.push(status);
    }
    if (customer_id) {
      query += ` AND o.customer_id = ?`;
      params.push(customer_id);
    }
    if (q) {
      query += ` AND (o.code LIKE ? OR c.name LIKE ? OR c.code LIKE ? OR o.notes LIKE ?)`;
      const searchPattern = `%${q}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY o.created_at DESC`;

    const orders = db.prepare(query).all(...params);

    // Lấy items cho từng order
    const orderIds = orders.map(o => o.id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const items = db.prepare(`
        SELECT oi.*, s.name as supplier_name 
        FROM order_items oi
        LEFT JOIN suppliers s ON oi.supplier_id = s.id
        WHERE oi.order_id IN (${placeholders})
      `).all(...orderIds);

      items.forEach(it => {
        if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
        itemsByOrder[it.order_id].push(it);
      });
    }

    const result = orders.map(o => ({
      ...o,
      items: itemsByOrder[o.id] || []
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders/:id', (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.*, c.name as customer_name, c.code as customer_code, c.phone as customer_phone,
        c.email as customer_email, c.address as customer_full_address,
        c.tax_company, c.tax_code, c.tax_email,
        ct.name as contact_name, ct.phone as contact_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN customer_contacts ct ON o.contact_id = ct.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    const items = db.prepare(`
      SELECT oi.*, s.name as supplier_name, s.phone as supplier_phone
      FROM order_items oi
      LEFT JOIN suppliers s ON oi.supplier_id = s.id
      WHERE oi.order_id = ?
    `).all(order.id);

    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE order_id = ? ORDER BY created_at DESC
    `).all(order.id);

    res.json({
      ...order,
      items,
      transactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/orders', (req, res) => {
  try {
    const {
      type = 'ORDER',
      customer_id,
      contact_id,
      delivery_deadline,
      shipping_address,
      vat_rate = 8,
      discount_amount = 0,
      deposit_amount = 0,
      notes = '',
      items = []
    } = req.body;

    if (isSalesUser(req)) {
      const cust = db.prepare('SELECT created_by_user_id FROM customers WHERE id = ?').get(customer_id);
      if (!cust || cust.created_by_user_id !== req.user.id) {
        return res.status(403).json({ error: 'Bạn chỉ được lên đơn cho khách hàng do mình tạo' });
      }
    }

    const id = generateId('dh');
    const code = generateOrderCode(type);

    let total_selling = 0;
    let total_cost = 0;

    items.forEach(it => {
      const lineCost = (parseFloat(it.unit_cost) || 0) * (parseInt(it.quantity) || 1);
      const linePrice = (parseFloat(it.unit_price) || 0) * (parseInt(it.quantity) || 1);
      total_cost += lineCost;
      total_selling += linePrice;
    });

    const parsedDiscount = parseFloat(discount_amount) || 0;
    const finalSellingAfterDiscount = Math.max(0, total_selling - parsedDiscount);
    const parsedVatRate = parseFloat(vat_rate) || 0;
    const vat_amount = (finalSellingAfterDiscount * parsedVatRate) / 100;
    const grand_total = finalSellingAfterDiscount + vat_amount;

    const gross_profit = finalSellingAfterDiscount - total_cost;
    const parsedDeposit = parseFloat(deposit_amount) || 0;
    const remaining_amount = Math.max(0, grand_total - parsedDeposit);

    let payment_status = 'UNPAID';
    if (parsedDeposit >= grand_total && grand_total > 0) {
      payment_status = 'PAID';
    } else if (parsedDeposit > 0) {
      payment_status = 'PARTIAL';
    }

    const initialStatus = type === 'QUOTE' ? 'QUOTE_SENT' : (parsedDeposit > 0 ? 'ORDER_CONFIRMED' : 'DRAFT');

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, code, type, customer_id, contact_id, status, delivery_deadline, shipping_address,
        vat_rate, vat_amount, discount_amount, total_selling, total_cost, gross_profit,
        deposit_amount, remaining_amount, payment_status, notes, created_by, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertOrder.run(
      id, code, type, customer_id, contact_id || null, initialStatus, delivery_deadline || null, shipping_address || '',
      parsedVatRate, vat_amount, parsedDiscount, grand_total, total_cost, gross_profit,
      parsedDeposit, remaining_amount, payment_status, notes, req.user?.full_name || 'Dương Trân', req.user?.id || null
    );

    // Lưu các line items
    const insertItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, item_name, size, quantity, unit, paper_gsm, specs, imposition_info,
        supplier_id, file_url, unit_cost, total_cost, unit_price, total_price, profit, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach(it => {
      const q = parseInt(it.quantity) || 1;
      const uCost = parseFloat(it.unit_cost) || 0;
      const uPrice = parseFloat(it.unit_price) || 0;
      const tCost = uCost * q;
      const tPrice = uPrice * q;
      const profit = tPrice - tCost;

      insertItem.run(
        generateId('item'), id, it.item_name || 'Ấn phẩm in', it.size || '', q, it.unit || 'bộ',
        it.paper_gsm || '', it.specs || '', it.imposition_info || '',
        it.supplier_id || null, it.file_url || '',
        uCost, tCost, uPrice, tPrice, profit, 'PENDING'
      );
    });

    // Nếu có cọc trước thì tạo giao dịch
    if (parsedDeposit > 0) {
      db.prepare(`
        INSERT INTO transactions (id, order_id, type, category, amount, payment_method, ref_code, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId('tx'), id, 'INCOME_DEPOSIT', 'BAN_HANG', parsedDeposit, 'BANK_TRANSFER', 'COC_KHI_TAO_DON', 'Tiền cọc khi khởi tạo đơn hàng'
      );
    }

    res.json({ success: true, id, code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật toàn bộ nội dung đơn hàng (chỉ cho phép khi chưa COMPLETED / CANCELLED)
router.put('/orders/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      return res.status(400).json({ error: 'Không thể sửa đơn hàng đã hoàn thành hoặc đã hủy' });
    }

    const {
      customer_id,
      contact_id,
      delivery_deadline,
      shipping_address,
      vat_rate = 8,
      discount_amount = 0,
      notes = '',
      items = []
    } = req.body;

    let total_selling = 0;
    let total_cost = 0;

    items.forEach(it => {
      const lineCost = (parseFloat(it.unit_cost) || 0) * (parseInt(it.quantity) || 1);
      const linePrice = (parseFloat(it.unit_price) || 0) * (parseInt(it.quantity) || 1);
      total_cost += lineCost;
      total_selling += linePrice;
    });

    const parsedDiscount = parseFloat(discount_amount) || 0;
    const finalSellingAfterDiscount = Math.max(0, total_selling - parsedDiscount);
    const parsedVatRate = parseFloat(vat_rate) || 0;
    const vat_amount = (finalSellingAfterDiscount * parsedVatRate) / 100;
    const grand_total = finalSellingAfterDiscount + vat_amount;
    const gross_profit = finalSellingAfterDiscount - total_cost;

    // Tính lại số tiền còn nợ dựa trên deposit_amount hiện tại trong DB
    const totalPaid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as paid FROM transactions WHERE order_id = ? AND type LIKE 'INCOME%'
    `).get(req.params.id)?.paid || 0;
    const remaining_amount = Math.max(0, grand_total - totalPaid);

    let payment_status = 'UNPAID';
    if (totalPaid >= grand_total && grand_total > 0) payment_status = 'PAID';
    else if (totalPaid > 0) payment_status = 'PARTIAL';

    // Update bảng orders
    db.prepare(`
      UPDATE orders SET
        customer_id = ?, contact_id = ?, delivery_deadline = ?, shipping_address = ?,
        vat_rate = ?, vat_amount = ?, discount_amount = ?, total_selling = ?, total_cost = ?,
        gross_profit = ?, remaining_amount = ?, payment_status = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      customer_id, contact_id || null, delivery_deadline || null, shipping_address || '',
      parsedVatRate, vat_amount, parsedDiscount, grand_total, total_cost,
      gross_profit, remaining_amount, payment_status, notes,
      req.params.id
    );

    // Xóa items cũ và insert lại
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);

    const insertItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, item_name, size, quantity, unit, paper_gsm, specs, imposition_info,
        supplier_id, file_url, unit_cost, total_cost, unit_price, total_price, profit, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach(it => {
      const q = parseInt(it.quantity) || 1;
      const uCost = parseFloat(it.unit_cost) || 0;
      const uPrice = parseFloat(it.unit_price) || 0;
      const tCost = uCost * q;
      const tPrice = uPrice * q;
      const profit = tPrice - tCost;

      insertItem.run(
        generateId('item'), req.params.id, it.item_name || 'Ấn phẩm in', it.size || '', q, it.unit || 'bộ',
        it.paper_gsm || '', it.specs || '', it.imposition_info || '',
        it.supplier_id || null, it.file_url || '',
        uCost, tCost, uPrice, tPrice, profit, 'PENDING'
      );
    });

    res.json({ success: true, id: req.params.id, code: order.code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật trạng thái đơn hàng (1-click transition)
router.patch('/orders/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật thông tin đơn hàng / Chuyển từ BÁO GIÁ sang ĐƠN HÀNG
router.patch('/orders/:id/convert-to-order', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });

    const newCode = order.code.replace('BG_', 'DH_');
    db.prepare(`
      UPDATE orders 
      SET type = 'ORDER', code = ?, status = 'ORDER_CONFIRMED', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newCode, req.params.id);

    res.json({ success: true, code: newCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm thanh toán / Thu cọc
router.post('/orders/:id/transactions', (req, res) => {
  try {
    const orderId = req.params.id;
    const { amount, type = 'INCOME_BALANCE', payment_method = 'BANK_TRANSFER', ref_code = '', notes = '' } = req.body;
    const numAmount = parseFloat(amount) || 0;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });

    const txId = generateId('tx');
    db.prepare(`
      INSERT INTO transactions (id, order_id, type, category, amount, payment_method, ref_code, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(txId, orderId, type, 'BAN_HANG', numAmount, payment_method, ref_code, notes);

    // Tính lại công nợ
    let newDeposit = order.deposit_amount;
    if (type === 'INCOME_DEPOSIT') newDeposit += numAmount;

    const totalPaid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as paid FROM transactions 
      WHERE order_id = ? AND type LIKE 'INCOME%'
    `).get(orderId).paid;

    const newRemaining = Math.max(0, order.total_selling - totalPaid);
    let newPayStatus = 'UNPAID';
    if (newRemaining <= 0) {
      newPayStatus = 'PAID';
    } else if (totalPaid > 0) {
      newPayStatus = 'PARTIAL';
    }

    db.prepare(`
      UPDATE orders 
      SET deposit_amount = ?, remaining_amount = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newDeposit, newRemaining, newPayStatus, orderId);

    res.json({ success: true, txId, remaining_amount: newRemaining, payment_status: newPayStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. CÔNG CỤ TÍNH GIÁ NHANH & BÌNH BÀI (PRICING ENGINE)
// ==========================================
router.get('/pricing/configs', (req, res) => {
  try {
    const configs = db.prepare('SELECT * FROM print_configs').all();
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pricing/calculate', (req, res) => {
  try {
    res.json(calculatePrice(db, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 6. TÀI CHÍNH, SỔ CÔNG NỢ & NHẬT KÝ THU CHI
// ==========================================
router.get('/finance', (req, res) => {
  try {
    // Sổ công nợ phải thu của khách hàng (AR)
    const customerDebts = db.prepare(`
      SELECT c.id, c.code, c.name, c.phone,
        COUNT(o.id) as unpaid_orders_count,
        COALESCE(SUM(o.total_selling), 0) as total_ordered,
        COALESCE(SUM(o.deposit_amount), 0) as total_deposited,
        COALESCE(SUM(o.remaining_amount), 0) as current_debt
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status != 'PAID' AND o.type = 'ORDER'
      GROUP BY c.id
      HAVING current_debt > 0
      ORDER BY current_debt DESC
    `).all();

    // Nhật ký giao dịch thu chi mới nhất
    const transactions = db.prepare(`
      SELECT t.*, o.code as order_code, c.name as customer_name
      FROM transactions t
      LEFT JOIN orders o ON t.order_id = o.id
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY t.created_at DESC
      LIMIT 20
    `).all();

    // Tổng hợp VAT
    const vatReport = db.prepare(`
      SELECT 
        COUNT(CASE WHEN vat_rate > 0 THEN 1 END) as vat_orders_count,
        COALESCE(SUM(vat_amount), 0) as total_vat_collected
      FROM orders
      WHERE type = 'ORDER'
    `).get();

    res.json({
      customerDebts,
      transactions,
      vatReport
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
