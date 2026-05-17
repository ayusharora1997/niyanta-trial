import { useState } from 'react';

export default function CopyButton({ value, label = 'Copy', compact = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className={`inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 ${
        compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      }`}
      title={value ? `Copy ${label}` : 'Nothing to copy'}
    >
      <span aria-hidden="true">📋</span>
      {copied ? 'Copied!' : label}
    </button>
  );
}
