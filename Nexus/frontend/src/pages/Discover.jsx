import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSearchRun, getRun } from '../api.js';
import ActiveJobCard from '../components/ActiveJobCard.jsx';
import RunSummary from '../components/RunSummary.jsx';
import ScrapeForm from '../components/ScrapeForm.jsx';
import VendorDetails from '../components/VendorDetails.jsx';

const TERMINAL = new Set(['completed', 'error']);

export default function Discover() {
  const [pollingId,        setPollingId]        = useState(null);
  const [liveData,         setLiveData]         = useState(null);   // { run, vendors, _live }
  const [tab,              setTab]              = useState('summary');
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState('');
  const timerRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const poll = useCallback(async (searchId) => {
    try {
      const data = await getRun(searchId);
      setLiveData(data);
      const status = data._live?.status || data.run?.status;
      if (TERMINAL.has(status)) stopPolling();
    } catch (err) {
      console.error('[poll]', err.message);
    }
  }, [stopPolling]);

  // Load a historical run if ?run= is in the URL (linked from History page)
  useEffect(() => {
    const runId = searchParams.get('run');
    if (runId) {
      setPollingId(runId);
      setSearchParams({}, { replace: true }); // clean URL after loading
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pollingId) return;
    poll(pollingId);
    timerRef.current = setInterval(() => poll(pollingId), 3000);
    return stopPolling;
  }, [pollingId, poll, stopPolling]);

  const handleSubmit = async (keyword) => {
    setSubmitting(true);
    setSubmitError('');
    setLiveData(null);
    setSelectedVendorId(null);
    stopPolling();
    try {
      const result = await createSearchRun(keyword);
      setPollingId(result.searchId);
    } catch (err) {
      setSubmitError(err.message || 'Failed to start search.');
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveStatus = liveData?._live?.status || liveData?.run?.status;
  const isActive  = liveData && !TERMINAL.has(effectiveStatus);
  const isSettled = liveData &&  TERMINAL.has(effectiveStatus);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pt-8 md:pt-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Niyanta Vendor Discovery</h1>
        <p className="mt-2 text-base text-slate-500">Powered by IndiaMART + TrustSEAL enrichment</p>
      </header>

      <ScrapeForm onSubmit={handleSubmit} disabled={submitting || isActive} />

      {submitError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {submitError}
        </div>
      )}

      {liveData && (
        <>
          {/* Live job card — only shown while job is queued/running, hides on completion */}
          {isActive && (
            <ActiveJobCard run={liveData.run} liveJob={liveData._live} />
          )}

          {/* Results — shown once completed or errored */}
          {isSettled && liveData.run && (
            <section className="space-y-4">
              {/* Tab bar */}
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
                {[['summary', 'Search Summary'], ['vendors', 'Vendor Details']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${
                      tab === key
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'summary' && (
                <RunSummary
                  run={liveData.run}
                  vendors={liveData.vendors}
                  onVendorSelect={(id) => { setSelectedVendorId(id); setTab('vendors'); }}
                />
              )}
              {tab === 'vendors' && (
                <VendorDetails
                  vendors={liveData.vendors}
                  run={liveData.run}
                  selectedVendorId={selectedVendorId}
                  onVendorSelect={setSelectedVendorId}
                />
              )}
            </section>
          )}

          {/* Error state */}
          {isSettled && effectiveStatus === 'error' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
              <p className="font-semibold text-rose-800">Scrape failed</p>
              <p className="mt-1 text-sm text-rose-700">{liveData._live?.error || liveData.run?.error_message || 'Unknown error'}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
