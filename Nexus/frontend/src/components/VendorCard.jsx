import { useState } from 'react';
import { priceLabel, truncateText, vendorTypeLabel } from '../utils.js';
import CopyButton from './CopyButton.jsx';

export default function VendorCard({ vendor }) {
  if (!vendor) {
    return (
      <div className="card flex min-h-96 items-center justify-center p-8 text-sm font-medium text-slate-500">
        Select a vendor to view details.
      </div>
    );
  }

  const extract = vendor.indiamart_extract || {};
  const websiteExtract = vendor.website_extract;
  const hsnCodes = (extract.hsnCodes || []).filter((item) => item.code !== 'HSN Code');

  return (
    <article className="card overflow-hidden">
      <div className="border-b border-slate-200 p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Vendor profile</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-950">{vendor.company_name}</h2>
        <p className="mt-1 text-sm text-slate-500">{[vendor.city, vendor.state].filter(Boolean).join(', ') || 'Location unavailable'}</p>
      </div>

      <div className="divide-y divide-slate-200">
        <Section title="🏢 Company Overview">
          {(extract.description || websiteExtract?.aboutUs) && (
            <blockquote className="mb-4 rounded-lg bg-slate-50 p-4 text-sm italic leading-6 text-slate-600">
              {extract.description || websiteExtract.aboutUs}
            </blockquote>
          )}
          <InfoGrid
            rows={[
              ['Location', [vendor.city, vendor.state].filter(Boolean).join(', ') || '-'],
              ['Member Since', extract.memberYears || '-'],
              ['Rating', vendor.indiamart_rating ? `${vendor.indiamart_rating} ★` : '-'],
              ['Reviews', vendor.indiamart_review_count ?? '-'],
              ['Price Range', priceLabel(vendor)],
              ['Vendor Type', vendorTypeLabel(vendor.vendor_type)],
              ['Nature of Business', extract.bizInfo?.['Nature of Business'] || '-'],
              ['Onboarding Status', vendor.onboarding_status || '-']
            ]}
          />
        </Section>

        {vendor.gstin_verified && (
          <Section title="🔏 TrustSEAL Certificate">
            <div className="mb-4 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              TrustSEAL Verified - IndiaMART
            </div>
            <InfoGrid
              rows={[
                ['Director / Proprietor', vendor.primary_contact_name || '-'],
                ['GSTIN', <span className="inline-flex items-center gap-2 font-mono">{vendor.gstin || '-'} {vendor.gstin && <CopyButton value={vendor.gstin} label="Copy" compact />}</span>],
                ['Registered Address', vendor.registered_address || '-'],
                ['City / State', [vendor.city, vendor.state].filter(Boolean).join(', ') || '-'],
                ['Mobile Verified', extract.mobileVerified ? 'Yes' : 'No'],
                ['Email Verified', extract.emailVerified ? 'Yes' : 'No'],
                ['Cert Issued', extract.trustSealIssued || '-'],
                ['Cert Expires', extract.trustSealExpires || '-']
              ]}
            />
          </Section>
        )}

        <Section title="📋 Business Details">
          <InfoGrid
            rows={[
              ['Nature of Business', extract.bizInfo?.['Nature of Business'] || '-'],
              ['Legal Status', vendor.legal_status || extract.bizInfo?.['Legal Status of Firm'] || '-'],
              ['Annual Turnover', vendor.annual_turnover_range || extract.bizInfo?.['Annual Turnover'] || '-'],
              ['Employees', vendor.num_employees_range || extract.bizInfo?.['Total Number of Employees'] || '-'],
              ['GST Reg Date', extract.bizInfo?.['GST Registration Date'] || '-'],
              ['IEC Number', extract.bizInfo?.['Import Export Code (IEC)'] || '-']
            ]}
          />
        </Section>

        <Section title="📞 Contact">
          <InfoGrid
            rows={[
              ['Phone', <span className="inline-flex items-center gap-2 font-mono">{vendor.primary_contact_phone || '-'} {vendor.primary_contact_phone && <CopyButton value={vendor.primary_contact_phone} label="Copy" compact />}</span>],
              ['Website', vendor.website ? <a href={vendor.website} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:text-indigo-500">{vendor.website}</a> : '-'],
              ['Website Type', websiteExtract?.hostedByIndiamart ? '🏠 IndiaMART-hosted website' : websiteExtract ? 'Independent site' : '-'],
              ['IndiaMART Profile', vendor.indiamart_url ? <a href={vendor.indiamart_url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:text-indigo-500">Open profile ↗</a> : '-']
            ]}
          />
        </Section>

        {!!hsnCodes.length && (
          <Section title="🏷️ HSN Codes">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 py-2 pr-4">Code</th>
                    <th className="border-b border-slate-200 py-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {hsnCodes.map((item) => (
                    <tr key={`${item.code}-${item.description}`}>
                      <td className="border-b border-slate-100 py-2 pr-4 font-mono text-xs">{item.code}</td>
                      <td className="border-b border-slate-100 py-2 text-slate-700">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {!!(extract.productCategories || []).length && (
          <Section title="📦 Products & Categories">
            <div className="space-y-4">
              {extract.productCategories.map((group) => (
                <div key={group.category}>
                  <h4 className="font-bold text-slate-900">{group.category}</h4>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {(group.items || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {websiteExtract && (
          <Section title="🌐 Website Intel">
            <div className="mb-4 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
              {websiteExtract.hostedByIndiamart ? 'IndiaMART-hosted website' : 'Independent site'}
            </div>
            <ReadMore title="About Us" text={websiteExtract.aboutUs} />
            <ReadMore title="Contact Us" text={websiteExtract.contactUs} />
          </Section>
        )}
      </div>
    </article>
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="p-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left text-base font-bold text-slate-950"
      >
        <span>{title}</span>
        <span className="text-slate-400">{open ? '−' : '+'}</span>
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'mt-4 max-h-[1600px]' : 'max-h-0'}`}>
        {children}
      </div>
    </section>
  );
}

function InfoGrid({ rows }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-100 bg-white p-3">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadMore({ title, text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const display = expanded ? text : truncateText(text);

  return (
    <div className="mb-4 last:mb-0">
      <h4 className="mb-2 font-bold text-slate-900">{title}</h4>
      <p className="text-sm leading-6 text-slate-700">{display}</p>
      {text.length > 400 && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 text-sm font-semibold text-indigo-600">
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
