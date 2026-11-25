// public/js/cskh.js - Giao diện CSKH đa kênh & trợ lý AI (mở rộng đối tượng App)
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // SQLite CURRENT_TIMESTAMP là UTC không có hậu tố → thêm 'Z' để hiển thị đúng giờ địa phương
  const toDate = s => (s ? new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z') : null);
  const hhmm = s => { const d = toDate(s); return d ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''; };

  Object.assign(App, {
    stateCSKH: {
      conversations: [], currentConvId: null, currentConv: null, currentMessages: [],
      filterPlatform: 'ALL', searchQuery: '', latestAiExtracted: null, pollingTimer: null, searchTimer: null
    },

    async cskhFetch(url, opts) {
      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
      return data;
    },

    async loadCSKHConversations(isBackground = false) {
      const S = this.stateCSKH;
      try {
        if (!isBackground && !S.initialSynced) {
          S.initialSynced = true;
          this.syncFacebookMessages(false);
        }
        let url = `/api/cskh/conversations?platform=${encodeURIComponent(S.filterPlatform)}`;
        if (S.searchQuery) url += `&q=${encodeURIComponent(S.searchQuery)}`;
        S.conversations = await this.cskhFetch(url);
        if (S.currentConvId) S.currentConv = S.conversations.find(c => c.id === S.currentConvId) || S.currentConv;
        this.renderCSKHConversations();
        this.updateCSKHBadge();
        this.refreshCSKHChannelBadge();

        if (!S.currentConvId && S.conversations.length && !isBackground) {
          this.selectCSKHConversation(S.conversations[0].id);
        }
        this.startCSKHPolling();
      } catch (err) {
        console.error('Lỗi tải hội thoại CSKH:', err.message);
      }
    },

    async syncFacebookMessages(manual = true) {
      const btn = document.getElementById('btn-cskh-sync-fb');
      if (manual && btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      try {
        const r = await this.cskhFetch('/api/cskh/sync/facebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: manual })
        });
        if (!r.skipped && (r.new_messages > 0 || manual)) {
          await this.loadCSKHConversations(true);
          if (this.stateCSKH.currentConvId) await this.refreshCurrentCSKHMessages();
        }
        if (manual) {
          alert(`✅ Đã đồng bộ từ Fanpage Facebook!\n• Hội thoại quét: ${r.synced_conversations || 0}\n• Tin nhắn mới tải về: ${r.new_messages || 0}`);
        }
      } catch (err) {
        if (manual) alert('❌ Lỗi đồng bộ Facebook: ' + err.message);
      } finally {
        if (manual && btn) { btn.disabled = false; btn.textContent = '🔄 Đồng bộ'; }
      }
    },

    startCSKHPolling() {
      const S = this.stateCSKH;
      if (S.pollingTimer) return;
      S.pollTick = 0;
      S.pollingTimer = setInterval(() => {
        if (document.hidden || this.state.activeTab !== 'cskh') return;
        S.pollTick++;
        // Mỗi 12 giây tự đồng bộ trực tiếp từ Facebook Graph API (hoạt động kể cả khi chạy local)
        if (S.pollTick % 3 === 0) this.syncFacebookMessages(false);
        this.loadCSKHConversations(true);
        this.refreshCurrentCSKHMessages();
      }, 4000);
    },

    updateCSKHBadge() {
      const total = this.stateCSKH.conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
      const el = document.getElementById('badge-cskh-count');
      if (!el) return;
      el.textContent = total;
      el.style.display = total > 0 ? 'inline-block' : 'none';
    },

    async refreshCSKHChannelBadge() {
      const el = document.getElementById('cskh-channel-status-badge');
      if (!el) return;
      try {
        const ch = (await this.cskhFetch('/api/cskh/channels')).find(c => c.platform === 'FACEBOOK');
        const ok = ch && ch.connected;
        el.textContent = ok ? '🟢 Đã cấu hình Fanpage' : '🔴 Chưa kết nối Fanpage';
        el.style.background = ok ? '#dcfce7' : '#fee2e2';
        el.style.color = ok ? '#166534' : '#991b1b';
      } catch (e) { /* bỏ qua */ }
    },

    async refreshCurrentCSKHMessages() {
      const S = this.stateCSKH;
      if (!S.currentConvId) return;
      try {
        const msgs = await this.cskhFetch(`/api/cskh/conversations/${S.currentConvId}/messages`);
        const last = m => m.length ? m[m.length - 1].id : null;
        if (msgs.length !== S.currentMessages.length || last(msgs) !== last(S.currentMessages)) {
          S.currentMessages = msgs;
          this.renderCSKHMessages();
          this.aiAnalyzeCurrentChat(false);
        }
      } catch (e) { /* bỏ qua lỗi ngầm */ }
    },

    renderCSKHConversations() {
      const S = this.stateCSKH;
      const listEl = document.getElementById('cskh-conv-list');
      const countEl = document.getElementById('cskh-conv-count');
      if (!listEl) return;
      if (countEl) countEl.textContent = S.conversations.length;

      if (!S.conversations.length) {
        listEl.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-muted); font-size:12px;">
          Chưa có cuộc hội thoại nào.<br>Khi khách nhắn vào Fanpage, hội thoại sẽ hiện ở đây.</div>`;
        return;
      }

      listEl.innerHTML = S.conversations.map(c => {
        const sel = c.id === S.currentConvId;
        const icon = c.platform === 'FACEBOOK' ? '🔵' : (c.platform === 'ZALO' ? '💬' : '🌐');
        return `
          <div data-conv="${esc(c.id)}" class="cskh-conv-item"
            style="padding:10px; border-radius:8px; cursor:pointer; display:flex; gap:10px; align-items:center;
                   background:${sel ? 'rgba(2,132,199,0.12)' : 'var(--bg-card-secondary)'};
                   border:1px solid ${sel ? 'var(--primary)' : 'transparent'};">
            <div style="width:36px; height:36px; border-radius:50%; background:#0284c7; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; flex-shrink:0;">
              ${esc((c.sender_name || 'K').charAt(0).toUpperCase())}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; justify-content:space-between; gap:6px;">
                <span style="font-weight:700; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${icon} ${esc(c.sender_name || 'Khách vãng lai')}</span>
                <span style="font-size:11px; color:var(--text-muted); flex-shrink:0;">${hhmm(c.last_message_at)}</span>
              </div>
              <div style="font-size:12px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;">${esc(c.last_message || '')}</div>
            </div>
            ${c.unread_count > 0 ? `<span style="background:var(--accent-rose); color:#fff; font-size:10px; font-weight:700; border-radius:10px; padding:2px 6px;">${c.unread_count}</span>` : ''}
          </div>`;
      }).join('');

      listEl.querySelectorAll('.cskh-conv-item').forEach(el =>
        el.addEventListener('click', () => this.selectCSKHConversation(el.dataset.conv)));
    },

    async selectCSKHConversation(convId) {
      const S = this.stateCSKH;
      S.currentConvId = convId;
      S.currentConv = S.conversations.find(c => c.id === convId) || null;
      S.latestAiExtracted = null;
      this.renderCSKHConversations();

      const conv = S.currentConv;
      if (conv) {
        document.getElementById('cskh-current-name').textContent = conv.sender_name || 'Khách hàng';
        document.getElementById('cskh-current-avatar').textContent = (conv.sender_name || 'K').charAt(0).toUpperCase();
        document.getElementById('cskh-current-platform').textContent = `Kênh: ${conv.platform}`;
        document.getElementById('cskh-chat-actions').style.display = 'flex';
        document.getElementById('cskh-reply-box').style.display = 'block';

        const profile = document.getElementById('cskh-customer-profile');
        if (conv.customer_id) {
          profile.innerHTML = `<strong>${esc(conv.customer_name || 'Đã liên kết')}</strong> (Mã: ${esc(conv.customer_code || '')})<br>SĐT: ${esc(conv.sender_phone || 'Chưa lưu')}`;
        } else {
          profile.innerHTML = `Khách vãng lai từ ${esc(conv.platform)}.<br>
            ${conv.sender_phone ? `SĐT: <strong>${esc(conv.sender_phone)}</strong><br>` : ''}
            <button class="btn btn-secondary btn-sm" style="margin-top:6px;" id="btn-cskh-save-customer">+ Lưu vào Danh Bạ Khách Hàng</button>`;
          document.getElementById('btn-cskh-save-customer').addEventListener('click', () => this.saveCSKHAsCustomer());
        }
      }

      try {
        S.currentMessages = await this.cskhFetch(`/api/cskh/conversations/${convId}/messages`);
        this.renderCSKHMessages();
        this.aiAnalyzeCurrentChat(false);
        this.loadCSKHConversations(true); // cập nhật số chưa đọc
      } catch (err) {
        console.error('Lỗi tải tin nhắn:', err.message);
      }
    },

    saveCSKHAsCustomer() {
      const c = this.stateCSKH.currentConv;
      if (!c) return;
      this.switchTab('customers');
      this.openNewCustomerModal({ name: c.sender_name || '', phone: c.sender_phone || this.stateCSKH.latestAiExtracted?.customer_phone || '' });
    },

    renderCSKHMessages() {
      const box = document.getElementById('cskh-messages-box');
      if (!box) return;
      const msgs = this.stateCSKH.currentMessages;
      if (!msgs.length) {
        box.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding-top:30px; font-size:12px;">Chưa có tin nhắn.</div>';
        return;
      }
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

      box.innerHTML = msgs.map(m => {
        const agent = m.sender_type === 'AGENT';
        const failed = m.status === 'FAILED';
        return `
          <div style="display:flex; justify-content:${agent ? 'flex-end' : 'flex-start'}; align-items:flex-end; gap:8px;">
            <div style="max-width:70%;">
              <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px; ${agent ? 'text-align:right;' : ''}">
                ${esc(m.sender_name || (agent ? 'Nhân viên' : 'Khách'))} • ${hhmm(m.created_at)}
              </div>
              <div style="padding:10px 14px; border-radius:${agent ? '14px 14px 2px 14px' : '14px 14px 14px 2px'}; font-size:13px; line-height:1.45; word-break:break-word; white-space:pre-wrap;
                          background:${agent ? 'var(--primary)' : 'var(--bg-card-secondary)'}; color:${agent ? '#fff' : 'var(--text-primary)'};
                          border:1px solid ${agent ? 'transparent' : 'var(--border-subtle)'};">${esc(m.message_text)}</div>
              ${failed ? '<div style="font-size:11px; color:#dc2626; text-align:right; margin-top:2px;">⚠ Chưa gửi được tới khách</div>' : ''}
            </div>
          </div>`;
      }).join('');
      if (nearBottom || msgs.length <= 1) box.scrollTop = box.scrollHeight;
    },

    async sendCSKHReply() {
      const S = this.stateCSKH;
      const input = document.getElementById('cskh-reply-input');
      if (!input || !S.currentConvId) return;
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        const data = await this.cskhFetch(`/api/cskh/conversations/${S.currentConvId}/reply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_text: text })
        });
        input.value = '';
        if (data.warning) alert('⚠ Tin đã lưu nhưng CHƯA gửi được tới khách:\n' + data.warning);
        S.currentMessages = await this.cskhFetch(`/api/cskh/conversations/${S.currentConvId}/messages`);
        this.renderCSKHMessages();
        this.loadCSKHConversations(true);
      } catch (err) {
        alert('Lỗi gửi tin: ' + err.message);
      } finally {
        input.disabled = false;
        input.focus();
      }
    },

    async aiAnalyzeCurrentChat(showAlert = true) {
      const S = this.stateCSKH;
      if (!S.currentConvId) return;
      const convId = S.currentConvId;
      const box = document.getElementById('cskh-ai-analysis-text');
      const badge = document.getElementById('cskh-ai-source-badge');
      const draftBox = document.getElementById('cskh-ai-draft-box');
      const draftText = document.getElementById('cskh-ai-draft-text');
      const btn = document.getElementById('btn-quick-create-order');

      if (showAlert && box) box.textContent = '⏳ Trợ lý AI đang đọc đoạn chat, tính giá ERP và soạn tin báo giá...';

      try {
        const resp = await this.cskhFetch(`/api/cskh/conversations/${convId}/ai-analyze`, { method: 'POST' });
        if (convId !== S.currentConvId) return; // người dùng đã chuyển hội thoại
        const data = resp.data;
        S.latestAiExtracted = data;

        if (badge) {
          badge.textContent = resp.source === 'GEMINI'
            ? `✨ ${resp.model || 'Gemini AI'}`
            : (resp.ai_configured ? '⚙️ Fallback (Lỗi AI)' : '⚙️ Rule cơ bản');
        }

        if (data && data.detected) {
          const sizeStr = (data.width_mm > 0 && data.height_mm > 0) ? `${data.width_mm} × ${data.height_mm} mm` : '';
          const missing = Array.isArray(data.missing_info) && data.missing_info.length
            ? `<div style="margin-top:4px; color:#b45309;"><strong>Cần hỏi thêm:</strong> ${esc(data.missing_info.join(', '))}</div>`
            : '';
          const priceHtml = data.estimated_total > 0
            ? `<div style="margin-top:6px; padding:6px 8px; background:rgba(22,163,74,0.12); border:1px solid rgba(22,163,74,0.35); border-radius:6px; color:#22c55e; font-weight:700;">
                💰 Giá tham khảo ERP: ${this.formatCurrency(data.estimated_total)}<br>
                <span style="font-size:11px; font-weight:500;">Đơn giá: ${this.formatCurrency(data.estimated_unit_price)} / ${esc(data.unit || 'cái')} (chưa VAT)</span>
              </div>`
            : '';

          box.innerHTML = `
            <strong>Sản phẩm:</strong> ${esc(data.product_name)}<br>
            ${sizeStr ? `<strong>Kích thước:</strong> ${esc(sizeStr)}<br>` : ''}
            ${data.quantity > 0 ? `<strong>Số lượng:</strong> ${this.formatNumber(data.quantity)} ${esc(data.unit || 'cái')}<br>` : ''}
            <strong>Quy cách:</strong> ${esc(data.specs || 'Chưa rõ — hỏi thêm khách')}<br>
            ${data.customer_phone ? `<strong>SĐT:</strong> ${esc(data.customer_phone)}<br>` : ''}
            ${data.customer_address ? `<strong>Địa chỉ:</strong> ${esc(data.customer_address)}<br>` : ''}
            ${priceHtml}
            ${missing}`;

          if (draftBox && draftText && data.reply_draft) {
            draftText.value = data.reply_draft;
            draftBox.style.display = 'block';
          } else if (draftBox) {
            draftBox.style.display = 'none';
          }
          btn.style.display = 'block';
        } else {
          if (draftBox && draftText && data?.reply_draft) {
            draftText.value = data.reply_draft;
            draftBox.style.display = 'block';
          } else if (draftBox) {
            draftBox.style.display = 'none';
          }
          box.textContent = 'Chưa nhận diện được yêu cầu báo giá / đặt in cụ thể trong đoạn chat này.';
          btn.style.display = 'none';
          if (showAlert && !data?.reply_draft) alert('Chưa nhận diện được yêu cầu in ấn cụ thể trong hội thoại này.');
        }
      } catch (err) {
        if (box) box.textContent = 'Lỗi phân tích AI: ' + err.message;
      }
    },

    async sendAIDraftToCustomer() {
      const S = this.stateCSKH;
      const draftEl = document.getElementById('cskh-ai-draft-text');
      const btn = document.getElementById('btn-send-ai-draft');
      if (!S.currentConvId || !draftEl) return;
      const text = draftEl.value.trim();
      if (!text) return;
      if (!confirm('Gửi nội dung báo giá này tới khách hàng qua Messenger?')) return;

      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang gửi...'; }
      try {
        const data = await this.cskhFetch(`/api/cskh/conversations/${S.currentConvId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_text: text })
        });
        if (data.warning) {
          alert('⚠ Tin đã lưu nhưng CHƯA gửi được tới khách:\n' + data.warning);
        } else {
          alert('✅ Đã gửi tin nhắn báo giá tới khách hàng trên Messenger!');
        }
        S.currentMessages = await this.cskhFetch(`/api/cskh/conversations/${S.currentConvId}/messages`);
        this.renderCSKHMessages();
        this.loadCSKHConversations(true);
      } catch (err) {
        alert('❌ Lỗi gửi báo giá: ' + err.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📨 Gửi Báo Giá Này Cho Khách (Messenger)'; }
      }
    },

    createOrderFromCSKH() {
      const S = this.stateCSKH;
      const d = S.latestAiExtracted;
      const conv = S.currentConv;
      if (!d) return;

      this.switchTab('orders');
      this.openNewOrderModal({
        items: [{
          item_name: d.product_name || 'Ấn phẩm in',
          quantity: d.quantity || 100,
          unit: d.unit || 'cái',
          specs: d.specs || '',
          unit_price: d.estimated_unit_price || 0,
          unit_cost: d.estimated_unit_cost || 0
        }]
      });

      if (conv?.customer_id) {
        const sel = document.getElementById('form-order-customer');
        if (sel) { sel.value = conv.customer_id; this.onCustomerSelected(conv.customer_id); }
      }
      const nameEl = document.getElementById('form-order-recipient-name');
      const phoneEl = document.getElementById('form-order-recipient-phone');
      const addrEl = document.getElementById('form-order-address');
      if (nameEl && conv?.sender_name) nameEl.value = conv.sender_name;
      if (phoneEl) phoneEl.value = d.customer_phone || conv?.sender_phone || '';
      if (addrEl && d.customer_address) addrEl.value = d.customer_address;
      this.calculateOrderTotals();
    },

    setCSKHFilter(platform, btn) {
      this.stateCSKH.filterPlatform = platform;
      document.querySelectorAll('.cskh-filter-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      this.loadCSKHConversations();
    },

    filterCSKHConversations() {
      const S = this.stateCSKH;
      clearTimeout(S.searchTimer);
      S.searchTimer = setTimeout(() => {
        S.searchQuery = document.getElementById('cskh-search-input')?.value.trim() || '';
        this.loadCSKHConversations();
      }, 300);
    },

    async simulateTestChat() {
      const prompts = [
        'Shop ơi báo giá giúp mình in 2.000 con tem decal giấy 6x6cm cán màng bóng bế demi, sđt mình 0909123456',
        'Mình cần in 5 hộp namecard giấy C300 cán màng mờ 2 mặt cho công ty',
        'Bên bạn có in tờ rơi A5 giấy C150 in màu 2 mặt không? Mình cần 1.000 tờ'
      ];
      try {
        const data = await this.cskhFetch('/api/cskh/conversations/simulate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_text: prompts[Math.floor(Math.random() * prompts.length)] })
        });
        await this.loadCSKHConversations(true);
        this.selectCSKHConversation(data.conversation_id);
      } catch (err) {
        alert('Chỉ Admin được tạo hội thoại thử: ' + err.message);
      }
    },

    async openCSKHSettingsModal() {
      try {
        const fb = (await this.cskhFetch('/api/cskh/channels')).find(c => c.platform === 'FACEBOOK');
        if (!fb || fb.page_id === undefined) { alert('Chỉ Admin được cấu hình kênh kết nối.'); return; }
        document.getElementById('cskh-conf-name').value = fb.name || '';
        document.getElementById('cskh-conf-page-id').value = fb.page_id || '';
        document.getElementById('cskh-conf-verify-token').value = fb.verify_token || '';
        const tk = document.getElementById('cskh-conf-access-token');
        tk.value = '';
        tk.placeholder = fb.has_access_token ? `Đã lưu (${fb.access_token_masked}) — để trống nếu giữ nguyên` : 'Dán Page Access Token...';
        const sec = document.getElementById('cskh-conf-app-secret');
        if (sec) { sec.value = ''; sec.placeholder = fb.has_app_secret ? 'Đã lưu — để trống nếu giữ nguyên' : 'App Secret (Settings → Basic) để xác thực webhook'; }
        document.getElementById('cskh-check-result').innerHTML = '';
        document.getElementById('modal-cskh-settings').classList.add('active');
      } catch (err) {
        alert('Lỗi mở cấu hình kênh: ' + err.message);
      }
    },

    async saveCSKHSettings() {
      const v = id => document.getElementById(id)?.value.trim() || '';
      try {
        const r = await this.cskhFetch('/api/cskh/channels/channel_fb_main', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: v('cskh-conf-name'), page_id: v('cskh-conf-page-id'), access_token: v('cskh-conf-access-token'),
            verify_token: v('cskh-conf-verify-token'), app_secret: v('cskh-conf-app-secret'), status: 'ACTIVE'
          })
        });
        document.getElementById('cskh-conf-access-token').value = '';
        this.refreshCSKHChannelBadge();
        if (r.subscribed === false) alert('Đã lưu, nhưng đăng ký webhook cho Page thất bại:\n' + (r.subscribe_error || 'không rõ lỗi'));
        await this.checkCSKHConnection();
      } catch (err) {
        alert('Lỗi lưu cấu hình: ' + err.message);
      }
    },

    async checkCSKHConnection() {
      const out = document.getElementById('cskh-check-result');
      out.innerHTML = '⏳ Đang kiểm tra kết nối với Facebook...';
      try {
        const r = await this.cskhFetch('/api/cskh/channels/channel_fb_main/check', { method: 'POST' });
        out.innerHTML = r.checks.map(c =>
          `<div style="font-size:12px; margin:3px 0;">${c.pass ? '✅' : '❌'} ${esc(c.label)}${c.detail ? ` <span style="color:var(--text-muted);">— ${esc(c.detail)}</span>` : ''}</div>`
        ).join('') + (r.warnings || []).map(w => `<div style="font-size:12px; color:#b45309; margin-top:4px;">⚠ ${esc(w)}</div>`).join('')
          + `<div style="margin-top:6px; font-weight:700; color:${r.ok ? '#166534' : '#991b1b'};">${r.ok ? 'Kết nối hoạt động bình thường' : 'Còn mục chưa đạt — xem các dòng ❌'}</div>`;
      } catch (err) {
        out.textContent = 'Lỗi kiểm tra: ' + err.message;
      }
    }
  });
})();

