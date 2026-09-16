import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';
import JobDrawer from './components/JobDrawer.jsx';
import TechnicianDashboard from './pages/TechnicianDashboard.jsx';
import MyJobs from './pages/MyJobs.jsx';
import {
  getPortalData,
  getPortalDate,
  mockMode,
} from './services/jobService.js';
const readPage = () => (location.hash === '#jobs' ? 'jobs' : 'dashboard');
export default function App() {
  const [page, setPage] = useState(readPage);
  const [jobs, setJobs] = useState([]);
  const [technician, setTechnician] = useState(null);
  const [loadedRetry, setLoadedRetry] = useState(-1);
  const [loadError, setLoadError] = useState({ retry: -1, message: '' });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null);
  const today = getPortalDate();
  useEffect(() => {
    const change = () => {
      setPage(readPage());
      setSelected(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getPortalData({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setJobs(data.jobs);
          setTechnician(data.technician);
        }
      })
      .catch((e) => {
        if (e.name !== 'AbortError')
          setLoadError({ retry, message: e.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedRetry(retry);
      });
    return () => controller.abort();
  }, [retry]);
  const loading = loadedRetry !== retry;
  const error = loadError.retry === retry ? loadError.message : '';
  return (
    <>
      <Sidebar page={page} technician={technician} />
      <div className="workspace">
        <Header
          page={page}
          total={jobs.length}
          today={today}
          technician={technician}
        />
        <main>
          {loading ? (
            <output className="panel empty">Loading your jobs…</output>
          ) : error ? (
            <div className="panel empty" role="alert">
              <p>{error}</p>
              <Button
                variant="ghost"
                className="detail-button"
                onClick={() => setRetry((r) => r + 1)}
              >
                Try again
              </Button>
            </div>
          ) : page === 'jobs' ? (
            <MyJobs jobs={jobs} today={today} onSelect={setSelected} />
          ) : (
            <TechnicianDashboard
              jobs={jobs}
              today={today}
              onSelect={setSelected}
            />
          )}
          <footer className="app-footer">
            AirCon Maintenance
            {mockMode ? ' · Demo data · 1 September 2026' : ' · MySQL'}
          </footer>
        </main>
      </div>
      {selected && (
        <JobDrawer
          job={selected}
          onClose={() => setSelected(null)}
          onStatusChanged={() => setRetry((r) => r + 1)}
        />
      )}
    </>
  );
}
