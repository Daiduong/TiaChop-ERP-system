# Hướng dẫn đưa ERP Tia Chớp lên host

Ứng dụng: Node.js + Express + SQLite (file `data/tiachop_erp.db`) + ảnh trong `uploads/`.
=> Cần host chạy được Node.js và có **ổ đĩa lưu trữ bền vững**. Không dùng Vercel/Netlify.

## Cách A (khuyên dùng): VPS Ubuntu (~100-150k/tháng: Vultr, DigitalOcean, Viettel, BKNS...)

1. Trỏ tên miền (A record) về IP VPS.
2. SSH vào VPS và cài môi trường:
   ```bash
   ssh root@IP_VPS
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install -y nodejs nginx build-essential python3 certbot python3-certbot-nginx
   npm i -g pm2
   ```
3. Upload code từ máy bạn (không gửi node_modules):
   ```bash
   rsync -av --exclude node_modules --exclude server.log ./ root@IP_VPS:/var/www/erp/
   ```
4. Cài và chạy:
   ```bash
   cd /var/www/erp && npm install --omit=dev
   PORT=3000 pm2 start server/index.js --name erp
   pm2 save && pm2 startup
   ```
5. Nginx: tạo `/etc/nginx/sites-available/erp`
   ```nginx
   server {
     server_name erp.tenmien.com;
     client_max_body_size 20M;
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $remote_addr; }
   }
   ```
   ```bash
   ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   certbot --nginx -d erp.tenmien.com     # bật HTTPS miễn phí
   ```
6. Mở `https://erp.tenmien.com` trên điện thoại/máy tính.

**Cập nhật sau này:** rsync lại code (KHÔNG ghi đè `data/`) rồi `pm2 restart erp`.
**Sao lưu:** cron copy `data/` và `uploads/` mỗi ngày.

## Cách B: Railway / Render (dễ hơn, có phí khi cần ổ đĩa)
1. Đẩy code lên GitHub (đã có `.gitignore`).
2. Tạo project mới từ repo; Start command: `npm start`.
3. **Bắt buộc gắn Volume/Disk** mount vào `/app/data` (và `/app/uploads`), nếu không dữ liệu mất mỗi lần deploy.
4. Dùng domain được cấp hoặc gắn domain riêng.

## Bắt buộc trước khi công khai
- Đăng nhập `admin / admin123` rồi **đổi mật khẩu ngay**.
- Chỉ dùng HTTPS.
- Nếu muốn giữ dữ liệu hiện tại, copy `data/tiachop_erp.db` (dừng app trước) lên host; nếu không app sẽ tạo DB trống.
