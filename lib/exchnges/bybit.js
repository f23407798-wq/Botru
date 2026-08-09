const crypto = require("crypto");
const { plainFetch, proxyFetch } = require("../proxyFetch");
const { roundToStep } = require("../analysis");

const BYBIT_INTERVAL_MAP = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };

const PUBLIC_HOSTS = ["https://api.bybit.com", "https://api.bytick.com"];
const PRIVATE_HOSTS = { mainnet: ["https://api.bybit.com", "https://api.bytick.com"], testnet: ["https://api-testnet.bybit.com"] };

function hmacHex(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

async function fetchJSONPublic(path) {
  let lastErr;
  for (const host of PUBLIC_HOSTS) {
    try {
      const res = await plainFetch(host + path);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw new Error("Bybit public request failed: " + (lastErr ? lastErr.message : "unknown"));
}

async function privateRequest(settings, method, path, params) {
  if (!settings.apiKey || !settings.apiSecret) throw new Error("Bybit API Key/Secret not set in Settings");
  const proxyUrl = (settings.proxyAppliesTo === "bybit" || settings.proxyAppliesTo === "both") ? settings.proxyUrl : null;
  const hosts = settings.testnet ? PRIVATE_HOSTS.testnet : PRIVATE_HOSTS.mainnet;
  const timestamp = String(Date.now());
  const recvWindow = "5000";
  const qs = method === "GET" ? new URLSearchParams(params || {}).toString() : "";
  const payload = method === "GET" ? qs : JSON.stringify(params || {});
  const signature = hmacHex(settings.apiSecret, timestamp + settings.apiKey + recvWindow + payload);
  const headers = {
    "X-BAPI-API-KEY": settings.apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-SIGN": signature,
    "X-BAPI-RECV-WINDOW": recvWindow,
    "X-BAPI-SIGN-TYPE": "2",
  };
  if (method !== "GET") headers["Content-Type"] = "application/json";

  let lastErr;
  for (const host of hosts) {
    try {
      const url = host + path + (method === "GET" && qs ? "?" + qs : "");
      const res = await proxyFetch(url, { method, headers, body: method === "GET" ? undefined : payload }, proxyUrl);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 150)}`); }
      if (typeof data.retCode === "undefined") throw new Error("Unexpected response shape");
      return data;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Bybit private request failed on all hosts: ${lastErr ? lastErr.message : "unknown"}`);
}

async function fetchTopSymbols(n) {
  const data = await fetchJSONPublic("/v5/market/tickers?category=linear");
  if (data.retCode !== 0) throw new Error("Bybit error: " + (data.retMsg || data.retCode));
  const list = data.result && data.result.list ? data.result.list : [];
  const usdt = list.filter(d => d.symbol.endsWith("USDT"));
  usdt.sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h));
  return usdt.slice(0, n).map(d => ({ symbol: d.symbol, lastPrice: d.lastPrice, quoteVolume: d.turnover24h }));
}

async function fetchKlines(symbol, interval, limit = 500) {
  const bybitInterval = BYBIT_INTERVAL_MAP[interval] || interval;
  const data = await fetchJSONPublic(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`);
  if (data.retCode !== 0) throw new Error("Bybit error: " + (data.retMsg || data.retCode));
  const list = data.result && data.result.list ? data.result.list : [];
  return list.slice().reverse().map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
}

async function fetchInstrumentInfo(symbol) {
  const data = await fetchJSONPublic(`/v5/market/instruments-info?category=linear&symbol=${symbol}`);
  if (data.retCode !== 0) throw new Error("Bybit error: " + (data.retMsg || data.retCode));
  const info = (data.result && data.result.list || [])[0];
  if (!info) throw new Error("No instrument info for " + symbol);
  return { qtyStep: parseFloat(info.lotSizeFilter.qtyStep), minOrderQty: parseFloat(info.lotSizeFilter.minOrderQty) };
}

async function setLeverage(settings, symbol, leverage) {
  try {
    const data = await privateRequest(settings, "POST", "/v5/position/set-leverage", {
      category: "linear", symbol, buyLeverage: String(leverage), sellLeverage: String(leverage),
    });
    if (data.retCode !== 0 && !/not modified/i.test(data.retMsg || "")) throw new Error(`${data.retCode}: ${data.retMsg}`);
  } catch (e) {
    if (!/not modified/i.test(e.message)) throw e;
  }
}

async function placeShortOrder(settings, { symbol, qty, takeProfit, stopLoss }) {
  const body = { category: "linear", symbol, side: "Sell", orderType: "Market", qty: String(qty), timeInForce: "IOC", reduceOnly: false, tpTriggerBy: "LastPrice", slTriggerBy: "LastPrice" };
  if (takeProfit != null) body.takeProfit = String(takeProfit);
  if (stopLoss != null) body.stopLoss = String(stopLoss);
  const data = await privateRequest(settings, "POST", "/v5/order/create", body);
  if (data.retCode !== 0) throw new Error(`Bybit order error ${data.retCode}: ${data.retMsg}`);
  return { orderId: data.result.orderId };
}

async function getWalletBalance(settings, coin = "USDT") {
  const data = await privateRequest(settings, "GET", "/v5/account/wallet-balance", { accountType: "UNIFIED", coin });
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
  const acct = (data.result.list || [])[0];
  const c = acct && (acct.coin || []).find(x => x.coin === coin);
  return c ? parseFloat(c.walletBalance) : 0;
}

async function getOpenPositions(settings) {
  const data = await privateRequest(settings, "GET", "/v5/position/list", { category: "linear", settleCoin: "USDT" });
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
  return (data.result.list || []).filter(p => parseFloat(p.size) > 0).map(p => ({
    symbol: p.symbol, side: p.side, size: p.size, avgPrice: p.avgPrice, markPrice: p.markPrice,
    unrealisedPnl: p.unrealisedPnl, leverage: p.leverage,
  }));
}

module.exports = { id: "bybit", fetchTopSymbols, fetchKlines, fetchInstrumentInfo, setLeverage, placeShortOrder, getWalletBalance, getOpenPositions, roundToStep };
