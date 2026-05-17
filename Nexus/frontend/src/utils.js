export const terminalStatuses = ['completed', 'error'];
export const runningStatuses = ['running', 'scraping_search', 'enriching_profiles', 'saving'];

export const isTerminalStatus = (status) => terminalStatuses.includes(status);

export const isRunningStatus = (status) => runningStatuses.includes(status);

export const formatStatus = (status) =>
  String(status || 'pending')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '-';
  const total = Number(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${rest}s`;
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
};

export const priceLabel = (vendor) => {
  if (!vendor) return '-';
  const unit = vendor.price_unit ? ` / ${vendor.price_unit}` : '';
  if (vendor.price_range_inr_low && vendor.price_range_inr_high) {
    return `₹${vendor.price_range_inr_low} - ₹${vendor.price_range_inr_high}${unit}`;
  }
  if (vendor.price_range_inr_low) return `₹${vendor.price_range_inr_low}${unit}`;
  if (vendor.price_range_inr_high) return `Up to ₹${vendor.price_range_inr_high}${unit}`;
  return '-';
};

export const vendorTypeLabel = (type) => {
  const labels = {
    full_package: 'Full Package Manufacturer',
    raw_material_trader: 'Trader / Distributor',
    cmt_unit: 'CMT Unit',
    exporter: 'Exporter',
    manufacturer: 'Manufacturer',
    wholesaler: 'Wholesaler',
    retailer: 'Retailer'
  };
  return labels[type] || formatStatus(type || '-');
};

export const sortVendorsByRating = (vendors = []) =>
  [...vendors].sort((a, b) => (b.indiamart_rating || 0) - (a.indiamart_rating || 0));

export const parseKeywordFromUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return (url.searchParams.get('ss') || '').replace(/\+/g, ' ').trim();
  } catch {
    const match = String(rawUrl).match(/[?&]ss=([^&]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : '';
  }
};

export const slugifyFilename = (value) =>
  `${String(value || 'niyanta-search').trim().replace(/\s+/g, '-').toLowerCase()}.md`;

export const truncateText = (value, limit = 400) => {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}...`;
};
