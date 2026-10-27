import fs from 'node:fs/promises';

// 1. AMBIL DATA KALENDER (ForexFactory)
async function fetchCalendar() {
  const urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.json'
  ];
  
  const batches = await Promise.all(urls.map(async u => {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  }));

  const rank = { Low: 1, Medium: 2, High: 3 };
  
  // FILTER KANADA & MINYAK/ENERGI DITAMBAHKAN DI SINI
  const keywords = /fed|fomc|interest rate|inflation|cpi|pce|payroll|employment|unemployment|jobless|gdp|pmi|ism|retail sales|consumer confidence|jolts|durable goods|powell|treasury|oil|crude|energy|gas|opec|eia|rig|inventories|distillate|gasoline/i;
  const allowedCountries = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD'];

  const events = batches.flat()
    .filter(e => allowedCountries.includes(String(e.country || '').toUpperCase()) && keywords.test(e.title || ''))
    .map(e => ({
      Date: e.date,
      Event: e.title,
      Country: e.country,
      Importance: rank[e.impact] || 1,
      Forecast: e.forecast || '',
      Previous: e.previous || '',
      Actual: e.actual || ''
    }));

  await fs.writeFile('data/calendar.json', JSON.stringify(events, null, 2));
  console.log('Berhasil menyimpan calendar.json dengan', events.length, 'berita.');
}

// 2. AMBIL HARGA EMAS (Gold API)
async function fetchMarket() {
  try {
    const r = await fetch('https://api.gold-api.com/price/XAU');
    const j = await r.json();
    const price = Number(j.price);
    if (price > 0) {
      await fs.writeFile('data/market.json', JSON.stringify({
        generatedAt: new Date().toISOString(),
        symbol: "XAU/USD",
        price: String(price),
        change: "",
        percentChange: "",
        previousClose: ""
      }, null, 2));
      console.log('Berhasil menyimpan market.json dengan harga', price);
    }
  } catch (e) {
    console.error('Gagal mengambil harga emas', e);
  }
}

// Jalankan
(async () => {
  await fetchCalendar();
  await fetchMarket();
})();
