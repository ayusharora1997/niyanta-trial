import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listRuns, subscribeToSearchRuns } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatDateTime } from '../utils.js';

export default function History() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

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

  useEffect(() => { loadRuns(); }, [loadRuns]);

  useEffect(() => {
    let unsubscribe;
    try { unsubscribe = subscribeToSearchRuns(loadRuns); } catch { /* polling handles it */ }
    const timer = window.setInterval(loadRuns, 5000);
    return () => { window.clearInterval(timer); if (unsubscribe) unsubscribe(); };
  }, [loadRuns]);

  const viewRun = (searchId) => navigate(`/?run=${searchId}`);

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
                <th className="px-4 py-3">Filters</th>
                <th className="px-4 py-3">Vendors</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {runs.map((run) => {
                const filtersCount = Array.isArray(run.filters_applied) ? run.filters_applied.length : 0;
                const isDone = run.status === 'completed';
                return (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{run.keyword || run.search_name || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-slate-600">
                      {filtersCount
                        ? <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{filtersCount} active</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{run.vendors_found ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(run.started_at)}</td>
                    <td className="px-4 py-3">
                      {isDone
                        ? <button type="button" onClick={() => viewRun(run.search_id)} className="font-semibold text-indigo-600 hover:text-indigo-500">View Results →</button>
                        : <span className="text-slate-400 text-xs">—</span>}
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
