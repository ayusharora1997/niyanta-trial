import { useState } from 'react';

export default function ScrapeForm({ onSubmit, disabled }) {
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      setError('Tell us what you are sourcing.');
      return;
    }

    try {
      await onSubmit(trimmedKeyword);
      setKeyword('');
    } catch {
      // Parent page renders the Supabase error.
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-bold text-slate-950">New sourcing search</h2>
        <p className="text-sm text-slate-500">Enter a product or material. The scraper will build the IndiaMART URL automatically.</p>
      </div>
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="field-label">What are you sourcing?</span>
          <input
            className="field-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="e.g. cotton fabric, HDPE pipes, auto components"
            disabled={disabled}
          />
        </label>
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div>}
        <button type="submit" className="primary-button w-full sm:w-auto" disabled={disabled}>
          Start Search
        </button>
      </div>
    </form>
  );
}
