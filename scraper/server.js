require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');

const { buildSearchUrl } = require('./scraper');
const { buildMarkdown } = require('./profile_scraper');
const db = require('./db');

// ── GitHub Actions trigger ────────────────────────────────────────────────────
const GITHUB_PAT  = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO || 'ayusharora1997/niyanta-trial';

async function triggerGitHubAction({ searchId, url, keyword, searchName, maxFilterUrls = 5, combineDepth = 2 }) {
  if (!GITHUB_PAT) throw new Error('GITHUB_PAT env var is not set on Railway');

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scrape.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${GITHUB_PAT}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent':   'niyanta-scraper',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          search_id:       searchId,
          url:             url,
          keyword:         keyword         || '',
          search_name:     searchName      || '',
          max_filter_urls: String(maxFilterUrls),
          combine_depth:   String(combineDepth),
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
}

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ── In-memory job progress store (keyed by searchId) ─────────────────────────
const jobs = {};  // { [searchId]: { status, log, error } }

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
  jobs[searchId] = { status: 'queued', progress: 0, total: 0, log: [], error: null };

  // Create the DB record immediately so the pipeline can find it by searchId
  try {
    await db.createSearchRun({ searchId, searchName, keyword: keyword || searchName || url, searchUrl: url, platform, country, clientId });
  } catch (err) {
    return res.status(500).json({ error: `DB error: ${err.message}` });
  }

  res.json({ searchId, message: 'Job queued. Poll /api/runs/:searchId for status.' });

  jobs[searchId].status = 'running';
  triggerGitHubAction({ searchId, url, keyword, searchName, maxFilterUrls, combineDepth })
    .then(() => { jobs[searchId].log.push({ ts: Date.now(), msg: 'GitHub Actions job triggered successfully.' }); })
    .catch(err => {
      console.error(`[${searchId}] Failed to trigger GitHub Action:`, err.message);
      jobs[searchId].status = 'error';
      jobs[searchId].error  = err.message;
      db.updateSearchRun(searchId, { status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).catch(() => {});
    });
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
    const { extractFilters } = require('./filter_scraper');
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
  jobs[searchId] = { status: 'queued', progress: 0, total: 0, log: [], error: null };

  try {
    await db.createSearchRun({ searchId, searchName, keyword: keyword || searchName || url, searchUrl: url, platform, country, clientId });
  } catch (err) {
    return res.status(500).json({ error: `DB error: ${err.message}` });
  }

  res.json({ searchId, message: 'Job queued. Poll /api/runs/:searchId for status.' });

  jobs[searchId].status = 'running';
  triggerGitHubAction({ searchId, url, keyword, searchName, maxFilterUrls, combineDepth })
    .then(() => { jobs[searchId].log.push({ ts: Date.now(), msg: 'GitHub Actions job triggered successfully.' }); })
    .catch(err => {
      console.error(`[${searchId}] Failed to trigger GitHub Action:`, err.message);
      jobs[searchId].status = 'error';
      jobs[searchId].error  = err.message;
      db.updateSearchRun(searchId, { status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).catch(() => {});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/runs/:searchId/log
// Receives live progress from the GitHub Actions pipeline so the frontend
// can show real log lines instead of just the trigger message.
// Body: { msg?, progress?, total?, status? }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/runs/:searchId/log', (req, res) => {
  const { searchId } = req.params;
  const { msg, progress, total, status } = req.body || {};
  if (!jobs[searchId]) jobs[searchId] = { status: 'running', progress: 0, total: 0, log: [], error: null };
  if (msg) {
    jobs[searchId].log.push({ ts: Date.now(), msg });
    if (jobs[searchId].log.length > 500) jobs[searchId].log.splice(0, jobs[searchId].log.length - 500);
  }
  if (typeof progress === 'number') jobs[searchId].progress = progress;
  if (typeof total === 'number')    jobs[searchId].total    = total;
  if (status)                       jobs[searchId].status   = status;
  res.json({ ok: true });
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
    const live = jobs[searchId] || null;
    const run  = await db.getSearchRun(searchId).catch(() => null);

    if (!run) {
      // Job just triggered — DB record not visible yet
      return res.json({ run: null, vendors: [], _live: live || { status: 'queued', log: [] } });
    }

    // For in-progress jobs, return DB status + any in-memory log messages
    if (run.status !== 'completed' && run.status !== 'error') {
      return res.json({ run, vendors: [], _live: live || { status: run.status, log: [] } });
    }

    // Completed or errored — return full vendor list
    const vendors = run.status === 'completed' ? await db.getVendorsByRunId(run.id) : [];
    res.json({ run, vendors, _live: live });
  } catch (err) {
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
app.listen(PORT, () => {
  console.log(`\n🚀  Niyanta Scraper API running on http://localhost:${PORT}`);
  console.log(`    POST /api/scrape        — single-URL scrape`);
  console.log(`    POST /api/scrape/multi  — filter-multiplied scrape`);
  console.log(`    GET  /api/filters?url=  — inspect discovered filters for a URL`);
  console.log(`    GET  /api/runs          — list recent runs`);
  console.log(`    GET  /api/runs/:id      — get run + vendors`);
});
