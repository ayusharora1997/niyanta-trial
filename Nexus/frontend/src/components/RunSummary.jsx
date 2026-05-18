import { getMarkdown } from '../api.js';
import { formatDateTime, formatDuration, priceLabel, slugifyFilename, sortVendorsByRating } from '../utils.js';
import CopyButton from './CopyButton.jsx';
import StatusBadge from './StatusBadge.jsx';

export default function RunSummary({ run, vendors, onVendorSelect }) {
  const sorted = sortVendorsByRating(vendors);

  const downloadMarkdown = async () => {
    const markdown = await getMarkdown(run.search_id);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = slugifyFilename(run.search_name);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950">Search Summary</h2>
          <button type="button" className="secondary-button" onClick={downloadMarkdown}>
            Download Markdown
          </button>
        </div>
        <dl className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Meta label="Search Name" value={run.search_name} />
          <Meta label="Platform" value={run.platform === 'indiamart' ? 'IndiaMART' : run.platform} />
          <Meta label="Country" value={run.country} />
          <div>
            <dt className="font-semibold text-slate-500">URL</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate text-slate-900">{run.search_url}</span>
              <CopyButton value={run.search_url} label="Copy" compact />
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Status</dt>
            <dd className="mt-1"><StatusBadge status={run.status} errorMessage={run.error_message} /></dd>
          </div>
          <Meta label="Vendors Found" value={`${run.vendors_found ?? 0} found, ${run.vendors_inserted ?? 0} inserted`} />
          <Meta label="Duration" value={formatDuration(run.duration_seconds)} />
          <Meta label="Scraped" value={formatDateTime(run.completed_at || run.started_at)} />
          <div>
            <dt className="font-semibold text-slate-500">IndiaMART URL</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2">
              {run.search_url
                ? <a href={run.search_url} target="_blank" rel="noreferrer" className="truncate text-indigo-600 hover:text-indigo-500 font-semibold">{run.search_url}</a>
                : <span className="text-slate-900">—</span>}
            </dd>
          </div>
        </dl>

        {/* Active filters from this run */}
        {Array.isArray(run.filters_applied) && run.filters_applied.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Filters active during this search</p>
            <div className="flex flex-wrap gap-2">
              {run.filters_applied.map((f, i) => (
                <span key={i} className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">
                  {f.label}: {f.value}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">City / State</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Rating ★</th>
                <th className="px-4 py-3">GSTIN</th>
                <th className="px-4 py-3">TrustSEAL</th>
                <th className="px-4 py-3">IndiaMART Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.map((vendor, index) => (
                <tr key={vendor.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-semibold text-indigo-600 hover:text-indigo-500"
                      onClick={() => onVendorSelect(vendor.id)}
                    >
                      {vendor.company_name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{[vendor.city, vendor.state].filter(Boolean).join(', ') || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{priceLabel(vendor)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{vendor.indiamart_rating || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{vendor.gstin || '-'}</td>
                  <td className="px-4 py-3">{vendor.indiamart_trust_seal ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">✅ Verified</span> : '-'}</td>
                  <td className="px-4 py-3">
                    {vendor.indiamart_url ? <a href={vendor.indiamart_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-500">Open ↗</a> : '-'}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan="8" className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                    Enrichment in progress...
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

function Meta({ label, value }) {
  return (
    <div>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value || '-'}</dd>
    </div>
  );
}
