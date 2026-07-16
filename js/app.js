// ============================================================
// CashPrinter — application shell: router, pages, global UI
// ============================================================
import { api } from './api.js';
import { runner, BUILTIN_BOTS } from './engine.js';
import { DigitStats } from './digits.js';
import { MARKETS, marketLabel, STORE, DEFAULT_APP_ID, OAUTH_URL } from './config.js';

const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const view = $('#view');
const fmt = (n, d=2) => Number(n).toFixed(d);

let pageCleanup = null;   // teardown fn for current page

/* ============================================================
   GLOBAL UI — toasts & journal
============================================================ */
function toast(msg, kind='info', ms=3500) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function jlog(msg, level='info') {
  const body = $('#journalBody');
  const line = document.createElement('div');
  line.className = 'j-line';
  const time = new Date().toLocaleTimeString('en-GB');
  line.innerHTML = `<span class="j-time">${time}</span><span class="j-msg ${level}"></span>`;
  line.lastChild.textContent = msg;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  while (body.children.length > 400) body.firstChild.remove();
}

$('#journalHead').addEventListener('click', () => {
  const j = $('#journal');
  j.classList.toggle('collapsed');
  $('#journalToggle').textContent = j.classList.contains('collapsed') ? '▴' : '▾';
  localStorage.setItem(STORE.journal, j.classList.contains('collapsed') ? '0' : '1');
});
if (localStorage.getItem(STORE.journal) === '0') {
  $('#journal').classList.add('collapsed');
  $('#journalToggle').textContent = '▴';
}

/* ============================================================
   TOP BAR — connection, balance, login
============================================================ */
api.on('status', (s) => {
  const badge = $('#connBadge');
  badge.classList.toggle('on', s === 'connected');
  badge.classList.toggle('auth', s === 'authorized');
  $('#connText').textContent = s;
  if (s === 'authorized') {
    const a = api.account;
    $('#acctTag').textContent = a.is_virtual ? 'demo' : 'real';
    $('#acctTag').className = 'acct-tag ' + (a.is_virtual ? 'demo' : 'real');
    $('#balAmount').textContent = fmt(a.balance);
    $('#balCurrency').textContent = a.currency;
    $('#loginBtn').textContent = 'Log out';
    jlog(`Authorized as ${a.loginid} (${a.is_virtual ? 'DEMO' : 'REAL'})`, 'info');
    if (!a.is_virtual) toast('You are on a REAL money account. Test on demo first.', 'warn', 6000);
  } else {
    $('#loginBtn').textContent = 'Log in';
    if (s === 'offline') { $('#balAmount').textContent = '—'; $('#balCurrency').textContent=''; $('#acctTag').textContent=''; }
  }
});

api.on('balance', (b) => {
  $('#balAmount').textContent = fmt(b.balance);
  $('#balCurrency').textContent = b.currency;
});

$('#loginBtn').addEventListener('click', () => {
  if (api.account) {
    if (runner.state === 'running') return toast('Stop the running bot before logging out.', 'warn');
    api.logout(); toast('Logged out.');
  } else {
    $('#loginModal').hidden = false;
    $('#tokenInput').focus();
  }
});
$('#loginCancel').addEventListener('click', () => $('#loginModal').hidden = true);

/* ---- OAuth: redirect to Deriv's login page ---- */
$('#oauthBtn').addEventListener('click', () => {
  location.href = OAUTH_URL(api.appId);
});

/* ---- OAuth: parse redirect callback (?acct1=..&token1=..&cur1=..&acct2=..) ---- */
function consumeOAuthCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.get('token1')) return null;
  const accounts = [];
  for (let i = 1; q.get(`token${i}`); i++) {
    accounts.push({
      loginid:  q.get(`acct${i}`),
      token:    q.get(`token${i}`),
      currency: q.get(`cur${i}`) || '',
    });
  }
  history.replaceState(null, '', location.pathname + location.hash);
  return accounts;
}

/* ---- account switcher ---- */
function renderAcctSwitch() {
  const sel = $('#acctSwitch');
  const accts = api.accounts;
  if (accts.length < 2) { sel.hidden = true; return; }
  sel.hidden = false;
  sel.innerHTML = accts.map(a => {
    const isDemo = /^VRT/i.test(a.loginid);
    return `<option value="${a.loginid}" ${api.account?.loginid === a.loginid ? 'selected' : ''}>
      ${a.loginid} ${a.currency ? '· ' + a.currency : ''}${isDemo ? ' (demo)' : ''}</option>`;
  }).join('');
}

$('#acctSwitch').addEventListener('change', async (e) => {
  if (runner.state === 'running') {
    toast('Stop the running bot before switching accounts.', 'warn');
    renderAcctSwitch();
    return;
  }
  try {
    await api.switchAccount(e.target.value);
    toast(`Switched to ${api.account.loginid}`, 'win');
    route();
  } catch (err) { toast('Switch failed: ' + err.message, 'loss'); }
});

$('#loginConfirm').addEventListener('click', async () => {
  const token = $('#tokenInput').value.trim();
  if (!token) return;
  try {
    if (api.status === 'offline') { api.connect(); await waitFor(() => api.status !== 'offline' && api.status !== 'connecting', 8000); }
    await api.authorize(token);
    $('#loginModal').hidden = true;
    $('#tokenInput').value = '';
    toast(`Connected — ${api.account.loginid}`, 'win');
  } catch (e) {
    toast('Login failed: ' + e.message, 'loss', 5000);
  }
});

const waitFor = (cond, ms) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (cond()) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); }
  }, 100);
});

/* ============================================================
   RUNNER STRIP — global bot status
============================================================ */
function refreshRunnerStrip() {
  const strip = $('#runnerStrip');
  if (!runner.bot) { strip.hidden = true; return; }
  strip.hidden = false;
  $('#runnerName').textContent = runner.bot.name;
  const live = runner.state === 'running';
  $('#runnerStatus').textContent = live ? 'live' : 'idle';
  $('#runnerStatus').classList.toggle('live', live);
  const s = runner.stats;
  $('#rsRuns').textContent = s.runs;
  $('#rsWon').textContent = s.won;
  $('#rsLost').textContent = s.lost;
  $('#rsStake').textContent = s.stake != null ? fmt(s.stake) : '—';
  const pl = $('#rsPL');
  pl.textContent = fmt(s.profit);
  pl.className = s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : '';
  const btn = $('#runnerToggle');
  btn.textContent = live ? 'Stop' : 'Run';
  btn.className = 'btn btn-sm ' + (live ? 'btn-stop' : 'btn-run');
}

$('#runnerToggle').addEventListener('click', async () => {
  try {
    if (runner.state === 'running') runner.stop();
    else await runner.start();
  } catch (e) { toast(e.message, 'warn'); }
});

runner.on((ev) => {
  if (ev.type === 'log') jlog(ev.data.msg, ev.data.level);
  if (ev.type === 'trade') {
    toast(ev.data.won ? `Won +${fmt(ev.data.profit)}` : `Lost ${fmt(ev.data.profit)}`, ev.data.won ? 'win' : 'loss', 2200);
  }
  if (ev.type === 'stop') toast(`Bot stopped · session P/L ${fmt(runner.stats.profit)} ${api.currency}`, runner.stats.profit >= 0 ? 'win' : 'loss', 5000);
  refreshRunnerStrip();
});

/* ============================================================
   SHARED WIDGET BUILDERS
============================================================ */
const marketSelect = (id, selected='R_100') => `
  <label class="field"><span>Market</span>
    <select id="${id}">
      ${MARKETS.map(m => `<option value="${m.symbol}" ${m.symbol===selected?'selected':''}>${m.label}</option>`).join('')}
    </select>
  </label>`;

function digitWheelHTML(id) {
  return `<div class="digit-row" id="${id}">
    ${Array.from({length:10}, (_,d) => `
      <div class="digit-cell" data-d="${d}">
        <div class="d">${d}</div>
        <div class="p">—</div>
        <div class="bar"><i style="width:0%"></i></div>
      </div>`).join('')}
  </div>`;
}

function renderDigitWheel(el, stats) {
  const dist = stats.distribution();
  const counts = dist.map(x => x.count);
  const hot = counts.indexOf(Math.max(...counts));
  const cold = counts.indexOf(Math.min(...counts));
  const cur = stats.current;
  $$('.digit-cell', el).forEach(cell => {
    const d = Number(cell.dataset.d);
    cell.querySelector('.p').textContent = fmt(dist[d].pct, 1) + '%';
    cell.querySelector('.bar i').style.width = Math.min(100, dist[d].pct * 6) + '%';
    cell.classList.toggle('hot', d === hot);
    cell.classList.toggle('cold', d === cold);
    cell.classList.toggle('current', d === cur);
  });
}

const splitBar = (id, aLabel, bLabel) => `
  <div class="split">
    <div class="split-label"><span>${aLabel} <b data-a>—</b></span><span>${bLabel} <b data-b>—</b></span></div>
    <div class="split-bar" id="${id}">
      <div class="split-a" style="width:50%">50%</div>
      <div class="split-b" style="width:50%">50%</div>
    </div>
  </div>`;

function renderSplit(el, aPct, bPct, aCount, bCount) {
  const bar = $(`#${el}`);
  const wrap = bar.closest('.split');
  const a = bar.children[0], b = bar.children[1];
  a.style.width = Math.max(aPct, 6) + '%'; a.textContent = fmt(aPct,1)+'%';
  b.style.width = Math.max(bPct, 6) + '%'; b.textContent = fmt(bPct,1)+'%';
  wrap.querySelector('[data-a]').textContent = aCount;
  wrap.querySelector('[data-b]').textContent = bCount;
}

function chipsHTML(digits, testFn, aChar, bChar) {
  return digits.map(d => {
    const isA = testFn(d);
    return `<span class="chip ${isA?'a':'b'}">${isA?aChar:bChar}</span>`;
  }).join('');
}

/* ============================================================
   PAGES
============================================================ */
const pages = {

  /* ---------------- DASHBOARD ---------------- */
  dashboard() {
    const name = api.account ? api.account.loginid : 'trader';
    view.innerHTML = `
      <div class="hero">
        <div class="strap">// the trend is your friend — until it ends</div>
        <h1>Hello ${name} 👋</h1>
        <p class="muted">Your Deriv terminal for synthetic indices — analysis, one-click digit trading and automated strategies, all from one place.</p>
        <div class="quick">
          <a href="#bots"><div class="q-title">🤖 Trading Bots</div><div class="q-desc">Load a built-in strategy or build your own, then run it live.</div></a>
          <a href="#bulk"><div class="q-title">⚡ Bulk Trader</div><div class="q-desc">One-click digit contracts with a live probability wheel.</div></a>
          <a href="#analysis"><div class="q-title">📊 Analysis Tool</div><div class="q-desc">Live digit distribution, even/odd, over/under, match/differ.</div></a>
          <a href="#charts"><div class="q-title">📈 Charts</div><div class="q-desc">Live tick charts for every synthetic index.</div></a>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h2>Your bots</h2>
          <div id="dashBots" class="muted">No saved bots yet — create one in <a href="#bots" style="color:var(--amber)">Trading Bots</a>.</div>
        </div>
        <div class="panel">
          <h2>Recent trades</h2>
          <div id="dashTrades" class="muted">${api.account ? 'Loading…' : 'Log in to see your trade history.'}</div>
        </div>
      </div>`;

    // saved bots
    const saved = loadSavedBots();
    if (saved.length) {
      $('#dashBots').innerHTML = `<table class="data"><thead><tr><th>Bot</th><th>Market</th><th>Type</th><th></th></tr></thead>
        <tbody>${saved.map(b => `<tr>
          <td>${esc(b.name)}</td><td>${b.config.symbol}</td><td>${b.config.contract_type}</td>
          <td><button class="btn btn-sm btn-ghost" data-load="${b.id}">Load</button></td>
        </tr>`).join('')}</tbody></table>`;
      $$('#dashBots [data-load]').forEach(btn => btn.addEventListener('click', () => {
        const bot = saved.find(x => x.id === btn.dataset.load);
        try { runner.load(bot); refreshRunnerStrip(); toast(`Loaded "${bot.name}" — press Run in the strip above.`, 'win'); }
        catch(e){ toast(e.message,'warn'); }
      }));
    }

    // recent trades
    if (api.account) {
      api.profitTable(8).then(pt => {
        const rows = pt.transactions || [];
        $('#dashTrades').innerHTML = rows.length
          ? `<table class="data"><thead><tr><th>Contract</th><th>Buy</th><th>P/L</th></tr></thead>
             <tbody>${rows.map(r => {
               const pl = r.sell_price - r.buy_price;
               return `<tr><td>${esc(r.shortcode?.split('_')[0] || '—')}</td><td>${fmt(r.buy_price)}</td>
                 <td class="${pl>=0?'pos':'neg'}">${pl>=0?'+':''}${fmt(pl)}</td></tr>`;
             }).join('')}</tbody></table>`
          : '<span class="muted">No trades yet.</span>';
      }).catch(()=>{});
    }
  },

  /* ---------------- CHARTS ---------------- */
  charts() {
    view.innerHTML = `
      <div class="page-title">Charts</div>
      <div class="page-sub">Live tick stream. Area chart of the last 1,000 ticks, updating in real time.</div>
      <div class="panel panel-flush">
        <div class="chart-toolbar" style="padding:16px 18px 0;">
          ${marketSelect('chartMarket')}
          <div class="field" style="min-width:140px;"><span>Live quote</span>
            <div class="bigtick" id="chartQuote" style="font-size:22px; text-align:left; margin:0;">—</div>
          </div>
        </div>
        <div id="chartHost"></div>
      </div>`;

    let unsub = null, chart = null, series = null, disposed = false;

    const boot = async () => {
      await loadLightweightCharts();
      if (disposed) return;
      const host = $('#chartHost');
      chart = LightweightCharts.createChart(host, {
        layout: { background: { color: '#141b24' }, textColor: '#8b98a9' },
        grid: { vertLines: { color: '#1e2937' }, horzLines: { color: '#1e2937' } },
        timeScale: { timeVisible: true, secondsVisible: true, borderColor:'#263242' },
        rightPriceScale: { borderColor:'#263242' },
      });
      series = chart.addAreaSeries({
        lineColor: '#f2b135', topColor: 'rgba(242,177,53,.25)', bottomColor: 'rgba(242,177,53,0)',
        lineWidth: 2, priceLineVisible: true,
      });
      const ro = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
      ro.observe(host);

      const attach = async (sym) => {
        unsub?.();
        try {
          const hist = await api.tickHistory(sym, 1000);
          series.setData(hist.map(h => ({ time: h.epoch, value: h.quote })));
          chart.timeScale().scrollToRealTime();
        } catch(e){ toast('History failed: '+e.message,'warn'); }
        unsub = api.subscribeTicks(sym, t => {
          series.update({ time: t.epoch, value: t.quote });
          $('#chartQuote') && ($('#chartQuote').textContent = t.quote);
        });
      };
      await attach($('#chartMarket').value);
      $('#chartMarket').addEventListener('change', e => attach(e.target.value));
    };

    if (api.status === 'offline') api.connect();
    waitFor(() => api.status === 'connected' || api.status === 'authorized', 10000)
      .then(boot).catch(() => toast('Could not reach Deriv. Check your connection.', 'loss'));

    return () => { disposed = true; unsub?.(); chart?.remove(); };
  },

  /* ---------------- ANALYSIS ---------------- */
  analysis() {
    view.innerHTML = `
      <div class="page-title">Analysis Tool</div>
      <div class="page-sub">Rolling digit statistics computed from the live tick stream.</div>

      <div class="panel">
        <div class="field-row" style="max-width:640px;">
          ${marketSelect('anMarket', 'R_10')}
          <label class="field"><span>Ticks window</span><input type="number" id="anWindow" value="50" min="20" max="5000"></label>
          <label class="field"><span>O/U · M/D barrier</span>
            <select id="anBarrier">${Array.from({length:10},(_,i)=>`<option ${i===5?'selected':''}>${i}</option>`).join('')}</select>
          </label>
        </div>
        <div class="bigtick" id="anQuote">—</div>
        <div class="bigtick-label">current tick · <span id="anCount">0</span> ticks in window</div>
        ${digitWheelHTML('anWheel')}
      </div>

      <div class="grid grid-3" style="margin-top:16px;">
        <div class="panel"><h2>Even / Odd</h2>${splitBar('anEO','Even','Odd')}
          <div class="chips" id="anEOchips"></div></div>
        <div class="panel"><h2>Over / Under <span class="tick-badge" id="anOUb"></span></h2>${splitBar('anOU','Over','Under')}
          <div class="chips" id="anOUchips"></div></div>
        <div class="panel"><h2>Matches / Differs <span class="tick-badge" id="anMDb"></span></h2>${splitBar('anMD','Differs','Matches')}
          <div class="chips" id="anMDchips"></div></div>
      </div>`;

    const stats = new DigitStats(Number($('#anWindow').value));
    let unsub = null;

    const paint = () => {
      if (!stats.count) return;
      $('#anQuote').textContent = stats.lastQuote ?? '—';
      $('#anCount').textContent = stats.count;
      renderDigitWheel($('#anWheel'), stats);
      const b = Number($('#anBarrier').value);
      $('#anOUb').textContent = 'vs ' + b; $('#anMDb').textContent = 'digit ' + b;

      const eo = stats.evenOdd();
      renderSplit('anEO', eo.evenPct, eo.oddPct, eo.even, eo.odd);
      $('#anEOchips').innerHTML = chipsHTML(stats.recent(14), d => d%2===0, 'E','O');

      const ou = stats.overUnder(b);
      renderSplit('anOU', ou.overPct, ou.underPct, ou.over, ou.under);
      $('#anOUchips').innerHTML = chipsHTML(stats.recent(14), d => d>b, 'O','U');

      const md = stats.matchDiffer(b);
      renderSplit('anMD', md.differPct, md.matchPct, md.differ, md.match);
      $('#anMDchips').innerHTML = chipsHTML(stats.recent(14), d => d!==b, 'D','M');
    };

    const attach = async () => {
      unsub?.();
      const sym = $('#anMarket').value;
      stats.windowSize = Number($('#anWindow').value);
      stats.digits = [];
      try { stats.seed(await api.tickHistory(sym, stats.windowSize)); paint(); } catch(e){}
      unsub = api.subscribeTicks(sym, t => { stats.push(t); paint(); });
    };

    if (api.status === 'offline') api.connect();
    waitFor(() => api.status === 'connected' || api.status === 'authorized', 10000)
      .then(attach).catch(() => toast('Could not reach Deriv.', 'loss'));

    $('#anMarket').addEventListener('change', attach);
    $('#anWindow').addEventListener('change', attach);
    $('#anBarrier').addEventListener('change', paint);

    return () => unsub?.();
  },

  /* ---------------- BULK TRADER ---------------- */
  bulk() {
    view.innerHTML = `
      <div class="page-title">Bulk Trader</div>
      <div class="page-sub">One-click digit contracts with live probabilities. Contracts settle after your chosen tick duration.</div>

      <div class="panel">
        <div class="field-row">
          ${marketSelect('btMarket')}
          <label class="field"><span>Trade type</span>
            <select id="btType">
              <option value="overunder">Over / Under</option>
              <option value="evenodd">Even / Odd</option>
              <option value="matchdiffer">Matches / Differs</option>
              <option value="risefall">Rise / Fall</option>
            </select></label>
          <label class="field"><span>Stats window (ticks)</span><input type="number" id="btWindow" value="1000" min="50" max="5000"></label>
          <label class="field" id="btPredWrap"><span>Prediction</span>
            <select id="btPred">${Array.from({length:10},(_,i)=>`<option ${i===5?'selected':''}>${i}</option>`).join('')}</select></label>
        </div>

        <div class="bigtick" id="btQuote">—</div>
        <div class="bigtick-label">current tick</div>
        ${digitWheelHTML('btWheel')}
        <div class="chips" id="btChips" style="justify-content:center;"></div>

        <div class="field-row" style="margin-top:18px;">
          <label class="field"><span>Duration (ticks)</span><input type="number" id="btTicks" value="1" min="1" max="10"></label>
          <label class="field"><span>Stake (${api.currency||'USD'})</span><input type="number" id="btStake" value="0.5" min="0.35" step="0.01"></label>
          <label class="field"><span>No. of trades</span><input type="number" id="btCount" value="1" min="1" max="20"></label>
        </div>

        <div style="display:flex; gap:14px; margin-top:6px;">
          <button class="btn btn-buy-over" id="btBuyA">—</button>
          <button class="btn btn-buy-under" id="btBuyB">—</button>
        </div>
        <p class="hint" style="margin-top:10px;">Percentages are historical frequencies in your stats window — on synthetic indices every tick is independent, so treat them as description, not prediction.</p>
      </div>`;

    const stats = new DigitStats(1000);
    let unsub = null;

    const typeSpec = () => {
      const b = Number($('#btPred').value);
      switch ($('#btType').value) {
        case 'evenodd':   return { a:{label:'Even', ct:'DIGITEVEN'}, b:{label:'Odd', ct:'DIGITODD'}, pred:false,
                                   pct:() => { const s=stats.evenOdd(); return [s.evenPct, s.oddPct]; },
                                   chips:[d=>d%2===0,'E','O'] };
        case 'matchdiffer':return { a:{label:'Differs', ct:'DIGITDIFF', barrier:b}, b:{label:'Matches', ct:'DIGITMATCH', barrier:b}, pred:true,
                                   pct:() => { const s=stats.matchDiffer(b); return [s.differPct, s.matchPct]; },
                                   chips:[d=>d!==b,'D','M'] };
        case 'risefall':  return { a:{label:'Rise', ct:'CALL'}, b:{label:'Fall', ct:'PUT'}, pred:false,
                                   pct:() => [null,null], chips:null };
        default:          return { a:{label:'Over', ct:'DIGITOVER', barrier:b}, b:{label:'Under', ct:'DIGITUNDER', barrier:b}, pred:true,
                                   pct:() => { const s=stats.overUnder(b); return [s.overPct, s.underPct]; },
                                   chips:[d=>d>b,'O','U'] };
      }
    };

    const paint = () => {
      $('#btQuote').textContent = stats.lastQuote ?? '—';
      renderDigitWheel($('#btWheel'), stats);
      const spec = typeSpec();
      $('#btPredWrap').style.visibility = spec.pred ? 'visible' : 'hidden';
      const [pa, pb] = spec.pct();
      $('#btBuyA').textContent = spec.a.label + (pa!=null ? ` · ${fmt(pa,1)}%` : '');
      $('#btBuyB').textContent = spec.b.label + (pb!=null ? ` · ${fmt(pb,1)}%` : '');
      $('#btChips').innerHTML = spec.chips ? chipsHTML(stats.recent(10), ...spec.chips) : '';
    };

    const attach = async () => {
      unsub?.();
      const sym = $('#btMarket').value;
      stats.windowSize = Number($('#btWindow').value);
      stats.digits = [];
      try { stats.seed(await api.tickHistory(sym, stats.windowSize)); paint(); } catch(e){}
      unsub = api.subscribeTicks(sym, t => { stats.push(t); paint(); });
    };

    if (api.status === 'offline') api.connect();
    waitFor(() => api.status === 'connected' || api.status === 'authorized', 10000)
      .then(attach).catch(() => toast('Could not reach Deriv.', 'loss'));

    $('#btMarket').addEventListener('change', attach);
    $('#btWindow').addEventListener('change', attach);
    $('#btType').addEventListener('change', paint);
    $('#btPred').addEventListener('change', paint);

    const fire = async (side) => {
      if (!api.account) return toast('Log in first.', 'warn');
      const spec = typeSpec()[side];
      const n = Math.min(20, Math.max(1, Number($('#btCount').value)));
      const stake = Number($('#btStake').value);
      const params = {
        contract_type: spec.ct, symbol: $('#btMarket').value, stake,
        duration: Number($('#btTicks').value), duration_unit: 't',
        barrier: spec.barrier,
      };
      jlog(`Bulk: ${n}× ${spec.ct}${spec.barrier!=null?' '+spec.barrier:''} @ ${fmt(stake)}`, 'info');
      let total = 0;
      for (let i = 0; i < n; i++) {
        try {
          const c = await api.buyAndSettle(params);
          const p = Number(c.profit);
          total += p;
          jlog(`  #${i+1} ${p>=0?'WON +':'LOST '}${fmt(p)}`, p>=0?'win':'loss');
        } catch (e) { jlog('  buy failed: '+e.message, 'warn'); break; }
      }
      toast(`Bulk done · ${n} trades · P/L ${total>=0?'+':''}${fmt(total)} ${api.currency}`, total>=0?'win':'loss', 5000);
    };
    $('#btBuyA').addEventListener('click', () => fire('a'));
    $('#btBuyB').addEventListener('click', () => fire('b'));

    return () => unsub?.();
  },

  /* ---------------- TRADING BOTS ---------------- */
  bots() {
    const saved = loadSavedBots();
    view.innerHTML = `
      <div class="page-title">Trading Bots</div>
      <div class="page-sub">Load a strategy into the runner, tune it, and run. Every bot has a target profit and stop-loss — keep them.</div>

      <div class="grid grid-3" id="botGrid">
        ${[...BUILTIN_BOTS, ...saved].map(b => `
          <div class="bot-card">
            <div class="tag">${saved.includes(b) ? 'custom' : 'cashprinter'}</div>
            <h3>${esc(b.name)}</h3>
            <p>${esc(b.blurb || 'Custom strategy.')}</p>
            <div class="bot-meta">
              <span>${marketLabel(b.config.symbol)}</span>
              <span>${b.config.contract_type}</span>
              <span>stake ${b.config.stake}</span>
              <span>${b.config.recovery === 'none' ? 'flat' : b.config.recovery + ' ×' + b.config.multiplier}</span>
              <span>TP ${b.config.targetProfit} / SL ${b.config.stopLoss}</span>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-primary btn-sm" style="flex:1" data-loadbot="${b.id}">Load bot</button>
              ${saved.includes(b) ? `<button class="btn btn-ghost btn-sm" data-delbot="${b.id}">✕</button>` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="panel" style="margin-top:20px;">
        <h2>Build your own</h2>
        <div class="grid grid-4">
          <label class="field"><span>Bot name</span><input id="nbName" placeholder="My strategy"></label>
          ${marketSelect('nbMarket')}
          <label class="field"><span>Contract</span>
            <select id="nbType">
              <option value="DIGITOVER">Digit Over</option><option value="DIGITUNDER">Digit Under</option>
              <option value="DIGITEVEN">Digit Even</option><option value="DIGITODD">Digit Odd</option>
              <option value="DIGITDIFF">Digit Differs</option><option value="DIGITMATCH">Digit Matches</option>
              <option value="CALL">Rise</option><option value="PUT">Fall</option>
            </select></label>
          <label class="field"><span>Barrier / digit</span>
            <select id="nbBarrier"><option value="">n/a</option>${Array.from({length:10},(_,i)=>`<option>${i}</option>`).join('')}<option value="auto-cold">auto (coldest)</option></select></label>
          <label class="field"><span>Stake</span><input type="number" id="nbStake" value="0.5" min="0.35" step="0.01"></label>
          <label class="field"><span>Duration (ticks)</span><input type="number" id="nbDur" value="1" min="1" max="10"></label>
          <label class="field"><span>Recovery</span>
            <select id="nbRec"><option value="none">None (flat)</option><option value="martingale">Martingale</option><option value="step">Fixed step</option></select></label>
          <label class="field"><span>Multiplier / step</span><input type="number" id="nbMult" value="2" min="1" step="0.1"></label>
          <label class="field"><span>Target profit</span><input type="number" id="nbTP" value="5" min="0" step="0.5"></label>
          <label class="field"><span>Stop loss</span><input type="number" id="nbSL" value="5" min="0" step="0.5"></label>
          <label class="field"><span>Max loss streak</span><input type="number" id="nbStreak" value="0" min="0" title="0 = disabled"></label>
          <label class="field"><span>Entry filter</span>
            <select id="nbEntry"><option value="none">Every tick</option><option value="parity-streak-4">After 4-parity streak (fade)</option></select></label>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-primary" id="nbSave">Save & load bot</button>
        </div>
        <p class="hint" style="margin-top:10px;">Recovery sizing (martingale) grows stakes geometrically after losses — a 10-loss streak at ×2 from 0.50 needs a 512.00 stake and 511.50 drawdown. The max-loss-streak brake exists for a reason.</p>
      </div>`;

    $$('[data-loadbot]').forEach(btn => btn.addEventListener('click', () => {
      const all = [...BUILTIN_BOTS, ...loadSavedBots()];
      const bot = all.find(b => b.id === btn.dataset.loadbot);
      try {
        runner.load(bot);
        refreshRunnerStrip();
        toast(`Loaded "${bot.name}" — press Run in the strip above.`, 'win');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) { toast(e.message, 'warn'); }
    }));

    $$('[data-delbot]').forEach(btn => btn.addEventListener('click', () => {
      saveSavedBots(loadSavedBots().filter(b => b.id !== btn.dataset.delbot));
      pages.bots();
    }));

    $('#nbSave').addEventListener('click', () => {
      const name = $('#nbName').value.trim() || 'Custom bot';
      const bot = {
        id: 'u-' + Date.now(),
        name,
        blurb: 'Custom strategy built in CashPrinter.',
        config: {
          symbol: $('#nbMarket').value,
          contract_type: $('#nbType').value,
          barrier: $('#nbBarrier').value,
          stake: Number($('#nbStake').value),
          duration: Number($('#nbDur').value),
          recovery: $('#nbRec').value,
          multiplier: Number($('#nbMult').value),
          targetProfit: Number($('#nbTP').value),
          stopLoss: Number($('#nbSL').value),
          maxLossStreak: Number($('#nbStreak').value) || 0,
          entry: $('#nbEntry').value,
        },
      };
      const saved2 = loadSavedBots(); saved2.push(bot); saveSavedBots(saved2);
      try { runner.load(bot); refreshRunnerStrip(); } catch(e){}
      toast(`Saved "${name}"`, 'win');
      pages.bots();
    });
  },

  /* ---------------- REPORTS ---------------- */
  reports() {
    view.innerHTML = `
      <div class="page-title">Reports</div>
      <div class="page-sub">Profit table from your Deriv account.</div>
      <div class="panel panel-flush">
        <h2 style="padding:16px 18px;">Trade history <span class="tick-badge" id="repTotal"></span></h2>
        <div id="repBody" style="padding:0 0 8px;">${api.account ? 'Loading…' : '<p style="padding:0 18px 16px" class="muted">Log in to load your history.</p>'}</div>
      </div>`;

    if (!api.account) return;
    api.profitTable(100).then(pt => {
      const rows = pt.transactions || [];
      let total = 0;
      $('#repBody').innerHTML = rows.length ? `
        <table class="data">
          <thead><tr><th>Time</th><th>Contract</th><th>Buy</th><th>Sell</th><th>P/L</th></tr></thead>
          <tbody>${rows.map(r => {
            const pl = r.sell_price - r.buy_price; total += pl;
            return `<tr>
              <td>${new Date(r.purchase_time*1000).toLocaleString('en-GB')}</td>
              <td title="${esc(r.longcode||'')}">${esc((r.shortcode||'').split('_').slice(0,2).join(' '))}</td>
              <td>${fmt(r.buy_price)}</td><td>${fmt(r.sell_price)}</td>
              <td class="${pl>=0?'pos':'neg'}">${pl>=0?'+':''}${fmt(pl)}</td></tr>`;
          }).join('')}</tbody>
        </table>` : '<p style="padding:0 18px 16px" class="muted">No trades found.</p>';
      const tt = $('#repTotal');
      tt.textContent = `Σ ${total>=0?'+':''}${fmt(total)} ${api.currency}`;
      tt.style.color = total >= 0 ? 'var(--gain)' : 'var(--loss)';
    }).catch(e => $('#repBody').innerHTML = `<p style="padding:0 18px 16px" class="muted">Failed: ${esc(e.message)}</p>`);
  },

  /* ---------------- RISK CALC ---------------- */
  risk() {
    view.innerHTML = `
      <div class="page-title">Risk Calculator</div>
      <div class="page-sub">Position sizing and the real cost of recovery ladders.</div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Stake sizing</h2>
          <div class="field-row">
            <label class="field"><span>Account balance</span><input type="number" id="rcBal" value="${api.account ? fmt(api.account.balance) : 100}"></label>
            <label class="field"><span>Risk per session %</span><input type="number" id="rcRisk" value="2" min="0.1" step="0.1"></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Payout % (approx)</span><input type="number" id="rcPayout" value="95" min="1"></label>
            <label class="field"><span>Trades per session</span><input type="number" id="rcTrades" value="20" min="1"></label>
          </div>
          <div id="rcOut" class="hint" style="font-size:13px; line-height:1.9;"></div>
        </div>
        <div class="panel">
          <h2>Martingale ladder</h2>
          <div class="field-row">
            <label class="field"><span>Base stake</span><input type="number" id="mlStake" value="0.5" step="0.01"></label>
            <label class="field"><span>Multiplier</span><input type="number" id="mlMult" value="2" step="0.1"></label>
            <label class="field"><span>Steps</span><input type="number" id="mlSteps" value="10" min="1" max="15"></label>
          </div>
          <div id="mlOut"></div>
        </div>
      </div>`;

    const calc = () => {
      const bal = Number($('#rcBal').value), risk = Number($('#rcRisk').value);
      const trades = Number($('#rcTrades').value);
      const budget = bal * risk / 100;
      $('#rcOut').innerHTML = `
        Session risk budget: <b>${fmt(budget)}</b><br>
        Flat stake for ${trades} trades: <b>${fmt(Math.max(0.35, budget/trades))}</b><br>
        Suggested stop-loss: <b>${fmt(budget)}</b> · target profit: <b>${fmt(budget*0.6)}</b> (0.6R)`;
      const s0 = Number($('#mlStake').value), m = Number($('#mlMult').value), n = Number($('#mlSteps').value);
      let cum = 0, rows = '';
      for (let i = 0; i < n; i++) {
        const st = s0 * Math.pow(m, i); cum += st;
        rows += `<tr><td>${i+1}</td><td>${fmt(st)}</td><td class="neg">${fmt(cum)}</td></tr>`;
      }
      $('#mlOut').innerHTML = `<table class="data"><thead><tr><th>Loss #</th><th>Next stake</th><th>Cumulative drawdown</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    $$('#view input').forEach(i => i.addEventListener('input', calc));
    calc();
  },

  /* ---------------- SETTINGS ---------------- */
  settings() {
    view.innerHTML = `
      <div class="page-title">Settings</div>
      <div class="page-sub">Connection and application settings. Everything is stored locally in your browser.</div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Deriv application</h2>
          <label class="field"><span>App ID</span><input type="text" id="stAppId" value="${api.appId}" autocomplete="off"></label>
          <p class="hint">Default <b>${DEFAULT_APP_ID}</b> is Deriv's public test app — <b>token login works with it, but OAuth login requires your own app ID</b> whose redirect URL points at this site. Register at
            <b>api.deriv.com → Dashboard → Register application</b> to route trades through the CashPrinter app ID and earn markup on your own platform. Changing this reconnects the socket.</p>
          <button class="btn btn-primary btn-sm" id="stSaveApp">Save app ID</button>
        </div>
        <div class="panel">
          <h2>Session</h2>
          <p class="hint" style="margin-bottom:12px;">
            Status: <b>${api.status}</b><br>
            Account: <b>${api.account ? `${api.account.loginid} (${api.account.is_virtual?'demo':'real'})` : 'not logged in'}</b><br>
            Currency: <b>${api.currency}</b>
          </p>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-ghost btn-sm" id="stClearToken">Forget saved token</button>
            <button class="btn btn-ghost btn-sm" id="stClearBots">Delete saved bots</button>
          </div>
        </div>
      </div>`;

    $('#stSaveApp').addEventListener('click', () => {
      const id = ($('#stAppId').value || String(DEFAULT_APP_ID)).trim();
      localStorage.setItem(STORE.appId, id);
      toast('App ID saved — reconnecting…', 'win');
      api.disconnect(); setTimeout(() => api.connect(), 400);
    });
    $('#stClearToken').addEventListener('click', () => {
      localStorage.removeItem(STORE.token); toast('Token forgotten.');
    });
    $('#stClearBots').addEventListener('click', () => {
      localStorage.removeItem(STORE.bots); toast('Saved bots deleted.');
    });
  },
};

/* ============================================================
   HELPERS
============================================================ */
function loadSavedBots() {
  try { return JSON.parse(localStorage.getItem(STORE.bots) || '[]'); } catch { return []; }
}
function saveSavedBots(list) { localStorage.setItem(STORE.bots, JSON.stringify(list)); }
function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let lwcPromise = null;
function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve();
  if (lwcPromise) return lwcPromise;
  lwcPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
    s.onload = res; s.onerror = () => rej(new Error('chart library failed to load'));
    document.head.appendChild(s);
  });
  return lwcPromise;
}

/* ============================================================
   ROUTER
============================================================ */
function route() {
  const hash = (location.hash || '#dashboard').slice(1);
  const page = pages[hash] ? hash : 'dashboard';
  pageCleanup?.(); pageCleanup = null;
  $$('#mainnav a').forEach(a => a.classList.toggle('active', a.dataset.route === page));
  const ret = pages[page]();
  if (typeof ret === 'function') pageCleanup = ret;
}
window.addEventListener('hashchange', route);

/* ============================================================
   BOOT
============================================================ */
const oauthAccounts = consumeOAuthCallback();
if (oauthAccounts) {
  api.accounts = oauthAccounts;
  const preferred = oauthAccounts.find(a => /^VRT/i.test(a.loginid)) || oauthAccounts[0];
  localStorage.setItem(STORE.token, preferred.token);
  jlog(`OAuth login: ${oauthAccounts.length} account(s) received — starting on ${preferred.loginid}`, 'info');
}

api.connect();
api.on('status', s => {
  if (s === 'authorized') {
    renderAcctSwitch();
    if ((location.hash || '#dashboard') === '#dashboard') route();
  }
});
jlog('CashPrinter terminal booted. Connecting to Deriv…', 'info');
route();
refreshRunnerStrip();
