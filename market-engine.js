// market-engine.js
// Lightweight event emitter + deriv websocket tick engine for digits distribution

(function(global){
  const APP_ID = 1089; // public readonly app id for tick streaming (no token)
  const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

  // small event emitter
  function E(){ this.handlers = {}; }
  E.prototype.on = function(k,h){ (this.handlers[k]||(this.handlers[k]=[])).push(h); };
  E.prototype.emit = function(k,p){ (this.handlers[k]||[]).forEach(h=>{ try{h(p);}catch(e){console.error(e);} }); };

  // markets list (volatilities)
  const MARKETS = [
    { id: 'R_10', label: 'Volatility 10 (R_10)' },
    { id: 'R_25', label: 'Volatility 25 (R_25)' },
    { id: 'R_50', label: 'Volatility 50 (R_50)' },
    { id: 'R_75', label: 'Volatility 75 (R_75)' },
    { id: 'R_100', label: 'Volatility 100 (R_100)' }
  ];

  // core engine
  function Engine(){
    E.call(this);
    this.ws = null;
    this.connected = false;
    this.subscribed = false;
    this.ticks = []; // store objects {price, epoch, digit}
    this.stats = {
      latestPrice: null,
      lastDigit: null,
      totalTicks: 0,
      digitsCount: Array(10).fill(0),
      digitsPct: Array(10).fill(0),
      evenPct: 0,
      oddPct: 0
    };
    this.currentMarket = MARKETS[0].id;
    this.historySize = 500;
    this._manualClose = false;
  }
  Engine.prototype = Object.create(E.prototype);

  Engine.prototype.getMarketList = function(){ return MARKETS.slice(); };

  Engine.prototype.connect = function({market, historySize}){
    this.currentMarket = market || this.currentMarket;
    this.historySize = historySize || this.historySize;
    this._manualClose = false;

    if(this.ws){
      try{ this.ws.close(); }catch(e){}
      this.ws = null;
    }

    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.connected = true;
      this.emit('connected');
      this._subscribeTicks();
    };
    this.ws.onerror = (e) => {
      console.error('WS error', e);
      this.emit('error', e);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.subscribed = false;
      this.emit('disconnected');
      // if not manual close, try reconnect after delay
      if(!this._manualClose){
        setTimeout(()=> this.connect({market:this.currentMarket, historySize:this.historySize}), 3000);
      }
    };
    this.ws.onmessage = (m) => this._handleMessage(m.data);
  };

  Engine.prototype.disconnect = function(){
    this._manualClose = true;
    if(this.ws) try{ this.ws.close(); }catch(e){}
    this.ws = null;
    this.connected = false;
    this.subscribed = false;
    this.emit('disconnected');
  };

  Engine.prototype.isConnected = function(){ return !!(this.connected && this.ws && this.ws.readyState===1); };

  Engine.prototype._send = function(obj){
    if(!this.ws || this.ws.readyState !== 1) return;
    try{ this.ws.send(JSON.stringify(obj)); }catch(e){ console.error('send err', e); }
  };

  Engine.prototype._subscribeTicks = function(){
    // request ticks subscription
    if(!this.ws) return;
    this.subscribed = true;
    this._send({ ticks: this.currentMarket, subscribe:1 });
    // also fetch last ticks history (optional) - we can fetch last 100 by 'ticks_history'
    this._send({ ticks_history: this.currentMarket, count: Math.min(1000, this.historySize), adjust_start_time:1 });
  };

  Engine.prototype._handleMessage = function(raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.msg_type === 'tick'){
      const price = parseFloat(msg.tick?.quote);
      const epoch = msg.tick?.epoch;
      const lastDigit = Engine._extractDigit(price);
      const rec = { price, epoch, digit: lastDigit };
      this._pushTick(rec);
      this.emit('tick', rec);
    } else if(msg.msg_type === 'history'){
      // ticks_history returns array of ticks
      const hist = (msg.history && msg.history.prices) || [];
      hist.forEach(p => {
        // history.prices are floats - map to recs with synthetic epoch if not provided
        const digit = Engine._extractDigit(p);
        this._pushTick({ price: parseFloat(p), epoch: Date.now()/1000, digit });
      });
      this.emit('stats', this.getStats());
    } else if(msg.msg_type === 'proposal'){
      // ignore
    } else if(msg.error){
      console.warn('Deriv error', msg.error);
    }
    // update stats after handling
    this._recomputeStats();
  };

  Engine._extractDigit = function(price){
    // price might be float; last digit is last decimal digit before fractional? Use Math.floor(price)%10
    // For R_100 indices price is float like 5399.494 - last digit is last char after decimal? Deriv 'last digit' uses last integer after decimal *?*
    // We'll use Math.floor(price) % 10 which matches many index last-digit semantics
    try {
      const floored = Math.floor(price);
      return Math.abs(floored) % 10;
    } catch(e){ return null; }
  };

  Engine.prototype._pushTick = function(rec){
    this.ticks.push(rec);
    if(this.ticks.length > this.historySize) this.ticks.splice(0, this.ticks.length - this.historySize);
    // increment total ticks count (for UI)
    this.stats.totalTicks = this.stats.totalTicks + 1;
  };

  Engine.prototype._recomputeStats = function(){
    const s = { ...this.stats };
    s.digitsCount = Array(10).fill(0);
    s.totalTicks = this.ticks.length;
    s.latestPrice = (this.ticks.length>0) ? this.ticks[this.ticks.length-1].price : null;
    s.lastDigit = (this.ticks.length>0) ? this.ticks[this.ticks.length-1].digit : null;

    this.ticks.forEach(t => { if(typeof t.digit === 'number') s.digitsCount[t.digit]++; });

    s.digitsPct = s.digitsCount.map(c => s.totalTicks ? (c / s.totalTicks * 100) : 0);
    const evenCount = s.digitsCount.reduce((acc, c, i)=> acc + ((i%2===0)?c:0), 0);
    const oddCount = s.totalTicks - evenCount;
    s.evenPct = s.totalTicks ? (evenCount / s.totalTicks * 100) : 0;
    s.oddPct = s.totalTicks ? (oddCount / s.totalTicks * 100) : 0;

    // write back
    this.stats = s;
    this.emit('stats', this.getStats());
  };

  Engine.prototype.getStats = function(){
    return {
      latestPrice: this.stats.latestPrice,
      lastDigit: this.stats.lastDigit,
      totalTicks: this.stats.totalTicks,
      digitsCount: (this.stats.digitsCount || Array(10).fill(0)),
      digitsPct: (this.stats.digitsPct || Array(10).fill(0)),
      evenPct: this.stats.evenPct || 0,
      oddPct: this.stats.oddPct || 0
    };
  };

  // expose the engine
  const e = new Engine();
  global.marketEngine = e;

})(window);
