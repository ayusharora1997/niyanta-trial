const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──────────────────────────────────────────────────────────────────
const DEFAULT_URL =
  'https://dir.indiamart.com/search.mp?ss=tshirts+gsm+360&v=4&mcatid=2893&catid=722&cq=bengaluru&c_src=as-userCity%7Cpos%3D2&cityid=70532&cq_src=city-search&crs=csugg-city&tags=res:RC3|ktp:N0|stype:attr=1|mtp:G|wc:3|lcf:3|cq:bengaluru|qr_nm:gl-gd|cs:20373|com-cf:nl|ptrs:na|mc:2893|cat:722|qry_typ:P|msc:3|lang:en|tyr:1|qrd:260517|mrd:260517|prdt:260517|msf:ms|pfen:1|gli:U0G0I0|gc:Bengaluru|ic:Bengaluru|scw:1|lf:5|emt:0';

const OUTPUT_MD   = path.join(__dirname, 'output.md');
const OUTPUT_JSON = path.join(__dirname, 'output.json');
// ────────────────────────────────────────────────────────────────────────────

async function scrape(targetUrl) {
  const TARGET_URL = targetUrl || process.env.INDIAMART_URL || DEFAULT_URL;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  console.log('Navigating to IndiaMART search…');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the first vendor card
  await page.waitForSelector('div.card', { timeout: 20000 }).catch(() => {
    console.warn('Selector div.card not found — page may have changed structure.');
  });

  // Scroll to trigger lazy-loaded cards
  console.log('Scrolling to load all results…');
  await autoScroll(page);

  console.log('Extracting vendor data…');
  const vendors = await page.evaluate(() => {
    const results = [];

    document.querySelectorAll('div.card[id^="LST"]').forEach((card, idx) => {
      const getText = (sel) => card.querySelector(sel)?.innerText?.trim() || '';

      // ── From data attributes (fast & reliable)
      const city     = card.getAttribute('data-city')     || '';
      const locality = card.getAttribute('data-locality') || '';
      const rating   = card.getAttribute('data-rating')   || '';
      const slug     = card.getAttribute('data-tscode')   || '';

      // ── Company name
      const nameAnchor = card.querySelector('div.companyname a.cardlinks');
      const name = nameAnchor?.innerText?.trim() || `Vendor ${idx + 1}`;

      // ── Profile URL (clean — strip tracking params)
      let profileUrl = nameAnchor?.href || '';
      try { profileUrl = new URL(profileUrl).origin + new URL(profileUrl).pathname; } catch (_) {}

      // ── Location display
      const locationEl = card.querySelector('.newLocationUi');
      const locationText = locationEl?.innerText?.trim().replace(/\s+/g, ' ') || [city, locality].filter(Boolean).join(' - ');

      // ── Member since
      const memberText = getText('span.memberSinceDisplay') ||
                         getText('.memberSinceDisplay');

      // ── Review count
      const reviewEl = card.querySelector('[id^="sellerrating_"] span.color');
      const reviews  = reviewEl?.innerText?.trim() || '';

      // ── GST / TrustSEAL badges
      const gstVerified  = !!card.querySelector('[class*="gst"], [alt*="GST"], [title*="GST"]') ||
                           /\bGST\b/.test(card.innerText);
      const trustSeal    = !!card.querySelector('[class*="trust"], [alt*="Trust"]') ||
                           /TrustSEAL/i.test(card.innerText);

      // ── Product listings within the card
      const productItems = [];
      card.querySelectorAll('.prd-name, .product-name, [class*="prdname"], h4, .prdtitle').forEach(el => {
        const t = el.innerText.trim();
        if (t && t.length < 120) productItems.push(t);
      });

      // ── Price range (if shown on listing card)
      const priceText = getText('[class*="price"], [class*="prc"]');

      // ── Deals-in note (vendors outside Bengaluru who deal there)
      const dealsIn = locationText.includes('Deals in') ? locationText : '';

      results.push({
        index: idx + 1,
        name,
        city,
        locality,
        location: locationText,
        dealsIn,
        rating,
        reviews,
        memberSince: memberText,
        gstVerified,
        trustSeal,
        products: productItems,
        price: priceText,
        profileUrl,
        slug,
      });
    });

    return results;
  });

  await browser.close();

  // ── Build Markdown ─────────────────────────────────────────────────────────
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const lines = [];

  lines.push(`# IndiaMART — T-Shirts 360 GSM, Bengaluru`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Query** | T-Shirts GSM 360 — Bengaluru |`);
  lines.push(`| **Scraped** | ${now} |`);
  lines.push(`| **Vendors found** | ${vendors.length} |`);
  lines.push(`| **Source** | [View on IndiaMART](${TARGET_URL}) |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (vendors.length === 0) {
    lines.push('> **No vendor cards matched selector `div.card[id^="LST"]`.** Check `debug_page.html` to verify page structure.');
  }

  // Group: Bengaluru-based vs. deals-in
  const local    = vendors.filter(v => !v.dealsIn);
  const dealsin  = vendors.filter(v => v.dealsIn);

  const renderGroup = (group, header) => {
    if (group.length === 0) return;
    lines.push(`## ${header} (${group.length})`);
    lines.push('');
    group.forEach((v) => {
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

  renderGroup(local,   '🏙️ Bengaluru-based Vendors');
  renderGroup(dealsin, '🚚 Deals in Bengaluru (based elsewhere)');

  const markdown = lines.join('\n');

  fs.writeFileSync(OUTPUT_MD,   markdown, 'utf8');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ scraped: now, count: vendors.length, vendors }, null, 2), 'utf8');

  console.log(`\nDone! ${vendors.length} vendors scraped (local: ${local.length}, deals-in: ${dealsin.length})`);

  return { vendors, markdown, local, dealsin };
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const dist = 700;
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

// Run standalone or export as module
if (require.main === module) {
  scrape().catch((err) => { console.error('Scraper error:', err); process.exit(1); });
}

module.exports = { runSearch: scrape };
