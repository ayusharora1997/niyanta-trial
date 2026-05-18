import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createSearchRun, getRun, listRuns } from '../api.js';
import ActiveJobCard from '../components/ActiveJobCard.jsx';
import RunSummary from '../components/RunSummary.jsx';
import VendorDetails from '../components/VendorDetails.jsx';
import { formatDateTime } from '../utils.js';

const TERMINAL = new Set(['completed', 'error']);
const SUGGESTIONS = ['cotton fabric', 'HDPE pipes', 'industrial bearings', 'stainless steel sheets', 'corrugated boxes'];

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

export default function Discover() {
  const [query, setQuery]               = useState('');
  const [busy, setBusy]                 = useState(false);
  const [submitError, setSubmitError]   = useState('');
  const [pollingId, setPollingId]       = useState(null);
  const [liveData, setLiveData]         = useState(null);
  const [tab, setTab]                   = useState('summary');
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [recentRuns, setRecentRuns]     = useState([]);
  const [bannerOpen, setBannerOpen]     = useState(true);
  const timerRef = useRef(null);
  const logRef   = useRef(null);
  const inputRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Load recent runs
  const loadRecent = useCallback(async () => {
    try { setRecentRuns(await listRuns()); } catch {}
  }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Keyboard shortcuts
  useEffect(() => {
    const fn = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); inputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  });

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [liveData?._live?.log?.length]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const poll = useCallback(async (id) => {
    try {
      const data = await getRun(id);
      setLiveData(data);
      const status = data._live?.status || data.run?.status;
      if (TERMINAL.has(status)) { stopPolling(); loadRecent(); }
    } catch {}
  }, [stopPolling, loadRecent]);

  // Load run from ?run= param (linked from History)
  useEffect(() => {
    const runId = searchParams.get('run');
    if (runId) { setPollingId(runId); setSearchParams({}, { replace: true }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pollingId) return;
    poll(pollingId);
    timerRef.current = setInterval(() => poll(pollingId), 3000);
    return stopPolling;
  }, [pollingId, poll, stopPolling]);

  const handleSubmit = useCallback(async () => {
    const kw = query.trim();
    if (!kw || busy) return;
    setBusy(true); setSubmitError(''); setLiveData(null); setSelectedVendorId(null); stopPolling();
    try {
      const result = await createSearchRun(kw);
      setPollingId(result.searchId);
      setQuery('');
    } catch (err) {
      setSubmitError(err.message || 'Failed to start search.');
    } finally { setBusy(false); }
  }, [query, busy, stopPolling]);

  const effectiveStatus = liveData?._live?.status || liveData?.run?.status;
  const isActive  = liveData && !TERMINAL.has(effectiveStatus);
  const isSettled = liveData &&  TERMINAL.has(effectiveStatus);

  // KPIs from recent runs
  const stats = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    const today = recentRuns.filter(r => new Date(r.started_at).getTime() >= since);
    const done  = today.filter(r => r.status === 'completed');
    const vTotal = done.reduce((s, r) => s + (r.vendors_found || 0), 0);
    return {
      runsToday: today.length,
      vendorsToday: vTotal,
      avg: done.length ? Math.round(vTotal / done.length) : 0,
      filtersDetected: today.filter(r => Array.isArray(r.filters_applied) && r.filters_applied.length > 0).length,
    };
  }, [recentRuns]);

  // Banner: most recent completed run with filters
  const bannerRun = useMemo(() => {
    if (!bannerOpen) return null;
    return recentRuns.find(r => r.status === 'completed' && Array.isArray(r.filters_applied) && r.filters_applied.length > 0) || null;
  }, [recentRuns, bannerOpen]);

  const recent5 = recentRuns.slice(0, 5);

  // Live job display
  const liveJob = liveData?._live;
  const liveProgress  = liveJob?.progress || 0;
  const liveTotal     = liveJob?.total || 0;
  const livePercent   = liveTotal ? Math.min(100, Math.round(liveProgress / liveTotal * 100)) : 0;
  const liveLogs      = (liveJob?.log || []).slice(-8).map(l => l.msg).join('\n') || 'Waiting for logs…';

  return (
    <main className="n-shell">
      <header className="n-page-head">
        <div>
          <h1>Discovery</h1>
          <div className="sub">Run a sourcing search against IndiaMART. Results appear below.</div>
        </div>
        <div className="right" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-3)' }}>
          <span style={{ color: 'var(--fg-4)' }}>Today</span>&nbsp;
          {stats.runsToday} runs · {stats.vendorsToday.toLocaleString('en-IN')} vendors
        </div>
      </header>

      {/* KPI strip */}
      <div className="n-kpis">
        <div className="n-kpi teal">
          <span className="eye">Runs · last 24h</span>
          <div className="val">{stats.runsToday}</div>
          <div className="sub">{recentRuns[0] ? `Last: ${relTime(recentRuns[0].started_at)}` : 'None yet'}</div>
        </div>
        <div className="n-kpi green">
          <span className="eye">Vendors found</span>
          <div className="val">{stats.vendorsToday.toLocaleString('en-IN')}</div>
          <div className="sub">Across completed runs today</div>
        </div>
        <div className="n-kpi">
          <span className="eye">Avg per run</span>
          <div className="val">{stats.avg}<span className="sm">/ run</span></div>
          <div className="sub">Completed runs only</div>
        </div>
        <div className="n-kpi amber">
          <span className="eye">Filters detected</span>
          <div className="val">{stats.filtersDetected}</div>
          <div className="sub">Runs that hit active IM filters</div>
        </div>
      </div>

      {/* Command bar */}
      <div className="n-command">
        <div className="n-command-label">
          <span className="eyebrow" style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--fg-4)' }}>What are you sourcing?</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--fg-4)' }}>Press / to focus · ⌘↵ to run</span>
        </div>
        <div className="n-command-row">
          <span className="n-prompt" aria-hidden>&gt;_</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="cotton fabric · HDPE pipes · auto components"
            disabled={isActive}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className={`n-run${busy ? ' loading' : ''}`}
            onClick={handleSubmit}
            disabled={!query.trim() || busy || isActive}
          >
            {busy
              ? <><span className="spin" /> Queuing…</>
              : <>Run Search <span className="n-run kbd">⌘↵</span></>}
          </button>
        </div>
        <div className="n-command-hint">
          <span>IndiaMART search</span>
          <span className="sep">·</span>
          <span>up to 3 pages</span>
          <span className="sep">·</span>
          <span className="em">full profile enrichment per vendor</span>
        </div>
      </div>

      {/* Suggestions */}
      <div className="n-suggestions">
        <span className="n-sugg-label">Try</span>
        {SUGGESTIONS.map(s => (
          <button key={s} className="n-sugg" onClick={() => setQuery(s)}>{s}</button>
        ))}
      </div>

      <div style={{ height: 28 }} />

      {submitError && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 'var(--text-sm)', color: 'var(--danger-strong)', fontWeight: 500 }}>
          {submitError}
        </div>
      )}

      {/* Filter banner */}
      {bannerRun && (
        <div className="n-banner">
          <span className="icon">⚠</span>
          <span className="msg">Active IndiaMART filters detected on last search:</span>
          <span className="pills">
            {bannerRun.filters_applied.map((f, i) => (
              <span className="pill" key={i}><span className="k">{f.label}:</span> {f.value}</span>
            ))}
          </span>
          <span className="spacer" />
          <button className="x" onClick={() => setBannerOpen(false)}>×</button>
        </div>
      )}

      {/* Live job card */}
      {isActive && liveJob && (
        <div className="n-live-card" style={{ marginBottom: 24 }}>
          <div className="n-live-head">
            <h2>Scraping in progress…</h2>
            <StatusPill status={effectiveStatus} />
          </div>
          <div className="n-live-body">
            {liveJob.status === 'queued' ? (
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12, fontSize: 'var(--text-sm)', color: 'var(--warning-strong)' }}>
                <strong>Queued</strong>{liveJob.queuePosition > 0 && ` — position ${liveJob.queuePosition}`} · Waiting for previous job to finish…
              </div>
            ) : liveTotal > 0 ? (
              <>
                <div className="n-progress-label">
                  <span>Enriching profiles: {liveProgress} / {liveTotal}</span>
                  <span>{livePercent}%</span>
                </div>
                <div className="n-progress-bar"><div className="fill" style={{ width: `${livePercent}%` }} /></div>
              </>
            ) : (
              <div className="n-progress-bar"><div className="fill" style={{ width: '33%', animation: 'pulse 1.5s ease-in-out infinite' }} /></div>
            )}
            <pre className="n-log" ref={logRef}>{liveLogs}</pre>
          </div>
        </div>
      )}

      {/* Results tabs */}
      {isSettled && liveData?.run && (
        <div style={{ marginBottom: 24 }}>
          <div className="n-tabs">
            {[['summary', 'Search Summary'], ['vendors', 'Vendor Details']].map(([key, label]) => (
              <button key={key} className={`n-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {tab === 'summary' && (
            <RunSummary run={liveData.run} vendors={liveData.vendors} onVendorSelect={id => { setSelectedVendorId(id); setTab('vendors'); }} />
          )}
          {tab === 'vendors' && (
            <VendorDetails vendors={liveData.vendors} run={liveData.run} selectedVendorId={selectedVendorId} onVendorSelect={setSelectedVendorId} />
          )}
        </div>
      )}
      {isSettled && effectiveStatus === 'error' && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderLeft: '2px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 24 }}>
          <div style={{ fontWeight: 600, color: 'var(--danger-strong)', marginBottom: 4 }}>Scrape failed</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{liveData?._live?.error || liveData?.run?.error_message || 'Unknown error'}</div>
        </div>
      )}

      {/* Recent runs */}
      <div className="n-card">
        <div className="n-card-head">
          <div className="title">
            <h2>Recent Runs</h2>
            <span className="n-count">{Math.min(recent5.length, 5)} of {recentRuns.length}</span>
          </div>
          <a href="/history" onClick={e => { e.preventDefault(); navigate('/history'); }} className="n-see-all">View all in History <span>→</span></a>
        </div>
        {recent5.length === 0 ? (
          <div className="n-empty"><span className="big">No searches yet.</span>Run your first search above. <span className="caret">▍</span></div>
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
              {recent5.map((r, i) => {
                const fc = Array.isArray(r.filters_applied) ? r.filters_applied.length : 0;
                return (
                  <tr key={r.id}>
                    <td className="idx">{padIdx(recentRuns.length - i)}</td>
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
                        ? <button onClick={() => { setPollingId(r.search_id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>View results →</button>
                        : <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fog-300)', fontSize: 'var(--text-xs)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="n-context">
        <span className="ico">i</span>
        <div>
          <div className="t">Backend: Railway · Supabase</div>
          <div className="s">Each run scrapes up to 3 pages, enriches every vendor profile with TrustSEAL + external website intel, and saves to Supabase. 3 parallel workers per run.</div>
        </div>
      </div>

      <div className="n-footer">
        <span>niyanta · discovery v0.5</span>
        <span>indiamart adapter · 2026-05</span>
      </div>
    </main>
  );
}
