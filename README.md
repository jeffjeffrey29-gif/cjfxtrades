# CashPrinter — Deriv Trading Terminal

A single-page web platform for Deriv synthetic indices: live charts, digit analysis, one-click bulk trading, and an automated strategy runner. Pure static files (vanilla ES modules, no build step, no backend) — the browser talks directly to the Deriv WebSocket API, so the identical folder runs on a local desktop, a VPS, or any static web host.

## Quick start (local desktop)

ES modules require a web server (opening index.html via file:// will not work).

```bash
cd cashprinter
python3 -m http.server 8080
# open http://localhost:8080
```

Any static server works: `npx serve`, VS Code Live Server, etc.

Then:
1. Click **Log in** and paste a Deriv API token.
   Create one at **app.deriv.com → Settings → API token** with the **Read**, **Trade** and **Trading information** scopes. Start with a token from your **demo** account.
2. Balance appears top-right, tagged `demo` or `real`.

## Deploy on a VPS (nginx)

```bash
sudo apt install nginx
sudo mkdir -p /var/www/cashprinter
sudo cp -r cashprinter/* /var/www/cashprinter/
```

`/etc/nginx/sites-available/cashprinter`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/cashprinter;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cashprinter /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS (required for a public site — tokens travel through this page):
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Deploy as hosted web (zero server)

The folder deploys as-is to GitHub Pages, Cloudflare Pages, Netlify or Vercel — drag-and-drop or `git push`. No environment variables needed.

## Your own Deriv app ID (branding + markup)

CashPrinter ships with Deriv's public test app ID (1089). To make it *your* platform:

1. Go to **api.deriv.com → Dashboard → Register application**.
2. Name it `CashPrinter`, set your site URL, choose scopes (read, trade, trading information), and optionally set **markup** (a percentage added to contract prices that Deriv pays out to you — this is how sites like the one you cloned earn).
3. Put the new app ID into **Settings → App ID** inside CashPrinter (stored in localStorage), or change `DEFAULT_APP_ID` in `js/config.js`.

## Architecture

```
index.html          shell: topbar, runner strip, journal, modal
css/style.css       design system (graphite/amber terminal)
js/config.js        app id, markets, storage keys
js/api.js           Deriv WS layer: auth, ticks, buy/settle, reports, auto-reconnect
js/digits.js        rolling digit statistics engine
js/engine.js        bot runner: entry filters, recovery sizing, TP/SL + built-in bots
js/app.js           hash router + 8 pages + global UI
```

## Pages

| Page | What it does |
|---|---|
| Dashboard | Account greeting, quick actions, saved bots, recent trades |
| Charts | Live area tick chart (last 1,000 ticks, streaming) |
| Analysis | Digit wheel, Even/Odd, Over/Under, Matches/Differs on a rolling window |
| Bulk Trader | One-click digit contracts with live frequencies and multi-trade fire |
| Trading Bots | 6 built-in strategies + custom bot builder; global runner strip + journal |
| Reports | Profit table pulled from the account |
| Risk Calc | Session stake sizing + martingale drawdown ladder |
| Settings | App ID, token/session management |

## Honest notes

- Synthetic indices are random-walk instruments; the displayed percentages are historical frequencies, not predictive edges. The built-in bots are for learning the runner and benchmarking on demo.
- Martingale recovery grows stakes geometrically. The Risk Calc page shows the exact drawdown ladder — look at it before running any recovery bot on a real account.
- Tokens are stored only in the browser's localStorage. On a public deployment, serve over HTTPS only.

## Roadmap (Phase 2)

- Blockly visual bot builder + Deriv XML import/export (compatible with DBot files)
- Candle charts with indicators
- Copy-trading via Deriv's copy_start API
- PWA install (manifest + service worker, same pattern as PRM Missioners)

## OAuth login ("Log in with your Deriv account")

The login modal's primary button sends the user to Deriv's official login page. After they sign in, Deriv redirects back with every account (demo + real) as query parameters; CashPrinter stores them, starts on the **demo** account by default, and shows an account switcher in the top bar.

**Important:** Deriv redirects to the URL registered against your **app_id** — so OAuth only round-trips once you have your own app:

1. **api.deriv.com → Dashboard → Register application** — name `CashPrinter`, scopes read/trade/trading information.
2. Set the **redirect URL** to where CashPrinter is served (e.g. `https://yourdomain.com` — use your VPS/hosted URL; for local development keep using the API-token method under "Advanced").
3. Enter the new app ID in **Settings → App ID**.

Until then, the "Advanced: API token" option in the same modal works with the default test app ID.
