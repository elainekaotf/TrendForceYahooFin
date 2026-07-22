const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CSV_DIR = path.join(__dirname, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

// Usage: node scrape_history.js SYMBOL [SYMBOL2 ...] [--from=2018-01-01] [--to=2026-06-30]
const args = process.argv.slice(2);
const symbols = args.filter(a => !a.startsWith('--'));
const opt = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const FROM = opt('from', '2018-01-01');
const TO = opt('to', new Date().toISOString().slice(0, 10));

if (!symbols.length) {
  console.error('Usage: node scrape_history.js SYMBOL [SYMBOL2 ...] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]');
  process.exit(1);
}

// query1.finance.yahoo.com's chart API 429s when hit directly (from curl or
// Node's own fetch), even from a residential IP — but calling it via
// page.evaluate() so the request originates from the already-loaded
// finance.yahoo.com page context sails through, presumably because Yahoo's
// own frontend uses this exact endpoint the same way.
async function fetchDailyHistory(page, symbol, fromDate, toDate) {
  const period1 = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${toDate}T23:59:59Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;

  const raw = await page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, url);

  const result = raw?.chart?.result?.[0];
  if (!result) throw new Error(raw?.chart?.error?.description || 'no result in response');

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: closes[i],
  })).filter(r => r.close != null);
}

// Collapses daily rows down to one row per calendar month — the LAST
// trading day of that month, since "每月31日收盤價" really means "month-end
// close" (months don't all have a 31st, and the 31st/30th itself is often
// a weekend/holiday with no trade).
function toMonthEndCloses(dailyRows) {
  const byMonth = new Map();
  for (const row of dailyRows) {
    const month = row.date.slice(0, 7);
    byMonth.set(month, row); // rows arrive in ascending date order, so last write wins
  }
  return Array.from(byMonth.values());
}

function writeMonthlyCsv(symbol, monthlyRows) {
  const csvFile = path.join(CSV_DIR, `${symbol.replace(/[^a-zA-Z0-9.]/g, '_')}_monthly.csv`);
  const header = 'monthEndDate,close\n';
  const body = monthlyRows.map(r => `${r.date},${r.close}`).join('\n');
  fs.writeFileSync(csvFile, header + body + '\n');
  console.log(`  Wrote ${monthlyRows.length} month-end rows to csv/${path.basename(csvFile)}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const failed = [];
  try {
    for (const symbol of symbols) {
      console.log(`Fetching ${symbol} history (${FROM} to ${TO})...`);
      try {
        // Load the quote page first so the fetch() below runs from the
        // finance.yahoo.com origin instead of an unloaded/blank page.
        await page.goto(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, { waitUntil: 'domcontentloaded' });
        const daily = await fetchDailyHistory(page, symbol, FROM, TO);
        const monthly = toMonthEndCloses(daily);
        writeMonthlyCsv(symbol, monthly);
      } catch (err) {
        console.error(`  [!] ${symbol} failed: ${err.message}`);
        failed.push(symbol);
      }
      await page.waitForTimeout(1500);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (failed.length) {
    console.log(`\nCompleted with failures on: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main();
