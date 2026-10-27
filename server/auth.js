const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');

const router = express.Router();
const COOKIE = 'tc_session';
const SESSION_DAYS = 7;

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

const publicUser = u => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, email: u.email, phone: u.phone });

// Chống dò mật khẩu: tối đa 10 lần sai / 15 phút / IP
const failures = new Map();
function tooMany(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60 * 1000) { failures.delete(ip); return false; }
  return f.count >= 10;
}
function recordFail(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

// ===== Đăng nhập =====
router.post('/login', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' });

  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    recordFail(ip);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  if (!u.is_active) return res.status(403).json({ error: 'Tài khoản đã bị khoá. Liên hệ Admin.' });

  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, expires);

  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
  res.json({ success: true, user: publicUser(u) });
});

// ===== Đăng xuất =====
router.post('/logout', (req, res) => {
  const token = getCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ success: true });
});

// ===== Middleware xác thực =====
function requireAuth(req, res, next) {
  const token = getCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const row = db.prepare(`
    SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  if (!row || row.expires_at < Date.now() || !row.is_active) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
  }
  req.user = publicUser(row);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này' });
}

// Sales: xoá mọi trường giá vốn / lợi nhuận khỏi dữ liệu trả về
const SENSITIVE = new Set([
  'total_cost', 'unit_cost', 'gross_profit', 'profit', 'supplier_cost', 'total_profit',
  'total_worked_amount', 'totalCost', 'unitCost', 'grossProfit', 'actualMargin', 'breakdown'
]);
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) if (!SENSITIVE.has(k)) o[k] = strip(val);
    return o;
  }
  return v;
}
function maskCostForSales(req, res, next) {
  if (req.user?.role !== 'SALES') return next();
  const json = res.json.bind(res);
  res.json = body => json(strip(body));
  next();
}

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Đổi mật khẩu của chính mình
router.post('/change-password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(old_password || ''), u.password_hash)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 6 ký tự' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(new_password, salt, 64).toString('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`${salt}:${hash}`, u.id);
  // Đăng xuất các phiên khác
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, getCookie(req, COOKIE));
  res.json({ success: true });
});

module.exports = { router, requireAuth, requireRole, maskCostForSales };
