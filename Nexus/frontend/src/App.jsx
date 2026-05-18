import { useLocation, Link, Route, Routes } from 'react-router-dom';
import Discover from './pages/Discover.jsx';
import History from './pages/History.jsx';

function TopBar({ runCount }) {
  const { pathname } = useLocation();
  return (
    <header className="n-topbar">
      <Link to="/" className="n-brand">
        <span className="mark">N</span>
        <span style={{ fontWeight: 600, letterSpacing: '-.005em' }}>niyanta</span>
      </Link>
      <nav className="n-nav">
        <Link to="/" className={pathname === '/' ? 'active' : ''}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M9 9l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          Discovery
        </Link>
        <Link to="/history" className={pathname === '/history' ? 'active' : ''}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1 0 1.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 2v2.5h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 4.5V7l1.7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          History
          {runCount != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)', background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 4, padding: '1px 5px' }}>{runCount}</span>}
        </Link>
      </nav>
      <div style={{ flex: 1 }} />
      <div className="n-scraper">
        <span style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--fg-4)' }}>Scraper</span>
        <span className="dot" />
        <span style={{ fontWeight: 500, color: 'var(--fg-2)' }}>Online</span>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      <TopBar />
      <Routes>
        <Route path="/" element={<Discover />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </div>
  );
}
