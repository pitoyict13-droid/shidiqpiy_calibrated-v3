const from = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const tvUrl = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=US,EU,GB,JP,AU,NZ,CA`;

const tvResponse = await fetch(tvUrl, {
  headers: {
    'user-agent': 'Mozilla/5.0',
    'origin': 'https://www.tradingview.com',
    'referer': 'https://www.tradingview.com/'
  }
});
if (!tvResponse.ok) throw new Error(`TradingView calendar feed returned ${tvResponse.status}`);
const tvData = await tvResponse.json();
const tvRecords = Array.isArray(tvData?.result) ? tvData.result : [];
const withActual = tvRecords.filter(r => r.actual !== null && r.actual !== undefined).length;
console.log(tvUrl, `OK: ${tvRecords.length} records (${withActual} with Actual)`);

const ffUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const ffResponse = await fetch(ffUrl);
if (!ffResponse.ok) throw new Error(`Calendar feed returned ${ffResponse.status}`);
const ffData = await ffResponse.json();
console.log(ffUrl, Array.isArray(ffData) ? `OK: ${ffData.length} records` : 'INVALID: expected array');
