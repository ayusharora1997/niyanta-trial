import { useEffect } from 'react';
import { sortVendorsByRating } from '../utils.js';
import VendorCard from './VendorCard.jsx';

export default function VendorDetails({ vendors, selectedVendorId, onVendorSelect, run }) {
  const sorted = sortVendorsByRating(vendors);
  const selected = sorted.find((vendor) => vendor.id === selectedVendorId) || sorted[0];

  useEffect(() => {
    if (!selectedVendorId && sorted[0]) {
      onVendorSelect(sorted[0].id);
    }
  }, [onVendorSelect, selectedVendorId, sorted]);

  if (!vendors.length) {
    return (
      <div className="card flex min-h-80 items-center justify-center p-8">
        <div className="text-center">
          {run?.status === 'completed' || run?.status === 'error' ? (
            <>
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">0</div>
              <p className="text-sm font-semibold text-slate-700">No vendor rows were saved for this run.</p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-niyanta-indigo" />
              <p className="text-sm font-semibold text-slate-600">Enrichment in progress...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="card max-h-[calc(100vh-9rem)] overflow-auto p-3">
        <div className="mb-3 px-2 text-xs font-bold uppercase tracking-wide text-slate-500">Vendors</div>
        <div className="space-y-1">
          {sorted.map((vendor) => (
            <button
              key={vendor.id}
              type="button"
              onClick={() => onVendorSelect(vendor.id)}
              className={`w-full rounded-lg px-3 py-2 text-left transition ${
                selected?.id === vendor.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
              }`}
            >
              <div className="font-semibold">{vendor.company_name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {vendor.indiamart_rating ? `${vendor.indiamart_rating} ★` : 'No rating'} · {[vendor.city, vendor.state].filter(Boolean).join(', ') || 'Location unavailable'}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <VendorCard vendor={selected} />
    </div>
  );
}
