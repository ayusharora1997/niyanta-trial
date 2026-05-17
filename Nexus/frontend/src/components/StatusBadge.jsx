import { formatStatus, isRunningStatus } from '../utils.js';

export default function StatusBadge({ status, errorMessage }) {
  const current = status || 'pending';
  const base = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';
  const classes = {
    completed: 'bg-emerald-100 text-emerald-700',
    error: 'bg-rose-100 text-rose-700',
    pending: 'bg-slate-100 text-slate-600'
  };

  if (isRunningStatus(current)) {
    return (
      <span className={`${base} bg-amber-100 text-amber-800`} title={formatStatus(current)}>
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        In progress
      </span>
    );
  }

  return (
    <span className={`${base} ${classes[current] || classes.pending}`} title={errorMessage || formatStatus(current)}>
      {current === 'completed' ? '✅ ' : ''}
      {formatStatus(current)}
    </span>
  );
}
