// ============================================================
// CashPrinter — digit statistics engine
// Maintains a rolling window of last digits for a symbol and
// computes distribution / even-odd / over-under / match-differ.
// ============================================================

export class DigitStats {
  constructor(windowSize = 1000) {
    this.windowSize = windowSize;
    this.digits = [];           // rolling window, newest last
    this.lastQuote = null;
  }

  seed(history) {               // history: [{quote, digit}]
    this.digits = history.map(h => h.digit).slice(-this.windowSize);
    if (history.length) this.lastQuote = history[history.length - 1].quote;
  }

  push(tick) {                  // {quote, digit}
    this.digits.push(tick.digit);
    if (this.digits.length > this.windowSize) this.digits.shift();
    this.lastQuote = tick.quote;
  }

  get count() { return this.digits.length; }
  get current() { return this.digits[this.digits.length - 1]; }

  distribution() {
    const c = Array(10).fill(0);
    for (const d of this.digits) c[d]++;
    const n = this.digits.length || 1;
    return c.map(x => ({ count: x, pct: (100 * x / n) }));
  }

  evenOdd() {
    let even = 0;
    for (const d of this.digits) if (d % 2 === 0) even++;
    const n = this.digits.length || 1;
    return { even, odd: n - even, evenPct: 100*even/n, oddPct: 100*(n-even)/n };
  }

  overUnder(barrier) {
    let over = 0, under = 0, equal = 0;
    for (const d of this.digits) {
      if (d > barrier) over++;
      else if (d < barrier) under++;
      else equal++;
    }
    const n = this.digits.length || 1;
    return { over, under, equal, overPct:100*over/n, underPct:100*under/n, equalPct:100*equal/n };
  }

  matchDiffer(target) {
    let match = 0;
    for (const d of this.digits) if (d === target) match++;
    const n = this.digits.length || 1;
    return { match, differ: n - match, matchPct: 100*match/n, differPct: 100*(n-match)/n };
  }

  recent(n = 10) { return this.digits.slice(-n); }
}
