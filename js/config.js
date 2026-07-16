// ============================================================
// CashPrinter — configuration
// ============================================================

// Deriv application ID.
// 1089 is Deriv's public test app_id — fine for development.
// Register your own at api.deriv.com (Dashboard → Register application)
// to route trades through YOUR app and earn markup, then change it in
// Settings (stored in localStorage) or edit the default below.
export const DEFAULT_APP_ID = 1089;

export const WS_URL = (appId) => `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

// Deriv OAuth login page. After login Deriv redirects to the URL
// registered against the app_id, appending acct1/token1/cur1 (+2, +3…)
// query parameters for every account the user holds.
export const OAUTH_URL = (appId) =>
  `https://oauth.deriv.com/oauth2/authorize?app_id=${appId}&l=EN&brand=deriv`;

export const STORE = {
  token:    'cashprinter.token',
  appId:    'cashprinter.appId',
  bots:     'cashprinter.savedBots',
  journal:  'cashprinter.journalOpen',
  accounts: 'cashprinter.accounts',
};

// Synthetic markets offered in CashPrinter (symbol → label, pip decimals)
export const MARKETS = [
  { symbol:'R_10',     label:'Volatility 10 Index'      },
  { symbol:'R_25',     label:'Volatility 25 Index'      },
  { symbol:'R_50',     label:'Volatility 50 Index'      },
  { symbol:'R_75',     label:'Volatility 75 Index'      },
  { symbol:'R_100',    label:'Volatility 100 Index'     },
  { symbol:'1HZ10V',   label:'Volatility 10 (1s) Index' },
  { symbol:'1HZ25V',   label:'Volatility 25 (1s) Index' },
  { symbol:'1HZ50V',   label:'Volatility 50 (1s) Index' },
  { symbol:'1HZ75V',   label:'Volatility 75 (1s) Index' },
  { symbol:'1HZ100V',  label:'Volatility 100 (1s) Index'},
  { symbol:'BOOM500',  label:'Boom 500 Index'           },
  { symbol:'BOOM1000', label:'Boom 1000 Index'          },
  { symbol:'CRASH500', label:'Crash 500 Index'          },
  { symbol:'CRASH1000',label:'Crash 1000 Index'         },
];

export const marketLabel = (sym) =>
  (MARKETS.find(m => m.symbol === sym) || { label: sym }).label;
