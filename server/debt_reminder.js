// server/debt_reminder.js - Quản lý nhắc nợ tự động theo chu kỳ khách hàng & Cảnh báo qua Telegram
const express = require('express');
const router = express.Router();
const { db } = require('./db');
const { requireRole } = require('./auth');

const ALLOWED_REMINDER_DAYS = [0, 7, 15, 30];

// Khởi tạo bảng lịch sử nhắc nợ & cấu hình Telegram mặc định
function initDebtReminder() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS debt_reminder_logs (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      overdue_amount REAL DEFAULT 0,
      overdue_days INTEGER DEFAULT 0,
      reminder_cycle_days INTEGER DEFAULT 0,
      channel TEXT DEFAULT 'TELEGRAM',
      status TEXT DEFAULT 'SENT',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ins.run('telegram_bot_token', '');
  ins.run('telegram_chat_id', '');
  ins.run('telegram_debt_enabled', '0');
  ins.run('telegram_debt_hour', '08:30');
}

initDebtReminder();

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatVnd(n) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';
}

function cycleLabel(days) {
  const d = Number(days) || 0;
  if (d === 7) return '1 tuần (7 ngày)';
  if (d === 15) return '15 ngày';
  if (d === 30) return '1 tháng (30 ngày)';
  return d > 0 ? `${d} ngày` : 'Không nhắc';
}

function getTelegramSettings() {
  const rows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN ('telegram_bot_token', 'telegram_chat_id', 'telegram_debt_enabled', 'telegram_debt_hour')
  `).all();
  const cfg = {
    telegram_bot_token: '',
    telegram_chat_id: '',
    telegram_debt_enabled: '0',
    telegram_debt_hour: '08:30'
  };
  rows.forEach(r => { cfg[r.key] = r.value ?? ''; });
  return cfg;
}

// Gửi tin nhắn Telegram (HTML)
async function sendTelegramMessage(botToken, chatId, htmlText) {
  if (!botToken || !chatId) {
    throw new Error('Chưa cấu hình đầy đủ Telegram Bot Token hoặc Chat ID');
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId).trim(),
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram API lỗi HTTP ${res.status}`);
  }
  return data;
}

// Parse SQLite timestamp (UTC) hoặc ISO thành milliseconds
function parseDbDateMs(val) {
  if (!val) return NaN;
  const s = String(val);
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00:00Z' : 'Z');
  return new Date(iso).getTime();
}

// Lấy danh sách KHÁCH HÀNG đang có công nợ quá hạn so với chu kỳ nhắc nợ đã cấu hình của khách
function getOverdueCustomers() {
  const rows = db.prepare(`
    SELECT c.id as customer_id, c.code as customer_code, c.name as customer_name, c.phone as customer_phone,
      COALESCE(c.debt_reminder_days, 0) as debt_reminder_days,
      c.last_debt_reminded_at,
      COUNT(o.id) as unpaid_orders_count,
      COALESCE(SUM(o.remaining_amount), 0) as total_debt,
      MIN(o.created_at) as oldest_unpaid_date
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    WHERE o.type = 'ORDER'
      AND o.status != 'CANCELLED'
      AND o.payment_status != 'PAID'
      AND o.remaining_amount > 0
      AND COALESCE(c.debt_reminder_days, 0) > 0
    GROUP BY c.id
    HAVING total_debt > 0
    ORDER BY total_debt DESC
  `).all();

  const nowMs = Date.now();
  const overdue = [];

  for (const r of rows) {
    const oldestMs = parseDbDateMs(r.oldest_unpaid_date);
    if (!Number.isFinite(oldestMs)) continue;
    const maxDebtDays = Math.max(0, Math.floor((nowMs - oldestMs) / 86400000));
    if (maxDebtDays < r.debt_reminder_days) continue;

    overdue.push({
      customer_id: r.customer_id,
      customer_code: r.customer_code,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      debt_reminder_days: r.debt_reminder_days,
      last_debt_reminded_at: r.last_debt_reminded_at,
      max_debt_days: maxDebtDays,
      unpaid_orders_count: r.unpaid_orders_count,
      overdue_amount: Number(r.total_debt) || 0
    });
  }

  return overdue;
}

// Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD)
function getVnDateStr(date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 3600000);
  return vn.toISOString().slice(0, 10);
}

function getVnTimeHM(date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 3600000);
  return vn.toISOString().slice(11, 16); // HH:MM
}

function wasRemindedToday(lastRemindedAt) {
  if (!lastRemindedAt) return false;
  const ms = parseDbDateMs(lastRemindedAt);
  if (!Number.isFinite(ms)) return false;
  return getVnDateStr(new Date(ms)) === getVnDateStr(new Date());
}

// Chạy kiểm tra và gửi cảnh báo Telegram cho Admin
async function runDebtReminderCheck({ force = false } = {}) {
  const cfg = getTelegramSettings();
  if (!force && cfg.telegram_debt_enabled !== '1') {
    return { skipped: true, reason: 'Chưa bật nhắc nợ tự động' };
  }
  if (!cfg.telegram_bot_token || !cfg.telegram_chat_id) {
    if (force) throw new Error('Vui lòng cấu hình Telegram Bot Token và Chat ID trước khi gửi');
    return { skipped: true, reason: 'Thiếu cấu hình Telegram' };
  }

  const allOverdue = getOverdueCustomers();
  const targets = force ? allOverdue : allOverdue.filter(c => !wasRemindedToday(c.last_debt_reminded_at));

  if (targets.length === 0) {
    return {
      sent: false,
      overdue_count: allOverdue.length,
      reminded_count: 0,
      message: allOverdue.length === 0
        ? 'Hiện không có khách hàng nào quá hạn công nợ theo chu kỳ đã cấu hình.'
        : 'Tất cả khách hàng quá hạn đều đã được gửi thông báo hôm nay.'
    };
  }

  const todayDisplay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10).split('-').reverse().join('/');
  const totalOverdue = targets.reduce((s, c) => s + c.overdue_amount, 0);

  const lines = [
    `🚨 <b>CẢNH BÁO CÔNG NỢ QUÁ HẠN - IN TIA CHỚP</b>`,
    `📅 Ngày: <b>${todayDisplay}</b> | Số khách quá hạn: <b>${targets.length}</b>`,
    `💰 Tổng nợ quá hạn: <b>${escHtml(formatVnd(totalOverdue))}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`
  ];

  targets.forEach((c, idx) => {
    const overdueExtra = c.max_debt_days - c.debt_reminder_days;
    lines.push(
      `\n<b>${idx + 1}. ${escHtml(c.customer_name)}</b> ${c.customer_code ? `(${escHtml(c.customer_code)})` : ''}`,
      c.customer_phone ? `📞 SĐT: <code>${escHtml(c.customer_phone)}</code>` : null,
      `⏱ Chu kỳ nhắc nợ: <b>${escHtml(cycleLabel(c.debt_reminder_days))}</b> | Đã nợ: <b>${c.max_debt_days} ngày</b>${overdueExtra > 0 ? ` (quá ${overdueExtra} ngày)` : ' (đến hạn)'}`,
      `💵 Tổng công nợ: <b>${escHtml(formatVnd(c.overdue_amount))}</b> (${c.unpaid_orders_count} đơn chưa tất toán)`
    );
  });

  const messageText = lines.filter(Boolean).join('\n');

  const insertLog = db.prepare(`
    INSERT INTO debt_reminder_logs (id, customer_id, customer_name, overdue_amount, overdue_days, reminder_cycle_days, channel, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, 'TELEGRAM', ?, ?)
  `);
  const updateCustomer = db.prepare(`UPDATE customers SET last_debt_reminded_at = CURRENT_TIMESTAMP WHERE id = ?`);

  try {
    await sendTelegramMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, messageText);
    db.transaction(() => {
      for (const c of targets) {
        updateCustomer.run(c.customer_id);
        insertLog.run(
          `drl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          c.customer_id, c.customer_name, c.overdue_amount, c.max_debt_days, c.debt_reminder_days, 'SENT', ''
        );
      }
    })();
    console.log(`📨 [Debt Reminder] Đã gửi cảnh báo Telegram cho ${targets.length} khách quá hạn (Tổng: ${formatVnd(totalOverdue)})`);
    return {
      sent: true,
      overdue_count: allOverdue.length,
      reminded_count: targets.length,
      total_overdue_amount: totalOverdue
    };
  } catch (err) {
    for (const c of targets) {
      insertLog.run(
        `drl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        c.customer_id, c.customer_name, c.overdue_amount, c.max_debt_days, c.debt_reminder_days, 'FAILED', err.message
      );
    }
    throw err;
  }
}

// ==========================================
// BACKGROUND SCHEDULER (Kiểm tra mỗi 5 phút)
// ==========================================
let schedulerStarted = false;
function startDebtReminderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    try {
      const cfg = getTelegramSettings();
      if (cfg.telegram_debt_enabled !== '1') return;
      if (!cfg.telegram_bot_token || !cfg.telegram_chat_id) return;

      const targetHM = /^\d{2}:\d{2}$/.test(cfg.telegram_debt_hour) ? cfg.telegram_debt_hour : '08:30';
      const nowHM = getVnTimeHM();
      if (nowHM < targetHM) return;

      await runDebtReminderCheck({ force: false });
    } catch (err) {
      console.warn('[Debt Reminder Scheduler Error]:', err.message);
    }
  };

  // Kiểm tra lần đầu sau 15s khi server khởi chạy, sau đó định kỳ mỗi 5 phút
  setTimeout(tick, 15000);
  setInterval(tick, 5 * 60 * 1000);
}

// ==========================================
// API ROUTES (mounted at /api/admin — chỉ ADMIN được truy cập)
// ==========================================
const maskToken = t => (t ? `••••••${String(t).slice(-6)}` : '');

// Lấy cấu hình Telegram nhắc nợ (chỉ Admin)
router.get('/telegram-config', requireRole('ADMIN'), (req, res) => {
  try {
    const cfg = getTelegramSettings();
    res.json({
      telegram_debt_enabled: cfg.telegram_debt_enabled === '1',
      telegram_debt_hour: cfg.telegram_debt_hour || '08:30',
      telegram_chat_id: cfg.telegram_chat_id || '',
      has_bot_token: !!cfg.telegram_bot_token,
      bot_token_masked: maskToken(cfg.telegram_bot_token),
      overdue_count: getOverdueCustomers().length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lưu cấu hình Telegram (chỉ Admin)
router.put('/telegram-config', requireRole('ADMIN'), (req, res) => {
  try {
    const { telegram_bot_token, telegram_chat_id, telegram_debt_enabled, telegram_debt_hour } = req.body || {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    db.transaction(() => {
      if (telegram_bot_token !== undefined && String(telegram_bot_token).trim() !== '') {
        up.run('telegram_bot_token', String(telegram_bot_token).trim());
      }
      if (telegram_chat_id !== undefined) {
        up.run('telegram_chat_id', String(telegram_chat_id).trim());
      }
      if (telegram_debt_enabled !== undefined) {
        const enabled = (telegram_debt_enabled === true || telegram_debt_enabled === 1 || telegram_debt_enabled === '1') ? '1' : '0';
        up.run('telegram_debt_enabled', enabled);
      }
      if (telegram_debt_hour !== undefined && /^\d{2}:\d{2}$/.test(String(telegram_debt_hour).trim())) {
        up.run('telegram_debt_hour', String(telegram_debt_hour).trim());
      }
    })();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gửi tin nhắn test Telegram (chỉ Admin)
router.post('/telegram-test', requireRole('ADMIN'), async (req, res) => {
  try {
    const cfg = getTelegramSettings();
    const token = (req.body?.telegram_bot_token && String(req.body.telegram_bot_token).trim()) || cfg.telegram_bot_token;
    const chatId = (req.body?.telegram_chat_id && String(req.body.telegram_chat_id).trim()) || cfg.telegram_chat_id;

    if (!token || !chatId) {
      return res.status(400).json({ error: 'Vui lòng nhập Telegram Bot Token và Chat ID để kiểm tra' });
    }

    const nowVn = new Date(Date.now() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Kết nối Telegram thành công!</b>\n🏢 Hệ thống <b>ERP In Tia Chớp</b> đã sẵn sàng gửi cảnh báo công nợ quá hạn tự động.\n🕒 Thời gian test: <code>${nowVn}</code>`
    );
    res.json({ success: true, message: 'Đã gửi tin nhắn thử nghiệm tới Telegram thành công!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Chạy kiểm tra & gửi cảnh báo công nợ quá hạn qua Telegram ngay lập tức (chỉ Admin)
router.post('/debt-reminder/run', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await runDebtReminderCheck({ force: true });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Xem lịch sử gửi nhắc nợ gần đây (chỉ Admin)
router.get('/debt-reminder/logs', requireRole('ADMIN'), (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM debt_reminder_logs ORDER BY created_at DESC LIMIT 30').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  ALLOWED_REMINDER_DAYS,
  getOverdueCustomers,
  runDebtReminderCheck,
  startDebtReminderScheduler,
  parseDbDateMs
};

