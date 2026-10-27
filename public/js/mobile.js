// Điều khiển menu trượt trên mobile
(function(){
  const body=document.body;
  const close=()=>body.classList.remove('sidebar-open');
  document.getElementById('mobile-menu-btn')?.addEventListener('click',()=>body.classList.toggle('sidebar-open'));
  document.getElementById('sidebar-backdrop')?.addEventListener('click',close);
  document.getElementById('main-nav')?.addEventListener('click',e=>{if(e.target.closest('.nav-item'))close();});
  window.addEventListener('resize',()=>{if(window.innerWidth>900)close();});
})();
