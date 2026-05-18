import { useCallback, useEffect, useState } from 'react';
import { listRuns, subscribeToSearchRuns } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatDateTime } from '../utils.js';

export default function History() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    setError('');
    try {
      const data = await listRuns();
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Unable to load history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    let unsubscribe;
    try {
      unsubscribe = subscribeToSearchRuns(loadRuns);
    } catch (err) {
      setError(err.message || 'Unable to subscribe to search runs.');
    }

    const timer = window.setInterval(loadRuns, 5000);
    return () => {
      window.clearInterval(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [loadRuns]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pt-8 md:pt-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">History</h1>
        <p className="mt-2 text-base text-slate-500">Review previous sourcing searches and scraper status.</p>
      </header>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Keyword</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Filters Active</th>
                <th className="px-4 py-3">Vendors Found</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Search URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {runs.map((run) => {
                const filtersCount = Array.isArray(run.filters_applied) ? run.filters_applied.length : 0;
                return (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{run.keyword || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-slate-600">
                      {filtersCount ? `${filtersCount} ${filtersCount === 1 ? 'filter' : 'filters'}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{run.vendors_found ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(run.started_at)}</td>
                    <td className="px-4 py-3">
                      {run.search_url ? (
                        <a href={run.search_url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:text-indigo-500">
                          Open IndiaMART
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {!runs.length && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                    {loading ? 'Loading history...' : 'No searches yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
