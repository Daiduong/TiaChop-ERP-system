# HỆ THỐNG ERP IN TIA CHỚP (ERP_TC)
> Hệ thống Quản trị Tổng thể Doanh nghiệp Thương mại & Dịch vụ In ấn (Print Commercial Trading ERP)

---

## I. GIỚI THIỆU & MÔ HÌNH VẬN HÀNH

Hệ thống **TiaChop ERP** được xây dựng đặc thù cho **Công ty In Tia Chớp**, giải quyết trọn vẹn mô hình **Print Commercial Trading**:
1. **Tiếp nhận & Báo giá trong 30 giây**: Tự động tính quy đổi khổ in (bình bài 32x43cm), tính chi phí giấy + lượt in xưởng + cán màng + gia công phụ + biên lợi nhuận (Margin %) để xuất báo giá tức thì.
2. **Chốt Đơn & Tách Lệnh Xưởng (Job Ticket)**: Phân phối từng hạng mục in về đúng xưởng có thế mạnh (Photo Ngọc Minh, In Thành Danh, In Sắc Kim, TTL Copier, In Đại Nam...).
3. **Quản lý Dòng tiền & Sổ Công Nợ (AR/AP)**: Theo dõi chặt chẽ tiền cọc 50%, công nợ còn lại của các khách hàng lớn (Texas Chicken, ITD Group, Ruby School, VNPT...), nhật ký thu chi ngày và thuế VAT.
4. **Kiến trúc Phân quyền Tuyển dụng (RBAC)**: Thiết kế sẵn bảo mật:
   - 👑 **Admin (Dương Trân)**: Toàn quyền quản trị, xem giá vốn, lợi nhuận, sổ quỹ.
   - 💼 **Sales (Kinh doanh)**: Ẩn hoàn toàn giá vốn xưởng (tiền làm) và lợi nhuận gộp để bảo mật biên lợi nhuận của công ty khi tuyển dụng nhân sự mới.
   - 📊 **Kế toán**: Quản lý chuyên sâu thu chi, cọc tiền hàng, công nợ và hóa đơn VAT.
   - 🏭 **Điều phối gia công**: Quản lý quy cách kỹ thuật, file in và theo dõi tiến độ hoàn thành từ các xưởng.

---

## II. HƯỚNG DẪN KHỞI CHẠY HỆ THỐNG

### 1. Khởi động ứng dụng
Hệ thống chạy trên nền tảng **Node.js** và cơ sở dữ liệu **SQLite** an toàn, nhanh, độc lập:

```bash
cd /Users/dev/Documents/TiaChop/ERP_TC
npm start
```

* Ứng dụng tự động chạy tại: **http://localhost:3000**

### 2. Phím tắt thao tác nhanh (Keyboard Shortcuts)
* **`P`**: Mở ngay tab **Tính Giá & Bình Bài Khổ 32x43cm**.
* **`N`**: Mở cửa sổ **Tạo Báo Giá / Đơn Hàng Mới** trong vòng 30 giây.
* **`D`**: Quay về màn hình **Tổng Quan (Dashboard)**.
* **`/`**: Đặt con trỏ vào ô tìm kiếm nhanh đơn hàng / khách hàng.
* **`Esc`**: Đóng nhanh các cửa sổ popup / modal.

---

## III. DANH MỤC PHÂN HỆ CHỨC NĂNG

### 1. Dashboard & Chỉ số KPI
* Tổng doanh thu đơn hàng chốt in, lợi nhuận gộp thực tế, tổng công nợ phải thu (AR) và số đơn đang gia công tại xưởng.
* Danh sách đơn hàng mới nhất và tải trọng công việc tại các xưởng in đối tác.

### 2. Công cụ Tính Giá & Bình Bài (Imposition & Pricing Engine)
* **Quy đổi bình bài khổ in tiêu chuẩn 32x43cm**:
  - $1 \text{ tờ } (32\times 43\text{cm}) = 4 \text{ tờ A5} = 2 \text{ tờ A4} = 8 \text{ tờ A6} = 20 \text{ con Namecard}$.
* **Bóc tách chi phí tự động**:
  - Tiền giấy: Couche 150/200/250/300gsm, Fort 80gsm, Decal nhựa sữa.
  - Tiền in lượt: In 1 mặt (2.500đ/tờ 32x43) hoặc 2 mặt (4.500đ/tờ 32x43).
  - Tiền cán màng: Cán màng mờ / màng bóng 2 mặt.
  - Tiền gia công phụ: Bo 4 góc, bế demi, bấm 2 kim giữa, đóng lò xo.
* **Thanh trượt Margin %**: Tự động tính giá bán đề xuất và lợi nhuận gộp theo biên lợi nhuận mong muốn.
* **Nút 1 chạm "👉 Đưa vào Báo Giá / Đơn Hàng Mới"**: Chuyển ngay kết quả tính toán vào form tạo đơn hàng mà không cần gõ lại.

### 3. Quản lý Báo Giá & Đơn Hàng (Orders & Quotes)
* Quản lý trạng thái: *Bản nháp ➔ Đã gửi báo giá ➔ Đã chốt đơn ➔ Đang in xưởng ➔ Xưởng đã xong ➔ Đang giao hàng ➔ Hoàn thành*.
* Nút chuyển đổi nhanh **"⚡ Chốt"** từ Báo Giá thành Đơn Hàng.
* **In Phiếu Báo Giá / Đơn Hàng (PDF)** chuẩn phong cách Tia Chớp: Logo chính thức, bảng mục, điều khoản đặt cọc 50%, số tài khoản ngân hàng.
* **In Phiếu Lệnh In (Job Ticket)** gửi riêng cho xưởng: Có quy cách kỹ thuật, file in, ngày hẹn giao, ẩn hoàn toàn giá bán khách hàng.

### 4. Quản lý Xưởng In Đối Tác (SRM)
* Lưu trữ danh sách đối tác chiến lược:
  - *Photo Ngọc Minh*: Chuyên in nhanh KTS màu 32x43, tài liệu đóng lò xo.
  - *In Thành Danh*: Chuyên offset số lượng lớn, bao thư, folder kẹp file.
  - *In Sắc Kim*: Chuyên standee, PP bồi format, decal khổ lớn, hộp giấy.
  - *TTL Copier*: Chuyên đóng cuốn tài liệu, giáo trình.
  - *In Đại Nam*: Chuyên tem nhãn xi bạc, 7 màu, ép kim.

### 5. Khách Hàng (CRM)
* Quản lý khách hàng B2B có nhiều người đặt hàng trực thuộc (Ví dụ: khách *Texas Chicken* có *Thy, Thọ Lee, Tuyết Trinh, Hoàng Kim...*; khách *ITD Group* có *Chị Trinh, Hồng Ân, Đan Nguyên...*).
* Cấu hình chiết khấu % riêng theo từng khách hàng.
* Quản lý thông tin xuất hóa đơn VAT: Tên pháp nhân, MST, Email nhận HĐĐT.

### 6. Dòng Tiền, Sổ Công Nợ & Thuế (Finance)
* Sổ công nợ phải thu (AR) chi tiết theo từng khách hàng.
* Ghi nhận thu cọc, thu tất toán và chi tiền xưởng.
* Báo cáo thuế VAT (0%, 8%, 10%).

---

## IV. CẤU TRÚC THƯ MỤC DỰ ÁN

```
/Users/dev/Documents/TiaChop/ERP_TC/
├── data/
│   └── tiachop_erp.db          # Cơ sở dữ liệu SQLite độc lập & bảo mật
├── public/
│   ├── assets/                 # Logo In Tia Chớp chính thức
│   │   ├── logo.png
│   │   └── logo-icon.png
│   ├── css/
│   │   └── style.css           # Vanilla CSS Design System (Dark/Light + Print)
│   ├── js/
│   │   └── app.js              # Controller frontend, Reactive Pricing & RBAC
│   └── index.html              # Giao diện web app chính
├── server/
│   ├── db.js                   # Schema SQLite & Nạp dữ liệu mẫu ban đầu
│   ├── api.js                  # Toàn bộ RESTful API endpoints
│   └── index.js                # Express Server (Port 3000)
├── uploads/                    # Thư mục lưu trữ file in / tài liệu nội bộ
└── package.json
```

---
*Phát triển bởi Antigravity cho Doanh nghiệp In Tia Chớp.*
