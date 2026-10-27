const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('./db');

// ==========================================
// KHỞI TẠO BẢNG QUẢN TRỊ
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'SALES', -- ADMIN, SALES, ACCOUNTANT, COORDINATOR
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const DEFAULT_SETTINGS = {
  company_name: 'CÔNG TY IN TIA CHỚP',
  company_slogan: 'Dịch Vụ & Thương Mại In Ấn Chuyên Nghiệp',
  company_address: 'TP. Hồ Chí Minh',
  company_hotline: '0903 000 000',
  company_email: 'contact@tiachop.vn',
  company_website: 'tiachop.vn',
  company_tax_code: '',
  bank_name: 'Vietcombank',
  bank_account: '0071000123456',
  bank_holder: 'NGUYỄN DƯƠNG TRÂN',
  quote_terms: 'Tạm ứng 50% khi duyệt file in và chốt đơn hàng, thanh toán 50% còn lại khi nhận đủ hàng.\nBáo giá có hiệu lực trong 7 ngày kể từ ngày lập.',
  order_terms: 'Đơn hàng được sản xuất theo file đã duyệt, mọi thay đổi sau khi chạy in sẽ tính phí.\nThanh toán số tiền còn lại khi nhận đủ hàng.\nKhiếu nại về chất lượng trong vòng 48 giờ kể từ khi nhận hàng.',
  quote_validity_days: '7',
  job_ticket_requirements: 'Canh đúng màu theo file in, kiểm tra kỹ chính tả trước khi chạy số lượng.\nCắt xén chuẩn kích thước, đóng gói bằng màng co/hộp chống va đập.',
  sign_customer_label: 'ĐẠI DIỆN KHÁCH HÀNG',
  sign_company_label: 'ĐẠI DIỆN IN TIA CHỚP',
  sign_company_name: 'Dương Trân',
  primary_color: '#0284c7'
};

// Seed mặc định
(function seed() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => ins.run(k, v));

  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count === 0) {
    db.prepare(`INSERT INTO users (id, username, full_name, email, phone, role, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('u_admin', 'admin', 'Dương Trân', 'contact@tiachop.vn', '0903000000', 'ADMIN', hashPassword('admin123'));
    console.log('👤 Đã tạo tài khoản admin mặc định: admin / admin123');
  }
})();

const safeUser = u => { const { password_hash, ...rest } = u; return rest; };

// ==========================================
// USERS
// ==========================================
router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(safeUser));
});

router.post('/users', (req, res) => {
  try {
    const { username, full_name, email, phone, role, password } = req.body;
    if (!username || !full_name || !password) return res.status(400).json({ error: 'Thiếu tên đăng nhập, họ tên hoặc mật khẩu' });
    const id = `u_${Date.now()}`;
    db.prepare(`INSERT INTO users (id, username, full_name, email, phone, role, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, username.trim(), full_name, email || '', phone || '', role || 'SALES', hashPassword(password));
    res.json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Tên đăng nhập đã tồn tại' : err.message });
  }
});

router.put('/users/:id', (req, res) => {
  try {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    const { full_name, email, phone, role, is_active, password } = req.body;

    // Không cho khoá / hạ quyền admin cuối cùng
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='ADMIN' AND is_active=1").get().c;
    const losingAdmin = u.role === 'ADMIN' && u.is_active && (role !== 'ADMIN' || is_active === 0 || is_active === false);
    if (losingAdmin && admins <= 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 tài khoản Admin đang hoạt động' });

    db.prepare(`UPDATE users SET full_name=?, email=?, phone=?, role=?, is_active=? WHERE id=?`)
      .run(full_name ?? u.full_name, email ?? u.email, phone ?? u.phone, role ?? u.role,
        is_active === undefined ? u.is_active : (is_active ? 1 : 0), u.id);
    if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), u.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='ADMIN'").get().c;
  if (u.role === 'ADMIN' && admins <= 1) return res.status(400).json({ error: 'Không thể xoá Admin cuối cùng' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ success: true });
});

// ==========================================
// SETTINGS (THÔNG TIN MẪU IN)
// ==========================================
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

router.put('/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(obj => {
    Object.entries(obj).forEach(([k, v]) => { if (k in DEFAULT_SETTINGS) up.run(k, String(v ?? '')); });
  });
  tx(req.body || {});
  res.json({ success: true });
});

// ==========================================
// BẢNG GIÁ VẬT TƯ & GIA CÔNG
// ==========================================
router.get('/price-configs', (req, res) => {
  res.json(db.prepare('SELECT * FROM print_configs ORDER BY category, name').all());
});

router.put('/price-configs/:id', (req, res) => {
  const { name, base_cost, unit } = req.body;
  const before = db.prepare('SELECT * FROM print_configs WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Không tìm thấy cấu hình' });
  db.prepare('UPDATE print_configs SET name = COALESCE(?, name), base_cost = COALESCE(?, base_cost), unit = COALESCE(?, unit) WHERE id = ?')
    .run(name ?? null, base_cost === undefined ? null : Number(base_cost), unit ?? null, req.params.id);
  const after = db.prepare('SELECT * FROM print_configs WHERE id = ?').get(req.params.id);
  if (before.base_cost !== after.base_cost || before.name !== after.name || before.unit !== after.unit) {
    db.prepare(`INSERT INTO price_history (id, config_id, code, name, old_cost, new_cost, old_unit, new_unit, changed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), after.id, after.code, after.name, before.base_cost, after.base_cost,
        before.unit, after.unit, req.user?.full_name || req.user?.username || '');
  }
  res.json({ success: true });
});

// ==========================================
// LỊCH SỬ THAY ĐỔI BẢNG GIÁ
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    config_id TEXT,
    code TEXT,
    name TEXT,
    old_cost REAL,
    new_cost REAL,
    old_unit TEXT,
    new_unit TEXT,
    changed_by TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS price_checks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    input TEXT NOT NULL,           -- JSON đầu vào của Bộ Tính Giá
    expected_price REAL,           -- Giá bán chuẩn đã được Admin xác nhận (đối chiếu thủ công / báo giá xưởng)
    tolerance_pct REAL DEFAULT 2,  -- % sai lệch cho phép
    note TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

router.get('/price-history', (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  res.json(db.prepare('SELECT * FROM price_history ORDER BY changed_at DESC, rowid DESC LIMIT ?').all(limit));
});

// ==========================================
// KIỂM TRA & ĐỐI CHIẾU TÍNH GIÁ
// ==========================================
const { calculatePrice } = require('./pricing');

// Giả lập db với đơn giá bị ghi đè (để xem trước tác động khi sửa bảng giá, chưa lưu)
function dbWithOverrides(overrides) {
  if (!overrides) return db;
  return {
    prepare: sql => ({
      all: () => db.prepare(sql).all().map(r =>
        (r.code in overrides) ? { ...r, base_cost: overrides[r.code] } : r)
    })
  };
}

function evalCheck(check, database) {
  let input = {};
  try { input = JSON.parse(check.input); } catch (e) { /* input hỏng */ }
  try {
    const r = calculatePrice(database, input);
    return { price: r.suggestedSellingPrice, cost: r.totalCost, error: null, group: r.group };
  } catch (e) {
    return { price: null, cost: null, error: e.message, group: input.group };
  }
}

function judge(price, expected, tol) {
  if (price === null) return 'LOI';
  if (expected === null || expected === undefined) return 'CHUA_CHUAN';
  const diffPct = expected ? Math.abs(price - expected) / expected * 100 : (price ? 100 : 0);
  return diffPct <= (tol ?? 2) ? 'OK' : 'LECH';
}

function runAll(overrides) {
  const checks = db.prepare('SELECT * FROM price_checks ORDER BY created_at, rowid').all();
  const cur = dbWithOverrides(null);
  const sim = overrides ? dbWithOverrides(overrides) : null;
  return checks.map(c => {
    const now = evalCheck(c, cur);
    const row = {
      id: c.id, name: c.name, note: c.note, group: now.group,
      input: JSON.parse(c.input || '{}'),
      expected: c.expected_price, tolerance_pct: c.tolerance_pct,
      price: now.price, cost: now.cost, error: now.error,
      diff: (now.price !== null && c.expected_price !== null) ? now.price - c.expected_price : null,
      diff_pct: (now.price !== null && c.expected_price) ? Math.round((now.price - c.expected_price) / c.expected_price * 1000) / 10 : null,
      status: judge(now.price, c.expected_price, c.tolerance_pct)
    };
    if (sim) {
      const after = evalCheck(c, sim);
      row.sim_price = after.price;
      row.sim_error = after.error;
      row.sim_change = (after.price !== null && now.price !== null) ? after.price - now.price : null;
      row.sim_change_pct = (after.price !== null && now.price) ? Math.round((after.price - now.price) / now.price * 1000) / 10 : null;
      row.sim_status = judge(after.price, c.expected_price, c.tolerance_pct);
    }
    return row;
  });
}

// Bộ ca kiểm tra mẫu (giá chuẩn ban đầu = kết quả hiện tại, Admin cần đối chiếu & điều chỉnh)
function seedPriceChecks() {
  if (db.prepare('SELECT COUNT(*) c FROM price_checks').get().c > 0) return;
  const samples = [
    ['Namecard C300 cán mờ 2 mặt - 10 hộp', { group: 'DIGITAL', productName: 'Namecard', quantity: 10, pcsPerUnit: 100, width: 90, height: 54, sheetSize: '320x430', paper: 'C300', printSides: 2, lamination: 'MATTE_2S', finishing: [], marginPercent: 40 }],
    ['Tờ rơi A5 C150 in 2 mặt - 1.000 tờ', { group: 'DIGITAL', productName: 'Tờ rơi A5', quantity: 1000, pcsPerUnit: 1, width: 148, height: 210, sheetSize: '320x430', paper: 'C150', printSides: 2, lamination: 'NONE', finishing: [], marginPercent: 40 }],
    ['Offset catalogue A4 C150 4/4 - 2.000 tờ', { group: 'OFFSET', productName: 'Tờ rơi A4 offset', quantity: 2000, width: 210, height: 297, sheetSize: '430x650', paperType: 'COUCHE', gsm: 150, colorsFront: 4, colorsBack: 4, workAndTurn: false, lamination: 'NONE', finishing: [], marginPercent: 40 }],
    ['Bạt Hiflex 1m x 2m - 1 tấm', { group: 'LARGE_FORMAT', productName: 'Bạt Hiflex', quantity: 1, width: 1000, height: 2000, material: 'HIFLEX', finishing: ['EYELET'], marginPercent: 40 }]
  ];
  const ins = db.prepare('INSERT INTO price_checks (id, name, input, expected_price, tolerance_pct, note, created_by) VALUES (?, ?, ?, ?, 2, ?, ?)');
  samples.forEach(([name, input]) => {
    let price = null;
    try { price = calculatePrice(db, input).suggestedSellingPrice; } catch (e) { /* bỏ qua */ }
    ins.run(crypto.randomUUID(), name, JSON.stringify(input), price, 'Giá chuẩn ban đầu = kết quả hệ thống. Hãy đối chiếu báo giá thực tế rồi chỉnh lại.', 'system');
  });
}
seedPriceChecks();

router.get('/price-checks/run', (req, res) => {
  res.json(runAll(null));
});

// Xem trước tác động của việc sửa bảng giá (chưa lưu): body { changes: { CODE: newCost, ... } }
router.post('/price-checks/simulate', (req, res) => {
  const changes = req.body?.changes || {};
  const overrides = {};
  Object.entries(changes).forEach(([code, v]) => { if (v !== null && v !== '' && !isNaN(Number(v))) overrides[code] = Number(v); });
  res.json(runAll(overrides));
});

router.post('/price-checks', (req, res) => {
  try {
    const { name, input, expected_price, tolerance_pct, note } = req.body || {};
    if (!name || !input || typeof input !== 'object') return res.status(400).json({ error: 'Thiếu tên hoặc dữ liệu đầu vào' });
    const r = calculatePrice(db, input); // đảm bảo input hợp lệ
    const expected = (expected_price === undefined || expected_price === null || expected_price === '') ? r.suggestedSellingPrice : Number(expected_price);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO price_checks (id, name, input, expected_price, tolerance_pct, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, String(name).trim(), JSON.stringify(input), expected, tolerance_pct === undefined ? 2 : Number(tolerance_pct), note || '', req.user?.full_name || '');
    res.json({ success: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/price-checks/:id', (req, res) => {
  const { name, expected_price, tolerance_pct, note } = req.body || {};
  const r = db.prepare(`UPDATE price_checks SET name = COALESCE(?, name), expected_price = COALESCE(?, expected_price),
    tolerance_pct = COALESCE(?, tolerance_pct), note = COALESCE(?, note) WHERE id = ?`)
    .run(name ?? null, expected_price === undefined || expected_price === '' ? null : Number(expected_price),
      tolerance_pct === undefined || tolerance_pct === '' ? null : Number(tolerance_pct), note ?? null, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Không tìm thấy ca kiểm tra' });
  res.json({ success: true });
});

// Chấp nhận kết quả hiện tại của hệ thống làm giá chuẩn mới
router.post('/price-checks/:id/accept', (req, res) => {
  const c = db.prepare('SELECT * FROM price_checks WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy ca kiểm tra' });
  const now = evalCheck(c, db);
  if (now.price === null) return res.status(400).json({ error: now.error || 'Không tính được giá' });
  db.prepare('UPDATE price_checks SET expected_price = ? WHERE id = ?').run(now.price, c.id);
  res.json({ success: true, expected_price: now.price });
});

router.delete('/price-checks/:id', (req, res) => {
  db.prepare('DELETE FROM price_checks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
