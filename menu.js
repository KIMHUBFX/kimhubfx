/* menu.js - shared across pages */
(function(){
  // sidebar open/close
  const sidebar = {
    el: null,
    init(){ this.el = document.getElementById('sidebar'); },
    open(){ if(this.el) this.el.classList.add('open'); },
    close(){ if(this.el) this.el.classList.remove('open'); }
  };

  window.appUI = {
    sidebar,
    openMenu(){ sidebar.open(); },
    closeMenu(){ sidebar.close(); },
    loginWithDeriv(){
      const app_id = 112604;
      const redirect = "https://kimhubfx.github.io/kimhubfx/redirect.html";
      const url = "https://oauth.deriv.com/oauth2/authorize"
                + "?app_id=" + app_id
                + "&force_login=1"
                + "&redirect_uri=" + encodeURIComponent(redirect);
      window.location.href = url;
    },
    createAccountReferral(){ window.location.href = "https://app.deriv.com/signup/?ref=kimhubfx"; },

    isLoggedIn(){ return !!localStorage.getItem('auth_token'); },

    ensureAuth(redirectToLogin=true){
      if(!this.isLoggedIn()){
        if(redirectToLogin) window.location.href = "index.html";
        return false;
      }
      return true;
    },

    // called on page load to render top-right auth controls
    renderAuthButtons(containerId){
      const c = document.getElementById(containerId);
      if(!c) return;
      c.innerHTML = '';
      if(this.isLoggedIn()){
        const balance = localStorage.getItem('fake_balance') || '0.00';
        const span = document.createElement('div');
        span.className = 'balance-box';
        span.innerHTML = `<div>Balance:</div><div style="font-weight:900">USD ${balance}</div><button id="logoutBtn" style="margin-left:12px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer">Logout</button>`;
        c.appendChild(span);
        document.getElementById('logoutBtn').addEventListener('click', ()=>{
          localStorage.removeItem('auth_token');
          localStorage.removeItem('fake_balance');
          location.href = 'index.html';
        });
      } else {
        const loginBtn = document.createElement('button');
        loginBtn.className = 'auth-btn'; loginBtn.textContent = 'Login';
        loginBtn.onclick = ()=> this.loginWithDeriv();
        const signupBtn = document.createElement('button');
        signupBtn.className = 'auth-btn'; signupBtn.textContent = 'Create Account';
        signupBtn.onclick = ()=> this.createAccountReferral();
        c.appendChild(loginBtn);
        c.appendChild(signupBtn);
      }
    },

    // mark active nav item (pass current page id)
    markActive(tabName){
      try{
        document.querySelectorAll('.menu-item').forEach(el=>{
          el.classList.remove('active');
        });
        const el = document.querySelector(`.menu-item[data-tab="${tabName}"]`);
        if(el) el.classList.add('active');
      }catch(e){}
    }
  };

  // init sidebar element reference
  document.addEventListener('DOMContentLoaded', ()=> sidebar.init());
})();
