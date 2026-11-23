const BASE_URL = 'https://moex.com';

// 1. Загружаем полный список всех торгуемых акций TQBR
export async function fetchAllMoexTickers() {
  try {
    const url = `${BASE_URL}.json?iss.meta=off&iss.only=securities&securities.columns=SECID,SHORTNAME`;
    const res = await fetch(url);
    const json = await res.json();
    const rows = json.securities?.data || [];

    return rows
      .filter(r => r[0] && r[1])
      .map(r => ({ secid: r[0], name: r[1] }))
      .sort((a, b) => a.secid.localeCompare(b.secid));
  } catch (e) {
    console.error('Ошибка загрузки списка тикеров:', e);
    return [
      { secid: 'SBER', name: 'Сбербанк' },
      { secid: 'SMLT', name: 'Самолет' },
      { secid: 'VKCO', name: 'ВК' },
      { secid: 'YDEX', name: 'Яндекс' }
    ];
  }
}

// Перевод времени МСК в UNIX timestamp (в секундах)
function mskToUnix(mskDateStr) {
  return Math.floor(new Date(mskDateStr.replace(' ', 'T') + '+03:00').getTime() / 1000);
}

// Склейка мелких свечей в крупные (2м, 3м, 5м, 15м, 30м, 2ч, 4ч)
function aggregateCandles(candles, stepSeconds) {
  const buckets = new Map();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / stepSeconds) * stepSeconds;
    if (!buckets.has(bucketTime)) {
      buckets.set(bucketTime, { ...c, time: bucketTime });
    } else {
      const agg = buckets.get(bucketTime);
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  return Array.from(buckets.values());
}

// 2. Загрузка свечей под любой таймфрейм
export async function fetchMoexCandles(ticker, timeframe) {
  const tfConfig = {
    '1m':  { iss: 1,  aggSec: null,  days: 3 },
    '2m':  { iss: 1,  aggSec: 120,   days: 4 },
    '3m':  { iss: 1,  aggSec: 180,   days: 5 },
    '5m':  { iss: 1,  aggSec: 300,   days: 7 },
    '10m': { iss: 10, aggSec: null,  days: 20 },
    '15m': { iss: 1,  aggSec: 900,   days: 10 },
    '30m': { iss: 1,  aggSec: 1800,  days: 14 },
    '1h':  { iss: 60, aggSec: null,  days: 90 },
    '2h':  { iss: 60, aggSec: 7200,  days: 150 },
    '4h':  { iss: 60, aggSec: 14400, days: 250 },
    '1D':  { iss: 24, aggSec: null,  days: 1000 },
    '1W':  { iss: 7,  aggSec: null,  days: 3000 },
    '1M':  { iss: 31, aggSec: null,  days: 5000 }
  };

  const cfg = tfConfig[timeframe] || tfConfig['15m'];
  const fromDate = new Date(Date.now() - cfg.days * 86400000).toISOString().split('T')[0];

  let start = 0;
  let rawCandles = [];

  while (true) {
    const url = `${BASE_URL}/${ticker.toUpperCase()}/candles.json?interval=${cfg.iss}&from=${fromDate}&start=${start}&iss.meta=off`;
    const res = await fetch(url);
    const json = await res.json();
    const rows = json.candles?.data || [];

    if (rows.length === 0) break;

    for (const r of rows) {
      // Индексы колонок MOEX: 0:open, 1:close, 2:high, 3:low, 4:value, 5:volume, 6:begin
      rawCandles.push({
        time: mskToUnix(r[6]),
        open: r[0],
        high: r[2],
        low: r[3],
        close: r[1],
        volume: r[5]
      });
    }

    if (rows.length < 500) break;
    start += 500;
  }

  return cfg.aggSec ? aggregateCandles(rawCandles, cfg.aggSec) : rawCandles;
}
