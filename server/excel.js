/**
 * MODULE IMPORT & EXPORT EXCEL ĐA DANH SÁCH (EXCELJS)
 * - Khách hàng (Customers)
 * - Nhà cung cấp / Xưởng in (Suppliers)
 * - Đơn hàng / Báo giá (Orders)
 * - Lệnh in chuyển xưởng (Supplier Jobs)
 * Phân quyền chặt chẽ theo RBAC và che giá vốn/lợi nhuận đối với Sales.
 */

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db } = require('./db');
const { isSalesUser } = require('./auth');

// Utility styling cho Excel
function styleHeaderRow(row, primaryColor = '0284C7') {
  row.height = 28;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + primaryColor } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });
}

function styleDataRow(row) {
  row.eachCell(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
    cell.alignment = { vertical: 'middle' };
  });
}

// ========================================================
// 1. EXPORT & IMPORT: KHÁCH HÀNG (CUSTOMERS)
// ========================================================

// Export Khách Hàng
router.get('/customers/export', async (req, res) => {
  try {
    const isSales = (req.user?.role === 'SALES');
    let query = `
      SELECT c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as total_orders_count,
        (SELECT COALESCE(SUM(remaining_amount), 0) FROM orders WHERE customer_id = c.id AND payment_status != 'PAID') as total_debt
      FROM customers c
    `;
    const params = [];
    if (isSales) {
      query += ` WHERE c.created_by_user_id = ?`;
      params.push(req.user.id);
    }
    query += ` ORDER BY c.created_at DESC`;

    const customers = db.prepare(query).all(...params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Danh Sách Khách Hàng');

    ws.columns = [
      { header: 'STT', key: 'stt', width: 6 },
      { header: 'Mã KH', key: 'code', width: 14 },
      { header: 'Tên Khách Hàng', key: 'name', width: 28 },
      { header: 'Số Điện Thoại', key: 'phone', width: 16 },
      { header: 'Email', key: 'email', width: 22 },
      { header: 'Địa Chỉ', key: 'address', width: 32 },
      { header: 'Công Ty Xuất HĐ', key: 'tax_company', width: 28 },
      { header: 'Mã Số Thuế', key: 'tax_code', width: 16 },
      { header: 'Email Nhận HĐ', key: 'tax_email', width: 22 },
      { header: 'Ghi Chú', key: 'notes', width: 24 },
      { header: 'Công Nợ Hiện Tại (đ)', key: 'total_debt', width: 20 }
    ];

    styleHeaderRow(ws.getRow(1));

    customers.forEach((c, idx) => {
      const row = ws.addRow({
        stt: idx + 1,
        code: c.code || '',
        name: c.name || '',
        phone: c.phone || '',
        email: c.email || '',
        address: c.address || '',
        tax_company: c.tax_company || '',
        tax_code: c.tax_code || '',
        tax_email: c.tax_email || '',
        notes: c.notes || '',
        total_debt: c.total_debt || 0
      });
      styleDataRow(row);
      row.getCell('stt').alignment = { horizontal: 'center' };
      row.getCell('total_debt').numFmt = '#,##0';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DS_KhachHang_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xuất Excel khách hàng: ' + err.message });
  }
});

// Import Khách Hàng
router.post('/customers/import', express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', '*/*'], limit: '20mb' }), async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu file tải lên không hợp lệ hoặc rỗng' });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.body);
    const ws = wb.getWorksheet(1);
    if (!ws) return res.status(400).json({ error: 'File Excel không có dữ liệu sheet' });

    let insertedCount = 0;
    let updatedCount = 0;
    const errors = [];

    const insertCustStmt = db.prepare(`
      INSERT INTO customers (id, code, name, phone, email, address, tax_company, tax_code, tax_email, notes, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateCustStmt = db.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, email = ?, address = ?, tax_company = ?, tax_code = ?, tax_email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const checkCustByPhone = db.prepare('SELECT id FROM customers WHERE phone = ? LIMIT 1');
    const checkCustByCode = db.prepare('SELECT id FROM customers WHERE code = ? LIMIT 1');

    const transaction = db.transaction(() => {
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Bỏ qua tiêu đề

        const vals = row.values;
        // Mapping cột (hỗ trợ cả file mẫu hoặc file người dùng tự tạo):
        // 1: STT, 2: Mã KH, 3: Tên KH, 4: SĐT, 5: Email, 6: Địa chỉ, 7: Công ty VAT, 8: MST, 9: Email VAT, 10: Ghi chú
        const code = String(vals[2] || '').trim();
        const name = String(vals[3] || '').trim();
        const phone = String(vals[4] || '').trim();
        const email = String(vals[5] || '').trim();
        const address = String(vals[6] || '').trim();
        const tax_company = String(vals[7] || '').trim();
        const tax_code = String(vals[8] || '').trim();
        const tax_email = String(vals[9] || '').trim();
        const notes = String(vals[10] || '').trim();

        if (!name) return; // Bỏ dòng trống tên

        let existing = null;
        if (code) existing = checkCustByCode.get(code);
        if (!existing && phone) existing = checkCustByPhone.get(phone);

        if (existing) {
          updateCustStmt.run(name, phone, email, address, tax_company, tax_code, tax_email, notes, existing.id);
          updatedCount++;
        } else {
          const newId = 'kh_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const newCode = code || ('KH' + Math.floor(100000 + Math.random() * 900000));
          insertCustStmt.run(newId, newCode, name, phone, email, address, tax_company, tax_code, tax_email, notes, req.user?.id || null);
          insertedCount++;
        }
      });
    });

    transaction();

    res.json({
      success: true,
      message: `Nhập dữ liệu thành công: Thêm mới ${insertedCount} khách hàng, Cập nhật ${updatedCount} khách hàng.`,
      inserted: insertedCount,
      updated: updatedCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi đọc file Excel khách hàng: ' + err.message });
  }
});


// ========================================================
// 2. EXPORT & IMPORT: NHÀ CUNG CẤP & XƯỞNG IN (SUPPLIERS)
// ========================================================

// Export Xưởng In
router.get('/suppliers/export', async (req, res) => {
  try {
    const suppliers = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM order_items WHERE supplier_id = s.id AND status = 'PRINTING') as printing_count,
        (SELECT COALESCE(SUM(total_cost), 0) FROM order_items WHERE supplier_id = s.id) as total_worked_amount
      FROM suppliers s
      ORDER BY s.name ASC
    `).all();

    const isSales = (req.user?.role === 'SALES');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Danh Sách Xưởng In');

    const cols = [
      { header: 'STT', key: 'stt', width: 6 },
      { header: 'Tên Xưởng In / NCC', key: 'name', width: 28 },
      { header: 'Số Điện Thoại', key: 'phone', width: 16 },
      { header: 'Địa Chỉ Xưởng', key: 'address', width: 32 },
      { header: 'Thế Mạnh Nổi Bật', key: 'specialties', width: 30 },
      { header: 'Tài Khoản Ngân Hàng', key: 'bank_info', width: 30 },
      { header: 'Hỗ Trợ VAT', key: 'vat_supported', width: 14 },
      { header: 'Ghi Chú', key: 'notes', width: 24 }
    ];

    if (!isSales) {
      cols.push(
        { header: 'Job Đang In', key: 'printing_count', width: 14 },
        { header: 'Tổng Tiền Đã Làm (đ)', key: 'total_worked_amount', width: 22 }
      );
    }

    ws.columns = cols;
    styleHeaderRow(ws.getRow(1), 'D97706'); // Màu cam hổ phách

    suppliers.forEach((s, idx) => {
      const rowData = {
        stt: idx + 1,
        name: s.name || '',
        phone: s.phone || '',
        address: s.address || '',
        specialties: s.specialties || '',
        bank_info: s.bank_info || '',
        vat_supported: s.vat_supported ? 'Có VAT' : 'Không VAT',
        notes: s.notes || ''
      };
      if (!isSales) {
        rowData.printing_count = s.printing_count || 0;
        rowData.total_worked_amount = s.total_worked_amount || 0;
      }
      const row = ws.addRow(rowData);
      styleDataRow(row);
      row.getCell('stt').alignment = { horizontal: 'center' };
      if (!isSales) {
        row.getCell('total_worked_amount').numFmt = '#,##0';
        row.getCell('printing_count').alignment = { horizontal: 'center' };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DS_XuongIn_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xuất Excel xưởng in: ' + err.message });
  }
});

// Import Xưởng In (Chỉ Admin / Coordinator)
router.post('/suppliers/import', express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', '*/*'], limit: '20mb' }), async (req, res) => {
  try {
    if (!['ADMIN', 'COORDINATOR'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền nhập danh sách xưởng in' });
    }

    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu file tải lên không hợp lệ hoặc rỗng' });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.body);
    const ws = wb.getWorksheet(1);
    if (!ws) return res.status(400).json({ error: 'File Excel không có dữ liệu sheet' });

    let insertedCount = 0;
    let updatedCount = 0;

    const insertSupStmt = db.prepare(`
      INSERT INTO suppliers (id, name, phone, address, specialties, bank_info, vat_supported, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateSupStmt = db.prepare(`
      UPDATE suppliers 
      SET phone = ?, address = ?, specialties = ?, bank_info = ?, vat_supported = ?, notes = ?
      WHERE id = ?
    `);

    const checkSupByName = db.prepare('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1');

    const transaction = db.transaction(() => {
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const vals = row.values;
        // 1: STT, 2: Tên Xưởng, 3: SĐT, 4: Địa chỉ, 5: Thế mạnh, 6: Ngân hàng, 7: VAT, 8: Ghi chú
        const name = String(vals[2] || '').trim();
        const phone = String(vals[3] || '').trim();
        const address = String(vals[4] || '').trim();
        const specialties = String(vals[5] || '').trim();
        const bank_info = String(vals[6] || '').trim();
        const vatText = String(vals[7] || '').toLowerCase();
        const vat_supported = (vatText.includes('có') || vatText.includes('yes') || vatText === '1') ? 1 : 0;
        const notes = String(vals[8] || '').trim();

        if (!name) return;

        const existing = checkSupByName.get(name);
        if (existing) {
          updateSupStmt.run(phone, address, specialties, bank_info, vat_supported, notes, existing.id);
          updatedCount++;
        } else {
          const newId = 'ncc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          insertSupStmt.run(newId, name, phone, address, specialties, bank_info, vat_supported, notes);
          insertedCount++;
        }
      });
    });

    transaction();

    res.json({
      success: true,
      message: `Nhập dữ liệu thành công: Thêm mới ${insertedCount} xưởng in, Cập nhật ${updatedCount} xưởng in.`,
      inserted: insertedCount,
      updated: updatedCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi đọc file Excel xưởng in: ' + err.message });
  }
});


// ========================================================
// 3. EXPORT: ĐƠN HÀNG & BÁO GIÁ (ORDERS)
// ========================================================
router.get('/orders/export', async (req, res) => {
  try {
    const isSales = (req.user?.role === 'SALES');
    let query = `
      SELECT o.*, c.name as customer_name, c.code as customer_code, c.phone as customer_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
    `;
    const params = [];
    if (isSales) {
      query += ` WHERE o.created_by_user_id = ?`;
      params.push(req.user.id);
    }
    query += ` ORDER BY o.created_at DESC`;

    const orders = db.prepare(query).all(...params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Danh Sách Đơn Hàng & Báo Giá');

    const cols = [
      { header: 'STT', key: 'stt', width: 6 },
      { header: 'Mã Đơn', key: 'code', width: 16 },
      { header: 'Loại', key: 'type', width: 12 },
      { header: 'Ngày Lập', key: 'created_at', width: 14 },
      { header: 'Tên Khách Hàng', key: 'customer_name', width: 28 },
      { header: 'Số Điện Thoại', key: 'customer_phone', width: 16 },
      { header: 'Hạn Giao Hàng', key: 'delivery_deadline', width: 14 },
      { header: 'Doanh Số Bán (đ)', key: 'total_selling', width: 18 },
      { header: 'Tiền Cọc (đ)', key: 'deposit_amount', width: 16 },
      { header: 'Còn Lại Phải Thu (đ)', key: 'remaining_amount', width: 18 },
      { header: 'Thanh Toán', key: 'payment_status', width: 14 },
      { header: 'Trạng Thái', key: 'status', width: 16 }
    ];

    if (!isSales) {
      cols.push(
        { header: 'Giá Vốn Xưởng (đ)', key: 'total_cost', width: 18 },
        { header: 'Lợi Nhuận Gộp (đ)', key: 'gross_profit', width: 18 }
      );
    }

    cols.push(
      { header: 'Người Tạo', key: 'created_by', width: 16 },
      { header: 'Ghi Chú', key: 'notes', width: 24 }
    );

    ws.columns = cols;
    styleHeaderRow(ws.getRow(1), '059669'); // Màu xanh lá ngọc

    const statusLabels = {
      DRAFT: 'Bản Nháp',
      QUOTE_SENT: 'Báo Giá',
      ORDER_CONFIRMED: 'Đã Chốt In',
      IN_PRODUCTION: 'Đang In Xưởng',
      PRODUCED: 'Đã Có Hàng',
      DELIVERING: 'Đang Giao',
      COMPLETED: 'Hoàn Tất',
      CANCELLED: 'Đã Hủy'
    };

    const payLabels = {
      UNPAID: 'Chưa TT',
      PARTIAL: 'Đã Cọc',
      PAID: 'Đã TT Đủ'
    };

    orders.forEach((o, idx) => {
      const rowData = {
        stt: idx + 1,
        code: o.code || '',
        type: o.type === 'QUOTE' ? 'Báo Giá' : 'Đơn Hàng',
        created_at: o.created_at ? new Date(o.created_at).toLocaleDateString('vi-VN') : '',
        customer_name: o.customer_name || '',
        customer_phone: o.customer_phone || '',
        delivery_deadline: o.delivery_deadline ? new Date(o.delivery_deadline).toLocaleDateString('vi-VN') : '',
        total_selling: o.total_selling || 0,
        deposit_amount: o.deposit_amount || 0,
        remaining_amount: o.remaining_amount || 0,
        payment_status: payLabels[o.payment_status] || o.payment_status,
        status: statusLabels[o.status] || o.status,
        created_by: o.created_by || '',
        notes: o.notes || ''
      };

      if (!isSales) {
        rowData.total_cost = o.total_cost || 0;
        rowData.gross_profit = o.gross_profit || 0;
      }

      const row = ws.addRow(rowData);
      styleDataRow(row);
      row.getCell('stt').alignment = { horizontal: 'center' };
      row.getCell('type').alignment = { horizontal: 'center' };
      row.getCell('created_at').alignment = { horizontal: 'center' };
      row.getCell('delivery_deadline').alignment = { horizontal: 'center' };
      row.getCell('payment_status').alignment = { horizontal: 'center' };
      row.getCell('status').alignment = { horizontal: 'center' };

      row.getCell('total_selling').numFmt = '#,##0';
      row.getCell('deposit_amount').numFmt = '#,##0';
      row.getCell('remaining_amount').numFmt = '#,##0';

      if (!isSales) {
        row.getCell('total_cost').numFmt = '#,##0';
        row.getCell('gross_profit').numFmt = '#,##0';
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DS_DonHang_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xuất Excel đơn hàng: ' + err.message });
  }
});


// ========================================================
// 4. EXPORT: LỆNH CHUYỂN XƯỞNG IN (SUPPLIER JOBS)
// ========================================================
router.get('/supplier-jobs/export', async (req, res) => {
  try {
    const isSales = (req.user?.role === 'SALES');
    const { supplier_id, status } = req.query;

    let query = `
      SELECT 
        oi.id, oi.item_name, oi.specs, oi.quantity, oi.unit,
        oi.file_url, oi.imposition_info, oi.status, oi.total_cost,
        o.code as order_code, o.delivery_deadline, o.created_at as order_created_at,
        c.name as customer_name,
        s.name as supplier_name, s.phone as supplier_phone
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN suppliers s ON oi.supplier_id = s.id
      WHERE o.type = 'ORDER'
    `;
    const params = [];
    if (supplier_id && supplier_id !== 'ALL') {
      if (supplier_id === 'UNASSIGNED') {
        query += ` AND (oi.supplier_id IS NULL OR oi.supplier_id = '')`;
      } else {
        query += ` AND oi.supplier_id = ?`;
        params.push(supplier_id);
      }
    }
    if (status && status !== 'ALL') {
      if (status === 'PENDING') {
        query += ` AND oi.status = 'PENDING' AND o.status NOT IN ('COMPLETED', 'CANCELLED')`;
      } else {
        query += ` AND oi.status = ?`;
        params.push(status);
      }
    }
    query += ` ORDER BY o.created_at DESC, oi.id DESC`;

    const jobs = db.prepare(query).all(...params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lệnh Chuyển Xưởng');

    const cols = [
      { header: 'STT', key: 'stt', width: 6 },
      { header: 'Mã Đơn', key: 'order_code', width: 16 },
      { header: 'Khách Hàng', key: 'customer_name', width: 26 },
      { header: 'Xưởng Gia Công', key: 'supplier_name', width: 24 },
      { header: 'Tên Ấn Phẩm', key: 'item_name', width: 26 },
      { header: 'Quy Cách Kỹ Thuật', key: 'specs', width: 34 },
      { header: 'Bình Bài', key: 'imposition_info', width: 24 },
      { header: 'Số Lượng', key: 'quantity', width: 12 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'File In (Link)', key: 'file_url', width: 32 },
      { header: 'Hạn Giao Xưởng', key: 'delivery_deadline', width: 14 }
    ];

    if (!isSales) {
      cols.push({ header: 'Tiền Gia Công (đ)', key: 'total_cost', width: 18 });
    }

    cols.push({ header: 'Trạng Thái', key: 'status', width: 16 });

    ws.columns = cols;
    styleHeaderRow(ws.getRow(1), '4F46E5'); // Màu tím Indigo

    const statusLabels = {
      PENDING: 'Chờ gửi xưởng',
      PRINTING: 'Đang in xưởng',
      DONE: 'Đã hoàn thành'
    };

    jobs.forEach((j, idx) => {
      const rowData = {
        stt: idx + 1,
        order_code: j.order_code || '',
        customer_name: j.customer_name || '',
        supplier_name: j.supplier_name || 'Chưa gán',
        item_name: j.item_name || '',
        specs: j.specs || '',
        imposition_info: j.imposition_info || '',
        quantity: j.quantity || 0,
        unit: j.unit || '',
        file_url: j.file_url || '',
        delivery_deadline: j.delivery_deadline ? new Date(j.delivery_deadline).toLocaleDateString('vi-VN') : '',
        status: statusLabels[j.status] || j.status
      };

      if (!isSales) {
        rowData.total_cost = j.total_cost || 0;
      }

      const row = ws.addRow(rowData);
      styleDataRow(row);
      row.getCell('stt').alignment = { horizontal: 'center' };
      row.getCell('order_code').alignment = { horizontal: 'center' };
      row.getCell('quantity').numFmt = '#,##0';
      row.getCell('unit').alignment = { horizontal: 'center' };
      row.getCell('delivery_deadline').alignment = { horizontal: 'center' };
      row.getCell('status').alignment = { horizontal: 'center' };

      if (!isSales) {
        row.getCell('total_cost').numFmt = '#,##0';
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DS_LenhXUONG_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xuất Excel lệnh chuyển xưởng: ' + err.message });
  }
});

// ========================================================
// 5. EXPORT & IMPORT: DANH MỤC LOẠI GIẤY (PAPERS)
// ========================================================

// Export danh mục giấy
router.get('/papers/export', async (req, res) => {
  try {
    const papers = db.prepare('SELECT * FROM papers ORDER BY paper_type, gsm ASC, name ASC').all();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Danh Mục Loại Giấy');

    ws.columns = [
      { header: 'STT', key: 'stt', width: 6 },
      { header: 'Mã Giấy (*)', key: 'code', width: 14 },
      { header: 'Tên Loại Giấy (*)', key: 'name', width: 30 },
      { header: 'Nhóm Chất Liệu', key: 'paper_type', width: 18 },
      { header: 'Định Lượng GSM', key: 'gsm', width: 16 },
      { header: 'Khổ / Quy Cách', key: 'size_spec', width: 16 },
      { header: 'Đơn Vị Tính', key: 'unit', width: 12 },
      { header: 'Giá Vốn Tờ (đ)', key: 'cost_per_sheet', width: 16 },
      { header: 'Giá Vốn Kg (đ)', key: 'cost_per_kg', width: 16 },
      { header: 'Ghi Chú / Ứng Dụng', key: 'notes', width: 32 },
      { header: 'Trạng Thái', key: 'status', width: 14 }
    ];

    styleHeaderRow(ws.getRow(1), '059669'); // Emerald Green

    papers.forEach((p, idx) => {
      const row = ws.addRow({
        stt: idx + 1,
        code: p.code || '',
        name: p.name || '',
        paper_type: p.paper_type || 'COUCHE',
        gsm: p.gsm || 150,
        size_spec: p.size_spec || '32x43',
        unit: p.unit || 'tờ',
        cost_per_sheet: p.cost_per_sheet || 0,
        cost_per_kg: p.cost_per_kg || 0,
        notes: p.notes || '',
        status: p.is_active ? 'Hoạt động' : 'Tạm ẩn'
      });

      styleDataRow(row);
      row.getCell('stt').alignment = { horizontal: 'center' };
      row.getCell('code').alignment = { horizontal: 'center' };
      row.getCell('paper_type').alignment = { horizontal: 'center' };
      row.getCell('gsm').alignment = { horizontal: 'center' };
      row.getCell('size_spec').alignment = { horizontal: 'center' };
      row.getCell('unit').alignment = { horizontal: 'center' };
      row.getCell('status').alignment = { horizontal: 'center' };
      row.getCell('cost_per_sheet').numFmt = '#,##0';
      row.getCell('cost_per_kg').numFmt = '#,##0';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DM_LoaiGiay_${new Date().toISOString().slice(0, 10)}.xlsx`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xuất Excel danh mục giấy: ' + err.message });
  }
});

// Import danh mục giấy
router.post('/papers/import', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'File Excel không có nội dung' });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.body);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'File không có trang tính (Sheet)' });

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const findRow = db.prepare('SELECT id, code FROM papers WHERE code = ?');
    const insertStmt = db.prepare(`
      INSERT INTO papers (id, code, name, paper_type, gsm, size_spec, unit, cost_per_sheet, cost_per_kg, notes, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = db.prepare(`
      UPDATE papers SET
        name = ?,
        paper_type = ?,
        gsm = ?,
        size_spec = ?,
        unit = ?,
        cost_per_sheet = ?,
        cost_per_kg = ?,
        notes = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    // Duyệt qua từng dòng dữ liệu (bỏ qua header dòng 1)
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const getVal = (idx) => {
        const val = row.getCell(idx).value;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object' && val.text) return String(val.text).trim();
        if (typeof val === 'object' && val.result !== undefined) return String(val.result).trim();
        return String(val).trim();
      };

      const getNum = (idx, def = 0) => {
        const val = row.getCell(idx).value;
        if (val === null || val === undefined || val === '') return def;
        if (typeof val === 'object' && val.result !== undefined) return Number(val.result) || def;
        const n = Number(String(val).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? def : n;
      };

      // Header: 1:STT, 2:Mã Giấy, 3:Tên Loại Giấy, 4:Nhóm Chất Liệu, 5:GSM, 6:Khổ, 7:ĐVT, 8:Giá Vốn Tờ, 9:Giá Vốn Kg, 10:Ghi Chú, 11:Trạng Thái
      let code = getVal(2).toUpperCase();
      const name = getVal(3);
      if (!name) {
        skipped++;
        return;
      }

      if (!code) {
        code = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 15);
      }

      let paperType = getVal(4).toUpperCase();
      const validTypes = ['COUCHE', 'FORT', 'IVORY', 'BRISTOL', 'DECAL', 'KRAFT', 'ART', 'OTHER'];
      if (!validTypes.includes(paperType)) {
        if (paperType.includes('COUCH')) paperType = 'COUCHE';
        else if (paperType.includes('FOR')) paperType = 'FORT';
        else if (paperType.includes('IVOR') || paperType.includes('DUPLEX')) paperType = 'IVORY';
        else if (paperType.includes('BRIS')) paperType = 'BRISTOL';
        else if (paperType.includes('DECAL')) paperType = 'DECAL';
        else if (paperType.includes('KRAFT')) paperType = 'KRAFT';
        else if (paperType.includes('THUẬT') || paperType.includes('ART')) paperType = 'ART';
        else paperType = 'COUCHE';
      }

      const gsm = getNum(5, 150);
      const sizeSpec = getVal(6) || '32x43';
      const unit = getVal(7) || 'tờ';
      const costSheet = getNum(8, 0);
      const costKg = getNum(9, 0);
      const notes = getVal(10);
      const statusText = getVal(11).toLowerCase();
      const isActive = (statusText.includes('ẩn') || statusText.includes('tắt') || statusText === '0') ? 0 : 1;

      const existing = findRow.get(code);
      if (existing) {
        updateStmt.run(name, paperType, gsm, sizeSpec, unit, costSheet, costKg, notes, isActive, existing.id);
        updated++;
      } else {
        const newId = `paper_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        insertStmt.run(newId, code, name, paperType, gsm, sizeSpec, unit, costSheet, costKg, notes, isActive);
        imported++;
      }

      // Sync print_configs an toàn (kiểm tra tồn tại trước thay vì dựa hoàn toàn vào ON CONFLICT)
      try {
        const cfgId = `cfg_paper_${code.toLowerCase()}`;
        const existingCfg = db.prepare('SELECT id FROM print_configs WHERE code = ? OR id = ?').get(code, cfgId);
        if (existingCfg) {
          db.prepare(`
            UPDATE print_configs SET
              name = ?,
              base_cost = ?,
              unit = ?,
              metadata = ?
            WHERE id = ?
          `).run(name, costSheet, `${unit} ${sizeSpec}`, JSON.stringify({ gsm, paper_type: paperType }), existingCfg.id);
        } else {
          db.prepare(`
            INSERT INTO print_configs (id, category, name, code, base_cost, unit, metadata)
            VALUES (?, 'PAPER', ?, ?, ?, ?, ?)
          `).run(cfgId, name, code, costSheet, `${unit} ${sizeSpec}`, JSON.stringify({ gsm, paper_type: paperType }));
        }
      } catch (errSync) {
        console.warn('Lỗi sync print_configs khi import giấy:', errSync.message);
      }
    });

    res.json({
      success: true,
      message: `Đã nhập xong danh mục giấy: thêm mới ${imported}, cập nhật ${updated}, bỏ qua ${skipped} dòng trống.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi import file Excel: ' + err.message });
  }
});

module.exports = router;

