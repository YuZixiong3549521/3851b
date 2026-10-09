'use client';
import { PortalAccountMenu } from '@/components/portal-account-menu';
import { usePortalSession, type PortalUser } from '@/lib/use-portal-session';
import { redirectToSessionPortal } from '@/lib/portal-session.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Snowflake,
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Database,
  ShieldCheck,
  ClipboardCheck,
  Send,
  Users,
  UserCog,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  ADMIN_ROOT,
  ROOT,
  api,
  setCsrf,
  type AdminActionSummary,
  type User,
} from '@/lib/inventory-client';
import {
  DispatchCalendarPage,
  OrdersPage,
  OrderDetails,
  StaffPage,
} from '@/components/admin-operations-views';
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
  const session = usePortalSession('Admin');
  if (!session.ready || !session.user)
    return (
      <main className="mx-auto max-w-xl p-8">
        {session.error ? (
          <div role="alert" className="space-y-4">
            <p>{session.error}</p>
            <Button variant="outline" onClick={session.retry}>
              Retry session check
            </Button>
          </div>
        ) : (
          <p role="status">Checking your session…</p>
        )}
      </main>
    );
  return <AdminPortal key={session.user.id} sessionUser={session.user} />;
}

function AdminPortal({ sessionUser }: { sessionUser: PortalUser }) {
  const [url, setUrl] = useState(ROOT),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [sessionError, setSessionError] = useState('');
  const [actionSummary, setActionSummary] = useState<AdminActionSummary>({
    submitted: 0,
    expiringSoon: 0,
    returnVisits: 0,
    awaitingDispatch: 0,
    ordersRequiringAction: 0,
    totalRequiringAction: 0,
  });
  const [pending, setPending] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [version, setVersion] = useState(0),
    [threshold, setThreshold] = useState(15);
  const dirtyRef = useRef(false),
    routeRef = useRef(ROOT);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
  }, []);
  const loadActionSummary = useCallback(async () => {
    try {
      setActionSummary(await api<AdminActionSummary>('/admin/action-summary'));
    } catch {
      // Page-level requests still surface connection and authorization errors.
    }
  }, []);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    void loadActionSummary();
  }, [loadActionSummary]);
  const notify = useCallback((text: string) => setMessage(text), []);
  const navigate = useCallback((target: string) => {
    if (!target.startsWith('/admin/')) {
      window.location.assign(target);
      return;
    }
    routeRef.current = target;
    window.history.pushState({}, '', target);
    setUrl(target);
    window.scrollTo({ top: 0 });
  }, []);
  const go = useCallback(
    (target: string, force = false) => {
      if (!target.startsWith(ADMIN_ROOT)) return;
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
      if (!session.user) {
        await redirectToSessionPortal('Admin');
        throw new Error('Please sign in again.');
      }
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
  useEffect(() => {
    if (!user) return;
    const update = () => void loadActionSummary();
    update();
    const timer = window.setInterval(update, 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') update();
    };
    window.addEventListener('focus', update);
    window.addEventListener('coolcare:admin-actions-updated', update);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('coolcare:admin-actions-updated', update);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [user, loadActionSummary]);
  useWebTools(user, go, refresh);
  const pathname = url.split('?')[0],
    params = new URLSearchParams(url.split('?')[1] || '');
  const operationsNav = [
    {
      Icon: ClipboardCheck,
      label: 'Orders',
      path: '/admin/orders',
      count: actionSummary.ordersRequiringAction,
    },
    {
      Icon: Send,
      label: 'Dispatch',
      path: '/admin/dispatch',
      count: actionSummary.awaitingDispatch,
    },
    { Icon: Users, label: 'Technicians', path: '/admin/technicians', count: 0 },
    ...(user?.access_level === 'Owner'
      ? [{ Icon: UserCog, label: 'Admins', path: '/admin/admins', count: 0 }]
      : []),
  ];
  const inventoryNav = [
    { Icon: LayoutDashboard, label: 'Inventory', path: ROOT },
    { Icon: Package, label: 'Parts', path: ROOT + '/parts' },
    {
      Icon: ArrowLeftRight,
      label: 'Transactions',
      path: ROOT + '/transactions',
    },
  ];
  const active = pathname.startsWith('/admin/orders')
    ? 'Orders'
    : pathname.startsWith('/admin/dispatch')
      ? 'Dispatch'
      : pathname.startsWith('/admin/technicians')
        ? 'Technicians'
        : pathname.startsWith('/admin/admins')
          ? 'Admins'
          : pathname.includes('/parts')
            ? 'Parts'
            : pathname.includes('/transactions')
              ? 'Transactions'
              : 'Inventory';
  const detailMatch = pathname.match(/\/parts\/(\d+)(\/edit)?$/);
  const orderMatch = pathname.match(/^\/admin\/orders\/(\d+)$/);
  const accountNavigate = (target: string) => {
    if (dirtyRef.current) {
      setPending(target);
      return;
    }
    navigate(target);
  };
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
          <p className="eyebrow">OPERATIONS</p>
          <SidebarMenu>
            {operationsNav.map(({ Icon, label, path, count }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  size="lg"
                  isActive={active === label}
                  onClick={() => go(path)}
                >
                  <Icon />
                  <span>{label}</span>
                  {Boolean(count) && (
                    <span
                      className="ml-auto min-w-6 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-xs font-semibold text-white"
                      aria-label={`${count} ${label.toLowerCase()} item${count === 1 ? '' : 's'} require action`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <p className="eyebrow mt-7">INVENTORY</p>
          <SidebarMenu>
            {inventoryNav.map(({ Icon, label, path }) => (
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
            Admin Console <span className="muted">/ {active}</span>
          </span>
          <div className="ml-auto shrink-0">
            <PortalAccountMenu
              user={sessionUser}
              onNavigate={accountNavigate}
              beforeSignOut={() => !dirtyRef.current}
            />
          </div>
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
            <div role="alert" className="space-y-4">
              <p>
                {sessionError || 'Unable to load your account. Please retry.'}
              </p>
              <Button variant="outline" onClick={() => void loadSession()}>
                Retry session check
              </Button>
            </div>
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
                actionSummary,
                reloadActionSummary: loadActionSummary,
              }}
            >
              {pathname === '/admin/orders' ? (
                <OrdersPage mode="review" params={params} />
              ) : pathname === '/admin/dispatch' ? (
                <DispatchCalendarPage params={params} />
              ) : orderMatch ? (
                <OrderDetails bookingId={Number(orderMatch[1])} />
              ) : pathname === '/admin/technicians' ? (
                <StaffPage role="Technician" />
              ) : pathname === '/admin/admins' &&
                user.access_level === 'Owner' ? (
                <StaffPage role="Admin" />
              ) : pathname === ROOT ? (
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
                  <Button onClick={() => go('/admin/orders')}>
                    Back to Orders
                  </Button>
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
