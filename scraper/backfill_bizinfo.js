/**
 * backfill_bizinfo.js
 * Re-scrapes IndiaMART profiles for all vendors missing bizInfo (legal_status = null).
 * Applies only the business detail fields — does NOT touch TrustSEAL, GSTIN, or address.
 *
 * Usage:  node backfill_bizinfo.js
 *         node backfill_bizinfo.js 20     ← limit to 20 vendors
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { scrapeIndiamartProfile } = require('./profile_scraper');
const db = require('./db');

const LIMIT = parseInt(process.argv[2] || '100');
const DELAY = 2500;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log(`\nBackfill bizInfo — fetching up to ${LIMIT} vendors missing legal_status...\n`);

  const vendors = await db.getVendorsMissingBizInfo(LIMIT);
  console.log(`Found ${vendors.length} vendors to backfill.\n`);
  if (!vendors.length) { console.log('Nothing to do.'); return; }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    // Prefer indiamart_url, fall back to slug-derived URL
    const profileUrl = v.indiamart_url ||
      (v.slug ? `https://www.indiamart.com/${v.slug}/` : null);

    process.stdout.write(`[${i+1}/${vendors.length}] ${v.company_name} ... `);

    if (!profileUrl) {
      console.log('SKIP (no URL)');
      skipped++;
      continue;
    }

    const profile = await scrapeIndiamartProfile(page, profileUrl);

    if (!profile || Object.keys(profile.bizInfo || {}).length === 0) {
      console.log('SKIP (no bizInfo on page)');
      skipped++;
      await sleep(DELAY);
      continue;
    }

    await db.patchVendorBizInfo(v.id, profile);
    updated++;
    await sleep(DELAY);
  }

  await browser.close();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done. Updated: ${updated}  Skipped: ${skipped}`);
})().catch(e => { console.error(e); process.exit(1); });
