import ServiceReports from './pages/ServiceReports.jsx';
import Profile from './pages/Profile.jsx';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
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
const readPage = () =>
  ['jobs', 'reports', 'profile'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'dashboard';
export default function App() {
  const [page, setPage] = useState(readPage);
  const [jobs, setJobs] = useState([]);
  const [technician, setTechnician] = useState(null);
  const [loadedRetry, setLoadedRetry] = useState(-1);
  const [loadError, setLoadError] = useState({ retry: -1, message: '' });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null);
  const knownJobs = useRef(null);
  const [notice, setNotice] = useState('');
  const [pageRevision, setPageRevision] = useState(0);
  const changed = () => {
    setPageRevision((r) => r + 1);
  };
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
    let inFlight = false;
    async function refresh() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await getPortalData({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const ids = new Set(data.jobs.map((j) => j.jobId ?? j.id));
        if (knownJobs.current) {
          const count = [...ids].filter(
            (id) => !knownJobs.current.has(id),
          ).length;
          if (count) setNotice(count + ' new work order(s) assigned.');
        }
        knownJobs.current = ids;
        setJobs(data.jobs);
        setTechnician(data.technician);
        setLoadError({ retry, message: '' });
      } catch (e) {
        if (e.name !== 'AbortError' && !controller.signal.aborted)
          setLoadError({ retry, message: e.message });
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoadedRetry(retry);
      }
    }
    const visibleRefresh = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    const timer = setInterval(visibleRefresh, 30000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [retry, pageRevision]);
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
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <span role="status">{notice}</span>
            {['dashboard', 'jobs'].includes(page) && (
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => setRetry((r) => r + 1)}
              >
                Refresh jobs
              </Button>
            )}
          </div>
          {page === 'reports' ? (
            <ServiceReports onChanged={changed} />
          ) : page === 'profile' ? (
            <Profile onChanged={changed} />
          ) : loading ? (
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
