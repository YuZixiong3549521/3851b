'use client';
import { PortalSwitcher } from '@/components/portal-switcher';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Snowflake,
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Database,
  ShieldCheck,
  LogOut,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  AppContext,
  ROOT,
  api,
  setCsrf,
  errorText,
  type User,
} from '@/lib/inventory-client';
import {
  Overview,
  PartsPage,
  PartDetails,
  PartForm,
  TransactionsPage,
  TransactionForm,
} from '@/components/inventory-views';
import { useWebTools } from '@/lib/inventory-webmcp';

export default function InventoryApp() {
  const [url, setUrl] = useState(ROOT),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [sessionError, setSessionError] = useState('');
  const [dirty, setDirtyState] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [version, setVersion] = useState(0),
    [threshold, setThreshold] = useState(15);
  const dirtyRef = useRef(false),
    routeRef = useRef(ROOT);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const notify = useCallback((text: string) => setMessage(text), []);
  const navigate = useCallback((target: string) => {
    routeRef.current = target;
    window.history.pushState({}, '', target);
    setUrl(target);
    window.scrollTo({ top: 0 });
  }, []);
  const go = useCallback(
    (target: string, force = false) => {
      if (!target.startsWith(ROOT)) return;
      if (dirtyRef.current && !force) {
        setPending(target);
        return;
      }
      if (force) setDirty(false);
      navigate(target);
    },
    [navigate, setDirty],
  );
  async function loadSession() {
    setSessionError('');
    try {
      const session = await api<{
        user: User | null;
        csrf: string;
        low_stock_threshold: number;
      }>('/session');
      setUser(session.user);
      setCsrf(session.csrf);
      setThreshold(session.low_stock_threshold);
    } catch {
      setSessionError(
        'The local server is not responding. Start CoolCare and retry.',
      );
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    const current =
      window.location.pathname === '/'
        ? ROOT
        : window.location.pathname + window.location.search;
    window.history.replaceState({}, '', current);
    routeRef.current = current;
    setUrl(current);
    void loadSession();
    const pop = () => {
      const next = window.location.pathname + window.location.search;
      if (dirtyRef.current) {
        window.history.pushState({}, '', routeRef.current);
        setPending(next);
      } else {
        routeRef.current = next;
        setUrl(next);
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const unauthorized = () => {
      setUser(null);
      setDirty(false);
      void loadSession();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('coolcare:unauthorized', unauthorized);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('coolcare:unauthorized', unauthorized);
    };
  }, [setDirty]);
  useWebTools(user, go, refresh);
  const pathname = url.split('?')[0],
    params = new URLSearchParams(url.split('?')[1] || '');
  const nav = [
    { Icon: LayoutDashboard, label: 'Overview', path: ROOT },
    { Icon: Package, label: 'Parts', path: ROOT + '/parts' },
    {
      Icon: ArrowLeftRight,
      label: 'Transactions',
      path: ROOT + '/transactions',
    },
  ];
  const active = pathname.includes('/parts')
    ? 'Parts'
    : pathname.includes('/transactions')
      ? 'Transactions'
      : 'Overview';
  const detailMatch = pathname.match(/\/parts\/(\d+)(\/edit)?$/);
  async function logout() {
    try {
      await api('/logout', 'POST', {});
      setUser(null);
      await loadSession();
    } catch (e) {
      notify(errorText(e));
    }
  }
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="brand">
          <Snowflake />
          <div>
            CoolCare<small>ADMIN CONSOLE</small>
          </div>
        </SidebarHeader>
        <SidebarContent className="side-content">
          <p className="eyebrow">INVENTORY</p>
          <SidebarMenu>
            {nav.map(({ Icon, label, path }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  size="lg"
                  isActive={active === label}
                  onClick={() => go(path)}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="side-footer">
          <Database size={18} />
          <span>
            Local MySQL<small>On this computer only</small>
          </span>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <SidebarTrigger />
          <span>
            Inventory <span className="muted">/ {active}</span>
          </span>
          <span className="local-badge">LOCAL EDITION</span><PortalSwitcher current="inventory" />
          {user && (
            <>
              <span className="user-name">{user.full_name}</span>
              <Button
                variant="ghost"
                size="icon"
                disabled={dirty}
                title={
                  dirty
                    ? 'Save or cancel your changes before signing out'
                    : 'Sign out'
                }
                aria-label="Sign out"
                onClick={logout}
              >
                <LogOut />
              </Button>
            </>
          )}
        </header>
        <div className="page-content">
          {message && (
            <div className="feedback" role="status">
              <ShieldCheck size={18} />
              <span>{message}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss message"
                onClick={() => setMessage('')}
              >
                <X />
              </Button>
            </div>
          )}
          {!ready ? (
            <p className="notice">Connecting to your local inventory…</p>
          ) : !user ? (
            <Login
              error={sessionError}
              retry={loadSession}
              onSuccess={(u, token) => {
                setUser(u);
                setCsrf(token);
                refresh();
              }}
            />
          ) : (
            <AppContext.Provider
              value={{
                user,
                url,
                go,
                setDirty,
                notify,
                version,
                threshold,
                refresh,
              }}
            >
              {pathname === ROOT ? (
                <Overview />
              ) : pathname === ROOT + '/parts' ? (
                <PartsPage params={params} />
              ) : pathname === ROOT + '/parts/new' ? (
                <PartForm key="new-part" params={params} />
              ) : detailMatch?.[2] ? (
                <PartForm
                  key={detailMatch[1]}
                  id={Number(detailMatch[1])}
                  params={params}
                />
              ) : detailMatch ? (
                <PartDetails id={Number(detailMatch[1])} params={params} />
              ) : pathname === ROOT + '/transactions' ? (
                <TransactionsPage params={params} />
              ) : pathname === ROOT + '/transactions/new' ? (
                <TransactionForm key={url} params={params} />
              ) : (
                <section className="panel">
                  <h1>Page not found</h1>
                  <Button onClick={() => go(ROOT)}>Back to Inventory</Button>
                </section>
              )}
            </AppContext.Provider>
          )}
        </div>
      </main>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes have not been saved to MySQL.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pending;
                setPending(null);
                setDirty(false);
                if (next) navigate(next);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
function Login({
  error,
  retry,
  onSuccess,
}: {
  error: string;
  retry: () => void;
  onSuccess: (u: User, token: string) => void;
}) {
  const [email, setEmail] = useState('norshida@coolcare.demo'),
    [password, setPassword] = useState(''),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const result = await api<{ user: User; csrf: string }>('/login', 'POST', {
        email,
        password,
      });
      setPassword('');
      onSuccess(result.user, result.csrf);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ADMIN / INVENTORY</p>
          <h1>Your inventory, connected.</h1>
          <p className="muted">
            Manage CoolCare parts and stock movements from one place.
          </p>
        </div>
      </div>
      <section className="panel login-panel">
        <div className="login-heading">
          <ShieldCheck />
          <div>
            <h2>Admin sign in</h2>
            <p className="muted">Use your CoolCare admin account.</p>
          </div>
        </div>
        {error ? (
          <div role="alert" className="notice error">
            {error}
            <Button onClick={retry} variant="outline">
              Retry connection
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Email
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                maxLength={255}
              />
            </label>
            <label>
              Password
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            {failure && (
              <p className="notice error" role="alert">
                {failure}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="form-hint">
              This is your webpage account, not the MySQL root password.
            </p>
          </form>
        )}
      </section>
    </>
  );
}
