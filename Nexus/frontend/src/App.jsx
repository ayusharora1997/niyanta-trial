import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Discover from './pages/Discover.jsx';
import History from './pages/History.jsx';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState(null);

  const viewRun = (searchId) => {
    setActiveRunId(searchId);
    setSelectedVendorId(null);
  };

  const discoverProps = {
    activeRunId,
    setActiveRunId,
    activeRun,
    setActiveRun,
    vendors,
    setVendors,
    selectedVendorId,
    setSelectedVendorId
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
      <main className="px-4 py-6 md:ml-60 md:px-8 lg:px-10">
        <Routes>
          <Route path="/" element={<Discover {...discoverProps} />} />
          <Route path="/history" element={<History onViewRun={viewRun} />} />
        </Routes>
      </main>
    </div>
  );
}
