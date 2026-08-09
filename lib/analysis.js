/* ============================== math ============================== */
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  let ema;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += closes[j];
      ema = sum / period;
      out[i] = ema;
    } else {
      ema = closes[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

function calcRSI(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0, loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// True EMA20/EMA50 intersection price (linear interpolation between the
// prior candle and the cross candle) — not the candle's close price.
function emaCrossPrice(ema20, ema50, idx) {
  const prevDiff = ema20[idx - 1] - ema50[idx - 1];
  const currDiff = ema20[idx] - ema50[idx];
  if (currDiff === prevDiff) return ema20[idx];
  let t = prevDiff / (prevDiff - currDiff);
  t = Math.max(0, Math.min(1, t));
  return ema20[idx - 1] + t * (ema20[idx] - ema20[idx - 1]);
}

// No candle strictly between T1 and T2 may have closed below the T1->T2 line.
function isLineCleanBetween(candles, t1Idx, t1Price, t2Idx, slope) {
  for (let k = t1Idx + 1; k < t2Idx; k++) {
    const lineVal = t1Price + slope * (k - t1Idx);
    if (candles[k].close < lineVal) return false;
  }
  return true;
}

function findOverboughtExcursion(rsi, idx, candles) {
  let maxRsi = rsi[idx], maxIdx = idx, j = idx + 1;
  while (j < candles.length && rsi[j] != null && rsi[j] > 70) {
    if (rsi[j] > maxRsi) { maxRsi = rsi[j]; maxIdx = j; }
    j++;
  }
  return { rsi: maxRsi, idx: maxIdx, end: j - 1 };
}

function findOversoldExcursion(rsi, idx, candles) {
  let minRsi = rsi[idx], minIdx = idx, j = idx + 1;
  while (j < candles.length && rsi[j] != null && rsi[j] < 30) {
    if (rsi[j] < minRsi) { minRsi = rsi[j]; minIdx = j; }
    j++;
  }
  return { rsi: minRsi, idx: minIdx, end: j - 1 };
}

// Chronological order: R3 (overbought peak) -> R2 (oversold trough) ->
// R1 (EMA20/50 bullish cross, price above both EMAs). Confirmation 1: the
// cross candle itself must touch the fib(P1->P2) level. Confirmation 2 /
// entry: the first candle whose CLOSE breaks below the T1->T2 trend line.
function analyzeSymbol(candles, requireCleanLine) {
  const closes = candles.map(c => c.close);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const found = [];
  let stage = "FIND_R3";
  let ctx = {};

  for (let idx = 51; idx < candles.length; idx++) {
    if (rsi[idx] == null) continue;

    if (stage === "FIND_R3") {
      if (rsi[idx] > 70) {
        const exc = findOverboughtExcursion(rsi, idx, candles);
        ctx = { r3: exc.rsi, r3Idx: exc.idx, r3Time: candles[exc.idx].time, p1: candles[exc.idx].high };
        idx = exc.end;
        stage = "FIND_R2";
      }
      continue;
    }

    if (stage === "FIND_R2") {
      if (rsi[idx] > 70) {
        const exc = findOverboughtExcursion(rsi, idx, candles);
        ctx.r3 = exc.rsi; ctx.r3Idx = exc.idx; ctx.r3Time = candles[exc.idx].time; ctx.p1 = candles[exc.idx].high;
        idx = exc.end;
        continue;
      }
      if (rsi[idx] < 30) {
        const exc = findOversoldExcursion(rsi, idx, candles);
        ctx.r2 = exc.rsi; ctx.r2Idx = exc.idx; ctx.r2Time = candles[exc.idx].time; ctx.p2 = candles[exc.idx].low;
        idx = exc.end;
        stage = "FIND_R1";
      }
      continue;
    }

    if (stage === "FIND_R1") {
      if (rsi[idx] < 30) {
        const exc = findOversoldExcursion(rsi, idx, candles);
        ctx.r2 = exc.rsi; ctx.r2Idx = exc.idx; ctx.r2Time = candles[exc.idx].time; ctx.p2 = candles[exc.idx].low;
        idx = exc.end;
        continue;
      }
      if (rsi[idx] > 70) {
        const exc = findOverboughtExcursion(rsi, idx, candles);
        ctx = { r3: exc.rsi, r3Idx: exc.idx, r3Time: candles[exc.idx].time, p1: candles[exc.idx].high };
        idx = exc.end;
        stage = "FIND_R2";
        continue;
      }
      if (ema20[idx] == null || ema50[idx] == null || ema20[idx - 1] == null || ema50[idx - 1] == null || ema20[idx - 2] == null || ema50[idx - 2] == null) continue;
      const wasBelow = ema20[idx - 1] < ema50[idx - 1] && ema20[idx - 2] < ema50[idx - 2];
      const crossedUp = wasBelow && ema20[idx] > ema50[idx];
      const priceAbove = candles[idx].close > ema20[idx] && candles[idx].close > ema50[idx];
      if (crossedUp && priceAbove) {
        ctx.r1 = rsi[idx]; ctx.r1Idx = idx; ctx.r1Time = candles[idx].time;
        if (ctx.p1 > ctx.p2) {
          const range = ctx.p1 - ctx.p2;
          const lvl618 = ctx.p1 - 0.618 * range;
          const lvl5 = ctx.p1 - 0.5 * range;
          let target = null, targetLabel = null;
          if (ctx.r1 >= 70) { target = lvl618; targetLabel = "0.618"; }
          else if (ctx.r1 >= 60) { target = lvl5; targetLabel = "0.5"; }
          if (target) {
            ctx.target = target; ctx.targetLabel = targetLabel; ctx.lvl618 = lvl618; ctx.lvl5 = lvl5;
            const touched = candles[idx].high >= target && candles[idx].low <= target;
            if (touched) {
              ctx.fibTouchIdx = idx; ctx.fibTouchTime = candles[idx].time;
              ctx.t1Idx = ctx.r2Idx; ctx.t1Price = ctx.p2;
              ctx.t2Idx = idx; ctx.t2Price = emaCrossPrice(ema20, ema50, idx);
              ctx.lineSlope = (ctx.t2Price - ctx.t1Price) / (ctx.t2Idx - ctx.t1Idx);
              if (requireCleanLine && !isLineCleanBetween(candles, ctx.t1Idx, ctx.t1Price, ctx.t2Idx, ctx.lineSlope)) {
                stage = "FIND_R3"; ctx = {};
                continue;
              }
              stage = "WATCH_BREAK";
              continue;
            }
          }
        }
        stage = "FIND_R3"; ctx = {};
      }
      continue;
    }

    if (stage === "WATCH_BREAK") {
      const lineVal = ctx.t1Price + ctx.lineSlope * (idx - ctx.t1Idx);
      ctx.lineValNow = lineVal; ctx.lineIdxNow = idx;
      if (candles[idx].close < lineVal) {
        ctx.entryIdx = idx; ctx.entryTime = candles[idx].time; ctx.entryPrice = candles[idx].close; ctx.lineValAtEntry = lineVal;
        found.push({ ...ctx, status: "TRIGGERED" });
        stage = "FIND_R3"; ctx = {};
      }
      continue;
    }
  }

  if (stage === "WATCH_BREAK") {
    found.push({ ...ctx, status: "CONFIRMED" });
  } else if (stage === "FIND_R1" && ctx.p1 != null && ctx.p2 != null) {
    found.push({ ...ctx, status: "ARMED" });
  }
  return found;
}

function roundToStep(value, step) {
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  return parseFloat((Math.floor(value / step) * step).toFixed(precision));
}

module.exports = { calcEMA, calcRSI, analyzeSymbol, roundToStep };
