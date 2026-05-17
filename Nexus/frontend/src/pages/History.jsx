import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listRuns } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatDateTime, formatDuration, isRunningStatus } from '../utils.js';

export default function History({ onViewRun }) {
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

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!runs.some((run) => isRunningStatus(run.status) || run.status === 'pending')) return undefined;
    const timer = window.setInterval(loadRuns, 5000);
    return () => window.clearInterval(timer);
  }, [loadRuns, runs]);

  const viewRun = (run) => {
    onViewRun(run.search_id);
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pt-8 md:pt-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">History</h1>
        <p className="mt-2 text-base text-slate-500">Review previous vendor discovery runs and reopen saved results.</p>
      </header>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Search Name</th>
                <th className="px-4 py-3">Keyword</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Vendors</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {runs.map((run) => (
                <tr key={run.search_id || run.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{run.search_name}</td>
                  <td className="px-4 py-3 text-slate-600">{run.keyword || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{run.platform === 'indiamart' ? 'IndiaMART' : run.platform}</td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} errorMessage={run.error_message} /></td>
                  <td className="px-4 py-3 text-slate-600">{run.vendors_inserted ?? run.vendors_found ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDuration(run.duration_seconds)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(run.completed_at || run.started_at)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className="secondary-button whitespace-nowrap" onClick={() => viewRun(run)}>
                      View Results
                    </button>
                  </td>
                </tr>
              ))}
              {!runs.length && (
                <tr>
                  <td colSpan="8" className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                    {loading ? 'Loading history...' : 'No scrape runs yet.'}
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
