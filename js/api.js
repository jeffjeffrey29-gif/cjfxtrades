// ============================================================
// CashPrinter — Deriv WebSocket API layer
// Single connection, promise-based calls, pub/sub streams,
// automatic reconnect + resubscribe.
// ============================================================
import { WS_URL, STORE, DEFAULT_APP_ID } from './config.js';

class DerivAPI {
  constructor() {
    this.ws = null;
    this.reqId = 1;
    this.pending = new Map();      // req_id -> {resolve, reject}
    this.tickSubs = new Map();     // symbol -> { id, handlers:Set }
    this.pocHandlers = new Map();  // contract_id -> handler
    this.listeners = { status: new Set(), balance: new Set(), transaction: new Set() };
    this.account = null;           // authorize response
    this.status = 'offline';       // offline | connected | authorized
    this.pipSizes = {};            // symbol -> decimals
    this._keepalive = null;
    this._reconnectDelay = 1000;
    this._wantOpen = false;
  }

  get appId()  { return localStorage.getItem(STORE.appId) || String(DEFAULT_APP_ID); }
  get token()  { return localStorage.getItem(STORE.token) || ''; }

  /** Accounts captured from an OAuth redirect: [{loginid, token, currency}] */
  get accounts() {
    try { return JSON.parse(localStorage.getItem(STORE.accounts) || '[]'); } catch { return []; }
  }
  set accounts(list) { localStorage.setItem(STORE.accounts, JSON.stringify(list)); }

  /** Switch the live session to another stored account. */
  async switchAccount(loginid) {
    const acct = this.accounts.find(a => a.loginid === loginid);
    if (!acct) throw new Error('Unknown account ' + loginid);
    return this.authorize(acct.token);
  }

  on(evt, fn)  { this.listeners[evt]?.add(fn); return () => this.listeners[evt]?.delete(fn); }
  _emit(evt, data) { this.listeners[evt]?.forEach(fn => { try { fn(data); } catch(e){ console.error(e); } }); }

  _setStatus(s) { this.status = s; this._emit('status', s); }

  // ---------------- connection ----------------
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this._wantOpen = true;
    this._setStatus('connecting');
    this.ws = new WebSocket(WS_URL(this.appId));

    this.ws.onopen = async () => {
      this._reconnectDelay = 1000;
      this._setStatus('connected');
      clearInterval(this._keepalive);
      this._keepalive = setInterval(() => this.send({ ping: 1 }).catch(()=>{}), 30000);

      try { await this._loadPips(); } catch(e) { console.warn('pip load failed', e); }

      if (this.token) {
        try { await this.authorize(this.token); } catch(e) { console.warn('auth failed', e.message); }
      }
      // re-arm tick streams after reconnect
      for (const sym of this.tickSubs.keys()) this._subscribeTicks(sym);
    };

    this.ws.onmessage = (ev) => this._route(JSON.parse(ev.data));

    this.ws.onclose = () => {
      clearInterval(this._keepalive);
      this._setStatus('offline');
      this.pending.forEach(p => p.reject(new Error('connection closed')));
      this.pending.clear();
      if (this._wantOpen) {
        setTimeout(() => this.connect(), this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15000);
      }
    };
    this.ws.onerror = () => {};
  }

  disconnect() {
    this._wantOpen = false;
    this.ws?.close();
  }

  // ---------------- request/response ----------------
  send(payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('not connected'));
      const req_id = this.reqId++;
      this.pending.set(req_id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, req_id }));
      setTimeout(() => {
        if (this.pending.has(req_id)) {
          this.pending.delete(req_id);
          reject(new Error('request timeout'));
        }
      }, 20000);
    });
  }

  _route(msg) {
    // resolve pending request
    if (msg.req_id && this.pending.has(msg.req_id)) {
      const p = this.pending.get(msg.req_id);
      this.pending.delete(msg.req_id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      else p.resolve(msg);
      // fall through: subscription first-responses also carry data handled below
    }

    switch (msg.msg_type) {
      case 'tick': {
        const t = msg.tick;
        const sub = this.tickSubs.get(t.symbol);
        if (sub) {
          sub.id = t.id;
          const dec = this.pipSizes[t.symbol] ?? 2;
          const quote = Number(t.quote);
          const digit = Number(quote.toFixed(dec).slice(-1));
          sub.handlers.forEach(fn => fn({ symbol:t.symbol, quote, digit, epoch:t.epoch }));
        }
        break;
      }
      case 'balance':
        this._emit('balance', msg.balance);
        break;
      case 'transaction':
        this._emit('transaction', msg.transaction);
        break;
      case 'proposal_open_contract': {
        const c = msg.proposal_open_contract;
        const h = this.pocHandlers.get(c.contract_id);
        if (h) {
          h(c);
          if (c.is_sold) {
            this.pocHandlers.delete(c.contract_id);
            if (c.subscription?.id) this.send({ forget: c.subscription.id }).catch(()=>{});
          }
        }
        break;
      }
    }
  }

  // ---------------- boot data ----------------
  async _loadPips() {
    const r = await this.send({ active_symbols: 'brief', product_type: 'basic' });
    for (const s of r.active_symbols) {
      const pip = String(s.pip);
      this.pipSizes[s.symbol] = pip.includes('.') ? pip.split('.')[1].length : 0;
    }
  }

  // ---------------- auth / account ----------------
  async authorize(token) {
    const r = await this.send({ authorize: token });
    this.account = r.authorize;
    localStorage.setItem(STORE.token, token);
    this._setStatus('authorized');
    // live balance stream
    this.send({ balance: 1, subscribe: 1 }).catch(()=>{});
    return r.authorize;
  }

  logout() {
    localStorage.removeItem(STORE.token);
    localStorage.removeItem(STORE.accounts);
    this.account = null;
    this.disconnect();
    setTimeout(() => this.connect(), 300);
  }

  get isVirtual() { return !!this.account?.is_virtual; }
  get currency()  { return this.account?.currency || 'USD'; }

  // ---------------- ticks ----------------
  subscribeTicks(symbol, handler) {
    let sub = this.tickSubs.get(symbol);
    if (!sub) {
      sub = { id: null, handlers: new Set() };
      this.tickSubs.set(symbol, sub);
      this._subscribeTicks(symbol);
    }
    sub.handlers.add(handler);
    return () => {
      sub.handlers.delete(handler);
      if (sub.handlers.size === 0) {
        this.tickSubs.delete(symbol);
        if (sub.id) this.send({ forget: sub.id }).catch(()=>{});
      }
    };
  }

  _subscribeTicks(symbol) {
    this.send({ ticks: symbol, subscribe: 1 }).catch(e => console.warn('tick sub', symbol, e.message));
  }

  async tickHistory(symbol, count = 1000) {
    const r = await this.send({ ticks_history: symbol, count, end: 'latest', style: 'ticks' });
    const dec = this.pipSizes[symbol] ?? 2;
    return r.history.prices.map((p, i) => ({
      quote: Number(p),
      digit: Number(Number(p).toFixed(dec).slice(-1)),
      epoch: r.history.times[i],
    }));
  }

  async candles(symbol, granularity = 60, count = 500) {
    const r = await this.send({ ticks_history: symbol, count, end:'latest', style:'candles', granularity });
    return r.candles;
  }

  // ---------------- trading ----------------
  /**
   * Buy a contract. params:
   *  { contract_type, symbol, stake, duration, duration_unit, barrier? }
   * Returns buy response. onUpdate(c) streams proposal_open_contract until sold.
   */
  async buy({ contract_type, symbol, stake, duration = 1, duration_unit = 't', barrier }, onUpdate) {
    const parameters = {
      contract_type,
      symbol,
      amount: Number(stake),
      basis: 'stake',
      currency: this.currency,
      duration: Number(duration),
      duration_unit,
    };
    if (barrier !== undefined && barrier !== null && barrier !== '') parameters.barrier = String(barrier);

    const r = await this.send({ buy: 1, price: Number(stake), parameters });
    const contractId = r.buy.contract_id;

    if (onUpdate) {
      this.pocHandlers.set(contractId, onUpdate);
      this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
        .catch(e => console.warn('poc sub', e.message));
    }
    return r.buy;
  }

  /** Await final result of a contract as a promise. */
  buyAndSettle(params) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.buy(params, (c) => {
          if (c.is_sold) resolve(c);
        });
      } catch (e) { reject(e); }
    });
  }

  async profitTable(limit = 50, offset = 0) {
    const r = await this.send({ profit_table: 1, description: 1, limit, offset, sort: 'DESC' });
    return r.profit_table;
  }

  async statement(limit = 50) {
    const r = await this.send({ statement: 1, description: 1, limit, sort: 'DESC' });
    return r.statement;
  }
}

export const api = new DerivAPI();
