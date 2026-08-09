# EMA · RSI · Fibonacci Reversal Scanner — Bybit + Binance

Scans top USDT perpetual pairs for a bullish EMA20/50 cross → oversold → overbought → fib-retest sequence, flags the SELL zone, and can auto-trade it. Now runs as a small server (not a single HTML file), so scanning and auto-trade keep working even if your browser is closed.

**Everything — exchange choice, API keys, trade size, proxy URL — is configured from the Settings page in the site itself. No environment variables needed.**

---

## 1. Why this had to become a server (not just an HTML file)

The old version ran entirely in your browser: your browser called Bybit's API directly. That means the IP the exchange saw was **your own internet connection's IP**, which changes constantly and can't be whitelisted.

For Binance's IP whitelist to work, the signed (authenticated) API calls need to come from **one consistent place** — this server, running on Railway, calling out through a fixed proxy IP. That's why the trading logic moved to `server.js`, and the browser page now just talks to *your* server.

---

## 2. Push this to GitHub

1. Create a new empty repo on GitHub (e.g. `my-scanner`).
2. In this folder:
   ```
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/my-scanner.git
   git push -u origin main
   ```

## 3. Deploy to Railway

1. Go to [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → pick your repo.
2. Railway detects Node.js automatically (from `package.json`) and runs `npm start`.
3. Once deployed, open the service → **Settings** tab → **Networking** → **Generate Domain** to get a public URL like `my-scanner-production.up.railway.app`. Open that URL — you'll see the scanner UI.
4. That's it for hosting. No environment variables to set — you'll configure everything from the site next.

> If you ever want to move to a different host later, this is a plain Node.js app (`npm start`) — it will run the same way on Render, Fly.io, a VPS, etc. Nothing here is Railway-specific except the proxy step below, which is only needed because of Binance's IP whitelist.

## 4. Get a static IP with QuotaGuard (for Binance's IP whitelist)

Railway's Free/Hobby plan doesn't offer a static outbound IP (that's a paid Railway Pro feature). QuotaGuard gives you one on a separate small subscription instead:

1. Go to [quotaguard.com](https://www.quotaguard.com) → sign up (check their current free trial, then their paid "Static Small" plan is roughly $9–15/month).
2. After signup, your QuotaGuard dashboard shows a **Static URL**, looking like:
   ```
   http://username:password@static.quotaguard.com:9293
   ```
3. Note the **fixed IP address(es)** QuotaGuard shows you (usually 1–2 IPs) — this is what you'll give to Binance.

## 5. Configure everything from the site

Open your Railway URL → click **⚙ Settings**:

- **Exchange**: choose Bybit or Binance (you can switch any time — both are supported side by side).
- **API Key / API Secret**: paste your exchange API key/secret.
- **Testnet**: leave ON while you test — no real money moves.
- **Position size, Leverage, SL%, TP%, Max trades/scan**: your risk settings.
- **Proxy URL**: paste the QuotaGuard Static URL from step 4.
- **Proxy applies to**: choose **Binance only** (default) — Bybit doesn't need it, so leave Bybit's calls going direct.
- Click **Test Connection** to confirm it can read your wallet balance through the proxy.
- Click **Save Settings**.

Turn on **▶ Auto-scan** to run the scan (and auto-trade, if enabled) every 5 minutes on the server — this keeps running whether or not this browser tab is open.

## 6. Whitelist the IP on Binance

1. On Binance → **API Management** → your API key → **Edit restrictions**.
2. Choose **Restrict access to trusted IPs only** and paste the IP address(es) QuotaGuard gave you in step 4.
3. Give the key **Enable Futures** / **Enable Trading** permission only — never enable withdrawals on a key used by a bot.
4. Save. Back in the scanner's Settings, click **Test Connection** again to confirm it still works.

## 7. Go live

Once Testnet runs clean for a while and you're comfortable with the signals:
1. Create a **real** (mainnet) API key on Binance/Bybit the same way (IP-restricted, trading-only, no withdrawals).
2. In Settings, turn **Testnet** off, paste the new key, **Test Connection**, then **Save**.
3. Turn on **Auto-Trade** only when you're ready for it to place real orders.

---

## Notes

- **Data persistence**: settings/trade history are saved to a local `data/*.json` file on the server. On Railway's free plan the filesystem can reset on redeploy — if that matters to you, add a [Railway Volume](https://docs.railway.com/reference/volumes) mounted at `/app/data`, or re-enter Settings after a redeploy.
- **Security**: your API secret is stored only in that `data/settings.json` file on your own Railway service — never sent to any third party. Anyone with access to your Railway project can read it, so don't share project access carelessly.
- **Bybit**: unaffected by any of this — it keeps working directly, no proxy needed, unless you also want to IP-restrict a Bybit key later (just set "Proxy applies to: Both").
