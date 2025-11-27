// app.js - Deriv analysis engine (complete)
// Drop this file into your repository and include <script src="app.js"></script> on your analysis page.
//
// IMPORTANT:
// - Make sure your analysis HTML has these IDs (recommended):
//   marketSelect (select or input), historySize (input), connectBtn, disconnectBtn, pauseBtn,
//   status, tickBox, tickTime, lastDigit, digitsContainer, totalTicks, history
//
// - If your HTML uses different ids, either rename them in HTML or change the variables below.

(() => {
  // ---------- CONFIG ----------
  const WS_APP_ID = 1089; // default websocket app id (change only if you need)
  const WS_BASE = `wss://ws.binaryws.com/websockets/v3?app_id=${WS_APP_ID}`;
  const DEFAULT_MARKET = 'R_100'; // fallback if no select provided
  const DEFAULT_HISTORY_SIZE = 500;

  // ---------- State ----------
  let ws = null;
  let wsMsgId = 1;
  let subscribedTickId = null;
  let paused = false;
  let connectedMarket = null;

  const ticks = []; // array of { epoch, quote, digit }
  const digitCount = new Array(10).fill(0);

  // ---------- Helpers to query/create DOM elements ----------
  function getId(id) { return document.getElementById(id); }

  function ensureEl(id, tag='div', parent=document.body, attrs={}) {
    let el = getId(id);
    if (!el) {
      el = document.createElement(tag);
      el.id = id;
      Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
      parent.appendChild(el);
    }
    return el;
  }

  // Ensure basic UI elements exist (non-destructive)
  const UI = {
    marketSelect: getId('marketSelect') || ensureEl('marketSelect', 'select', document.body),
    historySize: getId('historySize') || ensureEl('historySize', 'input', document.body, { type:'number', value: DEFAULT_HISTORY_SIZE }),
    connectBtn: getId('connectBtn') || ensureEl('connectBtn', 'button', document.body),
    disconnectBtn: getId('disconnectBtn') || ensureEl('disconnectBtn', 'button', document.body),
    pauseBtn: getId('pauseBtn') || ensureEl('pauseBtn', 'button', document.body),
    status: getId('status') || ensureEl('status','div',document.body),
    tickBox: getId('tickBox') || ensureEl('tickBox','div',document.body),
    tickTime: getId('tickTime') || ensureEl('tickTime','div',document.body),
    lastDigit: getId('lastDigit') || ensureEl('lastDigit','div',document.body),
    digitsContainer: getId('digitsContainer') || ensureEl('digitsContainer','div',document.body),
    totalTicks: getId('totalTicks') || ensureEl('totalTicks','div',document.body),
    history: getId('history') || ensureEl('history','div',document.body),
  };

  // Create reasonable defaults in the markup if they were newly created
  function initDefaultUI() {
    if (UI.marketSelect && UI.marketSelect.tagName === 'SELECT' && UI.marketSelect.options.length === 0) {
      const markets = [
        ['R_10','Volatility 10 (R_10)'],
        ['R_25','Volatility 25 (R_25)'],
        ['R_50','Volatility 50 (R_50)'],
        ['R_75','Volatility 75 (R_75)'],
        ['R_100','Volatility 100 (R_100)'],
        ['R_150','Volatility 150 (R_150)'],
        ['R_200','Volatility 200 (R_200)'],
        ['R_250','Volatility 250 (R_250)'],
        ['R_300','Volatility 300 (R_300)'],
        ['R_500','Volatility 500 (R_500)']
      ];
      markets.forEach(([val,label]) => {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        UI.marketSelect.appendChild(o);
      });
      UI.marketSelect.value = DEFAULT_MARKET;
    }

    // Set placeholder values for inputs/buttons we created
    if (UI.historySize && UI.historySize.tagName === 'INPUT' && !UI.historySize.value) UI.historySize.value = DEFAULT_HISTORY_SIZE;
    if (UI.connectBtn && UI.connectBtn.tagName === 'BUTTON' && !UI.connectBtn.textContent) UI.connectBtn.textContent = 'Connect';
    if (UI.disconnectBtn && UI.disconnectBtn.tagName === 'BUTTON' && !UI.disconnectBtn.textContent) UI.disconnectBtn.textContent = 'Disconnect';
    if (UI.pauseBtn && UI.pauseBtn.tagName === 'BUTTON' && !UI.pauseBtn.textContent) UI.pauseBtn.textContent = 'Pause';
    if (UI.status) UI.status.textContent = 'Status: Disconnected';
    if (UI.tickBox) UI.tickBox.textContent = 'Latest Price: —';
    if (UI.tickTime) UI.tickTime.textContent = '';
    if (UI.lastDigit) UI.lastDigit.textContent = 'Last Digit: —';
    if (UI.totalTicks) UI.totalTicks.textContent = 'Total ticks: 0';
    if (UI.history) UI.history.innerHTML = '';
  }

  // ---------- Digit UI builder ----------
  function buildDigitsUI() {
    const container = UI.digitsContainer;
    container.classList.add('digits-grid');
    container.innerHTML = ''; // reset

    for (let d = 0; d <= 9; d++) {
      const card = document.createElement('div');
      card.className = 'digit-card';
      card.id = `digit-${d}`;

      const num = document.createElement('div');
      num.className = 'digit-num';
      num.textContent = d;

      const pct = document.createElement('div');
      pct.className = 'digit-pct';
      pct.id = `digit-${d}-pct`;
      pct.textContent = '0.00%';

      card.appendChild(num);
      card.appendChild(pct);
      container.appendChild(card);
    }
  }

  // ---------- WebSocket & tick handling ----------
  function logEvent(msg) {
    const h = UI.history;
    if (!h) return;
    const t = new Date();
    const line = document.createElement('div');
    line.textContent = `[${t.toLocaleTimeString()}] ${msg}`;
    h.prepend(line);
    // keep history length reasonable
    while (h.children.length > 200) h.removeChild(h.lastChild);
  }

  function updateStatus(text, cls=null) {
    if (!UI.status) return;
    UI.status.textContent = `Connection: ${text}`;
    UI.status.className = cls || '';
  }

  function updateTickUI(quote, epoch) {
    if (UI.tickBox) UI.tickBox.textContent = quote;
    if (UI.tickTime) UI.tickTime.textContent = (new Date(epoch*1000)).toLocaleTimeString();
  }

  function updateTotals() {
    const total = ticks.length;
    if (UI.totalTicks) UI.totalTicks.textContent = 'Total ticks: ' + total;
  }

  function computeAndRenderDistribution() {
    const total = digitCount.reduce((a,b)=>a+b, 0);
    for (let d=0; d<=9; d++) {
      const pct = total ? (digitCount[d]/total * 100) : 0;
      const pctEl = document.getElementById(`digit-${d}-pct`);
      if (pctEl) {
        pctEl.textContent = pct.toFixed(2) + '%';
      }
      // highlight top maybe
      const card = document.getElementById(`digit-${d}`);
      if (card) {
        card.style.opacity = total ? ( (pct > 0) ? '1' : '0.7') : '0.6';
      }
    }
  }

  function extractLastDigitFromQuote(quote) {
    // quote is a number (float) or string
    if (quote === null || quote === undefined) return null;
    let s = String(quote);
    // remove scientific notation if any
    if (s.indexOf('e') !== -1) {
      s = Number(quote).toString();
    }
    // remove trailing zeros after decimal? keep digits
    // Remove non-digits, then get last character
    const clean = s.replace(/\D/g, '');
    if (!clean) return null;
    return Number(clean[clean.length - 1]);
  }

  function handleNewTick(tick) {
    if (!tick) return;
    // tick may contain 'quote' or 'tick' structure; standard Deriv tick has tick.quote
    const epoch = tick.epoch || (tick.tick && tick.tick.epoch) || Math.floor(Date.now()/1000);
    const quote = (typeof tick.quote !== 'undefined') ? tick.quote : (tick.tick && tick.tick.quote);
    if (quote === undefined) return;
    const lastDigit = extractLastDigitFromQuote(quote);
    if (lastDigit === null || isNaN(lastDigit)) return;

    // push to buffer
    const historySize = Math.max(10, parseInt((UI.historySize && UI.historySize.value) || DEFAULT_HISTORY_SIZE, 10));
    ticks.push({ epoch, quote, digit: lastDigit });
    digitCount[lastDigit]++;

    // trim if too long
    while (ticks.length > historySize) {
      const removed = ticks.shift();
      if (removed && typeof removed.digit === 'number') digitCount[removed.digit] = Math.max(0, digitCount[removed.digit] - 1);
    }

    // Update UI
    updateTickUI(quote, epoch);
    if (UI.lastDigit) UI.lastDigit.textContent = 'Last Digit: ' + lastDigit;
    updateTotals();
    computeAndRenderDistribution();

    // Optionally show small marker in history
    logEvent(`Tick ${quote} → digit ${lastDigit}`);
  }

  function startWebsocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(WS_BASE);
    ws.addEventListener('open', () => {
      updateStatus('Connected', 'connected');
      logEvent('WebSocket opened');
    });
    ws.addEventListener('close', () => {
      updateStatus('Disconnected', 'disconnected');
      logEvent('WebSocket closed');
      ws = null;
    });
    ws.addEventListener('error', (e) => {
      updateStatus('Error', 'error');
      logEvent('WebSocket error');
      console.error('WebSocket error', e);
    });

    ws.addEventListener('message', (evt) => {
      try {
        const data = JSON.parse(evt.data);
        // respond to ping/pong and subscription responses
        if (data.error) {
          logEvent('API error: ' + JSON.stringify(data.error));
          return;
        }
        // Tick from subscription
        if (data.tick) {
          if (!paused) handleNewTick(data.tick);
          return;
        }
        // generic subscribe response includes subscribe id for ticks
        if (data.subscription && data.subscription.id) {
          // we don't rely on this in this implementation
        }
      } catch (err) {
        console.error('msg parse error', err);
      }
    });
  }

  function subscribeToMarket(market) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      startWebsocket();
      // wait for open then subscribe
      const waitOpen = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(waitOpen);
          sendTicksSubscribe(market);
        }
      }, 150);
    } else {
      sendTicksSubscribe(market);
    }
  }

  function sendTicksSubscribe(market) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logEvent('WebSocket not open yet');
      return;
    }
    connectedMarket = market;
    // send subscribe request
    const req = { ticks: market, subscribe: 1, passthrough: { id: wsMsgId++ } };
    ws.send(JSON.stringify(req));
    updateStatus('Subscribed: ' + market);
    logEvent('Subscribed to ' + market);
  }

  function unsubscribeAll() {
    // There's no explicit unsubscribe by id implemented here (Deriv supports forget/unsubscribe by proposal),
    // easiest: close socket and re-open later when subscribing again.
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
      updateStatus('Disconnected');
      connectedMarket = null;
    }
  }

  // ---------- Public controls ----------
  function connect() {
    paused = false;
    const market = (UI.marketSelect && UI.marketSelect.value) || DEFAULT_MARKET;
    const historySizeVal = Math.max(10, parseInt((UI.historySize && UI.historySize.value) || DEFAULT_HISTORY_SIZE, 10));
    // clear previous state
    ticks.length = 0;
    for (let i=0;i<10;i++) digitCount[i]=0;
    buildDigitsUI();
    computeAndRenderDistribution();
    updateTotals();

    startWebsocket();
    setTimeout(() => subscribeToMarket(market), 150);
  }

  function disconnect() {
    unsubscribeAll();
    updateStatus('Disconnected');
    logEvent('Disconnected by user');
  }

  function pause() {
    paused = true;
    updateStatus('Paused');
    logEvent('Paused');
  }

  function resume() {
    paused = false;
    updateStatus(connectedMarket ? ('Subscribed: ' + connectedMarket) : 'Connected (no market)');
    logEvent('Resumed');
  }

  // ---------- Bind UI controls ----------
  function bindUI() {
    if (UI.connectBtn) UI.connectBtn.addEventListener('click', connect);
    if (UI.disconnectBtn) UI.disconnectBtn.addEventListener('click', disconnect);
    if (UI.pauseBtn) UI.pauseBtn.addEventListener('click', () => {
      (paused ? resume() : pause());
      if (UI.pauseBtn) UI.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    });

    // allow pressing Enter on history input to connect
    if (UI.historySize) UI.historySize.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connect();
    });

    // optional: change market to auto-subscribe when connected
    if (UI.marketSelect) UI.marketSelect.addEventListener('change', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // re-subscribe to new market
        connect();
      }
    });
  }

  // ---------- Init ----------
  function init() {
    initDefaultUI();
    buildDigitsUI();
    bindUI();
    computeAndRenderDistribution();
    logEvent('Analysis engine ready');
  }

  // Expose some methods for debug
  window.derivAnalysis = {
    connect,
    disconnect,
    pause,
    resume,
    getState: () => ({ ticks: ticks.length, digitCount: [...digitCount], paused, connectedMarket }),
  };

  // Run
  document.addEventListener('DOMContentLoaded', init);
})();