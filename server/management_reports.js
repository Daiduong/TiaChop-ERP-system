/**
 * SERVER/MANAGEMENT_REPORTS.JS
 * API Báo cáo Quản trị chuyên sâu (BI & Management Reporting) dành cho Ban Giám Đốc (ADMIN) & Kế Toán (ACCOUNTANT).
 */

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db } = require('./db');
const { getSettings } = require('./auth');

// Helper định dạng tiền & ngày
const money = n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ==========================================
// 1. API LẤY TỔNG HỢP BÁO CÁO QUẢN TRỊ (JSON)
// ==========================================
router.get('/analytics', (req, res) => {
  try {
    const { from, to, period = 'month' } = req.query;

    let dateFilter = '';
    const dateParams = [];
    if (from) {
      dateFilter += ' AND DATE(o.created_at) >= DATE(?)';
      dateParams.push(from);
    }
    if (to) {
      dateFilter += ' AND DATE(o.created_at) <= DATE(?)';
      dateParams.push(to);
    }

    // 1.1 Tổng quan KPI (Executive Summary)
    const kpi = db.prepare(`
      SELECT 
        COUNT(CASE WHEN o.type = 'ORDER' THEN 1 END) as total_orders,
        COUNT(CASE WHEN o.type = 'QUOTE' THEN 1 END) as total_quotes,
        COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) as completed_orders,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_selling ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_cost ELSE 0 END), 0) as total_cost,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.gross_profit ELSE 0 END), 0) as total_profit,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.shipping_fee ELSE 0 END), 0) as total_shipping_fee,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.vat_amount ELSE 0 END), 0) as total_vat,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' AND o.payment_status != 'PAID' THEN o.remaining_amount ELSE 0 END), 0) as total_debt
      FROM orders o
      WHERE 1=1 ${dateFilter}
    `).get(...dateParams);

    const conversionRate = (kpi.total_quotes + kpi.total_orders) > 0 
      ? Math.round((kpi.total_orders / (kpi.total_quotes + kpi.total_orders)) * 100) 
      : 0;
    const avgOrderValue = kpi.total_orders > 0 ? Math.round(kpi.total_revenue / kpi.total_orders) : 0;
    const profitMargin = kpi.total_revenue > 0 ? Math.round((kpi.total_profit / kpi.total_revenue) * 100) : 0;

    // 1.2 Doanh thu & Lợi nhuận theo thời gian (Timeline Trend)
    let timeGroupFormat = "%Y-%m";
    if (period === 'day') timeGroupFormat = "%Y-%m-%d";
    else if (period === 'year') timeGroupFormat = "%Y";

    const timeline = db.prepare(`
      SELECT 
        STRFTIME('${timeGroupFormat}', o.created_at) as timeline_key,
        COUNT(o.id) as orders_count,
        COALESCE(SUM(o.total_selling), 0) as revenue,
        COALESCE(SUM(o.total_cost), 0) as cost,
        COALESCE(SUM(o.gross_profit), 0) as profit
      FROM orders o
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY STRFTIME('${timeGroupFormat}', o.created_at)
      ORDER BY timeline_key ASC
    `).all(...dateParams);

    // 1.3 Hiệu suất nhân viên Sales (Sales Performance)
    const salesReport = db.prepare(`
      SELECT 
        COALESCE(u.id, 'unassigned') as user_id,
        COALESCE(u.full_name, o.created_by, 'Chưa gán') as sales_name,
        COALESCE(u.username, '') as username,
        COUNT(CASE WHEN o.type = 'ORDER' THEN 1 END) as order_count,
        COUNT(CASE WHEN o.type = 'QUOTE' THEN 1 END) as quote_count,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_selling ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.gross_profit ELSE 0 END), 0) as total_profit,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' AND o.payment_status != 'PAID' THEN o.remaining_amount ELSE 0 END), 0) as debt_amount
      FROM orders o
      LEFT JOIN users u ON o.created_by_user_id = u.id
      WHERE 1=1 ${dateFilter}
      GROUP BY COALESCE(u.id, o.created_by)
      ORDER BY total_revenue DESC
    `).all(...dateParams);

    // 1.4 Top khách hàng đóng góp doanh số & lợi nhuận lớn nhất (Top Customers 80/20)
    const topCustomers = db.prepare(`
      SELECT 
        c.id, c.code, c.name, c.customer_group, c.phone,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_selling), 0) as total_revenue,
        COALESCE(SUM(o.gross_profit), 0) as total_profit,
        COALESCE(SUM(o.remaining_amount), 0) as current_debt
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY c.id
      ORDER BY total_revenue DESC
      LIMIT 15
    `).all(...dateParams);

    // Cơ cấu doanh thu theo nhóm khách hàng (B2B_CHAIN, CORPORATE, SCHOOL, RETAIL)
    const customerGroups = db.prepare(`
      SELECT 
        COALESCE(c.customer_group, 'RETAIL') as group_name,
        COUNT(DISTINCT c.id) as customer_count,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_selling), 0) as total_revenue,
        COALESCE(SUM(o.gross_profit), 0) as total_profit
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY COALESCE(c.customer_group, 'RETAIL')
      ORDER BY total_revenue DESC
    `).all(...dateParams);

    // 1.5 Báo cáo chi phí theo Xưởng in & Đối tác gia công (Supplier Breakdown)
    let supDateFilter = '';
    const supParams = [];
    if (from) {
      supDateFilter += ' AND DATE(o.created_at) >= DATE(?)';
      supParams.push(from);
    }
    if (to) {
      supDateFilter += ' AND DATE(o.created_at) <= DATE(?)';
      supParams.push(to);
    }

    const suppliersReport = db.prepare(`
      SELECT 
        COALESCE(s.id, 'unknown') as supplier_id,
        COALESCE(s.name, 'Chưa gán xưởng') as supplier_name,
        s.specialties,
        COUNT(oi.id) as item_count,
        COUNT(DISTINCT oi.order_id) as order_count,
        COALESCE(SUM(oi.total_cost), 0) as total_cost,
        COALESCE(SUM(oi.total_price), 0) as total_selling_value
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN suppliers s ON oi.supplier_id = s.id
      WHERE o.type = 'ORDER' ${supDateFilter}
      GROUP BY COALESCE(s.id, 'unknown')
      ORDER BY total_cost DESC
    `).all(...supParams);

    // 1.6 Báo cáo Dòng tiền Thực tế (Cash Flow Summary)
    let txDateFilter = '';
    const txParams = [];
    if (from) {
      txDateFilter += ' AND DATE(t.created_at) >= DATE(?)';
      txParams.push(from);
    }
    if (to) {
      txDateFilter += ' AND DATE(t.created_at) <= DATE(?)';
      txParams.push(to);
    }

    const cashflowReport = db.prepare(`
      SELECT 
        t.type,
        t.payment_method,
        COUNT(t.id) as tx_count,
        COALESCE(SUM(t.amount), 0) as total_amount
      FROM transactions t
      WHERE 1=1 ${txDateFilter}
      GROUP BY t.type, t.payment_method
      ORDER BY total_amount DESC
    `).all(...txParams);

    res.json({
      success: true,
      period: { from: from || 'Toàn thời gian', to: to || 'Hiện tại' },
      kpi: {
        ...kpi,
        conversionRate,
        avgOrderValue,
        profitMargin
      },
      timeline,
      salesReport,
      topCustomers,
      customerGroups,
      suppliersReport,
      cashflowReport
    });

  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. XUẤT EXCEL BÁO CÁO QUẢN TRỊ TOÀN DIỆN
// ==========================================
router.get('/export/excel', async (req, res) => {
  try {
    const { from, to } = req.query;
    let dateFilter = '';
    const dateParams = [];
    if (from) {
      dateFilter += ' AND DATE(o.created_at) >= DATE(?)';
      dateParams.push(from);
    }
    if (to) {
      dateFilter += ' AND DATE(o.created_at) <= DATE(?)';
      dateParams.push(to);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'In Tia Chớp ERP';
    workbook.created = new Date();

    const styleHeader = (row, bg = '0284C7') => {
      row.height = 28;
      row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
      });
    };

    const styleData = row => {
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        cell.alignment = { vertical: 'middle' };
      });
    };

    // Sheet 1: Hiệu suất Sales
    const sheetSales = workbook.addWorksheet('Hiệu Suất Sales');
    sheetSales.columns = [
      { header: 'Nhân Viên Sales', key: 'name', width: 26 },
      { header: 'Số Đơn Hàng', key: 'orders', width: 14 },
      { header: 'Số Báo Giá', key: 'quotes', width: 14 },
      { header: 'Tổng Doanh Thu (đ)', key: 'rev', width: 22 },
      { header: 'Lợi Nhuận Gộp (đ)', key: 'profit', width: 22 },
      { header: 'Tỷ Suất LN (%)', key: 'margin', width: 16 },
      { header: 'Công Nợ Đang Quản Lý (đ)', key: 'debt', width: 24 }
    ];
    styleHeader(sheetSales.getRow(1), '0284C7');

    const salesData = db.prepare(`
      SELECT 
        COALESCE(u.full_name, o.created_by, 'Chưa gán') as name,
        COUNT(CASE WHEN o.type = 'ORDER' THEN 1 END) as orders,
        COUNT(CASE WHEN o.type = 'QUOTE' THEN 1 END) as quotes,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_selling ELSE 0 END), 0) as rev,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.gross_profit ELSE 0 END), 0) as profit,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' AND o.payment_status != 'PAID' THEN o.remaining_amount ELSE 0 END), 0) as debt
      FROM orders o
      LEFT JOIN users u ON o.created_by_user_id = u.id
      WHERE 1=1 ${dateFilter}
      GROUP BY COALESCE(u.id, o.created_by)
      ORDER BY rev DESC
    `).all(...dateParams);

    salesData.forEach(r => {
      const margin = r.rev > 0 ? Math.round((r.profit / r.rev) * 100) : 0;
      const row = sheetSales.addRow({
        name: r.name,
        orders: r.orders,
        quotes: r.quotes,
        rev: r.rev,
        profit: r.profit,
        margin: `${margin}%`,
        debt: r.debt
      });
      styleData(row);
      row.getCell('orders').alignment = { horizontal: 'center' };
      row.getCell('quotes').alignment = { horizontal: 'center' };
      row.getCell('margin').alignment = { horizontal: 'center' };
      row.getCell('rev').numFmt = '#,##0';
      row.getCell('profit').numFmt = '#,##0';
      row.getCell('debt').numFmt = '#,##0';
    });

    // Sheet 2: Top Khách Hàng (80/20)
    const sheetCust = workbook.addWorksheet('Top Khách Hàng');
    sheetCust.columns = [
      { header: 'Mã KH', key: 'code', width: 14 },
      { header: 'Tên Khách Hàng', key: 'name', width: 34 },
      { header: 'Nhóm Khách', key: 'group', width: 18 },
      { header: 'Số Đơn', key: 'orders', width: 12 },
      { header: 'Doanh Thu (đ)', key: 'rev', width: 22 },
      { header: 'Lợi Nhuận (đ)', key: 'profit', width: 22 },
      { header: 'Công Nợ Hiện Tại (đ)', key: 'debt', width: 22 }
    ];
    styleHeader(sheetCust.getRow(1), '10B981');

    const custData = db.prepare(`
      SELECT 
        c.code, c.name, c.customer_group as group_name,
        COUNT(o.id) as orders,
        COALESCE(SUM(o.total_selling), 0) as rev,
        COALESCE(SUM(o.gross_profit), 0) as profit,
        COALESCE(SUM(o.remaining_amount), 0) as debt
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY c.id
      ORDER BY rev DESC
    `).all(...dateParams);

    custData.forEach(r => {
      const row = sheetCust.addRow({
        code: r.code || '',
        name: r.name,
        group: r.group_name || 'Khách lẻ',
        orders: r.orders,
        rev: r.rev,
        profit: r.profit,
        debt: r.debt
      });
      styleData(row);
      row.getCell('code').alignment = { horizontal: 'center' };
      row.getCell('orders').alignment = { horizontal: 'center' };
      row.getCell('rev').numFmt = '#,##0';
      row.getCell('profit').numFmt = '#,##0';
      row.getCell('debt').numFmt = '#,##0';
    });

    // Sheet 3: Chi phí Xưởng Gia Công
    const sheetSup = workbook.addWorksheet('Chi Phí Xưởng In');
    sheetSup.columns = [
      { header: 'Tên Xưởng In / NCC', key: 'name', width: 30 },
      { header: 'Chuyên Môn', key: 'spec', width: 24 },
      { header: 'Số Hạng Mục Đặt', key: 'items', width: 18 },
      { header: 'Tổng Tiền Gia Công (đ)', key: 'cost', width: 24 },
      { header: 'Giá Bán Ấn Phẩm (đ)', key: 'rev', width: 24 }
    ];
    styleHeader(sheetSup.getRow(1), 'F59E0B');

    const supData = db.prepare(`
      SELECT 
        COALESCE(s.name, 'Chưa gán xưởng') as name,
        s.specialties as spec,
        COUNT(oi.id) as items,
        COALESCE(SUM(oi.total_cost), 0) as cost,
        COALESCE(SUM(oi.total_price), 0) as rev
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN suppliers s ON oi.supplier_id = s.id
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY COALESCE(s.id, 'unknown')
      ORDER BY cost DESC
    `).all(...dateParams);

    supData.forEach(r => {
      const row = sheetSup.addRow({
        name: r.name,
        spec: r.spec || '',
        items: r.items,
        cost: r.cost,
        rev: r.rev
      });
      styleData(row);
      row.getCell('items').alignment = { horizontal: 'center' };
      row.getCell('cost').numFmt = '#,##0';
      row.getCell('rev').numFmt = '#,##0';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Bao_Cao_Quan_Tri_TiaChop_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting management excel:', err);
    res.status(500).send('Lỗi xuất báo cáo Excel: ' + err.message);
  }
});

// ==========================================
// 3. IN / XUẤT PDF BÁO CÁO QUẢN TRỊ DÀNH CHO BAN GIÁM ĐỐC
// ==========================================
router.get('/print', (req, res) => {
  try {
    const { from, to } = req.query;
    let dateFilter = '';
    const dateParams = [];
    if (from) {
      dateFilter += ' AND DATE(o.created_at) >= DATE(?)';
      dateParams.push(from);
    }
    if (to) {
      dateFilter += ' AND DATE(o.created_at) <= DATE(?)';
      dateParams.push(to);
    }

    const S = getSettings ? getSettings() : {};
    const C = S.primary_color || '#0284c7';

    // Query Data
    const kpi = db.prepare(`
      SELECT 
        COUNT(CASE WHEN o.type = 'ORDER' THEN 1 END) as total_orders,
        COUNT(CASE WHEN o.type = 'QUOTE' THEN 1 END) as total_quotes,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_selling ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_cost ELSE 0 END), 0) as total_cost,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.gross_profit ELSE 0 END), 0) as total_profit,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' AND o.payment_status != 'PAID' THEN o.remaining_amount ELSE 0 END), 0) as total_debt
      FROM orders o
      WHERE 1=1 ${dateFilter}
    `).get(...dateParams);

    const margin = kpi.total_revenue > 0 ? Math.round((kpi.total_profit / kpi.total_revenue) * 100) : 0;

    const salesList = db.prepare(`
      SELECT 
        COALESCE(u.full_name, o.created_by, 'Chưa gán') as name,
        COUNT(CASE WHEN o.type = 'ORDER' THEN 1 END) as orders,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.total_selling ELSE 0 END), 0) as rev,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' THEN o.gross_profit ELSE 0 END), 0) as profit,
        COALESCE(SUM(CASE WHEN o.type = 'ORDER' AND o.payment_status != 'PAID' THEN o.remaining_amount ELSE 0 END), 0) as debt
      FROM orders o
      LEFT JOIN users u ON o.created_by_user_id = u.id
      WHERE 1=1 ${dateFilter}
      GROUP BY COALESCE(u.id, o.created_by)
      ORDER BY rev DESC
    `).all(...dateParams);

    const topCust = db.prepare(`
      SELECT 
        c.code, c.name,
        COUNT(o.id) as orders,
        COALESCE(SUM(o.total_selling), 0) as rev,
        COALESCE(SUM(o.gross_profit), 0) as profit,
        COALESCE(SUM(o.remaining_amount), 0) as debt
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.type = 'ORDER' ${dateFilter}
      GROUP BY c.id
      ORDER BY rev DESC
      LIMIT 10
    `).all(...dateParams);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Báo Cáo Quản Trị Doanh Nghiệp - In Tia Chớp</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 20px 30px; color: #1e293b; font-size: 10pt; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${C}; padding-bottom: 12px; margin-bottom: 18px; }
          .title { text-align: right; }
          .title h1 { margin: 0; font-size: 16pt; color: ${C}; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
          .kpi-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
          .kpi-label { font-size: 8.5pt; color: #64748b; font-weight: 600; text-transform: uppercase; }
          .kpi-val { font-size: 14pt; font-weight: bold; margin-top: 4px; color: #0f172a; }
          .kpi-val.green { color: #16a34a; }
          .kpi-val.blue { color: ${C}; }
          .kpi-val.rose { color: #dc2626; }
          h2 { font-size: 11.5pt; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 20px 0 10px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9pt; }
          th { background: #f1f5f9; padding: 7px 8px; text-align: left; font-weight: 600; border: 1px solid #cbd5e1; }
          td { padding: 6px 8px; border: 1px solid #e2e8f0; }
          .right { text-align: right; }
          .center { text-align: center; }
          .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
          @media print {
            body { margin: 10mm; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 16px; text-align: right;">
          <button onclick="window.print()" style="padding: 8px 16px; font-weight: bold; background: ${C}; color: #fff; border: none; border-radius: 4px; cursor: pointer;">🖨️ In Báo Cáo / Xuất PDF</button>
        </div>

        <div class="header">
          <div>
            <h2 style="margin: 0; font-size: 13pt; color: ${C};">${esc(S.company_name || 'CÔNG TY IN TIA CHỚP')}</h2>
            <div>Hotline: ${esc(S.company_hotline || '0903 000 000')} • MST: ${esc(S.company_tax_code || '0312998877')}</div>
            <div>Địa chỉ: ${esc(S.company_address || 'TP. Hồ Chí Minh')}</div>
          </div>
          <div class="title">
            <h1>BÁO CÁO QUẢN TRỊ ĐIỀU HÀNH</h1>
            <div style="font-size: 9pt; color: #64748b;">Kỳ báo cáo: ${from ? esc(from) : 'Khởi thủy'} đến ${to ? esc(to) : 'Hiện tại'}</div>
            <div style="font-size: 8.5pt; color: #94a3b8;">Ngày xuất báo cáo: ${new Date().toLocaleDateString('vi-VN')}</div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Tổng Doanh Thu</div>
            <div class="kpi-val blue">${money(kpi.total_revenue)} đ</div>
            <div style="font-size:8pt; color:#64748b;">${kpi.total_orders} đơn hàng đã chốt</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Lợi Nhuận Gộp (Gross Profit)</div>
            <div class="kpi-val green">${money(kpi.total_profit)} đ</div>
            <div style="font-size:8pt; color:#16a34a;">Biên LN gộp ~${margin}%</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Chi Phí Vốn Xưởng</div>
            <div class="kpi-val">${money(kpi.total_cost)} đ</div>
            <div style="font-size:8pt; color:#64748b;">Gia công & vật tư in</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Công Nợ Phải Thu (AR)</div>
            <div class="kpi-val rose">${money(kpi.total_debt)} đ</div>
            <div style="font-size:8pt; color:#dc2626;">Chưa tất toán</div>
          </div>
        </div>

        <h2>1. Báo Cáo Hiệu Suất Đội Ngũ Kinh Doanh (Sales Performance)</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 35px;" class="center">STT</th>
              <th>Nhân viên Sales</th>
              <th class="center" style="width: 70px;">Đơn Chốt</th>
              <th class="right">Doanh Thu (đ)</th>
              <th class="right">Lợi Nhuận (đ)</th>
              <th class="center" style="width: 80px;">Biên LN (%)</th>
              <th class="right">Công Nợ Đang Quản Lý (đ)</th>
            </tr>
          </thead>
          <tbody>
            ${salesList.map((s, idx) => {
              const sm = s.rev > 0 ? Math.round((s.profit / s.rev) * 100) : 0;
              return `
                <tr>
                  <td class="center">${idx + 1}</td>
                  <td><strong>${esc(s.name)}</strong></td>
                  <td class="center">${s.orders}</td>
                  <td class="right">${money(s.rev)}</td>
                  <td class="right" style="color: #16a34a; font-weight: bold;">${money(s.profit)}</td>
                  <td class="center">${sm}%</td>
                  <td class="right" style="color: #dc2626;">${money(s.debt)}</td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="7" class="center">Chưa có dữ liệu</td></tr>'}
          </tbody>
        </table>

        <h2>2. Top 10 Khách Hàng Doanh Số &amp; Lợi Nhuận Cao Nhất (Pareto 80/20)</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 35px;" class="center">STT</th>
              <th style="width: 90px;">Mã KH</th>
              <th>Tên Khách Hàng / Đơn Vị</th>
              <th class="center" style="width: 70px;">Số Đơn</th>
              <th class="right">Tổng Tiền Đặt (đ)</th>
              <th class="right">Lợi Nhuận (đ)</th>
              <th class="right">Còn Nợ (đ)</th>
            </tr>
          </thead>
          <tbody>
            ${topCust.map((c, idx) => `
              <tr>
                <td class="center">${idx + 1}</td>
                <td><strong>${esc(c.code || '-')}</strong></td>
                <td>${esc(c.name)}</td>
                <td class="center">${c.orders}</td>
                <td class="right"><strong>${money(c.rev)}</strong></td>
                <td class="right" style="color: #16a34a;">${money(c.profit)}</td>
                <td class="right" style="color: #dc2626;">${money(c.debt)}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="center">Chưa có dữ liệu</td></tr>'}
          </tbody>
        </table>

        <div class="sig-row">
          <div>
            <strong>NGƯỜI LẬP BÁO CÁO</strong>
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 50px;">(Ký & Ghi rõ họ tên)</div>
          </div>
          <div>
            <strong>GIÁM ĐỐC DUYỆT</strong>
            <div style="font-size: 8.5pt; color: #64748b; margin-top: 50px;">Dương Trần</div>
          </div>
        </div>
      </body>
      </html>
    `;

    res.type('html').send(html);
  } catch (err) {
    console.error('Error generating print report:', err);
    res.status(500).send('Lỗi in báo cáo: ' + err.message);
  }
});

module.exports = router;

