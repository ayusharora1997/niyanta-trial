require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');

const { runSearch, buildSearchUrl } = require('./scraper');
const { enrichVendors, buildMarkdown } = require('./profile_scraper');
const { extractFilters, generateFilterUrls } = require('./filter_scraper');
const db = require('./db');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ── In-memory job progress store (keyed by searchId) ─────────────────────────
const jobs = {};  // { [searchId]: { status, progress, total, log, error } }

// ── FIFO job queue ────────────────────────────────────────────────────────────
const jobQueue = [];   // { searchId, fn }
let queueRunning = false;

function enqueueJob(searchId, fn) {
  jobQueue.push({ searchId, fn });
  refreshQueuePositions();
  if (!queueRunning) drainQueue();
}

function refreshQueuePositions() {
  jobQueue.forEach(({ searchId: sid }, idx) => {
    if (jobs[sid]) jobs[sid].queuePosition = idx + 1;
  });
}

async function drainQueue() {
  if (queueRunning || !jobQueue.length) return;
  queueRunning = true;
  const { searchId: sid, fn } = jobQueue.shift();
  if (jobs[sid]) jobs[sid].queuePosition = 0;
  refreshQueuePositions();
  try { await fn(); } catch { /* errors handled inside fn */ }
  finally { queueRunning = false; drainQueue(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scrape
// Body: { url, searchName?, keyword?, platform?, country?, clientId? }
// Returns immediately with { searchId } — poll /api/runs/:searchId for status
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const { searchName, keyword, platform, country, clientId, maxFilterUrls = 5, combineDepth = 2 } = req.body;
  let { url } = req.body;

  if (!url && !keyword) return res.status(400).json({ error: 'url or keyword is required' });
  if (!url) url = buildSearchUrl(keyword);

  const searchId = `sr-${uuidv4()}`;
  jobs[searchId] = { status: 'queued', progress: 0, total: 0, log: [], error: null, filterUrlCount: 0, queuePosition: jobQueue.length + 1 };

  res.json({ searchId, message: 'Job queued. Poll /api/runs/:searchId for status.' });

  // Runs base URL first (Layer 1 + Layer 2), then up to maxFilterUrls filter
  // URLs (each Layer 1 + Layer 2).  Frontend only needs to send the URL.
  enqueueJob(searchId, () => runMultiPipeline({ searchId, url, searchName, keyword, platform, country, clientId, combineDepth, maxFilterUrls }).catch(err => {
    console.error(`[${searchId}] Pipeline crashed:`, err.message);
    jobs[searchId] = { ...jobs[searchId], status: 'error', error: err.message };
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/filters?url=...
// Returns discovered filter groups for a given IndiaMART search URL without
// running any scrape.  Use this to verify filter discovery is working before
// kicking off a full multi-scrape.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/filters', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param is required' });
  try {
    const filters = await extractFilters(url);
    // Return group names + value labels only (not full URLs — keeps response readable)
    const summary = Object.fromEntries(
      Object.entries(filters).map(([g, items]) => [g, items.map(i => i.label)])
    );
    res.json({
      groups:      Object.keys(filters).length,
      totalValues: Object.values(filters).reduce((s, v) => s + v.length, 0),
      filters:     summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scrape/multi
// Body: { url, searchName?, keyword?, clientId?, combineDepth? }
//
// Discovers all attribute-based filters on the given IndiaMART search page,
// then scrapes each filter URL (single-filter + 2-filter combos by default).
// Vendors are deduplicated by slug before enrichment so each is only enriched
// once, regardless of how many filter URLs it appears in.
//
// Returns immediately with { searchId, filterUrlCount } — poll /api/runs/:searchId.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/scrape/multi', async (req, res) => {
  const { searchName, keyword, platform, country, clientId, combineDepth, maxFilterUrls } = req.body;
  let { url } = req.body;

  if (!url && !keyword) return res.status(400).json({ error: 'url or keyword is required' });
  if (!url) url = buildSearchUrl(keyword);

  const searchId = `sr-${uuidv4()}`;
  jobs[searchId] = { status: 'queued', progress: 0, total: 0, log: [], error: null, filterUrlCount: 0, queuePosition: jobQueue.length + 1 };

  res.json({ searchId, message: 'Job queued. Poll /api/runs/:searchId for status.' });

  enqueueJob(searchId, () => runMultiPipeline({ searchId, url, searchName, keyword, platform, country, clientId, combineDepth, maxFilterUrls }).catch(err => {
    console.error(`[${searchId}] Multi-pipeline crashed:`, err.message);
    jobs[searchId] = { ...jobs[searchId], status: 'error', error: err.message };
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/runs
// Returns the 20 most recent search runs
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/runs', async (_, res) => {
  try {
    const runs = await db.listSearchRuns(30);
    // Merge live job state for in-progress runs
    const merged = runs.map(r => ({
      ...r,
      _live: jobs[r.search_id] || null,
    }));
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/runs/:searchId
// Returns run metadata + all enriched vendors for that run
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/runs/:searchId', async (req, res) => {
  const { searchId } = req.params;
  try {
    // If the job is still in-memory (queued/running), return live state
    if (jobs[searchId] && jobs[searchId].status !== 'completed' && jobs[searchId].status !== 'error') {
      return res.json({ run: null, vendors: [], _live: jobs[searchId] });
    }

    const run = await db.getSearchRun(searchId);
    const vendors = await db.getVendorsByRunId(run.id);
    res.json({ run, vendors, _live: jobs[searchId] || null });
  } catch (err) {
    // Might not be in DB yet
    if (jobs[searchId]) return res.json({ run: null, vendors: [], _live: jobs[searchId] });
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/runs/:searchId/markdown
// Returns the enriched markdown for a completed run
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/runs/:searchId/markdown', async (req, res) => {
  const { searchId } = req.params;
  try {
    const run     = await db.getSearchRun(searchId);
    const vendors = await db.getVendorsByRunId(run.id);
    const now     = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Reconstruct enriched shape for buildMarkdown
    const enriched = vendors.map((v, i) => ({
      index:      i + 1,
      name:       v.company_name,
      city:       v.city,
      location:   [v.city, v.state].filter(Boolean).join(', '),
      rating:     v.indiamart_rating?.toString(),
      reviews:    v.indiamart_review_count?.toString(),
      price:      v.price_range_inr_low ? `₹ ${v.price_range_inr_low}/${v.price_unit || 'Piece'}` : null,
      profileUrl: v.indiamart_url,
      profile:    v.indiamart_extract ? { ...v.indiamart_extract, phone: v.primary_contact_phone, bizInfo: v.indiamart_extract.bizInfo } : null,
      trustSeal: v.gstin ? {
        gstin:    v.gstin,
        director: v.primary_contact_name,
        address:  v.registered_address,
        cityState: [v.city, v.state].filter(Boolean).join(', '),
        mobileVerified: true, emailVerified: true,
        issueDate: v.indiamart_extract?.trustSealIssued,
        expiryDate: v.indiamart_extract?.trustSealExpires,
      } : null,
      website: v.website_extract ? { ...v.website_extract, baseUrl: v.website } : null,
    }));

    const markdown = buildMarkdown(enriched, now);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(markdown);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────────────────────────────────────
async function runPipeline({ searchId, url, searchName, keyword, platform, country, clientId }) {
  const log = (msg) => {
    console.log(`[${searchId}] ${msg}`);
    if (jobs[searchId]) jobs[searchId].log.push({ ts: Date.now(), msg });
  };

  log('Creating DB record…');
  jobs[searchId].status = 'running';

  // 1. Create search_run record
  const run = await db.createSearchRun({
    searchId, searchName, keyword: keyword || searchName || url,
    searchUrl: url, platform, country, clientId,
  });

  try {
    // 2. Run search scraper
    log('Launching search scraper…');
    jobs[searchId].status = 'scraping_search';
    const { vendors, activeFilters = [] } = await runSearch(url, log);
    jobs[searchId].total = vendors.length;
    log(`Search done — ${vendors.length} vendors found.`);

    await db.updateSearchRun(searchId, {
      vendors_found: vendors.length,
      pages_scraped: 1,
      filters_applied: activeFilters,
    });

    // 3. Enrich each vendor profile
    log('Starting profile enrichment…');
    jobs[searchId].status = 'enriching_profiles';

    const enriched = await enrichVendors(vendors, (entry, done, total) => {
      jobs[searchId].progress = done;
      jobs[searchId].total    = total;
      log(`Enriched [${done}/${total}]: ${entry.name}`);
    });

    // 4. Save vendors to DB
    log('Saving vendors to Supabase…');
    jobs[searchId].status = 'saving';
    let inserted = 0;
    for (const v of enriched) {
      const saved = await db.upsertVendor(v, run.id);
      if (saved) inserted++;
    }

    // 5. Mark run complete
    const now = new Date().toISOString();
    await db.updateSearchRun(searchId, {
      status:              'completed',
      completed_at:        now,
      total_vendors_found: vendors.length,
      vendors_found:       vendors.length,
      vendors_inserted:    inserted,
      duration_seconds:    Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000),
    });

    jobs[searchId].status = 'completed';
    log(`Pipeline complete. ${inserted} vendors saved.`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await db.updateSearchRun(searchId, {
      status:        'error',
      error_message: err.message,
      error_text:    err.stack?.substring(0, 1000),
      completed_at:  new Date().toISOString(),
    }).catch(() => {});
    jobs[searchId].status = 'error';
    jobs[searchId].error  = err.message;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-FILTER PIPELINE
//
// For each filter URL discovered from the base search page, runs runSearch()
// and accumulates a deduplicated vendor pool (by slug).  The full pool is
// enriched once and saved — same enrichment + DB layer as the single-URL
// pipeline, zero changes to scraper.js / profile_scraper.js / db.js.
//
// pages_scraped tracks how many filter URLs have been processed so the CLI
// progress bar gives meaningful feedback during the scraping phase.
// ─────────────────────────────────────────────────────────────────────────────
async function runMultiPipeline({ searchId, url, searchName, keyword, platform, country, clientId, combineDepth = 2, maxFilterUrls = 5 }) {
  const log = (msg) => {
    console.log(`[${searchId}] ${msg}`);
    if (jobs[searchId]) jobs[searchId].log.push({ ts: Date.now(), msg });
  };

  log('Creating DB record...');
  jobs[searchId].status = 'running';

  const run = await db.createSearchRun({
    searchId, searchName, keyword: keyword || searchName || url,
    searchUrl: url, platform, country, clientId,
  });

  // Tracks slugs already enriched across all filter URLs so each vendor is
  // only put through Layer 2 (profile enrichment) once.
  const seenSlugs    = new Set();
  let   totalSaved   = 0;
  let   urlsDone     = 0;

  // ── Per-URL pipeline: Layer 1 (scrape) then Layer 2 (enrich + save) ────────
  // Called once for the base URL, then once per filter URL.
  async function processUrl(targetUrl, label) {
    // Layer 1 -- search scrape
    log(`${label} -- Layer 1: scraping search results...`);
    jobs[searchId].status = 'scraping_search';

    const { vendors, activeFilters } = await runSearch(targetUrl, log);

    // Save detected filters for the base URL pass only
    if (label === 'Base URL' && Array.isArray(activeFilters) && activeFilters.length) {
      await db.updateSearchRun(searchId, { filters_applied: activeFilters }).catch(() => {});
    }

    // Deduplicate against globally seen slugs
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

    // Layer 2 -- profile enrichment
    log(`${label} -- Layer 2: enriching ${newVendors.length} vendor profiles...`);
    jobs[searchId].status   = 'enriching_profiles';
    jobs[searchId].progress = 0;
    jobs[searchId].total    = newVendors.length;

    const enriched = await enrichVendors(newVendors, (entry, done, total) => {
      jobs[searchId].progress = done;
      jobs[searchId].total    = total;
      log(`${label} -- Layer 2 [${done}/${total}]: ${entry.name}`);
    });

    // Save to Supabase
    jobs[searchId].status = 'saving';
    let saved = 0;
    for (const v of enriched) {
      const result = await db.upsertVendor(v, run.id);
      if (result) saved++;
    }

    log(`${label} -- Layer 2 done: ${saved} vendors saved to DB`);
    return saved;
  }
  // ────────────────────────────────────────────────────────────────────────────

  try {
    // ── Base URL: Layer 1 + Layer 2 ──────────────────────────────────────────
    totalSaved += await processUrl(url, 'Base URL');
    urlsDone    = 1;
    await db.updateSearchRun(searchId, { pages_scraped: urlsDone, vendors_found: seenSlugs.size });

    // ── Discover attribute filters from the base page ─────────────────────────
    log('Discovering attribute filters from base page...');
    const filters    = await extractFilters(url);
    const groupNames = Object.keys(filters);

    if (!groupNames.length) {
      log('No attribute filters found on this page -- base URL was the only pass.');
    } else {
      log(`Filter groups found: ${groupNames.join(', ')}`);

      const allFilterUrls = generateFilterUrls(url, filters, { combineDepth });
      const filterUrls    = allFilterUrls.slice(0, maxFilterUrls);
      jobs[searchId].filterUrlCount = filterUrls.length;
      log(`Generated ${allFilterUrls.length} filter URLs -- using first ${filterUrls.length} (maxFilterUrls=${maxFilterUrls})...`);

      // ── Filter URLs: Layer 1 + Layer 2 for each ────────────────────────────
      for (let i = 0; i < filterUrls.length; i++) {
        const label = `Filter ${i + 1}/${filterUrls.length}`;
        try {
          totalSaved += await processUrl(filterUrls[i], label);
        } catch (err) {
          log(`${label} -- WARN: pipeline failed -- ${err.message}`);
        }
        urlsDone++;
        await db.updateSearchRun(searchId, { pages_scraped: urlsDone, vendors_found: seenSlugs.size });
      }
    }

    // ── Mark run complete ─────────────────────────────────────────────────────
    await db.updateSearchRun(searchId, {
      status:           'completed',
      completed_at:     new Date().toISOString(),
      vendors_found:    seenSlugs.size,
      vendors_inserted: totalSaved,
      pages_scraped:    urlsDone,
      duration_seconds: Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000),
    });

    jobs[searchId].status = 'completed';
    log(`Multi-filter pipeline complete -- ${totalSaved} vendors saved across ${urlsDone} URLs (${seenSlugs.size} unique).`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await db.updateSearchRun(searchId, {
      status:        'error',
      error_message: err.message,
      error_text:    err.stack?.substring(0, 1000),
      completed_at:  new Date().toISOString(),
    }).catch(() => {});
    jobs[searchId].status = 'error';
    jobs[searchId].error  = err.message;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Niyanta Scraper API running on http://localhost:${PORT}`);
  console.log(`    POST /api/scrape        — single-URL scrape`);
  console.log(`    POST /api/scrape/multi  — filter-multiplied scrape`);
  console.log(`    GET  /api/filters?url=  — inspect discovered filters for a URL`);
  console.log(`    GET  /api/runs          — list recent runs`);
  console.log(`    GET  /api/runs/:id      — get run + vendors`);
});
