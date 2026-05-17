const { chromium } = require('playwright');

// ── Groups to skip entirely ───────────────────────────────────────────────────
const SKIP_GROUPS = new Set([
  'related category',
  'related brands',
  'recommended searches',
  'popular localities',
  'filters',            // Bengaluru-based Suppliers checkbox — not a q- filter
]);

// ── Structural URL params to carry forward into clean combo URLs ───────────────
const STRUCTURAL_PARAMS = new Set(['ss', 'v', 'mcatid', 'catid', 'cq', 'cityid']);

function cleanBaseUrl(rawUrl) {
  const src = new URL(rawUrl);
  const out = new URL('https://dir.indiamart.com/search.mp');
  for (const [k, v] of src.searchParams.entries()) {
    if (STRUCTURAL_PARAMS.has(k)) out.searchParams.set(k, v);
  }
  out.searchParams.set('src', 'advanced-filter');
  return out.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// extractFilters(baseUrl)
//
// IndiaMART renders the filter sidebar server-side as:
//
//   <div class="sidebarCard">
//     <h2 class="cardTitle">Waste Type▲</h2>
//     <ul class="ulList">
//       <li><span class="sidebarText">Flat Strip</span></li>
//       ...
//     </ul>
//   </div>
//
// There are no <a> href links — the filter URLs are constructed purely from
// the group name and value text:  q-{GroupName}={Value}
//
// Price and Business Credentials are handled separately with their own URL
// param patterns.  Everything else follows the q- pattern.
// ─────────────────────────────────────────────────────────────────────────────
async function extractFilters(baseUrl) {
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

  // Filters are server-side rendered, so domcontentloaded is enough.
  // We wait for the sidebarCard selector just to be safe.
  console.log('  [filters] Loading page...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  try {
    await page.waitForSelector('div.sidebarCard', { timeout: 15000 });
    console.log('  [filters] Sidebar detected.');
  } catch {
    console.log('  [filters] sidebarCard not found within 15s — page may have no filters.');
  }

  const cleanBase  = cleanBaseUrl(baseUrl);
  const skipGroups = [...SKIP_GROUPS];

  const { filters, debug } = await page.evaluate(({ skip, cleanBase }) => {
    const result  = {};
    const debug   = { totalCards: 0, found: [], skipped: [] };
    const SKIP    = new Set(skip.map(s => s.toLowerCase()));

    // ── Price: parse range label into minprice/maxprice params ────────────────
    function buildPriceUrl(label, base) {
      const u     = new URL(base);
      const nums  = (label.match(/[\d,]+/g) || []).map(n => parseInt(n.replace(/,/g, ''), 10));
      const lower = label.toLowerCase();
      if (lower.includes('below') && nums.length >= 1) {
        u.searchParams.set('maxprice', nums[0]);
        u.searchParams.set('pf', 'sb');
        return u.toString();
      }
      if (lower.includes('above') && nums.length >= 1) {
        u.searchParams.set('minprice', nums[0]);
        u.searchParams.set('pf', 'sb');
        return u.toString();
      }
      if (nums.length >= 2) {
        u.searchParams.set('minprice', nums[0]);
        u.searchParams.set('maxprice', nums[1]);
        u.searchParams.set('pf', 'sb');
        return u.toString();
      }
      return null;
    }

    // ── Business Credentials: hardcoded mapping from known IndiaMART params ───
    // Values sourced from actual filter URLs (bizCr=annualTurnoverBucket1 etc.)
    const BIZ_CR = {
      'annual turnover': 'annualTurnoverBucket1',
      'gst registered':  'gstRegisteredBucket2',
    };

    const cards = [...document.querySelectorAll('div.sidebarCard')];
    debug.totalCards = cards.length;

    for (const card of cards) {
      const h2 = card.querySelector('h2.cardTitle');
      if (!h2) continue;

      // Strip ▲ ▼ arrow chars from heading text
      const groupName  = (h2.innerText || h2.textContent).trim().replace(/[▲▼↑↓]+/g, '').trim();
      const lowerGroup = groupName.toLowerCase();

      if (!groupName || SKIP.has(lowerGroup)) {
        debug.skipped.push(groupName || '(no heading)');
        continue;
      }

      const spans = [...card.querySelectorAll('span.sidebarText')];
      if (!spans.length) {
        debug.skipped.push(groupName + ' (no values)');
        continue;
      }

      const items = [];

      if (lowerGroup === 'price') {
        // ── Price range filters ───────────────────────────────────────────────
        for (const sp of spans) {
          const label = sp.innerText.trim();
          const url   = buildPriceUrl(label, cleanBase);
          if (url) items.push({ label, url });
        }

      } else if (lowerGroup === 'business credentials') {
        // ── Business credential filters ───────────────────────────────────────
        for (const sp of spans) {
          const label  = sp.innerText.trim();
          const bizKey = Object.keys(BIZ_CR).find(k => label.toLowerCase().includes(k));
          if (!bizKey) continue;
          const u = new URL(cleanBase);
          u.searchParams.set('bizCr', BIZ_CR[bizKey]);
          items.push({ label, url: u.toString() });
        }

      } else {
        // ── Attribute filters: q-{GroupName}={Value} ──────────────────────────
        // URLSearchParams encodes spaces as + in both keys and values, which
        // matches IndiaMART's own filter URL format.
        for (const sp of spans) {
          const label = sp.innerText.trim();
          if (!label) continue;
          const u = new URL(cleanBase);
          u.searchParams.set('q-' + groupName, label);
          items.push({ label, url: u.toString() });
        }
      }

      if (items.length >= 2) {
        result[groupName] = items;
        debug.found.push(groupName + ':' + items.length);
      } else {
        debug.skipped.push(groupName + ' (' + items.length + ' value)');
      }
    }

    return { filters: result, debug };
  }, { skip: skipGroups, cleanBase });

  await browser.close();

  const groupCount = Object.keys(filters).length;
  const valueCount = Object.values(filters).reduce((s, v) => s + v.length, 0);
  console.log(
    `  [filters] ${debug.totalCards} sidebarCards found.` +
    ` Extracted: [${debug.found.join(', ')}].` +
    ` Skipped: [${debug.skipped.join(', ')}].`
  );
  console.log(
    `  [filters] => ${groupCount} groups, ${valueCount} values: ${Object.keys(filters).join(', ') || '(none)'}`
  );

  return filters;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateFilterUrls(baseUrl, filters, options)
//
// Single-filter URLs: one per filter value, using the pre-built URL from
// extractFilters (already has correct q- params + src=advanced-filter).
//
// 2-filter combos: cross-product of all distinct group pairs, merging each
// pair's filter params onto a clean base URL.
// ─────────────────────────────────────────────────────────────────────────────
function generateFilterUrls(baseUrl, filters, { combineDepth = 2 } = {}) {
  const cleanBase = cleanBaseUrl(baseUrl);
  const groups    = Object.keys(filters);
  const urlSet    = new Set();

  // Extract filter-specific params from a pre-built filter URL
  function filterDelta(filterUrl) {
    const delta = {};
    try {
      for (const [k, v] of new URL(filterUrl).searchParams.entries()) {
        const lk = k.toLowerCase();
        const isAttr  = lk.startsWith('q-') || lk.startsWith('q ');
        const isOther = ['bizcr', 'minprice', 'maxprice', 'pf', 'priceunit', 'biz'].includes(lk);
        if (isAttr || isOther) delta[k] = v;
      }
    } catch {}
    return delta;
  }

  // Single-filter URLs
  for (const group of groups) {
    for (const item of filters[group]) urlSet.add(item.url);
  }

  // 2-filter combos
  if (combineDepth >= 2) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const a of filters[groups[i]]) {
          const dA = filterDelta(a.url);
          for (const b of filters[groups[j]]) {
            const dB      = filterDelta(b.url);
            const combined = new URL(cleanBase);
            for (const [k, v] of Object.entries(dA)) combined.searchParams.set(k, v);
            for (const [k, v] of Object.entries(dB)) combined.searchParams.set(k, v);
            urlSet.add(combined.toString());
          }
        }
      }
    }
  }

  const urls = [...urlSet];

  const CAP = 500;
  if (urls.length > CAP) {
    console.warn(`  [filters] ${urls.length} URLs generated — capping at ${CAP}.`);
    return urls.slice(0, CAP);
  }

  const singleCount = Object.values(filters).reduce((s, v) => s + v.length, 0);
  const comboCount  = combineDepth >= 2 ? urls.length - singleCount : 0;
  console.log(
    `  [filters] Generated ${urls.length} URLs` +
    ` (${singleCount} single-filter + ${comboCount} 2-filter combos).`
  );

  return urls;
}

module.exports = { extractFilters, generateFilterUrls, cleanBaseUrl };
