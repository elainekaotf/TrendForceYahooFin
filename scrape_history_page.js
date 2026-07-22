const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CSV_DIR = path.join(__dirname, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

// Usage: node scrape_history_page.js "<yahoo history page URL>"
// e.g. https://hk.finance.yahoo.com/quote/0050.TW/history/?period1=1514764800&period2=1782777600
const url = process.argv[2];
if (!url) {
  console.error('Usage: node scrape_history_page.js "<yahoo finance /history/ URL>"');
  process.exit(1);
}

const symbolMatch = url.match(/\/quote\/([^/]+)\/history/);
const symbol = symbolMatch ? symbolMatch[1] : 'unknown';

// Yahoo's date column renders as Chinese "2026年6月29日" on hk.finance.yahoo.com
// (would be "Jun 29, 2026" on the .com domain) — parse either.
function parseDateCell(text) {
  const zh = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (zh) {
    const [, y, m, d] = zh;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toMonthEndCloses(dailyRows) {
  const byMonth = new Map();
  // Rows come off the page newest-first, so keep the FIRST row seen per
  // month (i.e. the latest date in that month) as the month-end close.
  for (const row of dailyRows) {
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, row);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
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

  try {
    console.log(`Loading ${url} ...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="history-table"] table tbody tr', { timeout: 20000 });
    // Yahoo's history table renders the whole requested date range in one
    // shot on load (confirmed: 2077 rows for an 8.5-year span appeared
    // without any further scrolling) — a short settle wait is still needed
    // for the async data fetch behind the table to finish populating.
    await page.waitForTimeout(4000);

    const rawRows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="history-table"] table tbody tr')).map(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        return cells;
      });
    });

    console.log(`  Found ${rawRows.length} rows in table.`);

    // Skip dividend/split event rows, which render with fewer columns than
    // a normal OHLCV row (7 columns: date, open, high, low, close,
    // adjClose, volume).
    const dailyRows = rawRows
      .filter(cells => cells.length >= 7)
      .map(cells => ({
        date: parseDateCell(cells[0]),
        open: cells[1],
        high: cells[2],
        low: cells[3],
        close: cells[4],
        adjClose: cells[5],
        volume: cells[6],
      }))
      .filter(r => r.date);

    // Volume renders with thousands separators ("101,519,378") — quote it
    // so the embedded commas don't get parsed as extra CSV columns.
    const quoteVolume = (v) => `"${v}"`;
    const dailyFile = path.join(CSV_DIR, `${symbol.replace(/[^a-zA-Z0-9.]/g, '_')}_history_daily.csv`);
    const dailyHeader = 'date,open,high,low,close,adjClose,volume\n';
    const dailyBody = dailyRows.map(r => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.adjClose},${quoteVolume(r.volume)}`).join('\n');
    fs.writeFileSync(dailyFile, dailyHeader + dailyBody + '\n');
    console.log(`  Wrote ${dailyRows.length} daily rows to csv/${path.basename(dailyFile)}`);

    const monthly = toMonthEndCloses(dailyRows.map(r => ({ date: r.date, close: r.adjClose })));
    const monthlyFile = path.join(CSV_DIR, `${symbol.replace(/[^a-zA-Z0-9.]/g, '_')}_history_monthly.csv`);
    const monthlyHeader = 'monthEndDate,adjClose\n';
    const monthlyBody = monthly.map(r => `${r.date},${r.close}`).join('\n');
    fs.writeFileSync(monthlyFile, monthlyHeader + monthlyBody + '\n');
    console.log(`  Wrote ${monthly.length} month-end rows to csv/${path.basename(monthlyFile)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
