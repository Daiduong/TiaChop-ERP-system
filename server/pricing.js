// ==========================================================
// MA TRẬN TÍNH GIÁ & QUY ĐỔI KỸ THUẬT NGÀNH IN - IN TIA CHỚP
// Nhóm 1: In nhanh kỹ thuật số | Nhóm 2: In offset | Nhóm 3: In quảng cáo
// Giá bán = (Chi phí trực tiếp + Chi phí phân bổ) / (1 - Margin%)
// ==========================================================

// ---------- 2. MA TRẬN QUY ĐỔI KỸ THUẬT CƠ BẢN ----------
const INCH_MM = 25.4;
const MM2_PER_M2 = 1000000;
const inchToMm = (inch) => inch * INCH_MM;
const areaM2 = (wMm, hMm) => (wMm * hMm) / MM2_PER_M2; // Dài (m) × Rộng (m)

/**
 * Số con trên tờ: số sản phẩm xếp vừa khổ in sau khi trừ lề và khoảng cách.
 * Thử cả 2 chiều xoay và lấy phương án nhiều con nhất.
 */
function fitOnSheet(sheetW, sheetH, itemW, itemH, margin = 0, gap = 0) {
  const usableW = sheetW - 2 * margin;
  const usableH = sheetH - 2 * margin;
  const fit = (w, h) => {
    const cols = Math.max(0, Math.floor((usableW + gap) / (w + gap)));
    const rows = Math.max(0, Math.floor((usableH + gap) / (h + gap)));
    return { cols, rows, ups: cols * rows };
  };
  const a = fit(itemW, itemH);
  const b = fit(itemH, itemW);
  const best = b.ups > a.ups ? { ...b, rotated: true } : { ...a, rotated: false };
  return { ...best, sheetW, sheetH, itemW, itemH, margin, gap };
}

// Số tờ cần in = SL thành phẩm ÷ số con/tờ (làm tròn lên)
const sheetsNeeded = (qty, ups) => Math.ceil(qty / Math.max(1, ups));

// ---------- Danh mục mặc định (giá dự phòng nếu bảng giá chưa có) ----------
// ---------- BẢNG GIÁ NGỌC MINH 2026 (In nhanh kỹ thuật số) ----------
// Bậc số lượng tờ (cận trên của từng bậc)
const DIG_TIER_MAX = [10, 30, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];
const DIG_TIER_LABELS = ['1-10', '11-30', '31-100', '101-150', '151-200', '201-300', '301-500', '501-750', '751-1.000', '1.001-1.500', '1.501-2.000', '2.001-3.000', '3.001-5.000'];
const digitalTierIndex = (sheets) => {
  const i = DIG_TIER_MAX.findIndex(m => sheets <= m);
  return i < 0 ? DIG_TIER_MAX.length - 1 : i;
};

// Khổ 32.5x43: đủ bảng (12 bậc, bậc 13 giữ giá bậc 12)
const PRINT_325 = [5936, 5600, 4189, 3853, 3640, 3506, 3343, 3086, 2951, 2766, 2621, 2391];
const LAM_325 = [7256, 6755, 4849, 4458, 4201, 4034, 3783, 3465, 3331, 3146, 2923, 2771];
// Khổ 33x36 và 32x48.7: bảng gốc chỉ có bậc đầu và bậc cuối -> nội suy theo đường cong khổ 32.5x43.
// ⚠ Cần cập nhật số liệu từng bậc từ bảng Ngọc Minh để chính xác 100%.
function interpCurve(base, first, last) {
  const f0 = first / base[0], f1 = last / base[base.length - 1];
  const n = base.length - 1;
  const arr = base.map((v, i) => Math.round(v * (f0 + (f1 - f0) * i / n)));
  arr[0] = first; arr[n] = last;
  return arr;
}
const PRINT_330 = interpCurve(PRINT_325, 4480, 1383), LAM_330 = interpCurve(LAM_325, 5140, 1713);
const PRINT_320 = interpCurve(PRINT_325, 6467, 2949), LAM_320 = interpCurve(LAM_325, 7567, 3449);
const pad = (a) => [...a, a[a.length - 1]]; // bậc 3.001-5.000: giữ giá bậc cuối

const DIGITAL_SHEETS = {
  '330x360': { w: 330, h: 360, label: 'Khổ 33 x 36 cm', lot: 100000, side2: 2000, lamSurcharge: 800,
    print: { plain: pad(PRINT_330), lam: pad(LAM_330) },
    paper: { C115: 450, C150: 650, C200: 860, C250: 1090, C300: 1290 } },
  '325x430': { w: 325, h: 430, label: 'Khổ 32.5 x 43 cm', lot: 120000, side2: 4000, lamSurcharge: 1100,
    print: { plain: pad(PRINT_325), lam: pad(LAM_325) },
    paper: { C115: 482, C150: 680, C200: 900, C250: 1150, C300: 1400 } },
  '320x487': { w: 320, h: 487, label: 'Khổ 32 x 48.7 cm', lot: 150000, side2: 4000, lamSurcharge: 1100,
    print: { plain: pad(PRINT_320), lam: pad(LAM_320) },
    paper: { C115: 760, C150: 970, C200: 1210, C250: 1500, C300: 1940 } }
};
// Tương thích đơn cũ
DIGITAL_SHEETS['320x430'] = DIGITAL_SHEETS['325x430'];
DIGITAL_SHEETS['330x487'] = DIGITAL_SHEETS['320x487'];
// Fort/Ford đồng giá với Couche cùng định lượng; F80 tính theo C115
const DIG_PAPER_ALIAS = { F80: 'C115', F100: 'C115', F120: 'C115' };

// Phí bế demi theo số tờ: [cận trên, đ/tờ]
const DEMI_TIERS = [[7, 8000], [10, 7000], [13, 6000], [50, 2500], [100, 2200], [150, 2000], [200, 1800], [300, 1600], [500, 1400], [750, 1200], [1000, 1100], [1500, 1000], [2000, 950], [3000, 850]];
// Ép keo nhiệt theo số cuốn: [cận trên, đ/cuốn]
const GLUE_A4 = [[1, 40000], [2, 30000], [10, 25000], [50, 16000], [100, 13000], [Infinity, 12000]];
const GLUE_A5 = [[5, 20000], [10, 15000], [50, 11000], [100, 9000], [Infinity, 8000]];

const OFFSET_SHEETS = {
  // Tờ in trên máy (cắt từ giấy lớn 65x86 / 79x109)
  '430x650': { w: 430, h: 650, parentPerSheet: 2, parent: '650x860', label: '43 x 65 cm (1/2 khổ 65x86)' },
  '325x430': { w: 325, h: 430, parentPerSheet: 4, parent: '650x860', label: '32.5 x 43 cm (1/4 khổ 65x86)' },
  '545x790': { w: 545, h: 790, parentPerSheet: 2, parent: '790x1090', label: '54.5 x 79 cm (1/2 khổ 79x109)' },
  '395x545': { w: 395, h: 545, parentPerSheet: 4, parent: '790x1090', label: '39.5 x 54.5 cm (1/4 khổ 79x109)' }
};

const LF_MATERIALS = {
  HIFLEX: { name: 'Bạt Hiflex', code: 'LF_HIFLEX', cost: 28000, rolls: [1600, 2200, 3200] },
  PP: { name: 'PP (in dầu/ in nước)', code: 'LF_PP', cost: 45000, rolls: [914, 1070, 1270, 1520] },
  DECAL: { name: 'Decal sữa / trong', code: 'LF_DECAL', cost: 55000, rolls: [1070, 1270, 1520] },
  BACKLIT: { name: 'Backlit film (hộp đèn)', code: 'LF_BACKLIT', cost: 95000, rolls: [914, 1070, 1270] },
  CANVAS: { name: 'Canvas', code: 'LF_CANVAS', cost: 120000, rolls: [914, 1070, 1270] },
  POSTER: { name: 'Poster giấy ảnh', code: 'LF_POSTER', cost: 40000, rolls: [610, 914, 1070] }
};

function buildPriceLookup(db) {
  const map = {};
  try {
    db.prepare('SELECT code, base_cost FROM print_configs').all().forEach(r => { map[r.code] = r.base_cost; });
  } catch (e) { /* bảng chưa có -> dùng giá dự phòng */ }
  return (code, fallback) => (map[code] !== undefined && map[code] !== null ? Number(map[code]) : fallback);
}

const round = (n) => Math.round(n);
const roundK = (n) => Math.ceil(n / 1000) * 1000; // làm tròn lên nghìn đồng

// Hoàn thiện giá bán: chi phí phân bổ, lợi nhuận mục tiêu, giá tối thiểu, chiết khấu lô
function finalize({ lines, quantity, overheadPercent, marginPercent, minOrder = 0, volumeDiscountPct = 0 }) {
  const directCost = lines.reduce((s, l) => s + (l.cost || 0), 0);
  const overheadRate = Math.max(0, (parseFloat(overheadPercent) || 0) / 100);
  const overheadCost = round(directCost * overheadRate);
  const totalCost = directCost + overheadCost;
  const marginRate = Math.min(0.9, Math.max(0, (parseFloat(marginPercent) || 0) / 100));

  let selling = totalCost / (1 - marginRate);
  if (volumeDiscountPct > 0) selling = selling * (1 - volumeDiscountPct / 100);
  let minApplied = false;
  if (selling < minOrder) { selling = minOrder; minApplied = true; }
  // Không bán dưới giá vốn
  if (selling < totalCost) selling = totalCost;
  const suggestedSellingPrice = roundK(selling);
  const grossProfit = suggestedSellingPrice - totalCost;

  return {
    directCost: round(directCost),
    overheadCost,
    totalCost: round(totalCost),
    unitCost: round(totalCost / quantity),
    suggestedSellingPrice,
    unitPrice: round(suggestedSellingPrice / quantity),
    grossProfit: round(grossProfit),
    actualMargin: suggestedSellingPrice ? Math.round((grossProfit / suggestedSellingPrice) * 100) : 0,
    minOrderApplied: minApplied,
    minOrder,
    volumeDiscountPct
  };
}

// ==========================================================
// NHÓM 1 — IN NHANH KỸ THUẬT SỐ
// Cơ sở: số tờ thành phẩm, số mặt in, khổ giấy, SL, giá tối thiểu, gia công
// ==========================================================
function calcDigital(input, P) {
  const qty = Math.max(1, parseInt(input.quantity) || 1);
  const pcsPerUnit = Math.max(1, parseInt(input.pcsPerUnit) || 1); // vd: namecard 1 hộp = 100 con
  const totalPieces = qty * pcsPerUnit;
  const w = parseFloat(input.width) || 148;
  const h = parseFloat(input.height) || 210;
  const sides = parseInt(input.printSides) === 1 ? 1 : 2;
  const sheet = DIGITAL_SHEETS[input.sheetSize] || DIGITAL_SHEETS['325x430'];
  const margin = P('DIG_MARGIN_MM', 3);   // lề kẹp/lề không in được
  const gap = P('DIG_GAP_MM', 0);         // khoảng cách + tràn lề

  const layout = fitOnSheet(sheet.w, sheet.h, w, h, margin, gap);
  if (layout.ups < 1) throw new Error(`Kích thước ${w}x${h}mm vượt khổ in ${sheet.label}. Hãy chuyển sang In quảng cáo.`);

  // Nhà cung cấp tính theo số tờ đặt in (không cộng hao hụt riêng)
  const sheets = sheetsNeeded(totalPieces, layout.ups);
  const impressions = sheets * sides; // 2 mặt = 2 lượt in; bậc giá & tiền lô tính theo số lượt in
  const tierIdx = digitalTierIndex(impressions);
  const tierLabel = DIG_TIER_LABELS[tierIdx];

  const paperCode = input.paper || 'C150';
  const isDecal = paperCode === 'DECAL';
  const lam = input.lamination || 'NONE';
  const hasLam = lam !== 'NONE' && !isDecal;
  const lamSides = lam.endsWith('_1S') ? 1 : 2;

  const lines = [];
  // 1) Tiền in (đơn giá theo khổ & bậc số lượng, 1 mặt; không cán / có cán)
  const printUnit = sheet.print[hasLam ? 'lam' : 'plain'][tierIdx];
  let printCost;
  if (impressions <= 5) {
    printCost = sheet.lot; // ≤5 tờ: tiền lô cố định
    lines.push({ group: 'In', name: `In ${impressions} lượt ${sheet.label} — tiền lô cố định`, cost: printCost });
  } else {
    printCost = impressions * printUnit;
    lines.push({ group: 'In', name: `In ${sides === 2 ? '2 mặt' : '1 mặt'}${hasLam ? ' + cán' : ''} (${sheets} tờ × ${sides} mặt = ${impressions} lượt × ${fmt(printUnit)}, bậc ${tierLabel})`, cost: round(printCost) });
  }
  if (hasLam && lamSides === 2) {
    lines.push({ group: 'Gia công', name: `Phụ phí cán 2 mặt (${sheets} tờ × ${fmt(sheet.lamSurcharge)})`, cost: round(sheets * sheet.lamSurcharge) });
  }

  // 2) Tiền giấy (tính riêng theo khổ & định lượng). Decal: giá giấy decal riêng
  const paperUnit = isDecal
    ? P('DECAL', 2000)
    : (sheet.paper[paperCode] ?? sheet.paper[DIG_PAPER_ALIAS[paperCode]] ?? sheet.paper.C150);
  lines.push({ group: 'Vật tư', name: `Giấy ${paperCode} (${sheets} tờ × ${fmt(paperUnit)})`, cost: round(sheets * paperUnit) });

  // 3) Gia công
  const fin = Array.isArray(input.finishing) ? input.finishing : [];
  if (fin.includes('CORNER_ROUND')) lines.push({ group: 'Gia công', name: `Bo 4 góc (${totalPieces} con)`, cost: round(totalPieces * P('CORNER_ROUND', 150)) });
  if (fin.includes('DIE_CUT_DEMI')) {
    const demi = DEMI_TIERS.find(t => sheets <= t[0]) || DEMI_TIERS[DEMI_TIERS.length - 1];
    lines.push({ group: 'Gia công', name: `Bế demi (${sheets} tờ × ${fmt(demi[1])})`, cost: round(sheets * demi[1]) });
  }
  if (fin.includes('GLUE_BIND_A4') || fin.includes('GLUE_BIND_A5')) {
    const a4 = fin.includes('GLUE_BIND_A4');
    const tiers = a4 ? GLUE_A4 : GLUE_A5;
    const unit = (tiers.find(t => qty <= t[0]) || tiers[tiers.length - 1])[1];
    lines.push({ group: 'Gia công', name: `Ép keo nhiệt ${a4 ? 'A4' : 'A5'} (${qty} cuốn × ${fmt(unit)}, gồm in bìa 1 mặt + vô keo + cắt)`, cost: round(qty * unit) });
    if (a4 && qty <= 20) lines.push({ group: 'Thiết lập', name: 'Phí mở máy keo nhiệt', cost: 40000 });
    if (sides === 2) lines.push({ group: 'Gia công', name: `Bìa 2 mặt (${qty} × ${fmt(a4 ? 4000 : 2000)})`, cost: round(qty * (a4 ? 4000 : 2000)) });
  }
  if (fin.includes('STAPLE_SADDLE')) lines.push({ group: 'Gia công', name: `Bấm kim giữa (${qty} cuốn)`, cost: round(qty * P('STAPLE_SADDLE', 800)) });
  if (fin.includes('SPIRAL_BIND')) lines.push({ group: 'Gia công', name: `Đóng lò xo (${qty} cuốn)`, cost: round(qty * P('SPIRAL_BIND', 7000)) });
  if (fin.includes('FOLD')) lines.push({ group: 'Gia công', name: `Gấp (${totalPieces} tờ)`, cost: round(totalPieces * P('FOLD_DIGITAL', 100)) });

  return {
    lines,
    finalizeArgs: { minOrder: P('DIG_MIN_ORDER', 0), volumeDiscountPct: 0 },
    layout,
    metrics: [
      ['Kích thước thành phẩm', `${w} × ${h} mm`],
      ['Khổ in', `${sheet.label} (lề ${margin}mm, khoảng cách ${gap}mm)`],
      ['Số con / tờ', `${layout.ups} con (${layout.cols} × ${layout.rows}${layout.rotated ? ', xoay 90°' : ''})`],
      ['Tổng thành phẩm', `${totalPieces.toLocaleString('vi-VN')} con`],
      ['Số tờ in (tính giá NCC)', `${sheets.toLocaleString('vi-VN')} tờ`],
      ['Bậc đơn giá', `${tierLabel} tờ${impressions <= 5 ? ' (≤5 lượt: tiền lô cố định)' : ''}`]
    ],
    impositionNote: `${sheet.label}: ${layout.ups} con/tờ → ${sheets} tờ in theo bảng giá Ngọc Minh 2026.`,
    specs: `KTS, ${w}x${h}mm, giấy ${paperCode}, in ${sides === 1 ? '4/0' : '4/4'}, ${sheet.label}`
  };
}

// ==========================================================
// NHÓM 2 — IN OFFSET
// Cơ sở: khổ giấy, số con/tờ, số tờ in, số màu, số kẽm, hao hụt, giấy, gia công
// ==========================================================
function calcOffset(input, P) {
  const qty = Math.max(1, parseInt(input.quantity) || 1);
  const w = parseFloat(input.width) || 148;
  const h = parseFloat(input.height) || 210;
  const sheet = OFFSET_SHEETS[input.sheetSize] || OFFSET_SHEETS['430x650'];
  const colorsFront = Math.max(0, Math.min(6, parseInt(input.colorsFront ?? 4)));
  const colorsBack = Math.max(0, Math.min(6, parseInt(input.colorsBack ?? 4)));
  const workAndTurn = !!input.workAndTurn && colorsBack > 0; // trở nhíp: 1 bộ kẽm in 2 mặt
  const gsm = parseFloat(input.gsm) || 150;
  const margin = P('OFF_GRIPPER_MM', 5); // nhíp + lề
  const gap = P('OFF_GAP_MM', 0);         // tràn lề 3mm mỗi cạnh

  let layout = fitOnSheet(sheet.w, sheet.h, w, h, margin, gap);
  if (layout.ups < 1) throw new Error(`Kích thước ${w}x${h}mm vượt khổ tờ in ${sheet.label}.`);

  // Trở nhíp: mỗi tờ in chứa cả mặt trước + sau -> số bộ thành phẩm/tờ = ups/2
  const effectiveUps = workAndTurn ? Math.max(1, Math.floor(layout.ups / 2)) : layout.ups;
  const baseSheets = sheetsNeeded(qty, effectiveUps);
  const totalColors = workAndTurn ? Math.max(colorsFront, colorsBack) : colorsFront + colorsBack;
  const plates = totalColors;

  // Hao hụt theo khổ, số màu, quy trình
  const wastePerColor = P('OFF_WASTE_PER_COLOR', 50); // tờ canh màu / màu
  const wastePct = P('OFF_WASTE_PCT', 3);
  const finishingWaste = (input.lamination && input.lamination !== 'NONE') || (input.finishing || []).length ? 1 : 0;
  const wasteSheets = Math.ceil(totalColors * wastePerColor + baseSheets * (wastePct + finishingWaste) / 100);
  const totalSheets = baseSheets + wasteSheets;

  // Giấy: tính theo kg = m² × gsm / 1000
  const sheetM2 = areaM2(sheet.w, sheet.h);
  const sheetKg = sheetM2 * gsm / 1000;
  const paperKgPrice = P(`OFF_PAPER_KG_${input.paperType || 'COUCHE'}`, input.paperType === 'FORT' ? 24000 : 26000);
  const paperCost = round(totalSheets * sheetKg * paperKgPrice);

  // Kẽm
  const plateUnit = sheet.w * sheet.h > 450 * 650 ? P('OFF_PLATE_LARGE', 180000) : P('OFF_PLATE', 120000);
  const plateCost = plates * plateUnit;

  // Công in: tính theo 1.000 lượt/màu, tối thiểu 1.000 lượt
  const impressionsPerColor = workAndTurn ? totalSheets * 2 : totalSheets;
  const runThousands = Math.max(1, Math.ceil(impressionsPerColor / 1000));
  const runUnit = P('OFF_RUN_PER_1000_COLOR', 60000);
  const printCost = runThousands * runUnit * totalColors;

  const lines = [];
  lines.push({ group: 'Vật tư', name: `Giấy ${gsm}gsm (${totalSheets} tờ × ${sheetKg.toFixed(3)}kg × ${fmt(paperKgPrice)}/kg)`, cost: paperCost });
  lines.push({ group: 'Thiết lập', name: `Kẽm ${plates} tấm × ${fmt(plateUnit)}`, cost: plateCost });
  lines.push({ group: 'Thiết lập', name: 'Bình bản, ra phim/CTP', cost: P('OFF_IMPOSE', 50000) });
  lines.push({ group: 'In', name: `Công in ${totalColors} màu × ${runThousands}.000 lượt × ${fmt(runUnit)}`, cost: round(printCost) });

  const lam = input.lamination || 'NONE';
  if (lam !== 'NONE') {
    const lamSides = lam.endsWith('_1S') ? 1 : 2;
    const perM2 = lam.startsWith('MATTE') ? P('OFF_LAM_MATTE_M2', 1800) : P('OFF_LAM_GLOSS_M2', 1500);
    const lamSheets = baseSheets + Math.ceil(baseSheets * 0.01);
    lines.push({ group: 'Gia công', name: `Cán màng ${lam.startsWith('MATTE') ? 'mờ' : 'bóng'} ${lamSides} mặt (${round(lamSheets * sheetM2 * lamSides)} m²)`, cost: Math.max(P('OFF_LAM_MIN', 100000), round(lamSheets * sheetM2 * lamSides * perM2)) });
  }
  const fin = Array.isArray(input.finishing) ? input.finishing : [];
  lines.push({ group: 'Gia công', name: 'Xén thành phẩm', cost: Math.max(P('OFF_CUT_MIN', 30000), round(baseSheets * P('OFF_CUT_PER_SHEET', 30))) });
  if (fin.includes('DIE_CUT')) {
    lines.push({ group: 'Gia công', name: 'Khuôn bế', cost: P('OFF_DIE_MOLD', 350000) });
    lines.push({ group: 'Gia công', name: `Công bế (${baseSheets} tờ)`, cost: Math.max(P('OFF_DIE_MIN', 150000), round(Math.ceil(baseSheets / 1000) * P('OFF_DIE_PER_1000', 120000))) });
  }
  if (fin.includes('FOLD')) lines.push({ group: 'Gia công', name: `Gấp (${qty} tờ)`, cost: Math.max(P('OFF_FOLD_MIN', 50000), round(qty * P('OFF_FOLD', 30))) });
  if (fin.includes('STAPLE_SADDLE')) lines.push({ group: 'Gia công', name: `Đóng ghim (${qty} cuốn)`, cost: round(qty * P('OFF_STAPLE', 400)) });
  if (fin.includes('PERFECT_BIND')) lines.push({ group: 'Gia công', name: `Đóng keo gáy (${qty} cuốn)`, cost: round(qty * P('OFF_PERFECT_BIND', 2500)) });
  if (fin.includes('GLUE_BOX')) lines.push({ group: 'Gia công', name: `Dán hộp/bao thư (${qty} cái)`, cost: Math.max(100000, round(qty * P('OFF_GLUE', 150))) });

  const colorLabel = `${colorsFront}/${colorsBack}${workAndTurn ? ' (trở nhíp)' : ''}`;
  return {
    lines,
    finalizeArgs: { minOrder: P('OFF_MIN_ORDER', 1000000) },
    layout,
    metrics: [
      ['Kích thước thành phẩm', `${w} × ${h} mm`],
      ['Tờ in', `${sheet.label} — ${sheet.parentPerSheet} tờ in/tờ giấy ${sheet.parent}`],
      ['Số con / tờ', `${layout.ups} con (${layout.cols} × ${layout.rows}${layout.rotated ? ', xoay 90°' : ''})${workAndTurn ? ` → ${effectiveUps} bộ/tờ` : ''}`],
      ['Số màu', colorLabel],
      ['Số kẽm', `${plates} tấm`],
      ['Số tờ cần in', `${baseSheets.toLocaleString('vi-VN')} tờ`],
      ['Hao hụt', `${wasteSheets.toLocaleString('vi-VN')} tờ (${wastePerColor} tờ/màu + ${wastePct + finishingWaste}%)`],
      ['Số tờ sản xuất', `${totalSheets.toLocaleString('vi-VN')} tờ ≈ ${Math.ceil(totalSheets / sheet.parentPerSheet)} tờ ${sheet.parent}`],
      ['Giấy tiêu hao', `${(totalSheets * sheetKg).toFixed(1)} kg`]
    ],
    impositionNote: `Offset ${sheet.label}: ${layout.ups} con/tờ, in ${colorLabel}, ${plates} kẽm → ${baseSheets} tờ + ${wasteSheets} hao = ${totalSheets} tờ.`,
    specs: `Offset, ${w}x${h}mm, giấy ${gsm}gsm, in ${colorLabel}, tờ in ${sheet.label}`
  };
}

// ==========================================================
// NHÓM 3 — IN QUẢNG CÁO
// Cơ sở: diện tích m², khổ cuộn, chiều dài vật liệu, mực, cán màng, bế, khoen, khung, lắp đặt
// ==========================================================
function calcLargeFormat(input, P) {
  const qty = Math.max(1, parseInt(input.quantity) || 1);
  const w = parseFloat(input.width) || 1000; // mm
  const h = parseFloat(input.height) || 2000;
  const mat = LF_MATERIALS[input.material] || LF_MATERIALS.HIFLEX;
  const matCode = input.material && LF_MATERIALS[input.material] ? input.material : 'HIFLEX';
  const pricePerM2 = P(mat.code, mat.cost); // vật liệu + mực in / m²
  const edge = P('LF_EDGE_MM', 0);          // biên chừa (dán biên/đóng khoen)
  const pw = w + 2 * edge, ph = h + 2 * edge;

  // Chọn khổ cuộn tối ưu: ít hao phí vật liệu nhất
  let best = null;
  for (const roll of mat.rolls) {
    for (const rotated of [false, true]) {
      const across = rotated ? ph : pw;  // chiều nằm ngang khổ cuộn
      const along = rotated ? pw : ph;
      const perRow = Math.floor(roll / across);
      if (perRow < 1) continue;
      const rowsNeeded = Math.ceil(qty / perRow);
      const lengthMm = rowsNeeded * along;
      const usedM2 = areaM2(roll, lengthMm);
      if (!best || usedM2 < best.usedM2) best = { roll, rotated, perRow, rowsNeeded, lengthMm, usedM2 };
    }
  }
  let tiled = false;
  if (!best) {
    // Quá khổ cuộn lớn nhất -> nối tấm
    const roll = Math.max(...mat.rolls);
    const short = Math.min(pw, ph), long = Math.max(pw, ph);
    const strips = Math.ceil(short / (roll - 30)); // chồng mí 30mm
    const lengthMm = strips * long * qty;
    best = { roll, rotated: pw < ph, perRow: 1, rowsNeeded: strips * qty, lengthMm, usedM2: areaM2(roll, lengthMm), strips };
    tiled = true;
  }

  const itemM2 = areaM2(w, h);
  const minBill = P('LF_MIN_M2_PER_PCS', 0.5); // diện tích tính tiền tối thiểu / sản phẩm
  const billM2Per = Math.max(itemM2, minBill);
  const billM2 = billM2Per * qty;
  const wasteM2 = Math.max(0, best.usedM2 - itemM2 * qty);

  const lines = [];
  // Chi phí vật liệu quảng cáo = diện tích tính tiền × đơn giá/m² (+ phần hao do khổ cuộn)
  lines.push({ group: 'Vật tư', name: `${mat.name} + mực in (${billM2.toFixed(2)} m² × ${fmt(pricePerM2)})`, cost: round(billM2 * pricePerM2) });
  const wasteCostRate = P('LF_WASTE_COST_RATE', 50) / 100; // tính 50% đơn giá cho phần hao (chỉ vật liệu, không mực)
  if (wasteM2 > 0.01) lines.push({ group: 'Vật tư', name: `Hao hụt khổ cuộn (${wasteM2.toFixed(2)} m²)`, cost: round(wasteM2 * pricePerM2 * wasteCostRate) });
  lines.push({ group: 'Thiết lập', name: 'Căn chỉnh file, khởi động máy', cost: P('LF_SETUP', 30000) });

  const fin = Array.isArray(input.finishing) ? input.finishing : [];
  if (fin.includes('LAMINATE')) lines.push({ group: 'Gia công', name: `Cán màng (${(itemM2 * qty).toFixed(2)} m²)`, cost: round(itemM2 * qty * P('LF_LAMINATE_M2', 20000)) });
  if (fin.includes('MOUNT_FOAM')) lines.push({ group: 'Gia công', name: `Bồi Format/Fomex (${(itemM2 * qty).toFixed(2)} m²)`, cost: round(itemM2 * qty * P('LF_MOUNT_M2', 120000)) });
  if (fin.includes('CONTOUR_CUT')) {
    const perim = 2 * (w + h) / 1000;
    lines.push({ group: 'Gia công', name: `Cắt bế theo viền (${(perim * qty).toFixed(1)} m)`, cost: Math.max(30000, round(perim * qty * P('LF_CUT_PER_M', 3000))) });
  }
  if (fin.includes('EYELET')) {
    const spacing = P('LF_EYELET_SPACING_MM', 500);
    const perPcs = Math.max(4, 2 * (Math.ceil(w / spacing) + Math.ceil(h / spacing)));
    lines.push({ group: 'Gia công', name: `Đóng khoen (${perPcs} khoen/tấm × ${qty})`, cost: round(perPcs * qty * P('LF_EYELET', 1500)) });
  }
  if (fin.includes('HEM')) {
    const perim = 2 * (w + h) / 1000;
    lines.push({ group: 'Gia công', name: `Dán/may biên (${(perim * qty).toFixed(1)} m)`, cost: round(perim * qty * P('LF_HEM_PER_M', 4000)) });
  }
  if (fin.includes('STANDEE')) lines.push({ group: 'Khung', name: `Chân standee (${qty} bộ)`, cost: qty * P('LF_STANDEE_FRAME', 120000) });
  if (fin.includes('FRAME')) {
    const perim = 2 * (w + h) / 1000;
    lines.push({ group: 'Khung', name: `Khung sắt/nhôm (${(perim * qty).toFixed(1)} m)`, cost: round(perim * qty * P('LF_FRAME_PER_M', 80000)) });
  }
  if (fin.includes('LIGHTBOX')) lines.push({ group: 'Khung', name: `Hộp đèn (${(itemM2 * qty).toFixed(2)} m²)`, cost: round(itemM2 * qty * P('LF_LIGHTBOX_M2', 1200000)) });
  if (fin.includes('INSTALL')) lines.push({ group: 'Lắp đặt', name: 'Vận chuyển & lắp đặt', cost: Math.max(P('LF_INSTALL_MIN', 300000), round(itemM2 * qty * P('LF_INSTALL_M2', 50000))) });

  // Giảm theo tổng diện tích
  const volumeDiscountPct = billM2 >= 100 ? 12 : billM2 >= 50 ? 8 : billM2 >= 20 ? 5 : 0;

  const layout = {
    type: 'roll', roll: best.roll, perRow: best.perRow, rowsNeeded: best.rowsNeeded,
    itemW: best.rotated ? ph : pw, itemH: best.rotated ? pw : ph, lengthMm: best.lengthMm, tiled
  };
  return {
    lines,
    finalizeArgs: { minOrder: P('LF_MIN_ORDER', 100000), volumeDiscountPct },
    layout,
    metrics: [
      ['Kích thước thành phẩm', `${w} × ${h} mm (${itemM2.toFixed(3)} m²/tấm)`],
      ['Diện tích tính tiền', `${billM2.toFixed(2)} m²${itemM2 < minBill ? ` (tối thiểu ${minBill} m²/tấm)` : ''}`],
      ['Khổ cuộn chọn', `${best.roll} mm${tiled ? ` — nối ${best.strips} tấm` : ''}`],
      ['Sơ đồ ghép', `${best.perRow} tấm/hàng × ${best.rowsNeeded} hàng${best.rotated ? ' (xoay 90°)' : ''}`],
      ['Chiều dài vật liệu', `${(best.lengthMm / 1000).toFixed(2)} m`],
      ['Vật liệu tiêu hao', `${best.usedM2.toFixed(2)} m² (hao ${wasteM2.toFixed(2)} m²)`],
      ['Giảm theo tổng diện tích', volumeDiscountPct ? `${volumeDiscountPct}%` : 'Không']
    ],
    impositionNote: `${mat.name} khổ cuộn ${best.roll}mm: ${best.perRow} tấm/hàng, dài ${(best.lengthMm / 1000).toFixed(2)}m, tính tiền ${billM2.toFixed(2)} m².`,
    specs: `${mat.name}, ${w}x${h}mm, ${billM2.toFixed(2)} m², khổ cuộn ${best.roll}mm`,
    material: matCode
  };
}

function fmt(n) { return `${Math.round(n).toLocaleString('vi-VN')}đ`; }

const GROUP_LABEL = { DIGITAL: 'In nhanh kỹ thuật số', OFFSET: 'In offset', LARGE_FORMAT: 'In quảng cáo' };

function calculatePrice(db, input) {
  const P = buildPriceLookup(db);
  const group = GROUP_LABEL[input.group] ? input.group : 'DIGITAL';
  const qty = Math.max(1, parseInt(input.quantity) || 1);
  const r = group === 'OFFSET' ? calcOffset(input, P) : group === 'LARGE_FORMAT' ? calcLargeFormat(input, P) : calcDigital(input, P);

  const fin = finalize({
    lines: r.lines,
    quantity: qty,
    overheadPercent: input.overheadPercent ?? P('OVERHEAD_PCT', 10),
    marginPercent: input.marginPercent ?? 40,
    ...r.finalizeArgs
  });

  return {
    group,
    groupLabel: GROUP_LABEL[group],
    productName: input.productName || GROUP_LABEL[group],
    quantity: qty,
    baseUnit: input.unit || (group === 'LARGE_FORMAT' ? 'tấm' : 'tờ'),
    lines: r.lines,
    metrics: r.metrics.map(([label, value]) => ({ label, value })),
    layout: r.layout,
    impositionNote: r.impositionNote,
    specs: r.specs,
    ...fin
  };
}

module.exports = { calculatePrice, fitOnSheet, sheetsNeeded, areaM2, inchToMm, DIGITAL_SHEETS, OFFSET_SHEETS, LF_MATERIALS };
