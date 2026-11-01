/**
 * MODULE BACKUP & RESTORE DỮ LIỆU TOÀN DIỆN (SQLITE DB)
 * Dành riêng cho vai trò ADMIN:
 * - Backup: Xuất file .db chuẩn của hệ thống để lưu trữ an toàn hoặc chuyển server.
 * - Restore: Nạp file .db backup lên hệ thống, kiểm tra tính toàn vẹn và khôi phục database.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db } = require('./db');

const DB_PATH = path.join(__dirname, '..', 'data', 'tiachop_erp.db');

// Tải file backup SQLite database
router.get('/download', async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `tiachop_erp_backup_${timestamp}.db`;
    const tempBackupPath = path.join(__dirname, '..', 'data', `temp_${Date.now()}.db`);

    // Dùng cơ chế online backup an toàn của better-sqlite3
    await db.backup(tempBackupPath);

    res.download(tempBackupPath, backupFileName, (err) => {
      // Dọn dẹp file tạm sau khi gửi xong
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
      }
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Lỗi tải file backup: ' + err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tạo bản sao lưu: ' + err.message });
  }
});

// Khôi phục (Restore) từ file backup .db
// Nhận octet-stream hoặc binary buffer từ request
router.post('/restore', express.raw({ type: ['application/octet-stream', 'application/x-sqlite3', '*/*'], limit: '150mb' }), async (req, res) => {
  let tempUploadedPath = null;
  let preBackupPath = null;
  try {
    const fileBuffer = req.body;
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length < 100) {
      return res.status(400).json({ error: 'File tải lên không hợp lệ hoặc rỗng' });
    }

    // Kiểm tra SQLite header chuẩn: "SQLite format 3\0"
    const header = fileBuffer.slice(0, 16).toString('utf8');
    if (!header.startsWith('SQLite format 3')) {
      return res.status(400).json({ error: 'File không phải là định dạng SQLite database hợp lệ' });
    }

    tempUploadedPath = path.join(__dirname, '..', 'data', `restore_verify_${Date.now()}.db`);
    fs.writeFileSync(tempUploadedPath, fileBuffer);

    // Kiểm tra các bảng cốt lõi trong file backup
    let testDb = null;
    let tableNames = [];
    try {
      testDb = new Database(tempUploadedPath, { readonly: true });
      const rows = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      tableNames = rows.map(r => r.name);
    } catch (testErr) {
      return res.status(400).json({ error: 'Không thể đọc dữ liệu từ file backup: ' + testErr.message });
    } finally {
      if (testDb) testDb.close();
    }

    const requiredTables = ['orders', 'customers', 'suppliers'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));
    if (missingTables.length > 0) {
      return res.status(400).json({ error: `File database thiếu các bảng bắt buộc: ${missingTables.join(', ')}` });
    }

    // Tạo bản backup an toàn trước khi restore phòng rủi ro
    preBackupPath = path.join(__dirname, '..', 'data', `pre_restore_backup_${Date.now()}.db`);
    await db.backup(preBackupPath);

    // Tiến hành restore: nạp dữ liệu từ tempUploadedPath vào db hiện tại
    const sourceDb = new Database(tempUploadedPath);
    // Khôi phục dữ liệu trực tiếp vào db đang chạy bằng online backup API
    await sourceDb.backup(DB_PATH);
    sourceDb.close();

    // Dọn dẹp
    if (fs.existsSync(tempUploadedPath)) fs.unlinkSync(tempUploadedPath);

    res.json({
      success: true,
      message: 'Khôi phục dữ liệu (Restore) thành công!',
      table_count: tableNames.length,
      pre_backup: path.basename(preBackupPath)
    });
  } catch (err) {
    if (tempUploadedPath && fs.existsSync(tempUploadedPath)) fs.unlinkSync(tempUploadedPath);
    res.status(500).json({ error: 'Lỗi khôi phục cơ sở dữ liệu: ' + err.message });
  }
});

// Lấy thông tin trạng thái database hiện tại
router.get('/info', (req, res) => {
  try {
    const stats = fs.statSync(DB_PATH);
    const tableCounts = {
      orders: db.prepare('SELECT count(*) as c FROM orders').get().c,
      customers: db.prepare('SELECT count(*) as c FROM customers').get().c,
      suppliers: db.prepare('SELECT count(*) as c FROM suppliers').get().c,
      users: db.prepare('SELECT count(*) as c FROM users').get().c,
      transactions: db.prepare('SELECT count(*) as c FROM transactions').get().c
    };

    res.json({
      database_size_bytes: stats.size,
      database_size_mb: (stats.size / (1024 * 1024)).toFixed(2),
      last_modified: stats.mtime,
      table_counts: tableCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

