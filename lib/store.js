const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const TRADELOG_FILE = path.join(DATA_DIR, "tradelog.json");
const TRADED_FILE = path.join(DATA_DIR, "traded-signals.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  exchange: "bybit",          // "bybit" | "binance"
  apiKey: "",
  apiSecret: "",
  testnet: true,
  autoTrade: false,
  autoScan: false,            // runs the scan loop on the SERVER, independent of any open browser tab
  positionSizeUsdt: 20,
  leverage: 3,
  slPct: 3,
  tpPct: 6,
  maxTradesPerRun: 3,
  topN: 100,
  interval: "15m",
  requireCleanLine: true,
  proxyUrl: "",                // e.g. QuotaGuard Static URL - used ONLY for signed Binance/Bybit requests
  proxyAppliesTo: "binance",   // "binance" | "bybit" | "both" | "none"
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function loadTradeLog() {
  try { return JSON.parse(fs.readFileSync(TRADELOG_FILE, "utf8")); }
  catch (e) { return []; }
}

function saveTradeLog(log) {
  fs.writeFileSync(TRADELOG_FILE, JSON.stringify(log.slice(0, 100), null, 2));
}

function loadTradedSet() {
  try { return new Set(JSON.parse(fs.readFileSync(TRADED_FILE, "utf8"))); }
  catch (e) { return new Set(); }
}

function saveTradedSet(set) {
  fs.writeFileSync(TRADED_FILE, JSON.stringify(Array.from(set)));
}

module.exports = { loadSettings, saveSettings, loadTradeLog, saveTradeLog, loadTradedSet, saveTradedSet, DEFAULT_SETTINGS };
