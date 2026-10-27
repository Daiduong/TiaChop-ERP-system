const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'tiachop_erp.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Khởi tạo các bảng
function initDatabase() {
  db.exec(`
    -- Bảng Khách hàng
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      customer_group TEXT DEFAULT 'RETAIL', -- B2B_CHAIN, SCHOOL, CORPORATE, RETAIL
      tax_company TEXT,
      tax_code TEXT,
      tax_email TEXT,
      default_discount REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Bảng Người liên hệ trực thuộc Khách hàng B2B
    CREATE TABLE IF NOT EXISTS customer_contacts (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      position TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    -- Bảng Nhà cung cấp / Xưởng in gia công (SRM)
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      specialties TEXT, -- Offset, In nhanh, Bao thư, Decal, Hộp...
      vat_supported INTEGER DEFAULT 1,
      bank_info TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Bảng Đơn hàng & Báo giá
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL, -- BH_... hoặc DH_...
      type TEXT NOT NULL DEFAULT 'ORDER', -- QUOTE, ORDER
      customer_id TEXT NOT NULL,
      contact_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, QUOTE_SENT, ORDER_CONFIRMED, IN_PRODUCTION, PRODUCED, DELIVERING, DELIVERED, COMPLETED, CANCELLED
      delivery_deadline DATE,
      shipping_address TEXT,
      vat_rate REAL DEFAULT 0, -- 0, 8, 10
      vat_amount REAL DEFAULT 0,
      vat_invoiced_at DATE,
      discount_amount REAL DEFAULT 0,
      total_selling REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      gross_profit REAL DEFAULT 0,
      deposit_amount REAL DEFAULT 0,
      remaining_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'UNPAID', -- UNPAID, PARTIAL, PAID
      notes TEXT,
      created_by TEXT DEFAULT 'Dương Trân',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Bảng Hạng mục Đơn hàng (Line Items)
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      size TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit TEXT DEFAULT 'bộ',
      paper_gsm TEXT,
      specs TEXT,
      imposition_info TEXT,
      supplier_id TEXT,
      file_url TEXT,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      status TEXT DEFAULT 'PENDING', -- PENDING, PRINTING, DONE
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    -- Bảng Lệnh In / Job Ticket gửi xưởng
    CREATE TABLE IF NOT EXISTS job_tickets (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      ticket_code TEXT UNIQUE,
      specs TEXT,
      file_url TEXT,
      deadline DATE,
      status TEXT DEFAULT 'SENT', -- SENT, IN_PROGRESS, READY, DELIVERED
      supplier_cost REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    -- Bảng Thu Chi & Dòng tiền (Transactions)
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      type TEXT NOT NULL, -- INCOME_DEPOSIT, INCOME_BALANCE, EXPENSE_SUPPLIER, EXPENSE_OTHER
      category TEXT DEFAULT 'BAN_HANG',
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'BANK_TRANSFER', -- BANK_TRANSFER, CASH
      ref_code TEXT, -- IDNhap, Mã giao dịch ngân hàng, Số phiếu chi
      supplier_id TEXT,
      notes TEXT,
      transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- Bảng Cấu hình Vật tư & Bình bài
    CREATE TABLE IF NOT EXISTS print_configs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL, -- PAPER, FINISHING, BASE_SIZE, PRODUCT_TEMPLATE
      name TEXT NOT NULL,
      code TEXT,
      base_cost REAL DEFAULT 0,
      unit TEXT,
      metadata TEXT
    );
  `);

  ensureOwnerColumns();

  // Seed dữ liệu mẫu nếu chưa có dữ liệu
  seedInitialData();
  ensurePricingMatrixConfigs();
}

// Cột chủ sở hữu (user tạo) để phân quyền dữ liệu cho Sales. Dữ liệu cũ = NULL → chỉ Admin thấy.
function ensureOwnerColumns() {
  ['customers', 'orders'].forEach(table => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === 'created_by_user_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN created_by_user_id TEXT`);
    }
  });
}

// Đơn giá ma trận tính giá 3 nhóm (In nhanh / Offset / Quảng cáo) - chỉnh sửa tại Bảng giá vật tư
function ensurePricingMatrixConfigs() {
  const ins = db.prepare(`INSERT OR IGNORE INTO print_configs (id, category, name, code, base_cost, unit, metadata) VALUES (?, ?, ?, ?, ?, ?, '{}')`);
  const rows = [
    // Chung
    ['GENERAL', 'Chi phí phân bổ (% trên chi phí trực tiếp)', 'OVERHEAD_PCT', 10, '%'],
    // Nhóm 1 - In nhanh KTS
    ['DIGITAL', 'KTS - Lề không in được', 'DIG_MARGIN_MM', 3, 'mm'],
    ['DIGITAL', 'KTS - Khoảng cách + tràn lề giữa các con', 'DIG_GAP_MM', 0, 'mm'],
    ['DIGITAL', 'KTS - Hao hụt %', 'DIG_WASTE_PCT', 2, '%'],
    ['DIGITAL', 'KTS - Hao hụt tối thiểu', 'DIG_WASTE_MIN', 3, 'tờ'],
    ['DIGITAL', 'KTS - Căn chỉnh, chạy máy', 'DIG_SETUP', 20000, 'đơn'],
    ['DIGITAL', 'KTS - Giá tối thiểu mỗi đơn', 'DIG_MIN_ORDER', 50000, 'đơn'],
    ['DIGITAL', 'KTS - Cắt thành phẩm', 'CUT_PER_SHEET', 100, 'tờ'],
    ['DIGITAL', 'KTS - Cắt tối thiểu', 'CUT_MIN', 10000, 'đơn'],
    ['DIGITAL', 'KTS - Bế demi tối thiểu', 'DIE_CUT_DEMI_MIN', 50000, 'đơn'],
    ['DIGITAL', 'KTS - Gấp', 'FOLD_DIGITAL', 100, 'tờ'],
    // Nhóm 2 - Offset
    ['OFFSET', 'Offset - Lề nhíp', 'OFF_GRIPPER_MM', 5, 'mm'],
    ['OFFSET', 'Offset - Khoảng cách + tràn lề', 'OFF_GAP_MM', 0, 'mm'],
    ['OFFSET', 'Offset - Giấy Couche', 'OFF_PAPER_KG_COUCHE', 26000, 'kg'],
    ['OFFSET', 'Offset - Giấy Fort/Ford', 'OFF_PAPER_KG_FORT', 24000, 'kg'],
    ['OFFSET', 'Offset - Giấy Ivory/Duplex (bao bì)', 'OFF_PAPER_KG_IVORY', 30000, 'kg'],
    ['OFFSET', 'Offset - Kẽm khổ nhỏ', 'OFF_PLATE', 120000, 'tấm'],
    ['OFFSET', 'Offset - Kẽm khổ lớn', 'OFF_PLATE_LARGE', 180000, 'tấm'],
    ['OFFSET', 'Offset - Bình bản / CTP', 'OFF_IMPOSE', 50000, 'đơn'],
    ['OFFSET', 'Offset - Công in / 1.000 lượt / màu', 'OFF_RUN_PER_1000_COLOR', 60000, '1000 lượt'],
    ['OFFSET', 'Offset - Hao canh màu', 'OFF_WASTE_PER_COLOR', 50, 'tờ/màu'],
    ['OFFSET', 'Offset - Hao hụt chạy máy', 'OFF_WASTE_PCT', 3, '%'],
    ['OFFSET', 'Offset - Cán màng mờ', 'OFF_LAM_MATTE_M2', 1800, 'm²'],
    ['OFFSET', 'Offset - Cán màng bóng', 'OFF_LAM_GLOSS_M2', 1500, 'm²'],
    ['OFFSET', 'Offset - Cán màng tối thiểu', 'OFF_LAM_MIN', 100000, 'đơn'],
    ['OFFSET', 'Offset - Xén / tờ', 'OFF_CUT_PER_SHEET', 30, 'tờ'],
    ['OFFSET', 'Offset - Xén tối thiểu', 'OFF_CUT_MIN', 30000, 'đơn'],
    ['OFFSET', 'Offset - Khuôn bế', 'OFF_DIE_MOLD', 350000, 'khuôn'],
    ['OFFSET', 'Offset - Công bế / 1.000 tờ', 'OFF_DIE_PER_1000', 120000, '1000 tờ'],
    ['OFFSET', 'Offset - Công bế tối thiểu', 'OFF_DIE_MIN', 150000, 'đơn'],
    ['OFFSET', 'Offset - Gấp', 'OFF_FOLD', 30, 'tờ'],
    ['OFFSET', 'Offset - Gấp tối thiểu', 'OFF_FOLD_MIN', 50000, 'đơn'],
    ['OFFSET', 'Offset - Đóng ghim', 'OFF_STAPLE', 400, 'cuốn'],
    ['OFFSET', 'Offset - Đóng keo gáy', 'OFF_PERFECT_BIND', 2500, 'cuốn'],
    ['OFFSET', 'Offset - Dán hộp / bao thư', 'OFF_GLUE', 150, 'cái'],
    ['OFFSET', 'Offset - Giá tối thiểu mỗi đơn', 'OFF_MIN_ORDER', 1000000, 'đơn'],
    // Nhóm 3 - Quảng cáo
    ['LARGE_FORMAT', 'QC - Bạt Hiflex + mực', 'LF_HIFLEX', 28000, 'm²'],
    ['LARGE_FORMAT', 'QC - PP + mực', 'LF_PP', 45000, 'm²'],
    ['LARGE_FORMAT', 'QC - Decal + mực', 'LF_DECAL', 55000, 'm²'],
    ['LARGE_FORMAT', 'QC - Backlit film + mực', 'LF_BACKLIT', 95000, 'm²'],
    ['LARGE_FORMAT', 'QC - Canvas + mực', 'LF_CANVAS', 120000, 'm²'],
    ['LARGE_FORMAT', 'QC - Poster giấy ảnh + mực', 'LF_POSTER', 40000, 'm²'],
    ['LARGE_FORMAT', 'QC - Diện tích tính tiền tối thiểu / tấm', 'LF_MIN_M2_PER_PCS', 0.5, 'm²'],
    ['LARGE_FORMAT', 'QC - Tỷ lệ tính phần hao khổ cuộn', 'LF_WASTE_COST_RATE', 50, '%'],
    ['LARGE_FORMAT', 'QC - Căn chỉnh file, khởi động máy', 'LF_SETUP', 30000, 'đơn'],
    ['LARGE_FORMAT', 'QC - Cán màng', 'LF_LAMINATE_M2', 20000, 'm²'],
    ['LARGE_FORMAT', 'QC - Bồi Format/Fomex', 'LF_MOUNT_M2', 120000, 'm²'],
    ['LARGE_FORMAT', 'QC - Cắt bế theo viền', 'LF_CUT_PER_M', 3000, 'm'],
    ['LARGE_FORMAT', 'QC - Khoen', 'LF_EYELET', 1500, 'khoen'],
    ['LARGE_FORMAT', 'QC - Khoảng cách khoen', 'LF_EYELET_SPACING_MM', 500, 'mm'],
    ['LARGE_FORMAT', 'QC - Dán/may biên', 'LF_HEM_PER_M', 4000, 'm'],
    ['LARGE_FORMAT', 'QC - Chân standee', 'LF_STANDEE_FRAME', 120000, 'bộ'],
    ['LARGE_FORMAT', 'QC - Khung sắt/nhôm', 'LF_FRAME_PER_M', 80000, 'm'],
    ['LARGE_FORMAT', 'QC - Hộp đèn', 'LF_LIGHTBOX_M2', 1200000, 'm²'],
    ['LARGE_FORMAT', 'QC - Lắp đặt', 'LF_INSTALL_M2', 50000, 'm²'],
    ['LARGE_FORMAT', 'QC - Lắp đặt tối thiểu', 'LF_INSTALL_MIN', 300000, 'đơn'],
    ['LARGE_FORMAT', 'QC - Giá tối thiểu mỗi đơn', 'LF_MIN_ORDER', 100000, 'đơn']
  ];
  const exists = db.prepare('SELECT 1 FROM print_configs WHERE code = ?');
  rows.forEach(([cat, name, code, cost, unit]) => {
    if (!exists.get(code)) ins.run(`cfg_${code.toLowerCase()}`, cat, name, code, cost, unit);
  });
}

function seedInitialData() {
  const customerCount = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;
  if (customerCount > 0) return;

  console.log('🌱 Đang nạp dữ liệu mẫu ban đầu cho In Tia Chớp...');

  // 1. Thêm Khách hàng thực tế
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, code, name, phone, email, address, customer_group, tax_company, tax_code, tax_email, default_discount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const customers = [
    ['kh_texas', 'TEXAS', 'Công Ty Cổ Phần F&B Texas Chicken', '0903123456', 'procurement@texas.vn', 'Quận 1, TP. Hồ Chí Minh', 'B2B_CHAIN', 'Công Ty Cổ Phần F&B Texas', '0312998877', 'invoice@texas.vn', 5, 'Chuỗi nhà hàng thức ăn nhanh - đặt thường xuyên namecard, menu, voucher, sticker'],
    ['kh_itd', 'ITD', 'Công Ty Cổ Phần Công Nghệ ITD Group', '0918765432', 'admin@itd.com.vn', 'Khu Công Nghệ Cao, TP. Thủ Đức', 'CORPORATE', 'Công Ty Cổ Phần ITD', '0303882211', 'ketoan@itd.com.vn', 0, 'In tài liệu kỹ thuật, brochure, profile năng lực doanh nghiệp'],
    ['kh_ruby', 'RUBY', 'Hệ Thống Mầm Non Quốc Tế Ruby School', '0988554433', 'contact@rubyschool.edu.vn', 'Bình Thạnh, TP. Hồ Chí Minh', 'SCHOOL', 'Công Ty Giáo Dục Mầm Non Ruby', '0315667788', 'tax@rubyschool.edu.vn', 5, 'Chị Nguyệt phụ trách - chiết khấu 5%'],
    ['kh_vnpt', 'VNPT', 'Chi Nhánh Tập Đoàn Bưu Chính Viễn Thông VNPT', '0944221100', 'marketing@vnpt.vn', 'Quận 3, TP. Hồ Chí Minh', 'CORPORATE', 'Tập Đoàn Bưu Chính Viễn Thông Việt Nam', '0100684378', 'hoadon@vnpt.vn', 10, 'Chiết khấu thỏa thuận 10%'],
    ['kh_tam_spa', 'TAM_SPA', 'Tâm - Spa Phú Yên', '0977889900', 'tamspa@gmail.com', 'Tuy Hòa, Phú Yên', 'RETAIL', '', '', '', 0, 'In voucher, menu spa, bảng giá dịch vụ'],
    ['kh_lech', 'KHACH_LE', 'Khách Vãng Lai / In Lẻ', '0909000111', '', 'TP. Hồ Chí Minh', 'RETAIL', '', '', '', 0, 'Khách lẻ in namecard, tem nhãn nhanh']
  ];

  customers.forEach(c => insertCustomer.run(...c));

  // 2. Thêm Người liên hệ trực thuộc
  const insertContact = db.prepare(`
    INSERT INTO customer_contacts (id, customer_id, name, phone, position, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const contacts = [
    ['ct_01', 'kh_texas', 'Thy (Thu Mua)', '0903111222', 'Purchasing Specialist', 'thy@texas.vn'],
    ['ct_02', 'kh_texas', 'Thọ Lee', '0903333444', 'Marketing Lead', 'tho.lee@texas.vn'],
    ['ct_03', 'kh_texas', 'Tuyết Trinh', '0903555666', 'Operations Manager', 'trinh.tuyet@texas.vn'],
    ['ct_04', 'kh_texas', 'Hoàng Kim', '0903777888', 'Graphic Designer', 'kim.hoang@texas.vn'],
    ['ct_05', 'kh_itd', 'Chị Trinh', '0918111222', 'Trưởng phòng Hành chính', 'trinh.cty@itd.com.vn'],
    ['ct_06', 'kh_itd', 'Hồng Ân', '0918333444', 'Chuyên viên Nhân sự', 'an.hong@itd.com.vn'],
    ['ct_07', 'kh_itd', 'Đan Nguyên', '0918555666', 'Project Manager', 'nguyen.dan@itd.com.vn'],
    ['ct_08', 'kh_ruby', 'Chị Nguyệt', '0988554433', 'Hiệu trưởng điều hành', 'nguyet@rubyschool.edu.vn']
  ];

  contacts.forEach(ct => insertContact.run(...ct));

  // 3. Thêm Nhà cung cấp / Xưởng in gia công (Suppliers)
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (id, name, phone, address, specialties, vat_supported, bank_info, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const suppliers = [
    ['ncc_thanhdanh', 'In Thành Danh', '0908123789', 'Quận 10, TP.HCM', 'Offset, Bao thư, Folder kẹp file, Bao lì xì, Tờ rơi số lượng lớn', 1, 'VCB 0071000123456 - Cty In Thanh Danh', 'Chuyên offset chạy số lượng nhiều, giá tốt'],
    ['ncc_ngocminh', 'Photo Ngọc Minh', '0913987654', 'Quận 5, TP.HCM', 'In nhanh kỹ thuật số màu, Tài liệu học tập, Đóng cuốn lò xo kẽm, Đóng keo gáy', 1, 'ACB 11223344 - Photo Ngoc Minh', 'Chuyên in nhanh lấy gấp, chạy bài 32x43cm rất đẹp'],
    ['ncc_sackim', 'In Sắc Kim', '0909876543', 'Bình Thạnh, TP.HCM', 'Standee, PP cán Format, Decal khổ lớn dán kính, Hộp giấy, Bạt Hiflex', 1, 'Techcombank 1902888999 - In Sac Kim', 'Thế mạnh quảng cáo ngoài trời, decal chống nước'],
    ['ncc_ttl', 'TTL Copier', '0938112233', 'Quận 10, TP.HCM', 'Đóng cuốn tài liệu, Ghim lồng, Đóng gáy xoắn, In đơn sắc / 2 màu', 0, 'VietinBank 101009988 - TTL Copier', 'Giá rẻ cho giáo trình, tài liệu nội bộ'],
    ['ncc_dainam', 'In Đại Nam', '0902345678', 'Tân Phú, TP.HCM', 'Tem nhãn cuộn, Tem xi bạc, Tem 7 màu bảo hành, Ép kim, Bế hình nổi', 1, 'MBBank 0902345678 - Cty Dai Nam', 'Chuyên gia công tem cao cấp và nhãn phụ']
  ];

  suppliers.forEach(s => insertSupplier.run(...s));

  // 4. Thêm Đơn hàng & Báo giá mẫu
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      id, code, type, customer_id, contact_id, status, delivery_deadline, shipping_address,
      vat_rate, vat_amount, discount_amount, total_selling, total_cost, gross_profit,
      deposit_amount, remaining_amount, payment_status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, item_name, size, quantity, unit, paper_gsm, specs, imposition_info,
      supplier_id, file_url, unit_cost, total_cost, unit_price, total_price, profit, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (
      id, order_id, type, category, amount, payment_method, ref_code, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Đơn 1: TEXAS - Đã chốt đơn và đang sản xuất tại Photo Ngọc Minh + Sắc Kim
  insertOrder.run(
    'dh_01', 'DH1773288121173', 'ORDER', 'kh_texas', 'ct_01', 'IN_PRODUCTION',
    '2026-10-16', 'Texas Chicken - Chi nhánh Hai Bà Trưng, Q1, HCM',
    8, 256000, 160000, 3200000, 1950000, 1250000,
    1600000, 1856000, 'PARTIAL', 'Khách hẹn giao trước 15h ngày 16/10. Kèm hoá đơn VAT 8%.', 'Dương Trân'
  );

  insertItem.run(
    'item_01_1', 'dh_01', 'Namecard C300 cán mờ 2 mặt', '9x5.4 cm', 10, 'hộp', 'C300gsm',
    'In 2 mặt, cán màng mờ 2 mặt, hộp mica trong', 'Bình 20 con / tờ 32x43cm',
    'ncc_ngocminh', 'https://drive.google.com/file/d/NameCard_FnB_CFO.pdf',
    45000, 450000, 85000, 850000, 400000, 'PRINTING'
  );

  insertItem.run(
    'item_01_2', 'dh_01', 'Sticker Beer Chống Nước', '6.5x4 cm', 2000, 'con', 'Decal Nhựa Sữa',
    'In màu kỹ thuật số, cán bóng chống nước, bế demi từng con', 'Bế demi viền chuẩn file',
    'ncc_sackim', 'https://drive.google.com/file/d/BEER_STICKER.pdf',
    750, 1500000, 1250, 2500000, 1000000, 'PRINTING'
  );

  insertTransaction.run(
    'tx_01', 'dh_01', 'INCOME_DEPOSIT', 'BAN_HANG', 1600000, 'BANK_TRANSFER', 'VCB_TEXAS_COC50', 'Khách chuyển cọc 50% qua tài khoản ngân hàng'
  );

  // Đơn 2: ITD - Đã hoàn thành & Thu đủ tiền
  insertOrder.run(
    'dh_02', 'BH_202613', 'ORDER', 'kh_itd', 'ct_05', 'COMPLETED',
    '2026-10-09', 'Tòa nhà ITD, Khu Công Nghệ Cao, TP. Thủ Đức',
    10, 480000, 0, 4800000, 2900000, 1900000,
    4800000, 0, 'PAID', 'Đã giao hàng và xuất hóa đơn VAT điện tử ngày 09/10.', 'Dương Trân'
  );

  insertItem.run(
    'item_02_1', 'dh_02', 'Profile Doanh Nghiệp (Cuốn A4 24 trang)', 'A4 (21x29.7cm)', 200, 'cuốn', 'Bìa C300, Ruột C150',
    'Bìa cán mờ, ruột in màu 2 mặt, đóng kim gáy vuông', 'Khổ in 32x43cm bình đôi',
    'ncc_thanhdanh', 'https://drive.google.com/file/d/Profile_ITD_2026.pdf',
    14500, 2900000, 24000, 4800000, 1900000, 'DONE'
  );

  insertTransaction.run(
    'tx_02', 'dh_02', 'INCOME_DEPOSIT', 'BAN_HANG', 2400000, 'BANK_TRANSFER', 'ITD_COC', 'Tạm ứng 50%'
  );
  insertTransaction.run(
    'tx_03', 'dh_02', 'INCOME_BALANCE', 'BAN_HANG', 2880000, 'BANK_TRANSFER', 'ITD_TT_CONLAI', 'Thanh toán đợt cuối kèm tiền VAT 10%'
  );

  // Đơn 3: Trường Ruby - Báo giá đang chờ duyệt
  insertOrder.run(
    'dh_03', 'BG_202645', 'QUOTE', 'kh_ruby', 'ct_08', 'QUOTE_SENT',
    '2026-10-18', 'Trường Mầm Non Ruby School, Bình Thạnh',
    0, 0, 95000, 1805000, 1100000, 705000,
    0, 1805000, 'UNPAID', 'Gửi báo giá in sổ bé ngoan và thẻ đeo phụ huynh. Đã áp chiết khấu 5%.', 'Dương Trân'
  );

  insertItem.run(
    'item_03_1', 'dh_03', 'Sổ Bé Ngoan Học Kỳ 1 (32 trang)', 'A5 (14.8x21cm)', 300, 'quyển', 'Bìa C250, Ruột F80',
    'Bìa cán bóng, in màu, ruột in 1 màu kẻ ô, bấm 2 kim giữa', '1 tờ 32x43 = 4 con A5',
    'ncc_ngocminh', '',
    3666, 1100000, 6333, 1900000, 800000, 'PENDING'
  );

  // 5. Thêm cấu hình giá vật tư mặc định (Pricing Presets)
  const insertConfig = db.prepare(`
    INSERT INTO print_configs (id, category, name, code, base_cost, unit, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const configs = [
    // Khổ in cơ sở
    ['cfg_size_1', 'BASE_SIZE', 'Khổ Chuẩn 32 x 43 cm (In Nhanh)', '32x43', 0, 'tờ', JSON.stringify({ width: 32, height: 43, a4: 2, a5: 4, a6: 8, namecard: 20 })],
    ['cfg_size_2', 'BASE_SIZE', 'Khổ Rộng 33 x 48.7 cm (A3+)', '33x48.7', 0, 'tờ', JSON.stringify({ width: 33, height: 48.7, a4: 2, a5: 4, a6: 8, namecard: 24 })],
    // Tiền in lượt 32x43 (Đơn giá xưởng Photo Ngọc Minh)
    ['cfg_print_run_1', 'PRINT_RUN', 'In màu 1 mặt (32x43 cm)', 'RUN_4C_1S', 2500, 'lượt', JSON.stringify({ description: 'Giá lượt in màu 1 mặt khổ 32x43' })],
    ['cfg_print_run_2', 'PRINT_RUN', 'In màu 2 mặt (32x43 cm)', 'RUN_4C_2S', 4500, 'lượt', JSON.stringify({ description: 'Giá lượt in màu 2 mặt khổ 32x43' })],
    // Giấy
    ['cfg_paper_c150', 'PAPER', 'Couche 150 gsm (C150)', 'C150', 600, 'tờ 32x43', JSON.stringify({ gsm: 150 })],
    ['cfg_paper_c200', 'PAPER', 'Couche 200 gsm (C200)', 'C200', 800, 'tờ 32x43', JSON.stringify({ gsm: 200 })],
    ['cfg_paper_c250', 'PAPER', 'Couche 250 gsm (C250)', 'C250', 1000, 'tờ 32x43', JSON.stringify({ gsm: 250 })],
    ['cfg_paper_c300', 'PAPER', 'Couche 300 gsm (C300)', 'C300', 1200, 'tờ 32x43', JSON.stringify({ gsm: 300 })],
    ['cfg_paper_fort', 'PAPER', 'Fort 80 gsm (F80)', 'F80', 400, 'tờ 32x43', JSON.stringify({ gsm: 80 })],
    ['cfg_paper_decal', 'PAPER', 'Decal Giấy / Nhựa Sữa', 'DECAL', 2000, 'tờ 32x43', JSON.stringify({ gsm: 120 })],
    // Gia công phụ trợ
    ['cfg_fin_lam_m', 'FINISHING', 'Cán màng mờ 2 mặt', 'LAM_MATTE_2S', 1200, 'tờ 32x43', JSON.stringify({ type: 'lamination' })],
    ['cfg_fin_lam_g', 'FINISHING', 'Cán màng bóng 2 mặt', 'LAM_GLOSS_2S', 1000, 'tờ 32x43', JSON.stringify({ type: 'lamination' })],
    ['cfg_fin_corner', 'FINISHING', 'Bo 4 góc tròn', 'CORNER_ROUND', 150, 'con', JSON.stringify({ type: 'corner' })],
    ['cfg_fin_demi', 'FINISHING', 'Bế demi hình tròn/vuông', 'DIE_CUT_DEMI', 500, 'tờ 32x43', JSON.stringify({ type: 'die_cut' })],
    ['cfg_fin_spiral', 'FINISHING', 'Đóng lò xo kẽm (cuốn)', 'SPIRAL_BIND', 7000, 'cuốn', JSON.stringify({ type: 'binding' })],
    ['cfg_fin_staple', 'FINISHING', 'Bấm 2 kim giữa & gập', 'STAPLE_SADDLE', 800, 'cuốn', JSON.stringify({ type: 'binding' })]
  ];

  configs.forEach(cfg => insertConfig.run(...cfg));

  console.log('✅ Nạp dữ liệu mẫu ban đầu thành công!');
}

initDatabase();

module.exports = {
  db,
  initDatabase
};
