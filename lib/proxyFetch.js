const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

// Plain fetch — used for public endpoints (tickers, klines). These never
// need a static IP because they don't carry an API key.
async function plainFetch(url, opts) {
  return fetch(url, opts);
}

// Proxy fetch — used ONLY for signed/private requests (the ones Binance/Bybit
// check the API key's IP whitelist on). proxyUrl comes from Settings, e.g.
// a QuotaGuard Static URL like: http://user:pass@static.quotaguard.com:9293
async function proxyFetch(url, opts, proxyUrl) {
  if (!proxyUrl) return fetch(url, opts); // no proxy configured — direct call
  const agent = new HttpsProxyAgent(proxyUrl);
  return fetch(url, { ...opts, agent });
}

module.exports = { plainFetch, proxyFetch };
