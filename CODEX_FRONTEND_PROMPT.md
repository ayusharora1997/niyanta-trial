# Codex Prompt — Niyanta Vendor Discovery Frontend

## Context

Build a React + Tailwind frontend for the **Niyanta AI-Apparel** vendor discovery tool.  
The backend is an Express API already running at `http://localhost:4000`.

The user pastes an **IndiaMART search URL**, gives it a name, clicks **Run Scrape**, and the
system scrapes + enriches all vendor profiles from that URL, saving results to Supabase.  
Results are shown in **two tabs** per run: a **Search Summary** and a **Vendor Details** table.

---

## API Contract

### `POST /api/scrape`
**Body:**
```json
{
  "url":        "https://dir.indiamart.com/search.mp?...",
  "searchName": "T-Shirts 360 GSM Bengaluru",
  "keyword":    "T-Shirts 360 GSM",
  "platform":   "indiamart",
  "country":    "India"
}
```
**Response (immediate, scraping runs in background):**
```json
{ "searchId": "sr-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "message": "Scrape started..." }
```

### `GET /api/runs`
Returns array of recent search runs, newest first. Each object:
```json
{
  "id":                  42,
  "search_id":           "sr-xxx",
  "search_name":         "T-Shirts 360 GSM Bengaluru",
  "search_url":          "https://dir.indiamart.com/...",
  "keyword":             "T-Shirts 360 GSM",
  "platform":            "indiamart",
  "country":             "India",
  "status":              "completed",  // pending | running | scraping_search | enriching_profiles | saving | completed | error
  "vendors_found":       10,
  "vendors_inserted":    10,
  "duration_seconds":    147,
  "started_at":          "2026-05-17T14:47:00Z",
  "completed_at":        "2026-05-17T14:49:27Z",
  "error_message":       null,
  "_live": {             // only present while job is running
    "status":   "enriching_profiles",
    "progress": 6,
    "total":    10,
    "log":      [{ "ts": 1234567890, "msg": "Enriched [6/10]: Flam" }]
  }
}
```

### `GET /api/runs/:searchId`
Returns `{ run, vendors, _live }`.  
`vendors` is an array of enriched vendor objects (see Vendor Schema below).

### `GET /api/runs/:searchId/markdown`
Returns the full enriched markdown as `text/plain`.

---

## Vendor Schema (key fields)
```typescript
interface Vendor {
  id:                     number;
  company_name:           string;
  city:                   string | null;
  state:                  string | null;
  registered_address:     string | null;
  primary_contact_name:   string | null;   // Director / Proprietor
  primary_contact_phone:  string | null;
  website:                string | null;
  indiamart_url:          string | null;
  gstin:                  string | null;   // Full GSTIN from TrustSEAL
  gstin_verified:         boolean;
  legal_status:           string | null;   // "Proprietorship", "Limited Company"
  annual_turnover_range:  string | null;   // "40 L - 1.5 Cr"
  num_employees_range:    string | null;   // "Upto 10 People"
  vendor_type:            string | null;   // "full_package", "raw_material_trader"
  indiamart_rating:       number | null;   // e.g. 4.3
  indiamart_review_count: number | null;
  indiamart_trust_seal:   boolean;
  price_range_inr_low:    number | null;
  price_range_inr_high:   number | null;
  price_unit:             string | null;
  product_categories:     string[];
  indiamart_extract: {
    description:       string;
    bizInfo:           Record<string, string>;
    hsnCodes:          Array<{ code: string; description: string }>;
    productCategories: Array<{ category: string; items: string[] }>;
    memberYears:       string;
    trustSealIssued:   string;
    trustSealExpires:  string;
    mobileVerified:    boolean;
    emailVerified:     boolean;
  } | null;
  website_extract: {
    hostedByIndiamart: boolean;
    aboutUs:           string;
    contactUs:         string;
    footerText:        string;
  } | null;
  onboarding_status: string;  // "discovered"
  created_at: string;
}
```

---

## Page Structure

### Layout
- Sidebar (left, ~240px) — navigation links: **Discover**, **History**
- Main content area (right)

### Route: `/` — Discover (default)
1. **Hero header**: "Niyanta Vendor Discovery" with a subtitle "Powered by IndiaMART + TrustSEAL enrichment"
2. **Scrape Form** (card):
   - Label: "IndiaMART Search URL"
   - Input (full-width text): placeholder `https://dir.indiamart.com/search.mp?ss=...`
   - Label: "Search Name" — short input, e.g. "T-Shirts 360 GSM Bengaluru"
   - Label: "Keyword" — short input (pre-fills from URL `ss=` param if user pastes a URL)
   - Country dropdown defaulting to "India"
   - Platform dropdown defaulting to "IndiaMART"
   - **[Run Scrape]** button — primary, disabled while a job is running
3. **Active job card** (shows only while a job from THIS session is in-flight):
   - Title: "Scraping in progress…"
   - Live status badge: `scraping_search` → `enriching_profiles` → `saving`
   - Progress bar: `progress / total` (shown once enrichment starts)
   - Scrollable log tail (last 8 lines from `_live.log`)
   - Polls `GET /api/runs/:searchId` every **3 seconds** until status is `completed` or `error`
   - On completion: auto-scroll to results section and stop polling
4. **Results section** (only shown after the active job completes OR when a run is selected from History):
   - Two tabs: **[Search Summary]** and **[Vendor Details]**

---

## Tab 1: Search Summary

Shows a card layout with the **run metadata** at the top and a **compact vendor table** below.

### Run Metadata Card
```
Search Name:    T-Shirts 360 GSM Bengaluru
URL:            https://dir.indiamart.com/... [copy icon]
Platform:       IndiaMART    Country: India
Status:         ✅ Completed
Vendors Found:  10    Inserted: 10
Duration:       2m 27s
Scraped:        17 May 2026, 08:47 PM
```

### Vendor Summary Table
Columns: `#` | `Company` | `City / State` | `Price` | `Rating ★` | `GSTIN` | `TrustSEAL` | `IndiaMART Profile`

- Sort by rating (desc) by default
- Each row: clicking the company name selects that vendor in Tab 2
- GSTIN shown as `29AJXPR8384E1Z5` in monospace
- TrustSEAL: green ✅ badge if true
- "IndiaMART Profile" column: external link icon → opens profile URL
- **[Download Markdown]** button top-right — fetches `/api/runs/:searchId/markdown` and triggers file download as `run-name.md`

---

## Tab 2: Vendor Details

A two-column layout:
- **Left panel** (~280px): vertical list of vendor names with rating badge. Clicking selects them.
- **Right panel**: full vendor detail card for the selected vendor.

### Vendor Detail Card (right panel)

Organised into collapsible sections (all expanded by default):

#### 🏢 Company Overview
- Company name (large, bold)
- Description/About (italic quote block, grey background)
- Table: Location | Member Since | Rating | Reviews | Price Range | Vendor Type | Nature of Business | Onboarding Status

#### 🔏 TrustSEAL Certificate
Only shown if `gstin_verified === true`. Badge: "TrustSEAL Verified — IndiaMART" in yellow/gold.
- Table: Director/Proprietor | GSTIN (monospace, copyable) | Registered Address | City/State | Mobile Verified | Email Verified | Cert Issued | Cert Expires

#### 📋 Business Details
- Table from `indiamart_extract.bizInfo`: Nature of Business | Legal Status | Annual Turnover | Employees | GST Reg Date | IEC Number

#### 📞 Contact
- Phone: `primary_contact_phone` — shown with a [📋 Copy] button
- Website: clickable link (if `website` is not null)
  - Show a "🏠 IndiaMART-hosted website" badge if `website_extract.hostedByIndiamart === true`
- IndiaMART Profile: external link

#### 🏷️ HSN Codes
Table: Code (monospace) | Description. From `indiamart_extract.hsnCodes`.
Skip header row where code === "HSN Code".

#### 📦 Products & Categories
Grouped by category. Each category is a bold heading, items are bullet points below.
From `indiamart_extract.productCategories`.

#### 🌐 Website Intel
Only shown if `website_extract` is not null.
- About Us page text (truncated to 400 chars with [Read more] toggle)
- Contact page text (similar)
- IndiaMART-hosted badge or "Independent site"

---

## Route: `/history` — History

Table of all past search runs (from `GET /api/runs`), columns:
`Search Name` | `Keyword` | `Platform` | `Status badge` | `Vendors` | `Duration` | `Date` | `Actions`

Status badges:
- `completed` → green pill
- `running` / `scraping_search` / `enriching_profiles` / `saving` → yellow animated pill "In progress"
- `error` → red pill with error_message tooltip
- `pending` → grey pill

Actions column: **[View Results]** button → navigates to `/` and loads that run's results.

Auto-refresh this page every 5 seconds if any run has a non-terminal status.

---

## State Management

Use React `useState` + `useEffect` (no Redux needed).

Key state:
```typescript
// Global app state
activeRunId: string | null          // searchId of the run being viewed
activeRun:   Run | null
vendors:     Vendor[]
selectedVendorId: number | null     // selected in Tab 2 left panel

// Polling state (Discover page)
pollingJobId: string | null         // searchId being polled
liveJob:      LiveJob | null        // latest _live data from polling
```

---

## Styling

- Tailwind CSS
- Colour palette: dark navy `#0f172a` sidebar, white main area, accent `#6366f1` (indigo)
- Monospace font for GSTIN, HSN codes, phone numbers: `font-mono`
- Collapsible sections: smooth `max-height` transition
- Status badges: rounded pills with colour-coded backgrounds
- Loading skeletons for vendor list while fetching
- Mobile responsive (sidebar collapses to hamburger on small screens)

---

## Tech Stack

- React 18 (Vite)
- Tailwind CSS v3
- React Router v6
- No other UI library needed — build all components from scratch with Tailwind

---

## Files to Create

```
frontend/
  src/
    api.js              ← all fetch calls to http://localhost:4000
    App.jsx             ← router setup
    pages/
      Discover.jsx      ← scrape form + active job + results tabs
      History.jsx       ← runs history table
    components/
      Sidebar.jsx
      ScrapeForm.jsx
      ActiveJobCard.jsx ← live progress + log
      RunSummary.jsx    ← tab 1: run metadata + summary table
      VendorDetails.jsx ← tab 2: vendor selector + detail card
      VendorCard.jsx    ← the full detail view of one vendor
      StatusBadge.jsx
      CopyButton.jsx
  index.html
  vite.config.js
  tailwind.config.js
  postcss.config.js
  package.json
```

---

## `api.js` — All API Calls

```javascript
const BASE = 'http://localhost:4000';

export const startScrape  = (body) => fetch(`${BASE}/api/scrape`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json());
export const listRuns     = ()     => fetch(`${BASE}/api/runs`).then(r => r.json());
export const getRun       = (id)   => fetch(`${BASE}/api/runs/${id}`).then(r => r.json());
export const getMarkdown  = (id)   => fetch(`${BASE}/api/runs/${id}/markdown`).then(r => r.text());
```

---

## Key Behaviour Notes

1. **Auto-parse keyword from URL**: When user pastes an IndiaMART URL, extract the `ss=` query param value (URL-decode it) and pre-fill the Keyword input. E.g. `ss=tshirts+gsm+360` → `"tshirts gsm 360"`.

2. **Polling**: Poll `GET /api/runs/:searchId` every 3 seconds. Stop when `status === 'completed' || status === 'error'`. Show live log lines in a `<pre>` with auto-scroll to bottom.

3. **Progress bar**: Shows `_live.progress / _live.total * 100`%. Label: "Enriching profiles: 6 / 10".

4. **Download Markdown**: Fetch markdown text, create a Blob, trigger `<a download>` click with filename `${search_name.replace(/\s+/g,'-').toLowerCase()}.md`.

5. **Default selected vendor**: When Tab 2 opens, auto-select the first vendor (highest rating).

6. **GSTIN copy**: Clicking the copy icon next to GSTIN copies it to clipboard and briefly shows "Copied!".

7. **Vendor type display**: Map enum values to readable labels:
   - `full_package` → "Full Package Manufacturer"
   - `raw_material_trader` → "Trader / Distributor"
   - `cmt_unit` → "CMT Unit"
   - etc.

8. **Empty states**: If no vendors yet for a run (still in progress), show a spinner with "Enrichment in progress…".

9. **Error state**: If `status === 'error'`, show a red alert card with `error_message` text.
