/**
 * Niyanta AI-Apparel — IndiaMART Deep Profile Enrichment Scraper
 *
 * For each vendor in output.json:
 *  1. Scrapes full IndiaMART profile (description, business info, HSN, products, phone)
 *  2. Extracts & visits TrustSEAL cert page (owner, full GSTIN, address, validity)
 *  3. If vendor has an external website:
 *     - Detects if footer says "Developed by IndiaMART InterMESH"
 *     - Visits /about-us and /contact-us pages for extra intel
 *
 * Output: enriched_profiles.md + enriched_profiles.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INPUT_JSON  = path.join(__dirname, 'output.json');
const OUTPUT_MD   = path.join(__dirname, 'enriched_profiles.md');
const OUTPUT_JSON = path.join(__dirname, 'enriched_profiles.json');

// Delay between vendor requests (ms) to be polite
const REQUEST_DELAY = 2500;

// ─────────────────────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeGoto(page, url, opts = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...opts });
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    console.warn(`  [WARN] Failed to load: ${url} — ${e.message.split('\n')[0]}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function scrapeIndiamartProfile(page, profileUrl) {
  console.log(`  → Profile: ${profileUrl}`);
  const ok = await safeGoto(page, profileUrl);
  if (!ok) return null;

  // Detect 404 / not-found pages before scraping
  const is404 = await page.evaluate(() => {
    const title = document.title || '';
    const src   = document.body?.innerText || '';
    return title.includes('Page not found') ||
           title.includes('Not Found') ||
           src.includes("pageType = 'Not Found'") ||
           src.includes('"pageType":"Not Found"');
  });
  if (is404) {
    console.warn(`  [SKIP] 404 page for ${profileUrl}`);
    return null;
  }

  return await page.evaluate(() => {
    const getText = (sel, root = document) => root.querySelector(sel)?.innerText?.trim() || '';
    const getAttr = (sel, attr, root = document) => root.querySelector(sel)?.getAttribute(attr) || '';

    // ── Company description
    // ONLY use IndiaMART-specific IDs — never broad class selectors that
    // could match third-party page content on non-IndiaMART pages.
    const description =
      getText('span#homePageDesc') ||
      getText('div#homePageDesc') ||
      getText('#companyDesc') ||
      '';

    // ── Business info circles (label → value pairs)
    // Strategy 1: FM_ class template (premium members, most common)
    const bizInfo = {};

    document.querySelectorAll('p.FM_c6.FM_f15.FM_m13').forEach(labelEl => {
      const label = labelEl.innerText.trim();
      const valueEl = labelEl.nextElementSibling;
      if (label && valueEl) bizInfo[label] = valueEl.innerText.trim();
    });

    // Strategy 2: Label-text search — find any leaf element whose text exactly
    // matches a known IndiaMART field name, then grab its sibling/parent value.
    // This works regardless of CSS class changes across IndiaMART profile templates.
    if (Object.keys(bizInfo).length === 0) {
      const KNOWN_LABELS = [
        'Nature of Business', 'Legal Status of Firm', 'Annual Turnover',
        'Total Number of Employees', 'GST Registration Date', 'GST Number',
        'Import Export Code (IEC)', 'IndiaMART Certification',
        'Udyam Registration No.', 'MSME Registration No.',
      ];
      document.querySelectorAll('*').forEach(el => {
        if (el.children.length > 0) return; // leaf nodes only
        const txt = el.innerText?.trim();
        if (!txt || !KNOWN_LABELS.includes(txt)) return;
        // Try next sibling → parent's next sibling → grandparent's next sibling
        const candidates = [
          el.nextElementSibling,
          el.parentElement?.nextElementSibling,
          el.parentElement?.parentElement?.nextElementSibling,
        ];
        for (const c of candidates) {
          const val = c?.innerText?.trim();
          if (val && val !== txt) { bizInfo[txt] = val; break; }
        }
      });
    }

    // Strategy 3: dt/dd or table rows (older/basic profile template)
    if (Object.keys(bizInfo).length === 0) {
      document.querySelectorAll('dt').forEach(dt => {
        const label = dt.innerText.trim().replace(/:$/, '');
        const val   = dt.nextElementSibling?.innerText?.trim() || '';
        if (label && val && label.length < 60) bizInfo[label] = val;
      });
    }

    // ── GST Number
    // 1. Try the standard masked field from bizInfo / DOM
    const gstMasked = bizInfo['GST Number'] || getText('[class*="gstno"]') || getText('[id*="gst"]') || '';

    // 2. Scan ALL visible text for a full GSTIN pattern (many vendors write it in descriptions)
    //    Pattern: 2-digit state code + PAN + entity + Z + checksum = 15 chars
    const fullPageText = document.body.innerText || '';
    const gstiNFullRegex = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
    const fullGstins = [...fullPageText.matchAll(gstiNFullRegex)]
      .map(m => m[1])
      .filter(g => g.length === 15);
    const gstiNFromText = fullGstins[0] || '';

    // 3. Also look for "GST No.", "GSTIN:", "GST Number" patterns followed by partial/full number
    //    e.g. "GST No.-07ALUPK6559R1ZT" or "GSTIN: 07ALUPK6559R1ZT"
    const gstTextPattern = fullPageText.match(
      /(?:GST(?:IN)?(?:\s*No\.?\s*[-:–]?\s*))([0-9]{2}[A-Z0-9*]{10,13}[A-Z0-9])/i
    );
    const gstFromLabel = gstTextPattern ? gstTextPattern[1].toUpperCase() : '';

    // Priority: full GSTIN from text scan > label-extracted > masked from bizInfo
    const gstNumber = gstiNFromText || gstFromLabel || gstMasked;

    // ── UDYAM / MSME Registration Number
    // Format: UDYAM-XX-00-0000000 (e.g. UDYAM-KA-03-0012345)
    // Check bizInfo first, then scan full page text
    const udyamFromBiz = Object.entries(bizInfo).find(([k]) =>
      /udyam|msme|udyog/i.test(k)
    )?.[1] || '';
    const udyamFromText = (fullPageText.match(
      /\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/i
    ) || [])[0]?.toUpperCase() || '';
    const udyamNumber = udyamFromText || udyamFromBiz || '';

    // ── Phone — try multiple locations across both profile templates
    const phone =
      getAttr('span#header_pnsno',  'data-pnsno') ||
      getAttr('span#footerPNS',     'data-pnsno') ||
      getAttr('[data-pnsno]',       'data-pnsno') ||
      getAttr('[class*="pnsno"]',   'data-pnsno') ||
      getText('span#header_pnsno')  || '';

    // ── Company age on IndiaMART
    const ageEl = Array.from(document.querySelectorAll('p')).find(p => /\d+\s*yrs?/i.test(p.innerText) && p.innerText.length < 20);
    const memberYears = ageEl ? ageEl.innerText.trim() : bizInfo['Member Since'] || '';

    // ── TrustSEAL URL from onclick
    const tsEl = document.querySelector('div[onclick*="openchildts1"]') ||
                 document.querySelector('[onclick*="trustseal"]');
    let trustSealUrl = '';
    if (tsEl) {
      const match = (tsEl.getAttribute('onclick') || '').match(/openchildts1\('([^']+)'\)/);
      if (match) trustSealUrl = match[1].replace(/^http:/, 'https:');
    }

    // ── External website: only from the dedicated "Website" field in the vendor profile,
    //    NOT from scanning all page links (which picks up iTunes, ads, software sites).
    //    IndiaMART renders it inside the business-info card block as a clickable link.
    let externalWebsite = '';

    // Domains that are definitely NOT the vendor's own site
    const BLOCKED_DOMAINS = [
      'apple.com', 'itunes.apple.com', 'apps.apple.com',
      'play.google.com', 'market.android.com',
      'indiamart.com', 'imimg.com', 'iimimg.com',
      'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
      'youtube.com', 'whatsapp.com', 'telegram.org',
      'google.com', 'googleapis.com', 'gstatic.com',
      'busy.in', 'tally.in', 'zoho.com', 'freshworks.com',
      'amazon.in', 'amazon.com', 'flipkart.com', 'snapdeal.com',
      'justdial.com', 'tradeindia.com', 'exportersindia.com',
      'wikipedia.org', 'w3.org', 'cloudflare.com',
      'shareaholic.com', 'addthis.com', 'sharethis.com',
    ];

    const isBlockedDomain = (href) => {
      try {
        const host = new URL(href).hostname.replace(/^www\./, '');
        return BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
      } catch { return true; }
    };

    // Look ONLY inside IndiaMART's business-info card blocks for a website link.
    // Do NOT do a broad page scan — too many false positives (ads, app-store banners, partner links).
    document.querySelectorAll('div.FM_AaRt a[href], div.supplierInfoDiv a[href], div[class*="website"] a[href]').forEach(a => {
      if (externalWebsite) return;
      const href = (a.href || '').trim();
      if (!href || isBlockedDomain(href)) return;
      if (!/^https?:\/\//i.test(href)) return;
      externalWebsite = href;
    });

    // ── Products & categories
    const productCategories = [];
    document.querySelectorAll('article.FM_PrdR').forEach(article => {
      const catName = article.querySelector('h3 a.FM_Ard')?.innerText?.trim() || '';
      const items = [];
      article.querySelectorAll('ul.FM_mb15 li a span').forEach(s => {
        const t = s.innerText.trim();
        if (t) items.push(t);
      });
      if (catName || items.length) productCategories.push({ category: catName, items });
    });

    // ── HSN codes
    const hsnCodes = [];
    document.querySelectorAll('div.FM_HsnTbl p').forEach(p => {
      const spans = p.querySelectorAll('span');
      if (spans.length >= 2) {
        hsnCodes.push({ code: spans[0].innerText.trim(), description: spans[1].innerText.trim() });
      } else if (spans.length === 1) {
        hsnCodes.push({ code: spans[0].innerText.trim(), description: '' });
      }
    });

    // ── Social links (vendor-owned, if any — distinct from IM share buttons)
    const socials = [];
    document.querySelectorAll('a[href*="facebook.com/"], a[href*="instagram.com/"], a[href*="linkedin.com/in"], a[href*="twitter.com/"]').forEach(a => {
      const href = a.href;
      if (!href.includes('sharer') && !href.includes('share') && !href.includes('indiamart')) {
        socials.push(href);
      }
    });

    // ── Page title for fallback name
    const pageTitle = document.title || '';

    return {
      description,
      bizInfo,
      gstNumber,
      udyamNumber,
      phone,
      memberYears,
      trustSealUrl,
      externalWebsite,
      productCategories,
      hsnCodes,
      socials,
      pageTitle,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function scrapeTrustSeal(page, trustSealUrl) {
  if (!trustSealUrl) return null;
  console.log(`  → TrustSEAL: ${trustSealUrl}`);
  const ok = await safeGoto(page, trustSealUrl);
  if (!ok) return null;

  return await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
    const getLi   = (n)   => document.querySelector(`ul.ts_cmpn_dtl li:nth-child(${n}) span.fwm`)?.innerText?.trim() || '';

    return {
      companyName  : getText('header hgroup h1.fs22') || getText('h1'),
      cityState    : getText('header hgroup h3.fs16') || getText('h3'),
      director     : getLi(1),
      gstin        : getLi(2),
      address      : getLi(3),
      mobileVerified: !!document.querySelector('ul.ts_cmpn_dtl li:nth-child(4)'),
      emailVerified : !!document.querySelector('ul.ts_cmpn_dtl li:nth-child(5)'),
      issueDate    : getText('footer ul.df li:nth-child(1) span.fwm'),
      expiryDate   : getText('footer ul.df li:nth-child(3) span.fwm'),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function scrapeExternalWebsite(page, baseUrl) {
  if (!baseUrl) return null;
  const result = { baseUrl, hostedByIndiamart: false, aboutUs: '', contactUs: '', footerText: '' };

  // Clean to origin
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return null; }

  console.log(`  → External site: ${origin}`);
  const ok = await safeGoto(page, origin);
  if (!ok) return result;

  // Check footer for IndiaMART hosting attribution
  const footerText = await page.evaluate(() => {
    const footer = document.querySelector('footer') || document.querySelector('[id*="footer"], [class*="footer"]');
    return footer ? footer.innerText.replace(/\s+/g, ' ').trim().substring(0, 500) : document.body.innerText.slice(-800).replace(/\s+/g, ' ');
  });
  result.footerText = footerText;
  result.hostedByIndiamart = /indiamart\s*inter\s*mesh/i.test(footerText) || /developed.*indiamart/i.test(footerText) || /managed.*indiamart/i.test(footerText);

  // Discover About Us link
  const aboutUrl = await page.evaluate((origin) => {
    const candidates = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
    return candidates.find(h => /about[-_]?us|about-us|about\.html|\/about\b/i.test(h)) || '';
  }, origin);

  if (aboutUrl) {
    console.log(`  → About Us: ${aboutUrl}`);
    const aok = await safeGoto(page, aboutUrl);
    if (aok) {
      result.aboutUs = await page.evaluate(() =>
        (document.querySelector('main, article, #content, .content, .about-content, [class*="about"]') || document.body)
          .innerText.replace(/\s+/g, ' ').trim().substring(0, 1200)
      );
    }
  }

  // Discover Contact Us link
  const contactUrl = await page.evaluate((origin) => {
    const candidates = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
    return candidates.find(h => /contact[-_]?us|contact\.html|\/contact\b/i.test(h)) || '';
  }, origin);

  if (contactUrl) {
    console.log(`  → Contact: ${contactUrl}`);
    const cok = await safeGoto(page, contactUrl);
    if (cok) {
      result.contactUs = await page.evaluate(() =>
        (document.querySelector('main, article, #content, .content, [class*="contact"]') || document.body)
          .innerText.replace(/\s+/g, ' ').trim().substring(0, 1200)
      );
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildMarkdown(enriched, scrapedAt) {
  const lines = [];

  lines.push(`# Niyanta — Enriched Vendor Profiles`);
  lines.push(`**Enriched:** ${scrapedAt}   |   **Total vendors:** ${enriched.length}`);
  lines.push('');

  // Summary table
  lines.push(`## Quick Reference Table`);
  lines.push('');
  lines.push(`| # | Vendor | City | GSTIN | Rating | Price | TrustSEAL | IndiaMART-hosted site |`);
  lines.push(`|---|--------|------|-------|--------|-------|-----------|----------------------|`);
  enriched.forEach(v => {
    const gstin    = v.trustSeal?.gstin || v.profile?.gstNumber || '—';
    const city     = v.trustSeal?.cityState || v.city || '—';
    const rating   = v.rating ? `${v.rating} ★` : '—';
    const price    = v.price || '—';
    const seal     = v.trustSeal ? '✅' : '—';
    const hosted   = v.website?.hostedByIndiamart ? '✅ Yes' : (v.website ? '❌ No' : '—');
    lines.push(`| ${v.index} | **${v.name}** | ${city} | \`${gstin}\` | ${rating} | ${price} | ${seal} | ${hosted} |`);
  });
  lines.push('');
  lines.push('---');
  lines.push('');

  enriched.forEach(v => {
    lines.push(`## ${v.index}. ${v.name}`);
    lines.push('');

    // ── Company Overview
    lines.push(`### 🏢 Company Overview`);
    if (v.profile?.description) {
      lines.push('');
      lines.push(`> ${v.profile.description.replace(/\n/g, ' ')}`);
    }
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **IndiaMART Profile** | [${v.name}](${v.profileUrl}) |`);
    if (v.city)          lines.push(`| **City** | ${v.city} |`);
    if (v.location)      lines.push(`| **Location** | ${v.location} |`);
    if (v.rating)        lines.push(`| **Rating** | ${v.rating} ★ (${v.reviews || '—'}) |`);
    if (v.price)         lines.push(`| **Price** | ${v.price} |`);
    if (v.profile?.memberYears) lines.push(`| **On IndiaMART** | ${v.profile.memberYears} |`);
    lines.push('');

    // ── Business Details
    const biz = v.profile?.bizInfo || {};
    if (Object.keys(biz).length) {
      lines.push(`### 📋 Business Details`);
      lines.push('');
      lines.push(`| Parameter | Value |`);
      lines.push(`|---|---|`);
      Object.entries(biz).forEach(([k, val]) => {
        if (val) lines.push(`| **${k}** | ${val} |`);
      });
      lines.push('');
    }

    // ── TrustSEAL Certificate
    const ts = v.trustSeal;
    if (ts) {
      lines.push(`### 🔏 TrustSEAL Certificate`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|---|---|`);
      if (ts.director)   lines.push(`| **Director / Proprietor** | ${ts.director} |`);
      if (ts.gstin)      lines.push(`| **GSTIN (full)** | \`${ts.gstin}\` |`);
      if (ts.address)    lines.push(`| **Registered Address** | ${ts.address} |`);
      if (ts.cityState)  lines.push(`| **City / State** | ${ts.cityState} |`);
      lines.push(`| **Mobile Verified** | ${ts.mobileVerified ? '✅' : '—'} |`);
      lines.push(`| **Email Verified** | ${ts.emailVerified ? '✅' : '—'} |`);
      if (ts.issueDate)  lines.push(`| **Cert Issued** | ${ts.issueDate} |`);
      if (ts.expiryDate) lines.push(`| **Cert Expires** | ${ts.expiryDate} |`);
      if (v.profile?.trustSealUrl) lines.push(`| **TrustSEAL URL** | [View cert](${v.profile.trustSealUrl}) |`);
      lines.push('');
    }

    // ── Contact
    lines.push(`### 📞 Contact`);
    lines.push('');
    if (v.profile?.phone) lines.push(`- **Phone:** ${v.profile.phone}`);
    else                  lines.push(`- **Phone:** *(click to reveal on IndiaMART)*`);
    if (v.website?.contactUs) {
      lines.push('');
      lines.push(`**From website Contact page:**`);
      lines.push('');
      lines.push('```');
      lines.push(v.website.contactUs.substring(0, 600));
      lines.push('```');
    }
    lines.push('');

    // ── HSN Codes
    if (v.profile?.hsnCodes?.length) {
      lines.push(`### 🏷️ HSN Codes`);
      lines.push('');
      lines.push(`| HSN Code | Description |`);
      lines.push(`|---|---|`);
      v.profile.hsnCodes.forEach(h => lines.push(`| \`${h.code}\` | ${h.description} |`));
      lines.push('');
    }

    // ── Products
    if (v.profile?.productCategories?.length) {
      lines.push(`### 📦 Products & Categories`);
      lines.push('');
      v.profile.productCategories.forEach(cat => {
        if (cat.category) lines.push(`**${cat.category}**`);
        if (cat.items.length) lines.push(cat.items.map(i => `- ${i}`).join('\n'));
        lines.push('');
      });
    }

    // ── Website Analysis
    const ws = v.website;
    if (ws) {
      lines.push(`### 🌐 Website Analysis`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|---|---|`);
      lines.push(`| **Website** | [${ws.baseUrl}](${ws.baseUrl}) |`);
      lines.push(`| **Hosted by IndiaMART** | ${ws.hostedByIndiamart ? '✅ Yes — IndiaMART InterMESH hosted' : '❌ Independent site'} |`);
      lines.push('');
      if (ws.aboutUs) {
        lines.push(`**About Us page content:**`);
        lines.push('');
        lines.push('```');
        lines.push(ws.aboutUs.substring(0, 800));
        lines.push('```');
        lines.push('');
      }
      if (ws.footerText && ws.hostedByIndiamart) {
        lines.push(`<details><summary>Footer text (shows IndiaMART hosting)</summary>`);
        lines.push('');
        lines.push('```');
        lines.push(ws.footerText.substring(0, 400));
        lines.push('```');
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Core enrichment function (accepts vendors array, returns enriched array) ──

async function enrichVendors(vendors, onProgress) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  const enriched = [];

  for (const vendor of vendors) {
    console.log(`\n[${vendor.index}/${vendors.length}] ${vendor.name}`);
    const entry = { ...vendor, profile: null, trustSeal: null, website: null };

    const isIndiamartUrl = vendor.profileUrl &&
      (vendor.profileUrl.includes('indiamart.com') ||
       vendor.profileUrl.includes('imimg.com'));

    // ── Build the canonical IndiaMART profile URL
    // For external-URL vendors, derive it from the slug (data-tscode from search scraper).
    // This is the ONLY page that has bizInfo circles (Nature of Business, Employees, etc.)
    let indiamartProfileUrl = isIndiamartUrl ? vendor.profileUrl : null;
    if (!indiamartProfileUrl && vendor.slug) {
      indiamartProfileUrl = `https://www.indiamart.com/${vendor.slug}/`;
    }

    // ── Always scrape the indiamart.com profile for bizInfo + TrustSEAL URL
    if (indiamartProfileUrl) {
      entry.profile = await scrapeIndiamartProfile(page, indiamartProfileUrl);
      await sleep(REQUEST_DELAY);
    }

    // ── For external-URL vendors, ALSO scrape their own website as website intel
    if (!isIndiamartUrl && vendor.profileUrl) {
      console.log(`  → External site: ${vendor.profileUrl}`);
      entry.website = await scrapeExternalWebsite(page, vendor.profileUrl);
      await sleep(REQUEST_DELAY);
    }

    // TrustSEAL — from the IndiaMART profile page onclick
    const tsUrl = entry.profile?.trustSealUrl;
    if (tsUrl) {
      entry.trustSeal = await scrapeTrustSeal(page, tsUrl);
      await sleep(REQUEST_DELAY);
    }

    // External website from IndiaMART profile page (only if not already set above)
    const extUrl = entry.profile?.externalWebsite;
    if (extUrl && !entry.website) {
      entry.website = await scrapeExternalWebsite(page, extUrl);
      await sleep(REQUEST_DELAY);
    }

    enriched.push(entry);
    if (onProgress) onProgress(entry, enriched.length, vendors.length);
    console.log(`  ✓ Done — trustSeal: ${!!entry.trustSeal}, website: ${!!entry.website}`);
  }

  await browser.close();
  return enriched;
}

// ── Standalone CLI entry ──────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error('output.json not found — run scraper.js first.');
    process.exit(1);
  }

  const { vendors } = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf8'));
  console.log(`Loaded ${vendors.length} vendors from output.json\n`);

  const enriched  = await enrichVendors(vendors);
  const scrapedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const markdown  = buildMarkdown(enriched, scrapedAt);

  fs.writeFileSync(OUTPUT_MD,   markdown, 'utf8');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ enrichedAt: scrapedAt, count: enriched.length, vendors: enriched }, null, 2), 'utf8');

  console.log(`\nDone! ${enriched.length} vendors enriched.`);
  console.log(`Markdown → ${OUTPUT_MD}`);
  console.log(`JSON     → ${OUTPUT_JSON}`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { enrichVendors, buildMarkdown, scrapeIndiamartProfile, scrapeTrustSeal };
