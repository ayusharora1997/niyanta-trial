import { useEffect, useState } from 'react';
import { parseKeywordFromUrl } from '../utils.js';

const initialForm = {
  url: '',
  searchName: '',
  keyword: '',
  country: 'India',
  platform: 'indiamart'
};

export default function ScrapeForm({ onSubmit, disabled }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');

  useEffect(() => {
    const parsed = parseKeywordFromUrl(form.url);
    if (parsed && !form.keyword) {
      setForm((current) => ({ ...current, keyword: parsed }));
    }
  }, [form.url, form.keyword]);

  const update = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.url.trim() || !form.searchName.trim() || !form.keyword.trim()) {
      setError('Search URL, Search Name, and Keyword are required.');
      return;
    }
    try {
      await onSubmit(form);
      setForm(initialForm);
    } catch {
      // Parent page renders the API error.
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-bold text-slate-950">New vendor scrape</h2>
        <p className="text-sm text-slate-500">Paste an IndiaMART search URL and run enrichment into Supabase.</p>
      </div>
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="field-label">IndiaMART Search URL</span>
          <input
            className="field-input"
            value={form.url}
            onChange={update('url')}
            placeholder="https://dir.indiamart.com/search.mp?ss=..."
            disabled={disabled}
          />
        </label>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block space-y-2">
            <span className="field-label">Search Name</span>
            <input
              className="field-input"
              value={form.searchName}
              onChange={update('searchName')}
              placeholder="T-Shirts 360 GSM Bengaluru"
              disabled={disabled}
            />
          </label>
          <label className="block space-y-2">
            <span className="field-label">Keyword</span>
            <input className="field-input" value={form.keyword} onChange={update('keyword')} disabled={disabled} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="field-label">Country</span>
            <select className="field-input" value={form.country} onChange={update('country')} disabled={disabled}>
              <option>India</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="field-label">Platform</span>
            <select className="field-input" value={form.platform} onChange={update('platform')} disabled={disabled}>
              <option value="indiamart">IndiaMART</option>
            </select>
          </label>
        </div>
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div>}
        <button type="submit" className="primary-button w-full sm:w-auto" disabled={disabled}>
          Run Scrape
        </button>
      </div>
    </form>
  );
}
