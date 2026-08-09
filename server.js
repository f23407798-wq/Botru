const express = require("express");
const path = require("path");
const store = require("./lib/store");
const scanner = require("./lib/scanner");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- settings ----------
app.get("/api/settings", (req, res) => {
  const s = store.loadSettings();
  // Mask the secret so it never round-trips back to the browser in full.
  res.json({ ...s, apiSecret: s.apiSecret ? "••••••••" : "" });
});

app.post("/api/settings", (req, res) => {
  const current = store.loadSettings();
  const incoming = req.body || {};
  // If the secret field is the masked placeholder (user didn't touch it), keep the old one.
  if (incoming.apiSecret === "••••••••") incoming.apiSecret = current.apiSecret;
  const merged = { ...current, ...incoming };
  store.saveSettings(merged);
  scanner.applyAutoScanSchedule(merged);
  res.json({ ok: true });
});

app.post("/api/settings/test", async (req, res) => {
  const incoming = req.body || {};
  const current = store.loadSettings();
  if (incoming.apiSecret === "••••••••") incoming.apiSecret = current.apiSecret;
  const testSettings = { ...current, ...incoming };
  try {
    const adapter = scanner.getAdapter(testSettings.exchange);
    const balance = await adapter.getWalletBalance(testSettings, "USDT");
    res.json({ ok: true, balance, mode: testSettings.testnet ? "testnet" : "mainnet" });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---------- scan ----------
app.post("/api/scan", async (req, res) => {
  const settings = store.loadSettings();
  const result = await scanner.runScan(settings);
  res.json(serializeScan(result));
});

app.get("/api/scan/last", (req, res) => {
  res.json(serializeScan(scanner.state));
});

function serializeScan(s) {
  return {
    scanning: s.scanning,
    lastScanAt: s.lastScanAt,
    error: s.error,
    signals: s.signals,
    confirmed: s.confirmed,
    watching: s.watching,
    progressDone: s.progressDone,
    progressTotal: s.progressTotal,
  };
}

// ---------- chart data passthrough (for the browser to draw candles) ----------
app.get("/api/klines", async (req, res) => {
  const settings = store.loadSettings();
  const symbol = req.query.symbol;
  const cached = scanner.state.candleCache[symbol];
  if (cached) return res.json(cached); // reuse the last scan's data — no extra API call
  try {
    const adapter = scanner.getAdapter(settings.exchange);
    const candles = await adapter.fetchKlines(symbol, settings.interval, 500);
    res.json({ candles });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- account ----------
app.get("/api/account", async (req, res) => {
  const settings = store.loadSettings();
  if (!settings.apiKey || !settings.apiSecret) {
    return res.status(400).json({ error: "No API Key/Secret saved yet — open Settings first." });
  }
  try {
    const adapter = scanner.getAdapter(settings.exchange);
    const [balance, positions] = await Promise.all([
      adapter.getWalletBalance(settings, "USDT"),
      adapter.getOpenPositions(settings),
    ]);
    res.json({ exchange: settings.exchange, testnet: settings.testnet, balance, positions });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- trade log ----------
app.get("/api/tradelog", (req, res) => {
  res.json(scanner.tradeLog());
});

// start server-side auto-scan loop if it was left enabled on last run
scanner.applyAutoScanSchedule(store.loadSettings());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scanner running on port ${PORT}`));
