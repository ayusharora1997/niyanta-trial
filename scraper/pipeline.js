require('dotenv').config();

const { runSearch, buildSearchUrl } = require('./scraper');
const { enrichVendors }             = require('./profile_scraper');
const { extractFilters, generateFilterUrls } = require('./filter_scraper');
const db = require('./db');

// ── Inputs from GitHub Actions env vars ──────────────────────────────────────
const searchId      = process.env.SEARCH_ID;
const rawUrl        = process.env.SEARCH_URL;
const keyword       = process.env.SEARCH_KEYWORD  || '';
const searchName    = process.env.SEARCH_NAME     || '';
const maxFilterUrls = parseInt(process.env.MAX_FILTER_URLS) || 5;
const combineDepth  = parseInt(process.env.COMBINE_DEPTH)   || 2;
const platform      = process.env.PLATFORM || 'indiamart';
const country       = process.env.COUNTRY  || 'India';

if (!searchId) { console.error('SEARCH_ID is required'); process.exit(1); }
const url = rawUrl || (keyword ? buildSearchUrl(keyword) : null);
if (!url)      { console.error('SEARCH_URL or SEARCH_KEYWORD is required'); process.exit(1); }

const log = (msg) => console.log(`[${searchId}] ${msg}`);

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Get the search_run record the server already created, or create it if missing
  let run;
  try {
    run = await db.getSearchRun(searchId);
    log('Resuming existing run record...');
  } catch (_) {
    log('Creating DB record...');
    run = await db.createSearchRun({
      searchId, searchName, keyword: keyword || searchName || url,
      searchUrl: url, platform, country,
    });
  }

  const seenSlugs = new Set();
  let totalSaved  = 0;
  let urlsDone    = 0;

  // ── Per-URL: Layer 1 (scrape) then Layer 2 (enrich + save) ─────────────────
  async function processUrl(targetUrl, label) {
    log(`${label} -- Layer 1: scraping search results...`);
    await db.updateSearchRun(searchId, { status: 'scraping_search' }).catch(() => {});

    const { vendors, activeFilters } = await runSearch(targetUrl, log);

    if (label === 'Base URL' && Array.isArray(activeFilters) && activeFilters.length) {
      await db.updateSearchRun(searchId, { filters_applied: activeFilters }).catch(() => {});
    }

    const newVendors = vendors.filter(v => {
      const key = v.slug || v.profileUrl;
      if (key && seenSlugs.has(key)) return false;
      if (key) seenSlugs.add(key);
      return true;
    });

    log(`${label} -- Layer 1 done: ${vendors.length} found, ${newVendors.length} new (${vendors.length - newVendors.length} duplicates skipped)`);

    if (!newVendors.length) {
      log(`${label} -- Layer 2: skipped (no new vendors)`);
      return 0;
    }

    log(`${label} -- Layer 2: enriching ${newVendors.length} vendor profiles...`);
    await db.updateSearchRun(searchId, { status: 'enriching_profiles' }).catch(() => {});

    const enriched = await enrichVendors(newVendors, (entry, done, total) => {
      log(`${label} -- Layer 2 [${done}/${total}]: ${entry.name}`);
    });

    await db.updateSearchRun(searchId, { status: 'saving' }).catch(() => {});
    let saved = 0;
    for (const v of enriched) {
      const result = await db.upsertVendor(v, run.id);
      if (result) saved++;
    }

    log(`${label} -- Layer 2 done: ${saved} vendors saved`);
    return saved;
  }

  try {
    // Base URL
    totalSaved += await processUrl(url, 'Base URL');
    urlsDone    = 1;
    await db.updateSearchRun(searchId, { pages_scraped: urlsDone, vendors_found: seenSlugs.size });

    // Discover and run filter URLs
    log('Discovering attribute filters from base page...');
    const filters    = await extractFilters(url);
    const groupNames = Object.keys(filters);

    if (!groupNames.length) {
      log('No attribute filters found — base URL was the only pass.');
    } else {
      log(`Filter groups found: ${groupNames.join(', ')}`);
      const allFilterUrls = generateFilterUrls(url, filters, { combineDepth });
      const filterUrls    = allFilterUrls.slice(0, maxFilterUrls);
      log(`Generated ${allFilterUrls.length} filter URLs — using first ${filterUrls.length}...`);

      for (let i = 0; i < filterUrls.length; i++) {
        const label = `Filter ${i + 1}/${filterUrls.length}`;
        try {
          totalSaved += await processUrl(filterUrls[i], label);
        } catch (err) {
          log(`${label} -- WARN: ${err.message}`);
        }
        urlsDone++;
        await db.updateSearchRun(searchId, { pages_scraped: urlsDone, vendors_found: seenSlugs.size });
      }
    }

    // Mark complete
    await db.updateSearchRun(searchId, {
      status:           'completed',
      completed_at:     new Date().toISOString(),
      vendors_found:    seenSlugs.size,
      vendors_inserted: totalSaved,
      pages_scraped:    urlsDone,
      duration_seconds: Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000),
    });

    log(`Pipeline complete — ${totalSaved} vendors saved across ${urlsDone} URL(s).`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await db.updateSearchRun(searchId, {
      status:        'error',
      error_message: err.message,
      error_text:    err.stack?.substring(0, 1000),
      completed_at:  new Date().toISOString(),
    }).catch(() => {});
    process.exit(1);
  }
}

main();
