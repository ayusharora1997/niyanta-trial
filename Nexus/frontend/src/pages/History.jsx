import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listRuns } from '../api.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'error', label: 'Errors' },
  { id: 'filtered', label: 'With filters' },
];

function StatusPill({ status }) {
  const s = (status || 'pending').toLowerCase().replace(/[_\s]+/g, '_');
  return (
    <span className={`n-pill n-s-${s}`}>
      <span className="blob" />
      {status || 'pending'}
    </span>
  );
}

function padIdx(n) { return String(n).padStart(3, '0'); }
function relTime(ts) {
  if (!ts) return '—';
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function History() {
  const [runs, setRuns]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [activeFilter, setFilter]   = useState('all');
  const [text, setText]             = useState('');
  const navigate = useNavigate();

  const loadRuns = useCallback(async () => {
    try {
      const data = await listRuns();
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Unable to load history.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => {
    const t = setInterval(loadRuns, 5000);
    return () => clearInterval(t);
  }, [loadRuns]);

  const counts = useMemo(() => {
    const c = { all: runs.length, running: 0, completed: 0, error: 0, filtered: 0 };
    runs.forEach(r => {
      if (r.status === 'running' || r.status === 'queued' || r.status === 'pending' || r.status === 'scraping_search' || r.status === 'enriching_profiles' || r.status === 'saving') c.running++;
      else if (r.status === 'completed') c.completed++;
      else if (r.status === 'error') c.error++;
      if (Array.isArray(r.filters_applied) && r.filters_applied.length > 0) c.filtered++;
    });
    return c;
  }, [runs]);

  const filtered = useMemo(() => {
    let list = runs;
    if (activeFilter === 'running')   list = list.filter(r => ['running','queued','pending','scraping_search','enriching_profiles','saving'].includes(r.status));
    if (activeFilter === 'completed') list = list.filter(r => r.status === 'completed');
    if (activeFilter === 'error')     list = list.filter(r => r.status === 'error');
    if (activeFilter === 'filtered')  list = list.filter(r => Array.isArray(r.filters_applied) && r.filters_applied.length > 0);
    if (text.trim()) {
      const t = text.trim().toLowerCase();
      list = list.filter(r => (r.keyword || r.search_name || '').toLowerCase().includes(t));
    }
    return list;
  }, [runs, activeFilter, text]);

  return (
    <main className="n-shell">
      <header className="n-page-head">
        <div>
          <h1>Search History</h1>
          <div className="sub">{runs.length} {runs.length === 1 ? 'run' : 'runs'} tracked · most recent first.</div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>
          <span style={{ color: 'var(--fg-4)' }}>Showing</span>&nbsp;{filtered.length} of {runs.length}
        </div>
      </header>

      {error && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 'var(--text-sm)', color: 'var(--danger-strong)' }}>{error}</div>
      )}

      <div className="n-card">
        <div className="n-card-head">
          <div className="n-chipbar">
            {FILTERS.map(f => (
              <button key={f.id} className={`n-chip${activeFilter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}
                <span className="ct">{counts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="n-search-mini">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--fg-4)', flexShrink: 0 }}><circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M9 9l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Filter keyword…" spellCheck={false} />
            {text && <button className="x" onClick={() => setText('')}>×</button>}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="n-empty">
            <span className="big">{runs.length === 0 ? 'No searches yet.' : 'No runs match.'}</span>
            {runs.length === 0 ? 'Run your first search in Discovery.' : 'Try a different filter.'} <span className="caret">▍</span>
          </div>
        ) : (
          <table className="n-runs">
            <thead>
              <tr>
                <th className="idx">#</th>
                <th>Keyword</th>
                <th>Status</th>
                <th>Filters</th>
                <th className="num">Vendors</th>
                <th>Started</th>
                <th className="act">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const fc = Array.isArray(r.filters_applied) ? r.filters_applied.length : 0;
                return (
                  <tr key={r.id}>
                    <td className="idx">{padIdx(filtered.length - i)}</td>
                    <td className="kw">
                      {r.keyword || r.search_name || '—'}
                      {r.status === 'error' && r.error_message && <span className="n-err-inline">{r.error_message}</span>}
                    </td>
                    <td><StatusPill status={r.status} /></td>
                    <td>
                      {fc > 0
                        ? <span className="n-pill-filter">{fc} filter{fc > 1 ? 's' : ''} <span className="warn">⚠</span></span>
                        : <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fog-300)' }}>—</span>}
                    </td>
                    <td className={`num${r.vendors_found == null ? ' dim' : ''}`}>
                      {r.vendors_found != null ? r.vendors_found.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="time">{relTime(r.started_at)}</td>
                    <td className="act">
                      {r.status === 'completed'
                        ? <button onClick={() => navigate(`/?run=${r.search_id}`)}>View results →</button>
                        : <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fog-300)', fontSize: 'var(--text-xs)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="n-footer">
        <span>niyanta · history v0.5</span>
        <span>last 50 runs · auto-refreshes every 5s</span>
      </div>
    </main>
  );
}
