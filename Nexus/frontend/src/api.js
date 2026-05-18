const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const json = (res) => {
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

// Start a scrape job — accepts a plain keyword string
export const createSearchRun = (keyword) =>
  fetch(`${BASE}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, searchName: keyword }),
  }).then(json);

// List recent search runs (includes _live state for in-progress jobs)
export const listRuns = () =>
  fetch(`${BASE}/api/runs`).then(json);

// Get a single run + its vendors
export const getRun = (searchId) =>
  fetch(`${BASE}/api/runs/${searchId}`).then(json);

// Download enriched markdown for a completed run
export const getMarkdown = (searchId) =>
  fetch(`${BASE}/api/runs/${searchId}/markdown`).then((res) => {
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.text();
  });

// No-op: components already poll via setInterval — realtime not needed
export const subscribeToSearchRuns = (_onChange) => () => {};
