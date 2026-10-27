const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./api');
const { initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Mount API routes
const adminRoutes = require('./admin'); // tạo bảng users trước
const auth = require('./auth');
app.use('/api/auth', auth.router);
app.use('/api/admin', auth.requireAuth, auth.requireRole('ADMIN'), adminRoutes);
app.use('/api/finance', auth.requireAuth, auth.requireRole('ADMIN', 'ACCOUNTANT'));
app.post('/api/suppliers', auth.requireAuth, auth.requireRole('ADMIN', 'COORDINATOR'));
app.use('/api', auth.requireAuth, auth.maskCostForSales, apiRoutes);

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
});
