// server/ai_assistant.js - Cấu hình Google AI Studio (Gemini) & Trợ lý AI đọc tin nhắn báo giá / tạo đơn
const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const { db } = require('./db');
const { requireRole } = require('./auth');
const { calculatePrice } = require('./pricing');

const ALLOWED_MODELS = [
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-3.5-flash-lite'
];

const DEFAULT_SYSTEM_PROMPT = `Bạn là Trợ lý Báo Giá chuyên nghiệp của Công ty TNHH TM DV In Tia Chớp (TP.HCM).
Nhiệm vụ: Đọc đoạn hội thoại Messenger với khách hàng, nhận diện chính xác nhu cầu in ấn, trích xuất thông số kỹ thuật để lên đơn và soạn sẵn tin nhắn báo giá / tư vấn lịch sự, tự nhiên bằng tiếng Việt (xưng "em", gọi khách là "anh/chị").
Quy tắc:
- Nếu khách chưa nêu đủ thông tin (như kích thước, số lượng, chất liệu giấy, 1 mặt hay 2 mặt, đã có file thiết kế chưa), hãy liệt kê vào missing_info và hỏi khéo léo trong reply_draft.
- Thời gian giao hàng tiêu chuẩn: 5 - 7 ngày làm việc kể từ ngày chốt đơn & duyệt file (in nhanh KTS có thể hỗ trợ sớm hơn).
- Không tự bịa giá cố định nếu chưa có giá từ hệ thống; nếu đã đủ thông số, viết câu trả lời gọn gàng để hệ thống tự điền mức giá tham khảo.`;

function initAISettings() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ins.run('gemini_api_key', '');
  ins.run('gemini_model', 'gemini-4-hydrogen');
  ins.run('gemini_system_prompt', DEFAULT_SYSTEM_PROMPT);
}
initAISettings();

function getAIConfig() {
  const rows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN ('gemini_api_key', 'gemini_model', 'gemini_system_prompt')
  `).all();
  const cfg = {
    gemini_api_key: '',
    gemini_model: 'gemini-4-hydrogen',
    gemini_system_prompt: DEFAULT_SYSTEM_PROMPT
  };
  rows.forEach(r => { if (r.value !== null && r.value !== undefined) cfg[r.key] = r.value; });
  if (!ALLOWED_MODELS.includes(cfg.gemini_model)) cfg.gemini_model = 'gemini-4-hydrogen';
  return cfg;
}

const maskKey = k => (k ? `••••••${String(k).slice(-6)}` : '');

function formatVnd(n) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';
}

// ==========================================
// ADMIN API ROUTES (mounted at /api/admin — chỉ ADMIN)
// ==========================================
router.get('/ai-config', requireRole('ADMIN'), (req, res) => {
  try {
    const cfg = getAIConfig();
    res.json({
      has_api_key: !!cfg.gemini_api_key,
      api_key_masked: maskKey(cfg.gemini_api_key),
      gemini_model: cfg.gemini_model,
      gemini_system_prompt: cfg.gemini_system_prompt || DEFAULT_SYSTEM_PROMPT,
      allowed_models: ALLOWED_MODELS
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/ai-config', requireRole('ADMIN'), (req, res) => {
  try {
    const { gemini_api_key, gemini_model, gemini_system_prompt } = req.body || {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    db.transaction(() => {
      if (gemini_api_key !== undefined && String(gemini_api_key).trim() !== '') {
        up.run('gemini_api_key', String(gemini_api_key).trim());
      }
      if (gemini_model !== undefined) {
        const m = String(gemini_model).trim();
        if (!ALLOWED_MODELS.includes(m)) throw new Error('Model Gemini không hợp lệ');
        up.run('gemini_model', m);
      }
      if (gemini_system_prompt !== undefined) {
        up.run('gemini_system_prompt', String(gemini_system_prompt).trim() || DEFAULT_SYSTEM_PROMPT);
      }
    })();

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ai-test', requireRole('ADMIN'), async (req, res) => {
  try {
    const cfg = getAIConfig();
    const apiKey = (req.body?.gemini_api_key && String(req.body.gemini_api_key).trim()) || cfg.gemini_api_key;
    const model = (req.body?.gemini_model && ALLOWED_MODELS.includes(req.body.gemini_model))
      ? req.body.gemini_model
      : cfg.gemini_model;

    if (!apiKey) {
      return res.status(400).json({ error: 'Vui lòng nhập Google AI Studio API Key trước khi kiểm tra' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      input: 'Trả lời ngắn gọn trong 1 câu tiếng Việt: xác nhận kết nối trợ lý báo giá In Tia Chớp thành công.',
      store: false
    });

    const reply = (interaction.output_text || '').trim();
    if (!reply) throw new Error('Gemini không trả về nội dung phản hồi');
    res.json({ success: true, model, reply });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Lỗi kết nối Google AI Studio' });
  }
});

// ==========================================
// PHÂN TÍCH HỘI THOẠI & TÍNH GIÁ TỰ ĐỘNG BẰNG GEMINI
// ==========================================
const QUOTE_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    detected: { type: 'boolean', description: 'true nếu khách có nhu cầu hỏi báo giá hoặc đặt in ấn' },
    product_name: { type: 'string', description: 'Tên ấn phẩm ngắn gọn (VD: Sticker Decal Giấy, Namecard C300, Tờ rơi A5)' },
    print_group: {
      type: 'string',
      enum: ['DIGITAL', 'OFFSET', 'LARGE_FORMAT', 'DOCUMENT_SPIRAL'],
      description: 'Nhóm công nghệ in phù hợp'
    },
    width_mm: { type: 'number', description: 'Chiều rộng thành phẩm tính bằng mm (0 nếu chưa rõ)' },
    height_mm: { type: 'number', description: 'Chiều cao thành phẩm tính bằng mm (0 nếu chưa rõ)' },
    quantity: { type: 'integer', description: 'Số lượng đặt in (0 nếu chưa rõ)' },
    unit: { type: 'string', description: 'Đơn vị tính (con, tờ, hộp, cuốn, tấm, cái...)' },
    paper_code: { type: 'string', description: 'Mã giấy phù hợp (C150, C200, C250, C300, F80, DECAL... hoặc rỗng)' },
    sides: { type: 'integer', description: 'Số mặt in: 1 hoặc 2' },
    lamination: {
      type: 'string',
      enum: ['NONE', 'MATTE_1S', 'MATTE_2S', 'GLOSS_1S', 'GLOSS_2S'],
      description: 'Cán màng nếu khách có nhắc tới'
    },
    die_cut: { type: 'boolean', description: 'Có bế demi / cắt hình theo viền không' },
    specs: { type: 'string', description: 'Mô tả quy cách kỹ thuật đầy đủ bằng tiếng Việt' },
    customer_phone: { type: 'string', description: 'Số điện thoại khách hàng nếu có trong chat, không có thì rỗng' },
    customer_address: { type: 'string', description: 'Địa chỉ giao hàng nếu có trong chat, không có thì rỗng' },
    missing_info: {
      type: 'array',
      items: { type: 'string' },
      description: 'Danh sách thông tin còn thiếu cần hỏi thêm khách (VD: Kích thước, Số lượng, File thiết kế)'
    },
    reply_draft: {
      type: 'string',
      description: 'Tin nhắn tư vấn / báo giá soạn sẵn bằng tiếng Việt tự nhiên, lịch sự để gửi cho khách trên Messenger'
    }
  },
  required: ['detected', 'product_name', 'specs', 'reply_draft']
};

function computeAutoPrice(extracted) {
  try {
    const qty = parseInt(extracted.quantity, 10) || 0;
    let w = parseFloat(extracted.width_mm) || 0;
    let h = parseFloat(extracted.height_mm) || 0;
    if (qty <= 0) return null;

    // Dự phòng kích thước chuẩn nếu AI chưa điền mm nhưng tên/quy cách có ghi rõ
    if (w <= 0 || h <= 0) {
      const ref = `${extracted.product_name || ''} ${extracted.specs || ''}`.toLowerCase();
      if (/namecard|danh thiếp/.test(ref)) { w = 90; h = 54; }
      else if (/\ba4\b/.test(ref)) { w = 210; h = 297; }
      else if (/\ba5\b/.test(ref)) { w = 148; h = 210; }
      else if (/\ba6\b/.test(ref)) { w = 105; h = 148; }
      else if (/\ba3\b/.test(ref)) { w = 297; h = 420; }
    }
    if (w <= 0 || h <= 0) return null;

    const group = extracted.print_group || 'DIGITAL';
    const isCard = /namecard|danh thiếp/i.test(extracted.product_name || '') && /hộp/i.test(extracted.unit || '');
    const rawPaper = (extracted.paper_code || '').toUpperCase();
    const paper = rawPaper.includes('DECAL') ? 'DECAL' : (rawPaper || 'C150');
    const finishing = [];
    if (extracted.die_cut) finishing.push('DIE_CUT_DEMI');

    let calc = null;
    if (group === 'DIGITAL' || group === 'OFFSET') {
      // Nếu khổ lớn vượt quá 325x430mm thì tự chuyển sang In quảng cáo
      const useGroup = (Math.min(w, h) > 325 || Math.max(w, h) > 430) ? 'LARGE_FORMAT' : group;
      calc = calculatePrice(db, {
        group: useGroup,
        productName: extracted.product_name,
        quantity: qty,
        pcsPerUnit: isCard ? 100 : 1,
        width: w,
        height: h,
        printSides: extracted.sides === 1 ? 1 : 2,
        paper,
        lamination: extracted.lamination || 'NONE',
        finishing,
        unit: extracted.unit || 'cái'
      });
    } else if (group === 'LARGE_FORMAT') {
      calc = calculatePrice(db, {
        group: 'LARGE_FORMAT',
        productName: extracted.product_name,
        quantity: qty,
        width: w,
        height: h,
        unit: extracted.unit || 'tấm'
      });
    }

    const totalSelling = Number(calc?.suggestedSellingPrice || 0);
    if (calc && totalSelling > 0) {
      return {
        total_selling: Math.round(totalSelling),
        unit_price: Math.round(calc.unitPrice || (totalSelling / qty)),
        total_cost: Math.round(calc.totalCost || 0),
        unit_cost: Math.round(calc.unitCost || 0),
        calc_specs: calc.specs || ''
      };
    }
  } catch (e) {
    console.warn('[AI computeAutoPrice]:', e.message);
  }
  return null;
}

async function analyzeConversationWithGemini(messages, fallbackAnalyzer) {
  const cfg = getAIConfig();
  if (!cfg.gemini_api_key) {
    return { source: 'RULES', ai_configured: false, data: fallbackAnalyzer() };
  }

  // Lấy danh mục giấy & sản phẩm mẫu làm ngữ cảnh thực tế cho Gemini
  const papers = db.prepare('SELECT code, name, gsm FROM papers WHERE is_active = 1 LIMIT 30').all();
  const presets = db.prepare('SELECT name, group_type, width, height, unit FROM product_presets WHERE is_active = 1 LIMIT 25').all();

  const transcript = messages.map(m => {
    const role = m.sender_type === 'CUSTOMER' ? 'Khách' : 'Shop';
    return `${role}: ${m.message_text || ''}`;
  }).join('\n');

  const prompt = `Danh mục giấy hiện có tại xưởng: ${papers.map(p => `${p.code} (${p.name})`).join(', ') || 'C150, C200, C250, C300, F80, DECAL'}.
Một số sản phẩm mẫu phổ biến: ${presets.map(p => `${p.name} [${p.width}x${p.height}mm, ĐVT: ${p.unit}]`).join('; ') || 'Sticker Decal, Namecard C300, Tờ rơi A5, Catalogue A4'}.

Nội dung đoạn chat gần nhất với khách hàng:
"""
${transcript}
"""

Hãy phân tích đoạn chat trên và trả về đúng JSON theo schema yêu cầu.`;

  try {
    const ai = new GoogleGenAI({ apiKey: cfg.gemini_api_key });
    const interaction = await ai.interactions.create({
      model: cfg.gemini_model,
      system_instruction: cfg.gemini_system_prompt || DEFAULT_SYSTEM_PROMPT,
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: QUOTE_EXTRACTION_SCHEMA
      },
      store: false
    });

    const rawText = (interaction.output_text || '').trim();
    const parsed = JSON.parse(rawText);

    // Tự động tính giá thực tế bằng công thức ERP nếu đủ kích thước & số lượng
    const pricing = parsed.detected ? computeAutoPrice(parsed) : null;
    if (pricing) {
      parsed.estimated_total = pricing.total_selling;
      parsed.estimated_unit_price = pricing.unit_price;
      parsed.estimated_unit_cost = pricing.unit_cost;
      // Bổ sung bảng giá tính được vào tin nhắn báo giá soạn sẵn nếu chưa có số tiền
      if (parsed.reply_draft && !/\d[.,]\d{3}/.test(parsed.reply_draft)) {
        parsed.reply_draft += `\n\n💰 Báo giá tham khảo:\n• ${parsed.product_name} (${parsed.specs || ''})\n• Số lượng: ${parsed.quantity} ${parsed.unit || 'cái'}\n• Đơn giá: ${formatVnd(pricing.unit_price)} / ${parsed.unit || 'cái'}\n• Tổng tạm tính (chưa VAT): ${formatVnd(pricing.total_selling)}\n⏱ Thời gian giao: 5 - 7 ngày làm việc kể từ ngày chốt đơn & duyệt file.`;
      }
    }

    return {
      source: 'GEMINI',
      model: cfg.gemini_model,
      ai_configured: true,
      data: parsed
    };
  } catch (err) {
    console.warn('[Gemini AI Analyze Fallback]:', err.message);
    return {
      source: 'RULES',
      ai_configured: true,
      ai_error: err.message,
      data: fallbackAnalyzer()
    };
  }
}

module.exports = {
  router,
  getAIConfig,
  analyzeConversationWithGemini,
  ALLOWED_MODELS
};

