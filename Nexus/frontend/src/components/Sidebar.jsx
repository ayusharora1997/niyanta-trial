import { NavLink } from 'react-router-dom';

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

export default function Sidebar({ open, onToggle }) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="fixed left-4 top-4 z-40 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-lg md:hidden"
      >
        Menu
      </button>
      {open && <button type="button" className="fixed inset-0 z-20 bg-slate-950/40 md:hidden" onClick={onToggle} />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 bg-niyanta-navy px-4 py-6 transition-transform md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-8 px-2">
          <div className="text-lg font-bold text-white">Niyanta</div>
          <div className="text-xs font-medium text-slate-400">Vendor Discovery</div>
        </div>
        <nav className="space-y-2">
          <NavLink to="/" className={linkClass} onClick={onToggle}>
            <span aria-hidden="true">⌕</span>
            Discover
          </NavLink>
          <NavLink to="/history" className={linkClass} onClick={onToggle}>
            <span aria-hidden="true">↺</span>
            History
          </NavLink>
        </nav>
      </aside>
    </>
  );
}
