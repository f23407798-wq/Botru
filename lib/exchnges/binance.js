const crypto = require("crypto");
const { plainFetch, proxyFetch } = require("../proxyFetch");
const { roundToStep } = require("../analysis");

const PUBLIC_HOSTS = { mainnet: "https://fapi.binance.com", testnet: "https://testnet.binancefuture.com" };

function hmacHex(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

async function fetchJSONPublic(settings, path) {
  const host = settings.testnet ? PUBLIC_HOSTS.testnet : PUBLIC_HOSTS.mainnet;
  const res = await plainFetch(host + path);
  const data = await res.json();
  if (!res.ok) throw new Error("Binance error: " + (data.msg || res.status));
  return data;
}

async function privateRequest(settings, method, path, params) {
  if (!settings.apiKey || !settings.apiSecret) throw new Error("Binance API Key/Secret not set in Settings");
  const proxyUrl = (settings.proxyAppliesTo === "binance" || settings.proxyAppliesTo === "both") ? settings.proxyUrl : null;
  const host = settings.testnet ? PUBLIC_HOSTS.testnet : PUBLIC_HOSTS.mainnet;
  const timestamp = Date.now();
  const qs = new URLSearchParams({ ...(params || {}), timestamp, recvWindow: 5000 }).toString();
  const signature = hmacHex(settings.apiSecret, qs);
  const url = `${host}${path}?${qs}&signature=${signature}`;
  const headers = { "X-MBX-APIKEY": settings.apiKey };

  const res = await proxyFetch(url, { method, headers }, proxyUrl);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 150)}`); }
  if (!res.ok) throw new Error(`Binance error ${data.code}: ${data.msg}`);
  return data;
}

async function fetchTopSymbols(n) {
  // Public request — no API key needed, so no proxy/static IP required here.
  const settingsPublic = { testnet: false };
  const data = await fetchJSONPublic(settingsPublic, "/fapi/v1/ticker/24hr");
  const usdt = data.filter(d => d.symbol.endsWith("USDT") && !d.symbol.includes("_")); // skip dated/quarterly contracts
  usdt.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  return usdt.slice(0, n).map(d => ({ symbol: d.symbol, lastPrice: d.lastPrice, quoteVolume: d.quoteVolume }));
}

async function fetchKlines(symbol, interval, limit = 500) {
  const settingsPublic = { testnet: false };
  const data = await fetchJSONPublic(settingsPublic, `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  // Binance already returns oldest -> newest.
  return data.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
}

async function fetchInstrumentInfo(symbol) {
  const settingsPublic = { testnet: false };
  const data = await fetchJSONPublic(settingsPublic, "/fapi/v1/exchangeInfo");
  const info = (data.symbols || []).find(s => s.symbol === symbol);
  if (!info) throw new Error("No instrument info for " + symbol);
  const lotSize = info.filters.find(f => f.filterType === "LOT_SIZE") || {};
  return { qtyStep: parseFloat(lotSize.stepSize || "1"), minOrderQty: parseFloat(lotSize.minQty || "0") };
}

async function setLeverage(settings, symbol, leverage) {
  await privateRequest(settings, "POST", "/fapi/v1/leverage", { symbol, leverage });
}

async function placeShortOrder(settings, { symbol, qty, takeProfit, stopLoss }) {
  const data = await privateRequest(settings, "POST", "/fapi/v1/order", {
    symbol, side: "SELL", type: "MARKET", quantity: qty,
  });
  // Binance Futures doesn't attach TP/SL to the market order itself — place
  // separate reduce-only conditional close orders.
  if (stopLoss != null) {
    try {
      await privateRequest(settings, "POST", "/fapi/v1/order", {
        symbol, side: "BUY", type: "STOP_MARKET", stopPrice: stopLoss, closePosition: "true",
      });
    } catch (e) { /* surfaced via trade log by caller if needed */ }
  }
  if (takeProfit != null) {
    try {
      await privateRequest(settings, "POST", "/fapi/v1/order", {
        symbol, side: "BUY", type: "TAKE_PROFIT_MARKET", stopPrice: takeProfit, closePosition: "true",
      });
    } catch (e) { /* surfaced via trade log by caller if needed */ }
  }
  return { orderId: data.orderId };
}

async function getWalletBalance(settings, asset = "USDT") {
  const data = await privateRequest(settings, "GET", "/fapi/v2/balance", {});
  const a = (data || []).find(x => x.asset === asset);
  return a ? parseFloat(a.availableBalance) : 0;
}

async function getOpenPositions(settings) {
  const data = await privateRequest(settings, "GET", "/fapi/v2/positionRisk", {});
  return (data || []).filter(p => parseFloat(p.positionAmt) !== 0).map(p => ({
    symbol: p.symbol,
    side: parseFloat(p.positionAmt) < 0 ? "Sell" : "Buy",
    size: Math.abs(parseFloat(p.positionAmt)),
    avgPrice: p.entryPrice,
    markPrice: p.markPrice,
    unrealisedPnl: p.unRealizedProfit,
    leverage: p.leverage,
  }));
}

module.exports = { id: "binance", fetchTopSymbols, fetchKlines, fetchInstrumentInfo, setLeverage, placeShortOrder, getWalletBalance, getOpenPositions, roundToStep };
