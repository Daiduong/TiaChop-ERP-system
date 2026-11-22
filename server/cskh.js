// server/cskh.js - Quản lý CSKH Đa Kênh, Webhook Facebook/Zalo & AI Báo Giá / Tạo Đơn Tự Động
const express = require('express');
const router = express.Router();
const { db } = require('./db');

// Khởi tạo bảng dữ liệu CSKH nếu chưa có
function initCSKHTables() {
  db.exec(`
    -- Kênh kết nối (Facebook Fanpage, Zalo OA...)
    CREATE TABLE IF NOT EXISTS chat_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL, -- 'FACEBOOK', 'ZALO', 'WEB'
      name TEXT NOT NULL,
      page_id TEXT,
      access_token TEXT,
      verify_token TEXT,
      app_secret TEXT,
      status TEXT DEFAULT 'ACTIVE',
      metadata TEXT, -- JSON config bổ sung
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Cuộc hội thoại của khách
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      platform TEXT NOT NULL,
      sender_id TEXT NOT NULL, -- UID Facebook hoặc Zalo User ID
      sender_name TEXT,
      sender_avatar TEXT,
      sender_phone TEXT,
      customer_id TEXT, -- Khách hàng ERP nếu đã liên kết
      status TEXT DEFAULT 'OPEN', -- 'OPEN', 'PENDING', 'ORDERED', 'RESOLVED'
      last_message TEXT,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_user_id TEXT,
      unread_count INTEGER DEFAULT 0,
      tags TEXT, -- Nhãn phân loại: Báo giá, In decal, Khiếu nại...
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Tin nhắn chi tiết
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL, -- 'CUSTOMER', 'AGENT', 'AI', 'SYSTEM'
      sender_name TEXT,
      message_text TEXT,
      attachments TEXT, -- JSON array các url hình ảnh, file đính kèm
      suggested_order_data TEXT, -- JSON dữ liệu AI bóc tách (kích thước, SL, giá dự kiến)
      status TEXT DEFAULT 'SENT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
    );
  `);

  // Tạo sẵn kênh Facebook mặc định nếu chưa có
  const existingFb = db.prepare("SELECT id FROM chat_channels WHERE platform = 'FACEBOOK'").get();
  if (!existingFb) {
    db.prepare(`
      INSERT INTO chat_channels (id, platform, name, page_id, verify_token, status)
      VALUES ('channel_fb_main', 'FACEBOOK', 'Fanpage Facebook Tia Chớp', '', 'tiachop_cskh_verify_token_2026', 'ACTIVE')
    `).run();
  }
}

initCSKHTables();

// Helper tạo ID
function generateId(prefix = 'cskh') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// -----------------------------------------------------------------------------
// 1. WEBHOOK XÁC THỰC & TIẾP NHẬN TIN NHẮN TỪ FACEBOOK MESSENGER
// -----------------------------------------------------------------------------

// Xác thực Webhook từ Facebook Meta Developer (GET /api/cskh/webhook/facebook)
router.get('/webhook/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const channel = db.prepare("SELECT verify_token FROM chat_channels WHERE platform = 'FACEBOOK' AND status = 'ACTIVE' LIMIT 1").get();
  const validToken = channel?.verify_token || 'tiachop_cskh_verify_token_2026';

  if (mode && token) {
    if (mode === 'subscribe' && token === validToken) {
      console.log('✅ Webhook Facebook xác thực thành công!');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Webhook Facebook xác thực thất bại: Sai Verify Token');
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// Nhận sự kiện tin nhắn từ Facebook (POST /api/cskh/webhook/facebook)
router.post('/webhook/facebook', async (req, res) => {
  try {
    const body = req.body;
    console.log('[Facebook Webhook POST Payload]:', JSON.stringify(body));

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const pageId = entry.id;
        const messagingList = entry.messaging || [];
        for (const webhookEvent of messagingList) {
          if (!webhookEvent) continue;

          const senderPsid = webhookEvent.sender ? webhookEvent.sender.id : null;
          if (!senderPsid) continue;

          // Bỏ qua tin nhắn do chính page gửi đi (echo)
          if (webhookEvent.message && !webhookEvent.message.is_echo) {
            const messageText = webhookEvent.message.text || '';
            const attachments = webhookEvent.message.attachments ? JSON.stringify(webhookEvent.message.attachments) : '[]';

            console.log(`[Facebook Webhook] Nhận tin nhắn từ ${senderPsid}: "${messageText}"`);

            // Lấy tên người gửi từ Facebook Graph API nếu có access token
            let senderName = `Khách Facebook (${senderPsid.substr(-4)})`;
            let senderAvatar = '';
            try {
              const channel = db.prepare("SELECT access_token FROM chat_channels WHERE platform = 'FACEBOOK'").get();
              if (channel && channel.access_token) {
                const fbProfile = await fetch(`https://graph.facebook.com/${senderPsid}?fields=first_name,last_name,profile_pic&access_token=${channel.access_token}`).then(r => r.json());
                if (fbProfile && (fbProfile.first_name || fbProfile.last_name)) {
                  senderName = `${fbProfile.last_name || ''} ${fbProfile.first_name || ''}`.trim();
                  senderAvatar = fbProfile.profile_pic || '';
                }
              }
            } catch (pErr) {
              // Bỏ qua nếu lỗi gọi profile
            }

            // Lưu hoặc cập nhật cuộc hội thoại
            let conv = db.prepare("SELECT * FROM chat_conversations WHERE sender_id = ? AND platform = 'FACEBOOK'").get(senderPsid);
            if (!conv) {
              const convId = generateId('conv');
              db.prepare(`
                INSERT INTO chat_conversations (id, channel_id, platform, sender_id, sender_name, sender_avatar, last_message, last_message_at, unread_count)
                VALUES (?, 'channel_fb_main', 'FACEBOOK', ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
              `).run(convId, senderPsid, senderName, senderAvatar, messageText || '[Đính kèm]');
              conv = { id: convId };
            } else {
              db.prepare(`
                UPDATE chat_conversations 
                SET last_message = ?, last_message_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1, status = 'OPEN',
                    sender_name = COALESCE(NULLIF(?, ''), sender_name)
                WHERE id = ?
              `).run(messageText || '[Đính kèm]', senderName, conv.id);
            }

            // Lưu tin nhắn vào lịch sử
            const msgId = generateId('msg');
            const suggestedData = analyzeMessageForPrintingOrder(messageText);

            db.prepare(`
              INSERT INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, attachments, suggested_order_data)
              VALUES (?, ?, 'CUSTOMER', ?, ?, ?, ?)
            `).run(msgId, conv.id, senderName, messageText, attachments, suggestedData ? JSON.stringify(suggestedData) : null);
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    res.sendStatus(404);
  } catch (err) {
    console.error('Lỗi tiếp nhận Webhook Facebook:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. AI & NLP: BÓC TÁCH NỘI DUNG CHAT ĐỂ TỰ ĐỘNG BÁO GIÁ & TẠO ĐƠN
// -----------------------------------------------------------------------------
function analyzeMessageForPrintingOrder(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Kiểm tra xem tin nhắn có mang ý định in ấn / đặt hàng không
  const isPrintingIntent = /in|báo giá|bao gia|in ấn|in an|decal|sticker|tem|nhãn|namecard|danh thiếp|catalogue|tờ rơi|brochure|hiflex|standee/i.test(lower);
  if (!isPrintingIntent) return null;

  const result = {
    detected: true,
    product_name: 'Ấn phẩm in',
    specs: '',
    quantity: 1000,
    unit: 'cái',
    customer_phone: null,
    customer_name: null,
    estimated_price: null
  };

  // 1. Nhận diện loại sản phẩm
  if (/decal|sticker|tem|nhãn/i.test(lower)) {
    result.product_name = 'Sticker / Tem Decal';
    result.unit = 'con';
    result.specs = 'Decal Giấy, In KTS chất lượng cao, bế demi thành phẩm';
  } else if (/namecard|card|danh thiếp/i.test(lower)) {
    result.product_name = 'Namecard / Danh thiếp';
    result.unit = 'hộp';
    result.specs = 'Giấy C300, In 2 mặt, Cán màng mờ 2 mặt, hộp mica';
    result.quantity = 5;
  } else if (/tờ rơi|flyer/i.test(lower)) {
    result.product_name = 'Tờ rơi / Flyer';
    result.unit = 'tờ';
    result.specs = 'Khổ A5 (14.5x20.5cm), Giấy C150, In màu 2 mặt';
  } else if (/catalogue|cuốn|sách/i.test(lower)) {
    result.product_name = 'Catalogue / Cuốn';
    result.unit = 'cuốn';
    result.specs = 'Khổ A4, Bìa C300 cán màng, ruột C150, bấm 2 kim giữa';
  }

  // 2. Tìm số lượng (VD: "in 2000 con", "sl: 500", "1.000 cái", "5 hộp")
  const qtyMatch = text.match(/(?:sl|số lượng|in|làm)\s*[:=]?\s*([0-9.,]+)\s*(con|cái|tờ|hộp|bộ|cuốn)?/i) || text.match(/([0-9.,]+)\s*(con|cái|tờ|hộp|bộ|cuốn)/i);
  if (qtyMatch) {
    const rawNum = qtyMatch[1].replace(/[.,]/g, '');
    const num = parseInt(rawNum, 10);
    if (!isNaN(num) && num > 0) {
      result.quantity = num;
      if (qtyMatch[2]) result.unit = qtyMatch[2];
    }
  }

  // 3. Tìm kích thước (VD: "5x5cm", "70x30 mm", "khổ A4")
  const sizeMatch = text.match(/([0-9.,]+)\s*(?:x|\*)\s*([0-9.,]+)\s*(cm|mm)?/i);
  if (sizeMatch) {
    const unit = sizeMatch[3] || 'cm';
    result.specs += ` - Kích thước: ${sizeMatch[1]}x${sizeMatch[2]}${unit}`;
  }

  // 4. Tìm số điện thoại
  const phoneMatch = text.match(/(0[3|5|7|8|9][0-9]{8})/);
  if (phoneMatch) {
    result.customer_phone = phoneMatch[1];
  }

  return result;
}

// -----------------------------------------------------------------------------
// 3. API DÀNH CHO GIAO DIỆN CSKH HUB TRÊN FRONTEND ERP
// -----------------------------------------------------------------------------

// Lấy danh sách hội thoại
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
    if (status && status !== 'ALL') {
      query += ` AND c.status = ?`;
      params.push(status);
    }
    if (platform && platform !== 'ALL') {
      query += ` AND c.platform = ?`;
      params.push(platform);
    }
    if (q) {
      query += ` AND (c.sender_name LIKE ? OR c.sender_phone LIKE ? OR c.last_message LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    query += ` ORDER BY c.last_message_at DESC LIMIT 50`;
    const conversations = db.prepare(query).all(...params);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy chi tiết tin nhắn trong một cuộc trò chuyện
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const messages = db.prepare(`
      SELECT * FROM chat_messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `).all(req.params.id);

    // Đánh dấu đã đọc
    db.prepare('UPDATE chat_conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nhân viên gửi tin nhắn phản hồi cho khách
router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const { message_text } = req.body;
    if (!message_text || !message_text.trim()) {
      return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống' });
    }

    const conv = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Không tìm thấy cuộc hội thoại' });

    const msgId = generateId('msg');
    const senderName = req.user ? (req.user.name || req.user.username) : 'Nhân viên CSKH';

    // Lưu tin nhắn phản hồi
    db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text)
      VALUES (?, ?, 'AGENT', ?, ?)
    `).run(msgId, conv.id, senderName, message_text.trim());

    db.prepare(`
      UPDATE chat_conversations 
      SET last_message = ?, last_message_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message_text.trim(), conv.id);

    // Gửi qua Facebook Messenger nếu kênh là FACEBOOK và có Access Token
    if (conv.platform === 'FACEBOOK') {
      const channel = db.prepare("SELECT access_token FROM chat_channels WHERE platform = 'FACEBOOK'").get();
      if (channel && channel.access_token) {
        sendFacebookMessage(conv.sender_id, message_text.trim(), channel.access_token).catch(e => {
          console.warn('[Facebook Send Message Error]:', e.message);
        });
      }
    }

    res.json({ success: true, id: msgId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Giả lập/Thêm cuộc trò chuyện kiểm thử
router.post('/conversations/simulate', (req, res) => {
  try {
    const { platform = 'FACEBOOK', sender_name = 'Khách Hàng Facebook Mới', message_text = 'Shop ơi cho mình hỏi giá in 1.000 tem decal 5x5cm bế demi bọc màng mờ', phone } = req.body;
    const convId = generateId('conv');
    const senderId = 'sim_' + Date.now();

    db.prepare(`
      INSERT INTO chat_conversations (id, channel_id, platform, sender_id, sender_name, sender_phone, last_message, unread_count)
      VALUES (?, 'channel_fb_main', ?, ?, ?, ?, ?, 1)
    `).run(convId, platform, senderId, sender_name, phone || null, message_text);

    const msgId = generateId('msg');
    const suggestedData = analyzeMessageForPrintingOrder(message_text);

    db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, sender_type, sender_name, message_text, suggested_order_data)
      VALUES (?, ?, 'CUSTOMER', ?, ?, ?)
    `).run(msgId, convId, sender_name, message_text, suggestedData ? JSON.stringify(suggestedData) : null);

    res.json({ success: true, conversation_id: convId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI phân tích tin nhắn và đề xuất báo giá / chốt đơn
router.post('/conversations/:id/ai-analyze', (req, res) => {
  try {
    const messages = db.prepare(`
      SELECT sender_type, message_text FROM chat_messages 
      WHERE conversation_id = ? 
      ORDER BY created_at DESC LIMIT 10
    `).all(req.params.id);

    const fullText = messages.map(m => m.message_text).join('\n');
    const extracted = analyzeMessageForPrintingOrder(fullText);

    res.json({
      success: true,
      data: extracted || {
        product_name: 'Ấn phẩm in ấn',
        specs: 'In theo file duyệt của khách',
        quantity: 1000,
        unit: 'cái'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật cấu hình kênh Fanpage / Zalo
router.get('/channels', (req, res) => {
  try {
    const channels = db.prepare('SELECT id, platform, name, page_id, verify_token, status, created_at FROM chat_channels').all();
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/channels/:id', (req, res) => {
  try {
    const { name, page_id, access_token, verify_token, app_secret, status } = req.body;
    db.prepare(`
      UPDATE chat_channels SET
        name = COALESCE(?, name),
        page_id = COALESCE(?, page_id),
        access_token = COALESCE(?, access_token),
        verify_token = COALESCE(?, verify_token),
        app_secret = COALESCE(?, app_secret),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, page_id, access_token, verify_token, app_secret, status, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper gửi tin qua Facebook Graph API
async function sendFacebookMessage(recipientId, text, accessToken) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });
  return response.json();
}

module.exports = router;

