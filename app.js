// app.js — OAuth-only + Deriv WebSocket read-only
const APP_ID = 112604;
const WS_URL = `wss://ws.deriv.com/websockets/v3?app_id=${APP_ID}`;
let ws = null;
let token = localStorage.getItem('auth_token');

const historyEl = document.getElementById ? document.getElementById('history') : null;
const balanceBox = document.getElementById ? document.getElementById('balanceBox') : null;
const tickBox = document.getElementById ? document.getElementById('tickBox') : null;
const statusEl = document.getElementById ? document.getElementById('status') : null;
const tickTime = document.getElementById ? document.getElementById('tickTime') : null;
const accountBox = document.getElementById ? document.getElementById('accountBox') : null;

function appendHistory(text) {
  if (!historyEl) return;
  const now = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.textContent = `[${now}] ${text}`;
  historyEl.prepend(div);
}

// If there's a token in URL (in case someone lands with ?token=), capture it:
(function captureTokenFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const t1 = q.get('token') || q.get('access_token');
  if (t1) {
    localStorage.setItem('auth_token', t1);
    token = t1;
    // remove token from URL
    window.history.replaceState({}, document.title, '/kimhubfx/dashboard.html');
  }
})();

// If token exists and on dashboard, connect
if (token && window.location.pathname.endsWith('dashboard.html')) {
  connectDeriv();
} else if (window.location.pathname.endsWith('dashboard.html')) {
  if (statusEl) statusEl.innerText = 'No token found — please login via Login page.';
  appendHistory('No token present.');
}

function connectDeriv() {
  if (!token) { appendHistory('No token — abort connect.'); return; }
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    appendHistory('WebSocket opened — authorizing.');
    if (statusEl) { statusEl.className = 'status waiting'; statusEl.innerText = 'Authorizing...'; }
    send({ authorize: token });
  };

  ws.onmessage = (evt) => {
    let d;
    try { d = JSON.parse(evt.data); } catch (e) { appendHistory('Invalid JSON'); return; }
    handleMessage(d);
  };

  ws.onerror = () => { appendHistory('WebSocket error'); if (statusEl) { statusEl.innerText = 'Connection error'; } };
  ws.onclose = () => { appendHistory('WebSocket closed'); if (statusEl) { statusEl.innerText = 'Disconnected'; } setTimeout(()=>{ if (localStorage.getItem('auth_token')) connectDeriv(); }, 5000); };
}

function send(obj) { if (!ws || ws.readyState !== WebSocket.OPEN) return; ws.send(JSON.stringify(obj)); }

function handleMessage(msg) {
  if (!msg) return;
  if (msg.msg_type === 'authorize' || msg.authorize) {
    if (msg.error) {
      appendHistory('Authorize failed: ' + (msg.error.message || JSON.stringify(msg.error)));
      if (statusEl) { statusEl.className = 'status waiting'; statusEl.innerText = 'Auth failed — login again'; }
      return;
    }
    appendHistory('Authorized.');
    if (statusEl) { statusEl.className = 'status connected'; statusEl.innerText = 'Connected'; }
    send({ balance: 1, subscribe: 1 });
    send({ ticks: 'R_100', subscribe: 1 });
    send({ get_account_status: 1 });
    return;
  }

  if (msg.msg_type === 'balance' || msg.balance) {
    const b = msg.balance && msg.balance.balance !== undefined ? Number(msg.balance.balance).toFixed(2) : null;
    if (b !== null && balanceBox) balanceBox.innerText = `$ ${b}`;
    appendHistory('Balance updated: ' + (b !== null ? `$${b}` : JSON.stringify(msg.balance)));
    return;
  }

  if (msg.msg_type === 'tick') {
    const quote = msg.tick && msg.tick.quote;
    const epoch = msg.tick && msg.tick.epoch;
    if (quote !== undefined) updateTick(quote, epoch);
    return;
  }

  if (msg.msg_type === 'get_account_status' || msg.get_account_status) {
    if (accountBox && msg.get_account_status) {
      accountBox.innerText = msg.get_account_status.shortcode || msg.get_account_status.country || 'Account';
    }
    return;
  }

  appendHistory('Msg: ' + (msg.msg_type || JSON.stringify(msg)));
}

function updateTick(price, epoch) {
  if (!tickBox) return;
  const s = String(price);
  const display = s.indexOf('.') === -1 ? s + '.0' : s;
  const [intP, decP] = display.split('.');
  const middle = decP.slice(0, -1) || '';
  const last = decP.slice(-1);
  tickBox.innerHTML = `${intP}.${middle}<b style="color:#ffeb3b">${last}</b>`;
  if (tickTime) tickTime.innerText = epoch ? `Updated: ${new Date(epoch*1000).toLocaleTimeString()}` : '';
}

function logout() {
  localStorage.removeItem('auth_token');
  try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch(e){}
  window.location.href = '/kimhubfx/login.html';
}

// expose logout
window.logout = logout;