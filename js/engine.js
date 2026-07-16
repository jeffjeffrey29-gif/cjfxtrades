// ============================================================
// CashPrinter — bot engine
// A bot = config object. The engine runs a sequential loop:
// (optional entry filter) → buy → await settlement → recovery
// sizing → target-profit / stop-loss checks → repeat.
// ============================================================
import { api } from './api.js';
import { DigitStats } from './digits.js';

export const BUILTIN_BOTS = [
  {
    id: 'cp-over2',
    name: 'CP Over 2 Steady',
    blurb: 'Buys DIGIT OVER 2 (7 winning digits per tick). Flat staking with hard stop-loss and target profit. The conservative baseline bot.',
    config: { contract_type:'DIGITOVER', symbol:'R_100', barrier:2, stake:0.5, duration:1,
              recovery:'none', multiplier:1, targetProfit:5, stopLoss:5, entry:'none' },
  },
  {
    id: 'cp-under7',
    name: 'CP Under 7 Steady',
    blurb: 'Mirror of Over 2: buys DIGIT UNDER 7. Flat stake, disciplined exits. Good for demo benchmarking against Over 2.',
    config: { contract_type:'DIGITUNDER', symbol:'R_100', barrier:7, stake:0.5, duration:1,
              recovery:'none', multiplier:1, targetProfit:5, stopLoss:5, entry:'none' },
  },
  {
    id: 'cp-differ',
    name: 'CP Differs Sniper',
    blurb: 'Buys DIGIT DIFFERS against the coldest digit in the live window — a ~90% payout-probability contract with proportionally small payouts. Optional recovery sizing.',
    config: { contract_type:'DIGITDIFF', symbol:'R_100', barrier:'auto-cold', stake:0.5, duration:1,
              recovery:'martingale', multiplier:11, targetProfit:3, stopLoss:10, entry:'none' },
  },
  {
    id: 'cp-evenodd',
    name: 'CP Even/Odd Recovery',
    blurb: 'Trades DIGIT EVEN with martingale recovery after losses. This is the classic "premium bot" recipe sold on clone sites — run it on demo and watch the drawdown math for yourself.',
    config: { contract_type:'DIGITEVEN', symbol:'R_100', barrier:'', stake:0.35, duration:1,
              recovery:'martingale', multiplier:2.1, targetProfit:5, stopLoss:15, entry:'none' },
  },
  {
    id: 'cp-riseflat',
    name: 'CP Rise 5-Tick',
    blurb: 'Simple RISE (CALL) contract over 5 ticks, flat staking. A momentum coin-flip on volatility indices — use it to learn the runner, not to retire.',
    config: { contract_type:'CALL', symbol:'R_75', barrier:'', stake:0.5, duration:5,
              recovery:'none', multiplier:1, targetProfit:5, stopLoss:5, entry:'none' },
  },
  {
    id: 'cp-streak',
    name: 'CP Streak Fader',
    blurb: 'Waits for a run of 4+ same-parity digits, then buys the opposite parity. Entry-filtered version of Even/Odd — fewer trades, same underlying odds.',
    config: { contract_type:'DIGITODD', symbol:'R_100', barrier:'', stake:0.5, duration:1,
              recovery:'none', multiplier:1, targetProfit:5, stopLoss:5, entry:'parity-streak-4' },
  },
];

const NEEDS_BARRIER = new Set(['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF']);

export class BotRunner {
  constructor() {
    this.state = 'idle';       // idle | running | stopping
    this.bot = null;
    this.stats = this._freshStats();
    this.listeners = new Set();
    this._digitStats = null;
    this._unsubTicks = null;
  }

  _freshStats() {
    return { runs:0, won:0, lost:0, profit:0, stake:null, streakLoss:0, startedAt:null };
  }

  on(fn){ this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, data){ this.listeners.forEach(fn => fn({ type, data, runner:this })); }

  load(bot) {
    if (this.state === 'running') throw new Error('Stop the current bot first.');
    this.bot = JSON.parse(JSON.stringify(bot));
    this.stats = this._freshStats();
    this.stats.stake = Number(this.bot.config.stake);
    this._emit('loaded', bot);
  }

  async start() {
    if (!this.bot) throw new Error('No bot loaded.');
    if (this.state === 'running') return;
    if (!api.account) throw new Error('Log in before running a bot.');

    const cfg = this.bot.config;
    this.state = 'running';
    this.stats = this._freshStats();
    this.stats.stake = Number(cfg.stake);
    this.stats.startedAt = Date.now();
    this._emit('start');
    this._emit('log', { level:'info', msg:`▶ ${this.bot.name} started on ${cfg.symbol} · stake ${cfg.stake} ${api.currency}` });

    // live digit window for entry filters / auto barriers
    this._digitStats = new DigitStats(200);
    try { this._digitStats.seed(await api.tickHistory(cfg.symbol, 200)); } catch(e){}
    this._unsubTicks = api.subscribeTicks(cfg.symbol, t => this._digitStats.push(t));

    this._loop();
  }

  stop(reason = 'stopped by user') {
    if (this.state !== 'running') return;
    this.state = 'stopping';
    this._emit('log', { level:'warn', msg:`■ stopping — ${reason}` });
  }

  _teardown() {
    this.state = 'idle';
    this._unsubTicks?.(); this._unsubTicks = null;
    this._emit('stop', this.stats);
  }

  async _loop() {
    const cfg = this.bot.config;
    while (this.state === 'running') {
      try {
        // ---- entry filter ----
        const ok = await this._waitEntry(cfg);
        if (!ok) break; // stopped while waiting

        // ---- resolve barrier ----
        let barrier = cfg.barrier;
        if (barrier === 'auto-cold') {
          const dist = this._digitStats.distribution();
          barrier = dist.indexOf(dist.reduce((a,b) => (b.count < a.count ? b : a)));
        }

        // ---- buy & settle ----
        const stake = Math.max(0.35, Number(this.stats.stake.toFixed(2)));
        this._emit('log', { level:'info',
          msg:`○ buy ${cfg.contract_type}${NEEDS_BARRIER.has(cfg.contract_type) ? ' '+barrier : ''} · stake ${stake.toFixed(2)}` });

        const result = await api.buyAndSettle({
          contract_type: cfg.contract_type,
          symbol: cfg.symbol,
          stake,
          duration: cfg.duration || 1,
          duration_unit: 't',
          barrier: NEEDS_BARRIER.has(cfg.contract_type) ? barrier : undefined,
        });

        const profit = Number(result.profit);
        this.stats.runs++;
        this.stats.profit += profit;
        const won = profit >= 0;

        if (won) {
          this.stats.won++;
          this.stats.streakLoss = 0;
          this.stats.stake = Number(cfg.stake);               // reset after win
          this._emit('log', { level:'win',  msg:`✔ WON  +${profit.toFixed(2)} · total ${this.stats.profit.toFixed(2)}` });
        } else {
          this.stats.lost++;
          this.stats.streakLoss++;
          if (cfg.recovery === 'martingale') {
            this.stats.stake = this.stats.stake * Number(cfg.multiplier || 2);
          } else if (cfg.recovery === 'step') {
            this.stats.stake = this.stats.stake + Number(cfg.stepAmount ?? cfg.stake);
          }
          this._emit('log', { level:'loss', msg:`✘ LOST ${profit.toFixed(2)} · total ${this.stats.profit.toFixed(2)}${cfg.recovery!=='none' ? ' · next stake '+this.stats.stake.toFixed(2) : ''}` });
        }
        this._emit('trade', { result, won, profit });

        // ---- exit rules ----
        if (cfg.targetProfit && this.stats.profit >= Number(cfg.targetProfit)) {
          this._emit('log', { level:'win', msg:`🎯 Target profit hit: ${this.stats.profit.toFixed(2)} ${api.currency}` });
          break;
        }
        if (cfg.stopLoss && this.stats.profit <= -Math.abs(Number(cfg.stopLoss))) {
          this._emit('log', { level:'loss', msg:`🛑 Stop-loss hit: ${this.stats.profit.toFixed(2)} ${api.currency}` });
          break;
        }
        if (cfg.maxLossStreak && this.stats.streakLoss >= Number(cfg.maxLossStreak)) {
          this._emit('log', { level:'warn', msg:`⚠ Max loss streak (${cfg.maxLossStreak}) reached` });
          break;
        }

        await sleep(600); // pacing between contracts
      } catch (e) {
        this._emit('log', { level:'warn', msg:`API error: ${e.message} — pausing 3s` });
        await sleep(3000);
        if (/authoriz|token|InvalidToken/i.test(e.message)) break;
      }
    }
    this._teardown();
  }

  async _waitEntry(cfg) {
    if (!cfg.entry || cfg.entry === 'none') return true;

    if (cfg.entry === 'parity-streak-4') {
      // wait for 4+ consecutive digits of same parity; then trade opposite
      this._emit('log', { level:'info', msg:'… waiting for 4-digit parity streak' });
      while (this.state === 'running') {
        const r = this._digitStats.recent(4);
        if (r.length === 4) {
          const parities = r.map(d => d % 2);
          if (parities.every(p => p === parities[0])) {
            // trade the opposite parity of the streak
            this.bot.config.contract_type = parities[0] === 0 ? 'DIGITODD' : 'DIGITEVEN';
            return true;
          }
        }
        await sleep(250);
      }
      return false;
    }
    return true;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const runner = new BotRunner();
