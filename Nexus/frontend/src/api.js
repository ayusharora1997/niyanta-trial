const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const parseJson = async (response) => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json();
};

export const startScrape = (body) =>
  fetch(`${BASE}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(parseJson);

export const listRuns = () => fetch(`${BASE}/api/runs`).then(parseJson);

export const getRun = (id) => fetch(`${BASE}/api/runs/${id}`).then(parseJson);

export const getMarkdown = async (id) => {
  const response = await fetch(`${BASE}/api/runs/${id}/markdown`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.text();
};
