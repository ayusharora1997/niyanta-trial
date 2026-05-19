const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──────────────────────────────────────────────────────────────────
const DEFAULT_KEYWORD = 'tshirts 360 gsm';
const MAX_PAGES = parseInt(process.env.MAX_PAGES) || 3;

const OUTPUT_MD   = path.join(__dirname, 'output.md');
const OUTPUT_JSON = path.join(__dirname, 'output.json');
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build an IndiaMART search URL from a plain keyword string.
 * e.g. "cotton fabric" → "https://dir.indiamart.com/search.mp?ss=cotton+fabric"
 */
function buildSearchUrl(keyword) {
  return `https://dir.indiamart.com/search.mp?ss=${encodeURIComponent(keyword).replace(/%20/g, '+')}`;
}

/**
 * Run a search scrape.
 * @param {string} targetUrlOrKeyword  A full IndiaMART search URL, OR a plain
 *                                     keyword string (no "http" prefix).
 */
async function scrape(targetUrlOrKeyword, logFn) {
  const log = logFn || console.log;
  log('[SCRAPER] scrape() called — target: ' + (targetUrlOrKeyword || '(default)'));
  const raw = targetUrlOrKeyword
    || process.env.SEARCH_KEYWORD
    || process.env.INDIAMART_KEYWORD
    || process.env.INDIAMART_URL
    || DEFAULT_KEYWORD;

  const TARGET_URL = raw.startsWith('http') ? raw : buildSearchUrl(raw);

  log('[SCRAPER] Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1440,900',
    ],
  });

  const proxy = process.env.PROXY_SERVER ? {
    server: process.env.PROXY_SERVER,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  } : undefined;
  if (proxy) log(`[SCRAPER] Routing through proxy: ${proxy.server}`);

  const context = await browser.newContext({
    ...(proxy ? { proxy } : {}),
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });

  // Patch away the most common bot-detection signals
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  log('[NAV] Navigating to: ' + TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(async (err) => {
    log('[NAV] networkidle timed out, falling back: ' + err.message);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
  });

  const finalUrl  = page.url();
  const pageTitle = await page.title();
  log(`[NAV] Landed on: "${pageTitle}" | ${finalUrl}`);

  // IndiaMART redirects non-Indian IPs to export.indiamart.com which shows a
  // full-page language selector before showing results. Click "English" to proceed.
  if (finalUrl.includes('export.indiamart.com')) {
    log('[NAV] Detected export site — clicking English on language selector...');
    try {
      await page.waitForSelector('text=English', { timeout: 10000 });
      await page.click('text=English');
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForTimeout(2000);
      log('[NAV] Language selected. Now on: ' + page.url());
    } catch (err) {
      log('[NAV] Could not click English: ' + err.message);
    }
  }

  // Wait for any vendor card to appear — covers dir.indiamart.com (data-tscode/div.card)
  // and export.indiamart.com (Tailwind cards containing /company/ links)
  const cardFound = await page.waitForSelector('[data-tscode], div.card, .product-list-item, .supplier-card, a[href*="/company/"]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!cardFound) {
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '(empty)');
    log('[NAV] No vendor cards found. Page text: ' + bodySnippet);
    try {
      await page.screenshot({ path: path.join(__dirname, 'debug_no_cards.png'), fullPage: true });
      const html = await page.content();
      fs.writeFileSync(path.join(__dirname, 'debug_no_cards.html'), html, 'utf8');
      log('[NAV] Saved debug_no_cards.png and debug_no_cards.html');
    } catch (e) { log('[NAV] Screenshot/HTML dump failed: ' + e.message); }
  }

  // ── Detect active filters from the first page only ────────────────────────
  log('[FILTER] Detecting active filters...');
  const activeFilters = await page.evaluate(() => {
    const candidates = [];
    const selectors = [
      '.filter-applied',
      '[data-filter]',
      '[class*="filter"][class*="appl"]',
      '[class*="applied"][class*="filter"]',
      '[class*="bread"] span',
      '[class*="crumb"] span',
      '[class*="chip"]',
      '[class*="tag"]',
    ];

    const cleanText = (v) => (v || '').replace(/[×✕✖]/g, '').replace(/\s+/g, ' ').trim();
    const titleCase = (v) => cleanText(v).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const fromText = (text, el) => {
      const cleaned = cleanText(text);
      if (!cleaned || cleaned.length < 2 || cleaned.length > 90) return null;
      if (/^(filters?|clear all|clear|sort by|view|results?)$/i.test(cleaned)) return null;

      const dataLabel = el?.getAttribute?.('data-filter-label') || el?.getAttribute?.('data-label') || el?.getAttribute?.('aria-label');
      const dataValue = el?.getAttribute?.('data-filter-value') || el?.getAttribute?.('data-value') || el?.getAttribute?.('data-filter');

      if (dataValue && dataLabel && cleanText(dataValue) !== cleanText(dataLabel)) {
        return { label: titleCase(dataLabel), value: cleanText(dataValue) };
      }

      const labelled = cleaned.match(/^([^:]+?)\s*[:：]\s*(.+)$/) || cleaned.match(/^(.+?)\s*(?:->|→)\s*(.+)$/);
      if (labelled) return { label: titleCase(labelled[1]), value: cleanText(labelled[2]) };

      const heading = el?.closest?.('section, div')?.querySelector?.('h1,h2,h3,h4,[class*="title"],[class*="label"]')?.innerText;
      const parentText = cleanText(el?.parentElement?.innerText || '');
      const parentLabel = parentText.includes(cleaned) ? cleanText(parentText.replace(cleaned, '')) : '';
      return { label: titleCase(dataLabel || heading || parentLabel || 'Filter'), value: cleaned };
    };

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = fromText(el.innerText || el.textContent, el);
        if (item) candidates.push(item);
      });
    });

    const paramLabels = { cq: 'Location', city: 'Location', cityid: 'Location', minprice: 'Min Price', maxprice: 'Max Price', bizCr: 'Business Credential', bizcr: 'Business Credential' };
    for (const [key, value] of new URL(window.location.href).searchParams.entries()) {
      if (!value) continue;
      if (key.toLowerCase().startsWith('q-')) candidates.push({ label: titleCase(key.slice(2)), value: cleanText(value) });
      else if (paramLabels[key]) candidates.push({ label: paramLabels[key], value: cleanText(value) });
    }

    const seen = new Set();
    return candidates.filter(item => {
      if (!item.label || !item.value || item.label === item.value) return false;
      const key = `${item.label.toLowerCase()}::${item.value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  });

  log(`[FILTER] ${activeFilters.length} filter(s): ${activeFilters.map(f => `${f.label}=${f.value}`).join(', ') || 'none'}`);

  // ── Paginated scrape — up to MAX_PAGES ────────────────────────────────────
  const allVendors = [];
  const seenKeys   = new Set();
  let   pageNum    = 1;

  while (pageNum <= MAX_PAGES) {
    if (pageNum > 1) {
      const pageUrl = new URL(TARGET_URL);
      pageUrl.searchParams.set('page', pageNum);
      log(`[NAV] Page ${pageNum}/${MAX_PAGES}: ${pageUrl.toString()}`);
      await page.goto(pageUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-tscode], div.card', { timeout: 15000 }).catch(() => {});
    }

    log(`[SCRAPE] Scrolling page ${pageNum}…`);
    await autoScroll(page);

    log(`[SCRAPE] Extracting vendor cards from page ${pageNum}…`);
    const pageVendors = await page.evaluate(() => {
      const results = [];

      const isExport = location.hostname.includes('export.indiamart.com');

      let cards;
      if (isExport) {
        // export.indiamart.com renders one card per product. The vendor link
        // (a[href*="/company/"]) is unique per card, so anchor on it and walk
        // up to the card container.
        const vendorAnchors = Array.from(document.querySelectorAll('a[href*="/company/"]'));
        cards = vendorAnchors.map(a => a.closest('div.bg-white.rounded-lg') || a.closest('[class*="rounded-lg"][class*="border"]') || a.parentElement?.parentElement?.parentElement).filter(Boolean);
        cards = [...new Set(cards)];
        console.log('[SCRAPE] Card strategy: export vendor-anchor —', cards.length, 'cards');
      } else if (document.querySelector('[data-tscode]')) {
        cards = Array.from(document.querySelectorAll('[data-tscode]'));
        console.log('[SCRAPE] Card strategy: data-tscode —', cards.length, 'cards');
      } else if (document.querySelector('[id^="LST"]')) {
        cards = Array.from(document.querySelectorAll('[id^="LST"]'));
        console.log('[SCRAPE] Card strategy: id^=LST —', cards.length, 'cards');
      } else if (document.querySelector('[id^="SUPP"]')) {
        cards = Array.from(document.querySelectorAll('[id^="SUPP"]'));
        console.log('[SCRAPE] Card strategy: id^=SUPP —', cards.length, 'cards');
      } else {
        cards = Array.from(document.querySelectorAll(
          'div.card, [class*="supplier-card"], [class*="sellerCard"], ' +
          '[class*="product-list"], [class*="supplierList"], ' +
          'li[class*="supplier"], li[class*="seller"], article[class*="card"]'
        )).filter(el => el.querySelector('a[href*="indiamart.com"]') || el.getAttribute('data-city'));
        console.log('[SCRAPE] Card strategy: broad fallback —', cards.length, 'cards');
      }

      cards.forEach((card, idx) => {
        const getText = (sel) => card.querySelector(sel)?.innerText?.trim() || '';
        const cardText = card.innerText || '';

        if (isExport) {
          // Export site card: vendor link is /company/{id}/?..., product link is /products/?id=...
          const vendorAnchor = card.querySelector('a[href*="/company/"]');
          if (!vendorAnchor) return;
          const name = vendorAnchor.innerText.trim();
          let profileUrl = vendorAnchor.href || '';
          const slugMatch = profileUrl.match(/\/company\/(\d+)/);
          const slug = slugMatch ? slugMatch[1] : '';
          try { profileUrl = new URL(profileUrl).origin + new URL(profileUrl).pathname; } catch (_) {}

          const productAnchor = card.querySelector('a[href*="/products/"]');
          const productName = productAnchor?.innerText?.trim() || '';

          // Price is the first <p> containing a currency symbol or "Price"
          let priceText = '';
          card.querySelectorAll('p').forEach(p => {
            const t = p.innerText.trim();
            if (!priceText && /[$₹€£]|\/\s*(Meter|Piece|Kg|Unit)/i.test(t)) priceText = t.replace(/\s+/g, ' ');
          });

          const gstVerified = /GST\s*Verified/i.test(cardText);
          const trustSeal   = /TrustSEAL/i.test(cardText);
          const verifiedExporter = /Verified\s*Exporter/i.test(cardText);
          const iecVerified = /IEC\s*Verified/i.test(cardText);

          const ratingMatch  = cardText.match(/(\d\.\d)\s*\(\s*(\d+)\s*\)/);
          const rating  = ratingMatch ? ratingMatch[1] : '';
          const reviews = ratingMatch ? `(${ratingMatch[2]})` : '';

          const exportsToMatch  = cardText.match(/Exports\s*To:\s*([^\n]+)/i);
          const sinceMatch      = cardText.match(/Exporting\s*Since:?\s*([^\n]+)/i);
          const location_       = exportsToMatch ? `Exports To: ${exportsToMatch[1].trim()}` : '';
          const memberText      = sinceMatch ? sinceMatch[1].trim() : '';

          if (!slug && !profileUrl) return;
          results.push({
            index: idx + 1, name, city: '', locality: '', location: location_, dealsIn: '',
            rating, reviews, memberSince: memberText,
            gstVerified, trustSeal, verifiedExporter, iecVerified,
            products: productName ? [productName] : [],
            price: priceText, profileUrl, slug,
          });
          return;
        }

        // ── dir.indiamart.com / legacy card path ───────────────────────────────
        const city     = card.getAttribute('data-city')     || '';
        const locality = card.getAttribute('data-locality') || '';
        const rating   = card.getAttribute('data-rating')   || '';
        const slug     = card.getAttribute('data-tscode')   || '';

        const nameAnchor = card.querySelector('div.companyname a, [class*="companyname"] a, [class*="company-name"] a, a.cardlinks');
        const name = nameAnchor?.innerText?.trim()
          || card.querySelector('h2, h3, [class*="name"]')?.innerText?.trim()
          || `Vendor ${idx + 1}`;

        let profileUrl = nameAnchor?.href || card.querySelector('a[href*="indiamart.com"]')?.href || '';
        try { profileUrl = new URL(profileUrl).origin + new URL(profileUrl).pathname; } catch (_) {}

        const locationEl   = card.querySelector('[class*="location"], [class*="Location"], [class*="city"]');
        const locationText = locationEl?.innerText?.trim().replace(/\s+/g, ' ')
          || [city, locality].filter(Boolean).join(' - ');

        const memberText = getText('[class*="memberSince"], [class*="member-since"], span.memberSinceDisplay');
        const reviewEl   = card.querySelector('[id^="sellerrating_"] span, [class*="rating"] span');
        const reviews    = reviewEl?.innerText?.trim() || '';

        const gstVerified = !!card.querySelector('[class*="gst"], [alt*="GST"], [title*="GST"]') || /\bGST\b/.test(cardText);
        const trustSeal   = !!card.querySelector('[class*="trust"], [alt*="Trust"]') || /TrustSEAL/i.test(cardText);

        const productItems = [];
        card.querySelectorAll('[class*="prd-name"], [class*="product-name"], [class*="prdname"], [class*="prdtitle"]').forEach(el => {
          const t = el.innerText.trim();
          if (t && t.length < 120) productItems.push(t);
        });

        const priceText = getText('[class*="price"], [class*="prc"]');
        const dealsIn   = locationText.includes('Deals in') ? locationText : '';

        if (!slug && !profileUrl && !city) return;

        results.push({ index: idx + 1, name, city, locality, location: locationText, dealsIn, rating, reviews, memberSince: memberText, gstVerified, trustSeal, products: productItems, price: priceText, profileUrl, slug });
      });
      return results;
    });

    let newCount = 0;
    for (const v of pageVendors) {
      const key = v.profileUrl || `${v.name}::${v.slug}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allVendors.push(v);
        newCount++;
      }
    }

    log(`[SCRAPE] Page ${pageNum}: ${pageVendors.length} cards found, ${newCount} new`);

    if (pageVendors.length === 0) {
      const snippet = await page.evaluate(() => (document.body?.innerText || '').substring(0, 400));
      log('[DEBUG] Page body text: ' + snippet);
    }

    if (newCount === 0 || pageVendors.length === 0) {
      log('[SCRAPE] No new vendors — stopping pagination.');
      break;
    }

    pageNum++;
  }

  await browser.close();

  const vendors = allVendors;
  log(`[DONE] ${vendors.length} vendors total across ${Math.min(pageNum, MAX_PAGES)} page(s) | active filters: ${activeFilters.length}`);

  // ── Build Markdown ─────────────────────────────────────────────────────────
  const now   = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const lines = [];

  lines.push(`# IndiaMART — ${raw}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Query** | ${raw} |`);
  lines.push(`| **Scraped** | ${now} |`);
  lines.push(`| **Vendors found** | ${vendors.length} |`);
  lines.push(`| **Source** | [View on IndiaMART](${TARGET_URL}) |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (vendors.length === 0) {
    lines.push('> **No vendor cards matched selector `div.card[id^="LST"]`.**');
  }

  const local   = vendors.filter(v => !v.dealsIn);
  const dealsin = vendors.filter(v =>  v.dealsIn);

  const renderGroup = (group, header) => {
    if (!group.length) return;
    lines.push(`## ${header} (${group.length})`);
    lines.push('');
    group.forEach(v => {
      lines.push(`### ${v.index}. ${v.name}`);
      lines.push('');
      if (v.location)    lines.push(`- **Location:** ${v.location}`);
      if (v.memberSince) lines.push(`- **Member:** ${v.memberSince}`);
      const ratingStr = [v.rating, v.reviews].filter(Boolean).join(' ');
      if (ratingStr)     lines.push(`- **Rating:** ${ratingStr}`);
      const badges = [v.gstVerified && 'GST Verified', v.trustSeal && 'TrustSEAL'].filter(Boolean);
      if (badges.length) lines.push(`- **Badges:** ${badges.join(', ')}`);
      if (v.price)       lines.push(`- **Price:** ${v.price}`);
      if (v.products.length) lines.push(`- **Products:** ${v.products.slice(0, 3).join(', ')}`);
      if (v.profileUrl)  lines.push(`- **Profile:** [${v.name}](${v.profileUrl})`);
      lines.push('');
    });
    lines.push('---');
    lines.push('');
  };

  renderGroup(local,   '🏙️ Local Vendors');
  renderGroup(dealsin, '🚚 Deals-In Vendors');

  const markdown = lines.join('\n');
  fs.writeFileSync(OUTPUT_MD,   markdown, 'utf8');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ scraped: now, keyword: raw, url: TARGET_URL, count: vendors.length, activeFilters, vendors }, null, 2), 'utf8');

  return { vendors, markdown, local, dealsin, activeFilters };
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const dist  = 700;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
  await page.waitForTimeout(2000);
}

// Run standalone: node scraper.js "cotton fabric"  OR  node scraper.js https://...
if (require.main === module) {
  const input = process.argv[2] || process.env.SEARCH_KEYWORD || process.env.INDIAMART_KEYWORD;
  scrape(input).catch(err => { console.error('[ERROR]', err); process.exit(1); });
}

module.exports = { runSearch: scrape, buildSearchUrl };
