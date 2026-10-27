/**
 * auth.js — Xử lý đăng nhập / đăng xuất / đổi mật khẩu phía client
 * Được load sau app.js và admin.js, gọi App.init(user) khi đăng nhập thành công
 */
const Auth = (() => {
  // ─── Helpers ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const loginScreen   = $('login-screen');
  const appContainer  = $('app-container');
  const loginForm     = $('login-form');
  const loginError    = $('login-error');
  const loginSubmit   = $('login-submit');
  const btnLogout     = $('btn-logout');
  const btnChangePw   = $('btn-change-password');
  const modalPassword = $('modal-password');

  function showError(msg) {
    if (!loginError) return;
    loginError.textContent = msg;
    loginError.style.display = msg ? 'block' : 'none';
  }

  function showApp(user) {
    if (loginScreen)  loginScreen.style.display  = 'none';
    if (appContainer) appContainer.style.display = '';
    App.init(user);
  }

  function showLogin() {
    if (loginScreen)  loginScreen.style.display  = '';
    if (appContainer) appContainer.style.display = 'none';
    if ($('login-username')) $('login-username').focus();
  }

  // ─── Kiểm tra phiên hiện tại ──────────────────────────────────────────────
  async function checkSession() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const { user } = await res.json();
        showApp(user);
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  // ─── Đăng nhập ────────────────────────────────────────────────────────────
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      showError('');
      const username = ($('login-username')?.value || '').trim();
      const password = $('login-password')?.value || '';
      if (!username || !password) { showError('Vui lòng nhập đầy đủ thông tin.'); return; }

      if (loginSubmit) { loginSubmit.disabled = true; loginSubmit.textContent = 'Đang đăng nhập…'; }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại');
        showApp(data.user);
      } catch (err) {
        showError(err.message);
        if ($('login-password')) $('login-password').value = '';
      } finally {
        if (loginSubmit) { loginSubmit.disabled = false; loginSubmit.textContent = 'Đăng Nhập'; }
      }
    });
  }

  // ─── Đăng xuất ────────────────────────────────────────────────────────────
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (!confirm('Bạn có chắc muốn đăng xuất?')) return;
      await fetch('/api/auth/logout', { method: 'POST' });
      showLogin();
    });
  }

  // ─── Mở modal đổi mật khẩu ────────────────────────────────────────────────
  if (btnChangePw) {
    btnChangePw.addEventListener('click', () => {
      if (modalPassword) {
        ['pw-old', 'pw-new', 'pw-new2'].forEach(id => { const el = $(id); if (el) el.value = ''; });
        modalPassword.style.display = 'flex';
      }
    });
  }

  // ─── Lưu mật khẩu mới ────────────────────────────────────────────────────
  async function changePassword() {
    const oldPw  = $('pw-old')?.value  || '';
    const newPw  = $('pw-new')?.value  || '';
    const newPw2 = $('pw-new2')?.value || '';
    if (!oldPw || !newPw) { alert('Vui lòng nhập đầy đủ thông tin.'); return; }
    if (newPw.length < 6)  { alert('Mật khẩu mới tối thiểu 6 ký tự.'); return; }
    if (newPw !== newPw2)  { alert('Mật khẩu mới nhập lại không khớp.'); return; }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Đổi mật khẩu thất bại');
      alert('✅ Đổi mật khẩu thành công!');
      if (modalPassword) modalPassword.style.display = 'none';
    } catch (err) {
      alert('❌ ' + err.message);
    }
  }

  // ─── Khởi động ────────────────────────────────────────────────────────────
  // Ẩn app cho đến khi xác thực xong
  if (appContainer) appContainer.style.display = 'none';
  checkSession();

  return { changePassword };
})();
