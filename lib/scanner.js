const { analyzeSymbol, calcEMA, calcRSI, roundToStep } = require("./analysis");
const bybit = require("./exchanges/bybit");
const binance = require("./exchanges/binance");
const store = require("./store");

function getAdapter(exchange) {
  return exchange === "binance" ? binance : bybit;
}

// In-memory state, shared across requests (single-process server).
const state = {
  scanning: false,
  lastScanAt: null,
  signals: [],
  confirmed: [],
  watching: [],
  candleCache: {}, // symbol -> {candles, ema20, ema50}
  error: null,
  progressDone: 0,
  progressTotal: 0,
};

let tradeLog = store.loadTradeLog();
let tradedSignals = store.loadTradedSet();

function logTrade(symbol, level, message) {
  tradeLog.unshift({ time: Date.now(), symbol, level, message });
  tradeLog = tradeLog.slice(0, 100);
  store.saveTradeLog(tradeLog);
}

async function runPool(items, worker, concurrency, onProgress) {
  let idx = 0, completed = 0;
  const results = new Array(items.length);
  async function next() {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await worker(items[my]); } catch (e) { results[my] = null; }
      completed++;
      if (onProgress) onProgress(completed, items.length);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, next);
  await Promise.all(workers);
  return results;
}

async function runScan(settings) {
  if (state.scanning) return state; // avoid overlapping scans
  state.scanning = true;
  state.error = null;
  const adapter = getAdapter(settings.exchange);
  try {
    state.candleCache = {};
    const top = await adapter.fetchTopSymbols(settings.topN);
    state.progressDone = 0;
    state.progressTotal = top.length;
    const results = await runPool(top, async (t) => {
      const candles = await adapter.fetchKlines(t.symbol, settings.interval, 500);
      if (candles.length < 60) return null;
      const closes = candles.map(c => c.close);
      const ema20 = calcEMA(closes, 20);
      const ema50 = calcEMA(closes, 50);
      state.candleCache[t.symbol] = { candles, ema20, ema50 };
      const setups = analyzeSymbol(candles, settings.requireCleanLine);
      if (!setups.length) return null;
      const last = setups[setups.length - 1];
      return { symbol: t.symbol, price: parseFloat(t.lastPrice), volume: parseFloat(t.quoteVolume), ...last };
    }, 6, (done, total) => { state.progressDone = done; state.progressTotal = total; });

    const valid = results.filter(Boolean);
    state.signals = valid.filter(v => v.status === "TRIGGERED").sort((a, b) => b.entryTime - a.entryTime);
    state.confirmed = valid.filter(v => v.status === "CONFIRMED").sort((a, b) => b.fibTouchTime - a.fibTouchTime);
    state.watching = valid.filter(v => v.status === "ARMED").sort((a, b) => b.r3Time - a.r3Time);
    state.lastScanAt = Date.now();

    await autoTradeIfEnabled(settings, state.signals);
  } catch (e) {
    state.error = e.message || "Scan failed";
  } finally {
    state.scanning = false;
  }
  return state;
}

async function autoTradeIfEnabled(settings, newSignals) {
  if (!settings.autoTrade) return;
  if (!settings.apiKey || !settings.apiSecret) {
    logTrade(null, "SKIPPED", "Auto-Trade is ON but API Key/Secret not set — open Settings.");
    return;
  }
  const adapter = getAdapter(settings.exchange);
  let placed = 0;
  for (const s of newSignals) {
    if (placed >= settings.maxTradesPerRun) break;
    const key = settings.exchange + "|" + s.symbol + "|" + s.entryTime;
    if (tradedSignals.has(key)) continue;
    tradedSignals.add(key);
    store.saveTradedSet(tradedSignals);
    try {
      await placeAutoTrade(settings, adapter, s);
      placed++;
    } catch (e) {
      logTrade(s.symbol, "ERROR", e.message);
    }
  }
}

async function placeAutoTrade(settings, adapter, s) {
  logTrade(s.symbol, "INFO", `New SELL signal on ${settings.exchange} — entry ${s.entryPrice}. Placing order…`);
  const info = await adapter.fetchInstrumentInfo(s.symbol);
  const rawQty = (settings.positionSizeUsdt * settings.leverage) / s.entryPrice;
  const qty = roundToStep(rawQty, info.qtyStep);
  if (qty < info.minOrderQty) {
    logTrade(s.symbol, "SKIPPED", `Computed qty ${qty} is below min order qty ${info.minOrderQty}. Increase position size or leverage in Settings.`);
    return;
  }
  await adapter.setLeverage(settings, s.symbol, settings.leverage);
  const stopLoss = s.entryPrice * (1 + settings.slPct / 100);
  const takeProfit = s.entryPrice * (1 - settings.tpPct / 100);
  const result = await adapter.placeShortOrder(settings, { symbol: s.symbol, qty, takeProfit, stopLoss });
  logTrade(s.symbol, "PLACED", `SELL ${qty} @ ~${s.entryPrice} · SL ${stopLoss.toFixed(6)} · TP ${takeProfit.toFixed(6)} · Order ID ${result.orderId || "-"}${settings.testnet ? " (TESTNET)" : ""}`);
}

// ---- server-side auto-scan scheduler (keeps working even with no browser open) ----
// Always re-reads settings fresh from disk on every tick, so changes made in
// the Settings page take effect on the next run without needing a restart.
let autoScanTimer = null;
function applyAutoScanSchedule(settings) {
  if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; }
  if (settings.autoScan) {
    runScan(store.loadSettings()); // kick off immediately
    autoScanTimer = setInterval(() => runScan(store.loadSettings()), 5 * 60 * 1000);
  }
}

module.exports = { getAdapter, runScan, state, tradeLog: () => tradeLog, applyAutoScanSchedule };
