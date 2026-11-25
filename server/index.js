const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./api');
const { initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
// Giữ raw body để xác thực chữ ký X-Hub-Signature-256 của Meta
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Mount API routes
const adminRoutes = require('./admin'); // tạo bảng users trước
const auth = require('./auth');
const backupRoutes = require('./backup');
const excelRoutes = require('./excel');
const cskhRoutes = require('./cskh');
const debtReminder = require('./debt_reminder');
const aiAssistant = require('./ai_assistant');

// Chỉ webhook của Meta là công khai (có xác thực verify token + chữ ký). Mọi API CSKH khác bắt buộc đăng nhập.
app.use('/api/cskh/webhook', cskhRoutes.webhook);
app.use('/api/cskh', auth.requireAuth, cskhRoutes);

app.use('/api/auth', auth.router);
app.use('/api/admin', auth.requireAuth, auth.requireRole('ADMIN'), adminRoutes);
app.use('/api/admin', auth.requireAuth, auth.requireRole('ADMIN'), debtReminder.router);
app.use('/api/admin', auth.requireAuth, auth.requireRole('ADMIN'), aiAssistant.router);
app.use('/api/admin/backup', auth.requireAuth, auth.requireRole('ADMIN'), backupRoutes);
app.use('/api/excel', auth.requireAuth, excelRoutes);
app.use('/api/finance', auth.requireAuth, auth.requireRole('ADMIN', 'ACCOUNTANT'));
app.use('/api/reports', auth.requireAuth, auth.requireRole('ADMIN', 'ACCOUNTANT'), require('./reports'));
app.use('/api/management-reports', auth.requireAuth, auth.requireRole('ADMIN', 'ACCOUNTANT'), require('./management_reports'));
app.post('/api/suppliers', auth.requireAuth, auth.requireRole('ADMIN', 'COORDINATOR'));
app.use('/api', auth.requireAuth, auth.maskCostForSales, apiRoutes);

// Đảm bảo mọi route /api/* không tồn tại trả về JSON 404 thay vì HTML index.html
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API không tồn tại: ${req.method} ${req.originalUrl}` });
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`⚡ HỆ THỐNG ERP IN TIA CHỚP (ERP_TC) ĐÃ KHỞI CHẠY!`);
  console.log(`🌐 Truy cập ứng dụng: http://localhost:${PORT}`);
  console.log(`====================================================`);
  debtReminder.startDebtReminderScheduler();
});
