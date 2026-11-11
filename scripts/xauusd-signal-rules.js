function parseMetricValue(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === '-' || s === '—') return null;
  const raw = s.replace(/,/g, '').replace(/^[$€£¥]/, '');
  const m = raw.match(/^([+-]?\d*\.?\d+)\s*([KMBT])?%?$/i);
  let n;
  let suf = '';
  if (m) {
    n = Number(m[1]);
    suf = (m[2] || '').toUpperCase();
  } else {
    n = Number(raw.replace(/[^0-9.-]/g, ''));
  }
  if (!Number.isFinite(n)) return null;
  if (suf === 'K') n *= 1e3;
  if (suf === 'M') n *= 1e6;
  if (suf === 'B') n *= 1e9;
  if (suf === 'T') n *= 1e12;
  return n;
}

export function getGoldSignal({ event = '', actual, forecast, importance = 1, country = 'USD' }) {
  const name = String(event).toLowerCase();
  const c = String(country || 'USD').trim().toUpperCase();
  const imp = Number(importance || 1);

  const a = parseMetricValue(actual);
  const f = parseMetricValue(forecast);
  if (a === null || f === null) {
    return {
      dir: 'wait',
      score: Math.max(35, 48 - imp * 2),
      reason: 'Actual dan Forecast keduanya dibutuhkan untuk sinyal BUY/SELL pasca-rilis.'
    };
  }

  const surprise = a - f;
  const threshold = Math.min(Math.max(Math.abs(f) * 0.005, 0.01), 0.5);
  if (Math.abs(surprise) < threshold) {
    return {
      dir: 'wait',
      score: 45,
      reason: `Actual ${actual} vs Forecast ${forecast}: hasil inline, belum ada deviasi signifikan.`
    };
  }

  const laborOrSupplyWeakIfHigh = /unemployment rate|unemployment|initial claims|continuing claims|jobless claims|jobless|claimant count|crude oil inventories|crude oil stock|api crude|distillate|gasoline stocks/.test(name);
  const strongEconomyIfHigh = /cpi|core cpi|inflation|ppi|core ppi|pce|pmi|ism|retail sales|consumer confidence|consumer sentiment|michigan|business confidence|sentix|zew|ifo|fed funds|interest rate|rate decision|bank rate|cash rate|policy rate|jolts|durable goods|factory orders|industrial production|manufacturing production|wholesale inventories|nonfarm payroll|non-farm payroll|non farm payroll|nfp|payroll|adp|employment|average hourly earnings|wage|gdp|building permits|housing starts|existing home sales|new home sales|pending home sales|trade balance|balance of trade|current account/.test(name);

  let goldBullish;
  if (c === 'USD') {
    if (laborOrSupplyWeakIfHigh) goldBullish = surprise > 0;
    else if (strongEconomyIfHigh) goldBullish = surprise < 0;
    else return { dir: 'wait', score: 40, reason: `${name} belum memiliki pemetaan dampak ekonomi XAU/USD.` };
  } else {
    if (laborOrSupplyWeakIfHigh) goldBullish = surprise < 0;
    else if (strongEconomyIfHigh) goldBullish = surprise > 0;
    else return { dir: 'wait', score: 40, reason: `${name} belum memiliki pemetaan dampak ekonomi.` };
  }

  const ratio = Math.abs(surprise) / threshold;
  const strength = Math.min(35, Math.round(ratio * 8));
  const impBoost = imp >= 3 ? 8 : imp >= 2 ? 4 : 0;
  const score = Math.min(96, Math.max(55, 55 + strength + impBoost));
  const dir = goldBullish ? 'long' : 'short';
  const action = dir === 'long' ? 'BUY' : 'SELL';

  return {
    dir,
    action,
    score,
    reason: `Actual ${actual} vs Forecast ${forecast}. ${
      c === 'USD'
        ? (goldBullish ? 'Data USD lebih lemah dari ekspektasi → DXY melemah, bias XAU/USD BUY.' : 'Data USD lebih kuat dari ekspektasi → DXY menguat, bias XAU/USD SELL.')
        : (goldBullish ? `Data ${c} lebih kuat dari ekspektasi → ${c} menguat.` : `Data ${c} lebih lemah dari ekspektasi → ${c} melemah.`)
    }`
  };
}
