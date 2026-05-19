import { useEffect, useRef } from 'react';
import StatusBadge from './StatusBadge.jsx';

export default function ActiveJobCard({ run, liveJob }) {
  const logRef = useRef(null);
  const log = liveJob?.log || [];
  const total = liveJob?.total || 0;
  const progress = liveJob?.progress || 0;
  const percent = total ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Scraping in progress...</h2>
          <p className="text-sm text-slate-500">{run?.search_name || run?.search_id}</p>
        </div>
        <StatusBadge status={liveJob?.status || run?.status} />
      </div>
      {liveJob?.status === 'queued' ? (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          <span className="font-bold">Queued</span>
          {liveJob.queuePosition > 0 && ` — position ${liveJob.queuePosition} in queue`}
          <span className="ml-2 text-amber-600">Waiting for previous job to finish...</span>
        </div>
      ) : (
        total > 0 ? (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>Enriching profiles: {progress} / {total}</span>
              <span>{percent}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-niyanta-indigo transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : (
          <div className="mb-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-niyanta-indigo" />
          </div>
        )
      )}
      <pre
        ref={logRef}
        className="overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100"
        style={{ maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {(log.map((item) => item.msg).join('\n') || 'Waiting for live scrape logs...')}
      </pre>
    </section>
  );
}
