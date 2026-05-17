import { useCallback, useEffect, useRef, useState } from 'react';
import ActiveJobCard from '../components/ActiveJobCard.jsx';
import RunSummary from '../components/RunSummary.jsx';
import ScrapeForm from '../components/ScrapeForm.jsx';
import VendorDetails from '../components/VendorDetails.jsx';
import { getRun, startScrape } from '../api.js';
import { isRunningStatus, isTerminalStatus, sortVendorsByRating } from '../utils.js';

export default function Discover({
  activeRunId,
  setActiveRunId,
  activeRun,
  setActiveRun,
  vendors,
  setVendors,
  selectedVendorId,
  setSelectedVendorId
}) {
  const [pollingJobId, setPollingJobId] = useState(null);
  const [liveJob, setLiveJob] = useState(null);
  const [tab, setTab] = useState('summary');
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState('');
  const resultsRef = useRef(null);

  const loadRun = useCallback(
    async (searchId) => {
      if (!searchId) return;
      setLoadingRun(true);
      setError('');
      try {
        const data = await getRun(searchId);
        const live = data._live || data.run?._live || null;
        const liveStatus = live?.status;
        setActiveRun((current) => data.run ? { ...data.run, status: liveStatus || data.run.status } : (current ? { ...current, status: liveStatus || current.status } : null));
        setVendors(data.vendors || []);
        setLiveJob(live);
        if (isRunningStatus(liveStatus || data.run?.status) || data.run?.status === 'pending') {
          setPollingJobId(searchId);
        }
        setSelectedVendorId((current) => {
          const loadedVendors = data.vendors || [];
          return loadedVendors.some((vendor) => vendor.id === current) ? current : loadedVendors[0]?.id || null;
        });
      } catch (err) {
        setError(err.message || 'Unable to load run.');
      } finally {
        setLoadingRun(false);
      }
    },
    [setActiveRun, setSelectedVendorId, setVendors]
  );

  useEffect(() => {
    if (activeRunId) loadRun(activeRunId);
  }, [activeRunId, loadRun]);

  useEffect(() => {
    if (!pollingJobId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getRun(pollingJobId);
        if (cancelled) return;
        const live = data._live || data.run?._live || null;
        const liveStatus = live?.status;
        setActiveRun((current) => data.run ? { ...data.run, status: liveStatus || data.run.status } : (current ? { ...current, status: liveStatus || current.status } : null));
        setVendors(data.vendors || []);
        setLiveJob(live);
        if (isTerminalStatus(data.run?.status || liveStatus)) {
          setPollingJobId(null);
          window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Polling failed.');
      }
    };

    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollingJobId, setActiveRun, setVendors]);

  const handleSubmit = async (form) => {
    setError('');
    try {
      const body = {
        url: form.url,
        searchName: form.searchName,
        keyword: form.keyword,
        platform: form.platform,
        country: form.country
      };
      const response = await startScrape(body);
      setActiveRunId(response.searchId);
      setActiveRun({ search_id: response.searchId, search_name: form.searchName, search_url: form.url, keyword: form.keyword, platform: form.platform, country: form.country, status: 'pending' });
      setVendors([]);
      setSelectedVendorId(null);
      setLiveJob(null);
      setTab('summary');
      setPollingJobId(response.searchId);
    } catch (err) {
      setError(err.message || 'Unable to start scrape.');
      throw err;
    }
  };

  const selectVendorAndOpenDetails = (vendorId) => {
    setSelectedVendorId(vendorId);
    setTab('details');
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const openDetailsTab = () => {
    setSelectedVendorId(sortVendorsByRating(vendors)[0]?.id || null);
    setTab('details');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pt-8 md:pt-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Niyanta Vendor Discovery</h1>
        <p className="mt-2 text-base text-slate-500">Powered by IndiaMART + TrustSEAL enrichment</p>
      </header>

      <ScrapeForm onSubmit={handleSubmit} disabled={!!pollingJobId} />

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      {(pollingJobId || isRunningStatus(activeRun?.status) || activeRun?.status === 'pending') && (
        <ActiveJobCard run={activeRun} liveJob={liveJob} />
      )}

      {activeRun?.status === 'error' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <strong>Scrape failed:</strong> {activeRun.error_message || 'Unknown error'}
        </div>
      )}

      {loadingRun && (
        <div className="card flex min-h-40 items-center justify-center p-8 text-sm font-semibold text-slate-500">
          Loading run results...
        </div>
      )}

      {activeRun && !loadingRun && (
        <section ref={resultsRef} id="results" className="space-y-4">
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>Search Summary</TabButton>
            <TabButton active={tab === 'details'} onClick={openDetailsTab}>Vendor Details</TabButton>
          </div>
          {tab === 'summary' ? (
            <RunSummary run={activeRun} vendors={vendors} onVendorSelect={selectVendorAndOpenDetails} />
          ) : (
            <VendorDetails vendors={vendors} selectedVendorId={selectedVendorId} onVendorSelect={setSelectedVendorId} run={activeRun} />
          )}
        </section>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition ${
        active ? 'bg-niyanta-indigo text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
