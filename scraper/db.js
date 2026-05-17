require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(priceStr) {
  if (!priceStr) return { low: null, high: null, unit: null };
  const match = priceStr.match(/₹?\s*([\d,]+)\s*(?:-\s*([\d,]+))?\s*\/\s*(\w+)?/);
  if (!match) return { low: null, high: null, unit: null };
  const low  = parseFloat((match[1] || '').replace(/,/g, '')) || null;
  const high = match[2] ? parseFloat(match[2].replace(/,/g, '')) : low;
  return { low, high, unit: match[3] || 'Piece' };
}

function parseEmployeeCount(rangeStr) {
  if (!rangeStr) return null;
  const match = rangeStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// Map IndiaMART "Nature of Business" → vendor_type_apparel enum
function mapVendorType(natureOfBusiness) {
  if (!natureOfBusiness) return null;
  const n = natureOfBusiness.toLowerCase();
  if (n.includes('manufacturer')) return 'full_package';
  if (n.includes('wholesaler') || n.includes('distributor')) return 'raw_material_trader';
  if (n.includes('trader') || n.includes('retailer')) return 'raw_material_trader';
  if (n.includes('exporter')) return 'full_package';
  return null;
}

function extractPincode(address) {
  const match = (address || '').match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

function extractState(cityState) {
  // "Bengaluru, Karnataka" → "Karnataka"
  const parts = (cityState || '').split(',');
  return parts.length >= 2 ? parts[parts.length - 1].trim() : null;
}

// ── search_runs ───────────────────────────────────────────────────────────────

async function createSearchRun({ searchId, searchName, keyword, searchUrl, platform, country, clientId }) {
  const { data, error } = await supabase
    .from('search_runs')
    .insert({
      search_id: searchId,
      search_name: searchName || keyword || 'IndiaMART Scrape',
      keyword,
      search_url: searchUrl,
      platform: platform || 'indiamart',
      country: country || 'India',
      client_id: clientId || parseInt(process.env.CLIENT_ID) || 1,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`createSearchRun: ${error.message}`);
  return data;
}

async function updateSearchRun(searchId, updates) {
  const { error } = await supabase
    .from('search_runs')
    .update(updates)
    .eq('search_id', searchId);
  if (error) throw new Error(`updateSearchRun: ${error.message}`);
}

async function listSearchRuns(limit = 20) {
  const { data, error } = await supabase
    .from('search_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listSearchRuns: ${error.message}`);
  return data;
}

async function getSearchRun(searchId) {
  const { data, error } = await supabase
    .from('search_runs')
    .select('*')
    .eq('search_id', searchId)
    .single();
  if (error) throw new Error(`getSearchRun: ${error.message}`);
  return data;
}

// ── apparel_vendors ───────────────────────────────────────────────────────────

// ── PASS 1: Save everything from the IndiaMART profile page ──────────────────
// Called for every vendor, regardless of whether TrustSEAL exists.
// Fills: business details, products, HSN codes, phone, pricing, website intel.
async function saveVendorProfile(enrichedVendor, searchRunDbId) {
  const v     = enrichedVendor;
  const p     = v.profile || {};
  const biz   = p.bizInfo || {};
  const ws    = v.website || {};
  const price = parsePrice(v.price);
  const slug  = (v.profileUrl || '').replace(/https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]/gi, '-').substring(0, 80);

  // GSTIN from page text only (pass 1 does NOT use TrustSEAL)
  const GSTIN_RE  = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const gstiNFull = (p.gstNumber && GSTIN_RE.test(p.gstNumber)) ? p.gstNumber : null;

  const record = {
    vendor_code:      `IM-${slug}`.substring(0, 100),
    client_id:        parseInt(process.env.CLIENT_ID) || 1,
    data_source:      'indiamart',
    source_url:       v.profileUrl || '',
    source_vendor_id: v.slug || slug,
    search_run_id:    searchRunDbId || null,

    // ── Identity (from search results + profile page)
    company_name: v.name || 'Unknown',
    city:         v.city || null,
    country:      'India',
    cluster:      v.city || null,

    // ── Contact
    primary_contact_phone: p.phone || null,
    indiamart_url:         v.profileUrl || null,

    // ── GSTIN — only what we can read directly from the page
    // Full 15-char if found in page text, masked partial if not, null if absent
    gstin:         gstiNFull || p.gstNumber || null,
    gstin_verified: !!gstiNFull,   // only true if full GSTIN confirmed without TrustSEAL
    iec_number:       biz['Import Export Code (IEC)'] || null,
    // UDYAM / MSME — stored in both columns; udyam_number is the modern format
    udyam_number:     p.udyamNumber || null,
    msme_number:      p.udyamNumber || null,
    msme_registered:  !!(p.udyamNumber),

    // ── Business details — sourced ONLY from the profile page bizInfo cards
    legal_status:          biz['Legal Status of Firm'] || null,
    annual_turnover_range: biz['Annual Turnover'] || null,
    num_employees_range:   biz['Total Number of Employees'] || null,
    num_employees:         parseEmployeeCount(biz['Total Number of Employees']),
    vendor_type:           mapVendorType(biz['Nature of Business']),
    is_exporter:           (biz['Nature of Business'] || '').toLowerCase().includes('export'),

    // ── IndiaMART ratings + metadata
    indiamart_rating:       parseFloat(v.rating) || null,
    indiamart_review_count: v.reviews ? parseInt((v.reviews.match(/\d+/) || [])[0]) : null,
    indiamart_trust_seal:   false,   // will be flipped to true in pass 2 if TrustSEAL found
    indiamart_scraped_at:   new Date().toISOString(),
    indiamart_extract: {
      description:       p.description  || null,
      bizInfo:           biz,
      hsnCodes:          p.hsnCodes     || [],
      productCategories: p.productCategories || [],
      memberYears:       p.memberYears  || null,
      trustSealUrl:      p.trustSealUrl || null,
      gstFromPage:       p.gstNumber    || null,
      udyamNumber:       p.udyamNumber  || null,
    },

    // ── Pricing
    price_range_inr_low:  price.low,
    price_range_inr_high: price.high,
    price_unit:           price.unit,

    // ── Website intel
    website:             ws.hostedByIndiamart ? null : (ws.baseUrl || null),
    website_scraped_at:  ws.baseUrl ? new Date().toISOString() : null,
    website_extract: ws.baseUrl ? {
      hostedByIndiamart: ws.hostedByIndiamart,
      aboutUs:           ws.aboutUs   || null,
      contactUs:         ws.contactUs || null,
      footerText:        ws.footerText || null,
    } : null,

    // ── Product categories
    product_categories: (p.productCategories || []).map(c => c.category).filter(Boolean),

    onboarding_status: 'discovered',
  };

  const { data: existing, error: lookupError } = await supabase
    .from('apparel_vendors')
    .select('id')
    .eq('source_url', record.source_url)
    .eq('data_source', record.data_source)
    .maybeSingle();

  if (lookupError) {
    console.error(`  [DB P1] lookup error for ${v.name}:`, lookupError.message);
    return null;
  }

  const query = existing
    ? supabase.from('apparel_vendors').update(record).eq('id', existing.id)
    : supabase.from('apparel_vendors').insert(record);

  const { data, error } = await query.select('id, vendor_uuid, company_name').single();

  if (error) {
    console.error(`  [DB P1] save error for ${v.name}:`, error.message);
    return null;
  }

  console.log(`  [DB P1] saved: ${data.company_name} (id=${data.id})`);
  return data;
}

// ── PASS 2: Overlay TrustSEAL data — ONLY runs when TrustSEAL was found ──────
// Updates ONLY the fields that TrustSEAL provides.
// Does NOT touch bizInfo fields (legal_status, employees, turnover, etc.)
async function applyTrustSeal(vendorDbId, trustSeal, trustSealUrl) {
  if (!vendorDbId || !trustSeal) return;

  const cityState = trustSeal.cityState || '';
  const state     = extractState(cityState);
  const city      = cityState.split(',')[0]?.trim() || null;

  // Only update columns that TrustSEAL actually provides
  const patch = {
    // Identity (TrustSEAL gives the verified registered address)
    ...(city  && { city }),
    ...(state && { state }),
    ...(trustSeal.address && {
      registered_address: trustSeal.address,
      pincode:            extractPincode(trustSeal.address),
    }),

    // Contact — director/proprietor name
    ...(trustSeal.director && { primary_contact_name: trustSeal.director }),

    // GSTIN — full verified value from the certificate
    ...(trustSeal.gstin && {
      gstin:         trustSeal.gstin,
      gstin_verified: true,
    }),

    // TrustSEAL flag + cert metadata stored inside the existing extract blob
    indiamart_trust_seal: true,
  };

  // Merge TrustSeal cert metadata into the existing indiamart_extract JSONB.
  // Fetch current value first so we don't overwrite profile fields already saved in pass 1.
  const { data: existing } = await supabase
    .from('apparel_vendors')
    .select('indiamart_extract')
    .eq('id', vendorDbId)
    .single();

  const mergedExtract = {
    ...(existing?.indiamart_extract || {}),
    trustSealUrl:    trustSealUrl                   || null,
    trustSealIssued: trustSeal.issueDate             || null,
    trustSealExpires: trustSeal.expiryDate           || null,
    mobileVerified:  trustSeal.mobileVerified        || false,
    emailVerified:   trustSeal.emailVerified         || false,
    director:        trustSeal.director              || null,
    gstin_trustseal: trustSeal.gstin                 || null,
  };

  patch.indiamart_extract = mergedExtract;

  const { error } = await supabase
    .from('apparel_vendors')
    .update(patch)
    .eq('id', vendorDbId);

  if (error) {
    console.error(`  [DB P2] TrustSeal update error (id=${vendorDbId}):`, error.message);
    return;
  }

  console.log(`  [DB P2] TrustSeal applied (id=${vendorDbId}): GSTIN=${trustSeal.gstin || '—'}, director=${trustSeal.director || '—'}`);
}

// ── Convenience wrapper used by server.js ─────────────────────────────────────
// Runs pass 1 then conditionally pass 2 — keeps server.js unchanged.
async function upsertVendor(enrichedVendor, searchRunDbId) {
  // Pass 1: always
  const saved = await saveVendorProfile(enrichedVendor, searchRunDbId);
  if (!saved) return null;

  // Pass 2: only if TrustSEAL data was collected
  const ts = enrichedVendor.trustSeal;
  if (ts && (ts.gstin || ts.director || ts.address)) {
    await applyTrustSeal(saved.id, ts, enrichedVendor.profile?.trustSealUrl);
  }

  return saved;
}

async function getVendorsByRunId(searchRunDbId) {
  const { data, error } = await supabase
    .from('apparel_vendors')
    .select(`
      id, vendor_uuid, company_name, city, state, registered_address,
      primary_contact_name, primary_contact_phone, website, indiamart_url,
      gstin, gstin_verified, legal_status, annual_turnover_range,
      num_employees_range, vendor_type, indiamart_rating, indiamart_review_count,
      indiamart_trust_seal, price_range_inr_low, price_range_inr_high, price_unit,
      product_categories, indiamart_extract, website_extract,
      onboarding_status, created_at
    `)
    .eq('search_run_id', searchRunDbId)
    .order('indiamart_rating', { ascending: false });
  if (error) throw new Error(`getVendorsByRunId: ${error.message}`);
  return data;
}

// Backfill bizInfo for vendors that have TrustSEAL but empty business details.
// Returns list of { id, company_name, indiamart_url } to re-scrape.
async function getVendorsMissingBizInfo(limit = 50) {
  const { data, error } = await supabase
    .from('apparel_vendors')
    .select('id, company_name, indiamart_url, source_url, slug:source_vendor_id')
    .is('legal_status', null)
    .not('indiamart_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getVendorsMissingBizInfo: ${error.message}`);
  return data;
}

// Patch only the bizInfo-derived columns on an existing vendor row.
async function patchVendorBizInfo(vendorId, profile) {
  if (!vendorId || !profile) return;
  const biz = profile.bizInfo || {};
  if (Object.keys(biz).length === 0) return; // nothing to update

  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const gstiNFull = (profile.gstNumber && GSTIN_RE.test(profile.gstNumber)) ? profile.gstNumber : null;

  const patch = {
    legal_status:          biz['Legal Status of Firm']       || null,
    annual_turnover_range: biz['Annual Turnover']             || null,
    num_employees_range:   biz['Total Number of Employees']   || null,
    num_employees:         parseEmployeeCount(biz['Total Number of Employees']),
    vendor_type:           mapVendorType(biz['Nature of Business']),
    is_exporter:           (biz['Nature of Business'] || '').toLowerCase().includes('export'),
    iec_number:            biz['Import Export Code (IEC)']    || null,
    udyam_number:          profile.udyamNumber                || null,
    msme_number:           profile.udyamNumber                || null,
    msme_registered:       !!(profile.udyamNumber),
    primary_contact_phone: profile.phone                      || null,
    product_categories:    (profile.productCategories || []).map(c => c.category).filter(Boolean),
    indiamart_scraped_at:  new Date().toISOString(),
    ...(gstiNFull && { gstin: gstiNFull, gstin_verified: true }),
  };

  // Merge into existing indiamart_extract without wiping TrustSeal fields
  const { data: existing } = await supabase
    .from('apparel_vendors')
    .select('indiamart_extract')
    .eq('id', vendorId)
    .single();

  patch.indiamart_extract = {
    ...(existing?.indiamart_extract || {}),
    description:       profile.description       || null,
    bizInfo:           biz,
    hsnCodes:          profile.hsnCodes          || [],
    productCategories: profile.productCategories || [],
    memberYears:       profile.memberYears        || null,
    gstFromPage:       profile.gstNumber          || null,
    udyamNumber:       profile.udyamNumber        || null,
  };

  const { error } = await supabase
    .from('apparel_vendors')
    .update(patch)
    .eq('id', vendorId);

  if (error) {
    console.error(`  [DB PATCH] bizInfo update error (id=${vendorId}):`, error.message);
    return;
  }
  console.log(`  [DB PATCH] bizInfo applied (id=${vendorId}): legal=${biz['Legal Status of Firm']||'—'}, employees=${biz['Total Number of Employees']||'—'}`);
}

module.exports = {
  supabase,
  createSearchRun,
  updateSearchRun,
  listSearchRuns,
  getSearchRun,
  upsertVendor,
  saveVendorProfile,
  patchVendorBizInfo,
  getVendorsMissingBizInfo,
  applyTrustSeal,
  getVendorsByRunId,
};
