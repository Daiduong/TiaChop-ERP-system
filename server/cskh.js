// server/cskh.js - CSKH đa kênh: Webhook Facebook (công khai, có ký xác thực) + API quản lý (yêu cầu đăng nhập)
const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { requireRole } = require('./auth');

const router = express.Router();   // API nội bộ - được mount SAU requireAuth
const webhook = express.Router();  // Webhook công khai cho Meta - mount TRƯỚC requireAuth

const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`;
const DEFAULT_VERIFY_TOKEN = 'tiachop_cskh_verify_token_2026';

// -----------------------------------------------------------------------------
// Khởi tạo bảng
// -----------------------------------------------------------------------------
function initCSKHTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      page_id TEXT,
      access_token TEXT,
      verify_token TEXT,
      app_secret TEXT,
      status TEXT DEFAULT 'ACTIVE',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      platform TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      sender_avatar TEXT,
      sender_phone TEXT,
      customer_id TEXT,
      status TEXT DEFAULT 'OPEN',
      last_message TEXT,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_user_id TEXT,
      unread_count INTEGER DEFAULT 0,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT,
      message_text TEXT,
      attachments TEXT,
      suggested_order_data TEXT,
      status TEXT DEFAULT 'SENT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
    );
  `);

  // Migration: mã tin nhắn Facebook (mid) để chống xử lý trùng khi Meta gửi lại webhook
  try { db.exec('ALTER TABLE chat_messages ADD COLUMN mid TEXT'); } catch (e) { /* đã có */ }
  for (const sql of [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_mid ON chat_messages(mid) WHERE mid IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conv_sender ON chat_conversations(platform, sender_id)',
    'CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at)'
  ]) {
    try { db.exec(sql); } catch (e) { console.warn('[CSKH index]', e.message); }
  }

  const existingFb = db.prepare("SELECT id FROM chat_channels WHERE platform = 'FACEBOOK'").get();
  if (!existingFb) {
    db.prepare(`
      INSERT INTO chat_channels (id, platform, name, page_id, verify_token, status)
      VALUES ('channel_fb_main', 'FACEBOOK', 'Fanpage Facebook Tia Chớp', '', ?, 'ACTIVE')
    `).run(DEFAULT_VERIFY_TOKEN);
  }
}
initCSKHTables();

function generateId(prefix = 'cskh') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Gọi Graph API: token đặt ở header (không để lộ trên URL/log), có timeout
async function graph(path, token, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  return res.json();
}

function getFbChannel(pageId) {
  if (pageId) {
    const byPage = db.prepare("SELECT * FROM chat_channels WHERE platform = 'FACEBOOK' AND page_id = ? AND status = 'ACTIVE'").get(String(pageId));
    if (byPage) return byPage;
  }
  return db.prepare("SELECT * FROM chat_channels WHERE platform = 'FACEBOOK' AND status = 'ACTIVE' ORDER BY (page_id != '') DESC LIMIT 1").get();
}

function verifySignature(req, secret) {
  const sig = req.get('x-hub-signature-256');
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// -----------------------------------------------------------------------------
// 1. WEBHOOK FACEBOOK (công khai)
// -----------------------------------------------------------------------------
webhook.get('/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const channel = db.prepare("SELECT verify_token FROM chat_channels WHERE platform = 'FACEBOOK' AND status = 'ACTIVE' LIMIT 1").get();
  const validToken = channel?.verify_token || DEFAULT_VERIFY_TOKEN;

  if (mode === 'subscribe' && token && token === validToken) {
    console.log('✅ Webhook Facebook xác thực thành công');
    return res.status(200).send(String(challenge));
  }
  console.warn('❌ Webhook Facebook xác thực thất bại (sai Verify Token)');
  res.sendStatus(403);
});

webhook.post('/facebook', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.object !== 'page' || !Array.isArray(body.entry)) return res.sendStatus(404);

    const insertMsg = db.prepare(`
      INSERT OR IGNORE INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, attachments, suggested_order_data, mid)
      VALUES (?, ?, 'CUSTOMER', ?, ?, ?, ?, ?)
    `);

    for (const entry of body.entry) {
      const channel = getFbChannel(entry.id);
      if (!channel) continue;
      // Page gửi tới phải khớp Page đã cấu hình (nếu đã cấu hình)
      if (channel.page_id && String(entry.id) !== String(channel.page_id)) continue;

      // Xác thực chữ ký Meta nếu đã khai báo App Secret
      if (channel.app_secret) {
        if (!verifySignature(req, channel.app_secret)) {
          console.warn('❌ Webhook Facebook: chữ ký X-Hub-Signature-256 không hợp lệ, bỏ qua');
          return res.sendStatus(403);
        }
      }

      // Hỗ trợ cả entry.messaging (chính) và entry.standby (khi Meta AI Agent / Business Suite đang giữ luồng)
      const events = [...(entry.messaging || []), ...(entry.standby || [])];
      if (events.length > 0) {
        console.log(`📩 [FB Webhook] Nhận ${events.length} sự kiện từ Page ${entry.id}`);
      }
      for (const ev of events) {
        const psid = ev?.sender?.id;
        const msg = ev?.message;
        if (!psid || !msg || msg.is_echo) continue;

        const hasAttachment = Array.isArray(msg.attachments) && msg.attachments.length > 0;
        const text = String(msg.text || '').slice(0, 5000) || (hasAttachment ? '[Hình ảnh / tệp đính kèm]' : '');
        if (!text) continue;
        const attachments = hasAttachment ? JSON.stringify(msg.attachments) : '[]';

        // Chỉ gọi lấy hồ sơ khi là hội thoại mới (tránh chậm & tốn quota)
        const existing = db.prepare("SELECT id, sender_name FROM chat_conversations WHERE platform = 'FACEBOOK' AND sender_id = ?").get(psid);
        let senderName = existing?.sender_name || `Khách Facebook (${psid.slice(-4)})`;
        let senderAvatar = '';
        if ((!existing || /^Khách Facebook \(/.test(existing.sender_name || '')) && channel.access_token) {
          try {
            const p = await graph(`/${psid}?fields=first_name,last_name,profile_pic`, channel.access_token, { timeoutMs: 3000 });
            if (p && (p.first_name || p.last_name)) {
              senderName = `${p.last_name || ''} ${p.first_name || ''}`.trim();
              senderAvatar = p.profile_pic || '';
            }
          } catch (e) { /* bỏ qua, dùng tên mặc định */ }
        }

        const suggested = analyzeMessageForPrintingOrder(text);

        db.transaction(() => {
          let convId = existing?.id;
          if (!convId) {
            convId = generateId('conv');
            db.prepare(`
              INSERT INTO chat_conversations (id, channel_id, platform, sender_id, sender_name, sender_avatar, last_message, last_message_at, unread_count)
              VALUES (?, ?, 'FACEBOOK', ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
            `).run(convId, channel.id, psid, senderName, senderAvatar, text);
          }
          const r = insertMsg.run(generateId('msg'), convId, senderName, text, attachments,
            suggested ? JSON.stringify(suggested) : null, msg.mid || null);
          if (r.changes === 0) return; // webhook gửi lại → đã xử lý rồi
          db.prepare(`
            UPDATE chat_conversations
            SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1,
                status = CASE WHEN status IN ('RESOLVED','ORDERED') THEN 'OPEN' ELSE status END,
                sender_name = CASE WHEN ? != '' THEN ? ELSE sender_name END,
                sender_avatar = CASE WHEN ? != '' THEN ? ELSE sender_avatar END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(text, senderName, senderName, senderAvatar, senderAvatar, convId);
        })();
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Lỗi tiếp nhận Webhook Facebook:', err.message);
    res.sendStatus(500); // Meta sẽ gửi lại; mid chống trùng
  }
});

// -----------------------------------------------------------------------------
// 2. AI/NLP bóc tách yêu cầu in ấn từ tin nhắn
// -----------------------------------------------------------------------------
const L = '\\p{L}';
const word = alts => new RegExp(`(?<!${L})(?:${alts})(?!${L})`, 'iu');
const RE_INTENT = word('in|in ấn|báo giá|bao gia|in an|decal|sticker|tem|nhãn|namecard|card|danh thiếp|catalogue|tờ rơi|brochure|hiflex|standee');
const RE_STICKER = word('decal|sticker|tem|nhãn');
const RE_CARD = word('namecard|card|danh thiếp');
const RE_FLYER = word('tờ rơi|flyer');
const RE_CATALOG = word('catalogue|cuốn|sách');

function analyzeMessageForPrintingOrder(text) {
  if (!text || !RE_INTENT.test(text)) return null;

  const result = {
    detected: true, product_name: 'Ấn phẩm in', specs: '', quantity: 1000, unit: 'cái',
    customer_phone: null, customer_name: null, estimated_price: null
  };
  const specParts = [];

  if (RE_STICKER.test(text)) {
    result.product_name = 'Sticker / Tem Decal'; result.unit = 'con';
    specParts.push('Decal Giấy, In KTS, bế demi thành phẩm');
  } else if (RE_CARD.test(text)) {
    result.product_name = 'Namecard / Danh thiếp'; result.unit = 'hộp'; result.quantity = 5;
    specParts.push('Giấy C300, In 2 mặt, Cán màng mờ 2 mặt, hộp mica');
  } else if (RE_FLYER.test(text)) {
    result.product_name = 'Tờ rơi / Flyer'; result.unit = 'tờ';
    specParts.push('Khổ A5, Giấy C150, In màu 2 mặt');
  } else if (RE_CATALOG.test(text)) {
    result.product_name = 'Catalogue / Cuốn'; result.unit = 'cuốn';
    specParts.push('Khổ A4, Bìa C300 cán màng, ruột C150, bấm 2 kim giữa');
  }

  // SĐT (trước, rồi loại khỏi chuỗi để không bị nhầm thành số lượng)
  let rest = text;
  const phone = text.match(/(?<!\d)(?:\+?84|0)([35789]\d{8})(?!\d)/);
  if (phone) { result.customer_phone = '0' + phone[1]; rest = text.replace(phone[0], ' '); }

  const qty = rest.match(/(?<!\p{L})(?:sl|số lượng|in|làm)\s*[:=]?\s*(\d[\d.,]*)\s*(con|cái|tờ|hộp|bộ|cuốn)?/iu)
    || rest.match(/(\d[\d.,]*)\s*(con|cái|tờ|hộp|bộ|cuốn)(?!\p{L})/iu);
  if (qty) {
    const n = parseInt(qty[1].replace(/[.,]/g, ''), 10);
    if (Number.isFinite(n) && n > 0 && n <= 10000000) {
      result.quantity = n;
      if (qty[2]) result.unit = qty[2].toLowerCase();
    }
  }

  const size = rest.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?/i);
  if (size) specParts.push(`Kích thước: ${size[1]}x${size[2]}${(size[3] || 'cm').toLowerCase()}`);

  result.specs = specParts.join(' - ');
  return result;
}

// -----------------------------------------------------------------------------
// 3. API NỘI BỘ (đã qua requireAuth)
// -----------------------------------------------------------------------------
router.get('/conversations', (req, res) => {
  try {
    const { status, platform, q } = req.query;
    let query = `
      SELECT c.*, cust.name as customer_name, cust.code as customer_code
      FROM chat_conversations c
      LEFT JOIN customers cust ON c.customer_id = cust.id
      WHERE 1=1
    `;
    const params = [];
    if (status && status !== 'ALL') { query += ' AND c.status = ?'; params.push(status); }
    if (platform && platform !== 'ALL') { query += ' AND c.platform = ?'; params.push(platform); }
    if (q) {
      query += ' AND (c.sender_name LIKE ? OR c.sender_phone LIKE ? OR c.last_message LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY c.last_message_at DESC LIMIT 100';
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:id/messages', (req, res) => {
  try {
    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC'
    ).all(req.params.id);
    db.prepare('UPDATE chat_conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const text = String(req.body?.message_text || '').trim();
    if (!text) return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống' });
    if (text.length > 2000) return res.status(400).json({ error: 'Tin nhắn quá dài (tối đa 2000 ký tự)' });

    const conv = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Không tìm thấy cuộc hội thoại' });

    const msgId = generateId('msg');
    const senderName = req.user?.full_name || req.user?.username || 'Nhân viên CSKH';
    let status = 'SENT';
    let warning = null;

    if (conv.platform === 'FACEBOOK') {
      const channel = getFbChannel() ;
      if (!channel?.access_token) {
        status = 'FAILED'; warning = 'Chưa cấu hình Page Access Token nên tin chưa được gửi tới khách.';
      } else {
        try {
          const r = await graph('/me/messages', channel.access_token, {
            method: 'POST',
            body: { recipient: { id: conv.sender_id }, messaging_type: 'RESPONSE', message: { text } }
          });
          if (r.error) { status = 'FAILED'; warning = r.error.message; }
        } catch (e) {
          status = 'FAILED'; warning = 'Không kết nối được Facebook: ' + e.message;
        }
      }
    } else if (conv.sender_id.startsWith('sim_')) {
      status = 'SENT';
    }

    db.transaction(() => {
      db.prepare(`INSERT INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, status)
                  VALUES (?, ?, 'AGENT', ?, ?, ?)`).run(msgId, conv.id, senderName, text, status);
      db.prepare('UPDATE chat_conversations SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(text, conv.id);
    })();

    res.json({ success: true, id: msgId, delivered: status === 'SENT', warning });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tạo hội thoại thử (chỉ Admin)
router.post('/conversations/simulate', requireRole('ADMIN'), (req, res) => {
  try {
    const sender_name = String(req.body?.sender_name || 'Khách Hàng Facebook (Test)').slice(0, 100);
    const message_text = String(req.body?.message_text || 'Shop ơi báo giá in 1.000 tem decal 5x5cm bế demi').slice(0, 2000);
    const convId = generateId('conv');
    db.transaction(() => {
      db.prepare(`INSERT INTO chat_conversations (id, channel_id, platform, sender_id, sender_name, last_message, unread_count)
                  VALUES (?, 'channel_fb_main', 'FACEBOOK', ?, ?, ?, 1)`).run(convId, 'sim_' + Date.now(), sender_name, message_text);
      const suggested = analyzeMessageForPrintingOrder(message_text);
      db.prepare(`INSERT INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, suggested_order_data)
                  VALUES (?, ?, 'CUSTOMER', ?, ?, ?)`).run(generateId('msg'), convId, sender_name, message_text, suggested ? JSON.stringify(suggested) : null);
    })();
    res.json({ success: true, conversation_id: convId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:id/ai-analyze', async (req, res) => {
  try {
    const { analyzeConversationWithGemini } = require('./ai_assistant');
    const allRows = db.prepare(`
      SELECT sender_type, message_text FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 20
    `).all(req.params.id).reverse();

    const fallbackAnalyzer = () => {
      const customerRows = allRows.filter(r => r.sender_type === 'CUSTOMER');
      let merged = null;
      let phone = null;
      for (const r of customerRows) {
        const a = analyzeMessageForPrintingOrder(r.message_text);
        if (!a) continue;
        if (a.customer_phone) phone = a.customer_phone;
        merged = a;
      }
      if (merged) merged.customer_phone = merged.customer_phone || phone;
      return merged;
    };

    const result = await analyzeConversationWithGemini(allRows, fallbackAnalyzer);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Cấu hình kênh ----
const maskToken = t => (t ? `••••••${String(t).slice(-6)}` : '');

router.get('/channels', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM chat_channels').all();
    const isAdmin = req.user?.role === 'ADMIN';
    res.json(rows.map(c => ({
      id: c.id, platform: c.platform, name: c.name, status: c.status,
      connected: !!(c.page_id && c.access_token),
      has_app_secret: !!c.app_secret,
      ...(isAdmin ? {
        page_id: c.page_id, verify_token: c.verify_token,
        access_token_masked: maskToken(c.access_token), has_access_token: !!c.access_token
      } : {})
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/channels/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const blank = v => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
    const { name, page_id, access_token, verify_token, app_secret, status } = req.body || {};
    if (status && !['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    if (page_id && !/^\d{5,30}$/.test(String(page_id).trim())) return res.status(400).json({ error: 'Page ID chỉ gồm chữ số' });

    const r = db.prepare(`
      UPDATE chat_channels SET
        name = COALESCE(?, name), page_id = COALESCE(?, page_id),
        access_token = COALESCE(?, access_token), verify_token = COALESCE(?, verify_token),
        app_secret = COALESCE(?, app_secret), status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(blank(name), blank(page_id), blank(access_token), blank(verify_token), blank(app_secret), blank(status), req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Không tìm thấy kênh' });

    // Tự đăng ký webhook cho Page và báo kết quả thật cho người dùng
    const ch = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(req.params.id);
    let subscribed = null, subscribe_error = null;
    if (ch.platform === 'FACEBOOK' && ch.page_id && ch.access_token) {
      try {
        const s = await graph(`/${ch.page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`, ch.access_token, { method: 'POST' });
        subscribed = !!s.success;
        if (s.error) subscribe_error = s.error.message;
      } catch (e) { subscribed = false; subscribe_error = e.message; }
    }
    res.json({ success: true, subscribed, subscribe_error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kiểm tra kết nối thực tế với Facebook
router.post('/channels/:id/check', requireRole('ADMIN'), async (req, res) => {
  try {
    const ch = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Không tìm thấy kênh' });
    const out = { ok: false, checks: [], warnings: [] };
    const add = (label, pass, detail = '') => out.checks.push({ label, pass, detail });

    if (!ch.page_id || !ch.access_token) {
      add('Đã lưu Page ID & Access Token', false, 'Chưa nhập đủ thông tin');
      return res.json(out);
    }
    add('Đã lưu Page ID & Access Token', true);

    const me = await graph('/me?fields=id,name', ch.access_token).catch(e => ({ error: { message: e.message } }));
    if (me.error) { add('Token còn hiệu lực', false, me.error.message); return res.json(out); }
    add('Token còn hiệu lực', true, `Page: ${me.name}`);
    add('Page ID khớp với Token', String(me.id) === String(ch.page_id), `Token thuộc Page ${me.id}`);

    const dbg = await graph(`/debug_token?input_token=${encodeURIComponent(ch.access_token)}`, ch.access_token).catch(() => null);
    const scopes = dbg?.data?.scopes || [];
    if (dbg?.data) add('Có quyền pages_messaging', scopes.includes('pages_messaging'), scopes.includes('pages_messaging') ? '' : 'Thiếu quyền → không nhận/gửi được tin');

    const subs = await graph(`/${ch.page_id}/subscribed_apps`, ch.access_token).catch(() => ({ data: [] }));
    const fields = (subs.data || []).flatMap(a => a.subscribed_fields || []);
    add('Page đã đăng ký webhook "messages"', fields.includes('messages'), fields.join(', ') || 'Chưa đăng ký');

    if (!ch.app_secret) out.warnings.push('Chưa nhập App Secret: webhook chưa được xác thực chữ ký Meta (nên nhập để chống giả mạo).');
    out.ok = out.checks.every(c => c.pass);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. ĐỒNG BỘ HỘI THOẠI & TIN NHẮN THẬT TRỰC TIẾP TỪ FACEBOOK GRAPH API
// (Hoạt động cả khi chạy localhost không có ngrok hoặc khi Meta AI giữ luồng)
// -----------------------------------------------------------------------------
let lastFbSyncAt = 0;
async function syncFacebookConversations({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastFbSyncAt < 10000) {
    return { skipped: true, synced_conversations: 0, new_messages: 0 };
  }
  const ch = getFbChannel();
  if (!ch || !ch.page_id || !ch.access_token) {
    throw new Error('Chưa cấu hình Page ID hoặc Page Access Token');
  }
  lastFbSyncAt = now;

  const data = await graph(
    `/${ch.page_id}/conversations?limit=25&fields=id,updated_time,participants,messages.limit(20){id,from,message,created_time,attachments}`,
    ch.access_token,
    { timeoutMs: 12000 }
  );
  if (data.error) throw new Error(data.error.message || 'Lỗi gọi Facebook Graph API');

  const convs = Array.isArray(data.data) ? data.data : [];
  let syncedConvs = 0;
  let newMsgs = 0;

  const findConv = db.prepare("SELECT id, sender_name FROM chat_conversations WHERE platform = 'FACEBOOK' AND sender_id = ?");
  const insertConv = db.prepare(`
    INSERT INTO chat_conversations (id, channel_id, platform, sender_id, sender_name, last_message, last_message_at, unread_count)
    VALUES (?, ?, 'FACEBOOK', ?, ?, ?, ?, 0)
  `);
  const insertMsg = db.prepare(`
    INSERT OR IGNORE INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, attachments, suggested_order_data, mid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateConv = db.prepare(`
    UPDATE chat_conversations
    SET sender_name = CASE WHEN ? != '' THEN ? ELSE sender_name END,
        last_message = ?, last_message_at = ?,
        unread_count = unread_count + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const toSqliteUtc = iso => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  };

  db.transaction(() => {
    for (const c of convs) {
      const participants = c.participants?.data || [];
      const customer = participants.find(p => String(p.id) !== String(ch.page_id));
      if (!customer || !customer.id) continue;

      const psid = String(customer.id);
      const customerName = customer.name || `Khách Facebook (${psid.slice(-4)})`;
      const rawMsgs = (c.messages?.data || []).slice().reverse(); // cũ → mới
      if (rawMsgs.length === 0) continue;

      let existing = findConv.get(psid);
      let convId = existing?.id;
      const latestRaw = rawMsgs[rawMsgs.length - 1];
      const latestText = String(latestRaw.message || '').slice(0, 5000) || (latestRaw.attachments?.data?.length ? '[Hình ảnh / tệp đính kèm]' : '');
      const latestTime = toSqliteUtc(latestRaw.created_time || c.updated_time);

      if (!convId) {
        convId = generateId('conv');
        insertConv.run(convId, ch.id, psid, customerName, latestText, latestTime);
      }

      let addedCustomerMsgs = 0;
      for (const m of rawMsgs) {
        const isPage = String(m.from?.id) === String(ch.page_id);
        const hasAtt = Array.isArray(m.attachments?.data) && m.attachments.data.length > 0;
        const text = String(m.message || '').slice(0, 5000) || (hasAtt ? '[Hình ảnh / tệp đính kèm]' : '');
        if (!text) continue;
        const attJson = hasAtt ? JSON.stringify(m.attachments.data) : '[]';
        const suggested = !isPage ? analyzeMessageForPrintingOrder(text) : null;
        const createdUtc = toSqliteUtc(m.created_time);

        const r = insertMsg.run(
          generateId('msg'), convId, isPage ? 'AGENT' : 'CUSTOMER',
          m.from?.name || (isPage ? ch.name : customerName),
          text, attJson, suggested ? JSON.stringify(suggested) : null,
          m.id || null, createdUtc
        );
        if (r.changes > 0) {
          newMsgs++;
          if (!isPage && existing) addedCustomerMsgs++;
        }
      }

      updateConv.run(customerName, customerName, latestText, latestTime, addedCustomerMsgs, convId);
      syncedConvs++;
    }
  })();

  return { synced_conversations: syncedConvs, new_messages: newMsgs };
}

router.post('/sync/facebook', async (req, res) => {
  try {
    const force = req.body?.force !== false;
    const result = await syncFacebookConversations({ force });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports.webhook = webhook;
module.exports.analyzeMessageForPrintingOrder = analyzeMessageForPrintingOrder;
module.exports.syncFacebookConversations = syncFacebookConversations;
