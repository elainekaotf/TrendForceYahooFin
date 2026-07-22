const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { toTaiwanISOString } = require('./tz_util');

const CSV_DIR = path.join(__dirname, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

// Same mkdir-mutex pattern as TrendforceTwitterScraper/scrape_accounts.js —
// covers a manual invocation overlapping a scheduled one.
const LOCK_DIR = path.join(__dirname, '.scrape_quotes.lock');
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000;

function releaseLock() {
  try { fs.rmdirSync(LOCK_DIR); } catch {}
}
process.on('exit', releaseLock);

async function acquireLock() {
  while (true) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const lockAgeMs = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
      if (lockAgeMs >= LOCK_STALE_AFTER_MS) {
        console.log(`[WARN] scrape_quotes: lock directory is ${Math.round(lockAgeMs / 1000)}s old — assuming a crashed run left it behind, taking over`);
        releaseLock();
        try { fs.mkdirSync(LOCK_DIR); return; } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const ALL_SYMBOLS = ['2330.TW', '2317.TW', '2454.TW', 'NVDA', 'TSM'];
const requestedSymbols = process.argv.slice(2).filter(a => !a.startsWith('-'));
const SYMBOLS = requestedSymbols.length ? requestedSymbols : ALL_SYMBOLS;

const safe = (s) => `"${String(s ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;

// Yahoo's raw chart API (query1/query2.finance.yahoo.com) now 429s
// consistently even from a residential IP, so we scrape the rendered quote
// page instead — same DOM-scraping approach as
// TrendforceTwitterScraper/scrape_accounts.js, just without any login step
// since quote pages are public.
async function scrapeQuote(page, symbol) {
  await page.goto(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="qsp-price"]', { timeout: 15000 });

  const data = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
    // The old individual data-testid stat cells (PREV_CLOSE-value etc.) are
    // gone — stats now live as <fin-streamer data-field="..."> rows inside
    // [data-testid="quote-statistics"], keyed by Yahoo's internal field name.
    const stat = (field) => document.querySelector(`[data-testid="quote-statistics"] fin-streamer[data-field="${field}"]`)?.textContent?.trim() || '';
    return {
      price: text('[data-testid="qsp-price"]'),
      change: text('[data-testid="qsp-price-change"]'),
      changePercent: text('[data-testid="qsp-price-change-percent"]'),
      previousClose: stat('regularMarketPreviousClose'),
      dayRange: stat('regularMarketDayRange'),
      volume: stat('regularMarketVolume'),
      marketState: text('[data-testid="quote-hdr"] .exchange'),
    };
  });

  return { ...data, timestamp: toTaiwanISOString(new Date().toISOString()) };
}

function writeQuoteRow(symbol, q) {
  const csvFile = path.join(CSV_DIR, `${symbol.replace(/[^a-zA-Z0-9.]/g, '_')}.csv`);
  const header = 'timestamp,price,change,changePercent,previousClose,dayRange,volume,marketState\n';

  const row = [
    q.timestamp, safe(q.price), safe(q.change), safe(q.changePercent),
    safe(q.previousClose), safe(q.dayRange), safe(q.volume), safe(q.marketState),
  ].join(',');

  const existing = fs.existsSync(csvFile) ? fs.readFileSync(csvFile, 'utf8') : header;
  const lines = existing.split('\n').filter(l => l.trim());
  const bodyLines = lines.slice(1);

  // One row per calendar day (Taiwan time) — re-running the same day just
  // refreshes today's row instead of piling up duplicates.
  const today = q.timestamp.slice(0, 10);
  const filtered = bodyLines.filter(l => !l.startsWith(today));
  const combined = header + row + '\n' + filtered.join('\n') + (filtered.length ? '\n' : '');
  fs.writeFileSync(csvFile, combined);
  console.log(`  Updated csv/${path.basename(csvFile)}: ${q.price} (${q.change}, ${q.changePercent})`);
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
    for (const symbol of SYMBOLS) {
      console.log(`Fetching ${symbol}...`);
      try {
        const q = await scrapeQuote(page, symbol);
        writeQuoteRow(symbol, q);
      } catch (err) {
        console.error(`  [!] ${symbol} failed: ${err.message}`);
        failed.push(symbol);
        await page.screenshot({ path: `error-${symbol.replace(/[^a-zA-Z0-9.]/g, '_')}.png` }).catch(() => {});
      }
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (failed.length) {
    console.log(`\nCompleted with failures on: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

(async () => {
  await acquireLock();
  try {
    await main();
  } finally {
    releaseLock();
  }
})();
