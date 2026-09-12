'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { CalendarDays, ChevronDown, ClipboardCheck, Gauge, History, Home, LogOut, MapPin, Snowflake, Sparkles, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageLoading } from '@/components/page-state';
import type { ReactNode } from 'react';

const navItems = [
  { label: 'Dashboard', shortLabel: 'Dashboard', href: '/customer', icon: Gauge },
  { label: 'Book Service', shortLabel: 'Book', href: '/customer/book', icon: CalendarDays },
  { label: 'My Bookings', shortLabel: 'Bookings', href: '/customer/bookings', icon: ClipboardCheck },
  { label: 'Booking History', shortLabel: 'History', href: '/customer/history', icon: History },
];

export function CoolCareShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [name, setName] = useState('Customer');
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const sessionUserId = useRef<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const controller = new AbortController();
    const loginPath = () => new URLSearchParams(window.location.search).get('assistant') === 'resume'
      ? '/#/login?returnTo=assistant' : '/#/login';
    async function refreshSession() {
      try {
        const response = await fetch('/api/public/session', { signal: controller.signal, cache: 'no-store' });
        if ([401, 403].includes(response.status)) { window.location.assign(loginPath()); return; }
        if (!response.ok) throw new Error('Unable to check your session. Please retry.');
        const result = await response.json() as { user?: { id: number; name: string; role: string } | null };
        if (result.user?.role !== 'Customer') { window.location.assign(loginPath()); return; }
        if (controller.signal.aborted) return;
        if (sessionUserId.current !== null && sessionUserId.current !== result.user.id) {
          // Another tab signed in as a different customer. Clear every draft
          // and cached page before showing or editing the new account's data.
          setReady(false);
          window.location.reload();
          return;
        }
        sessionUserId.current = result.user.id;
        setName(result.user.name || 'Customer');
        setReady(true);
        setSessionError('');
      } catch (reason) {
        if (!controller.signal.aborted) setSessionError(reason instanceof Error ? reason.message : 'Unable to check your session. Please retry.');
      }
    }
    const refresh = () => { setNow(new Date()); void refreshSession(); };
    void refreshSession();
    window.addEventListener('focus', refresh);
    window.addEventListener('coolcare:profile-updated', refresh);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('coolcare:profile-updated', refresh);
      window.clearInterval(timer);
    };
  }, [sessionAttempt]);

  async function signOut() {
    setSigningOut(true);
    setSessionError('');
    try {
      const sessionResponse = await fetch('/api/session', { cache: 'no-store' });
      if (!sessionResponse.ok) throw new Error('Unable to sign out. Please retry.');
      const session = await sessionResponse.json() as { csrf: string };
      const response = await fetch('/api/public/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrf } });
      if (!response.ok) throw new Error('Unable to sign out. Please retry.');
      window.location.assign('/#/login');
    } catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : 'Unable to sign out. Please retry.');
      setSigningOut(false);
    }
  }
  const today = new Intl.DateTimeFormat('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(now);

  const isActive = (href: string) => pathname === href || (href !== '/customer' && pathname.startsWith(`${href}/`));

  return (
    <div className="customer-shell min-h-screen bg-background text-foreground" lang="en-SG">
      <aside className="customer-shell-navigation fixed inset-y-0 left-0 z-30 hidden w-[280px] border-r border-border bg-white px-5 py-7 lg:flex lg:flex-col">
        <Brand />
        <nav aria-label="Primary navigation" className="space-y-1.5">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link key={label} href={href} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl bg-[linear-gradient(145deg,#eff5ff,#ecfffb)] p-5">
          <div className="mb-3 grid size-9 place-items-center rounded-xl bg-white text-secondary shadow-sm"><Sparkles className="size-5" aria-hidden="true" /></div>
          <p className="font-semibold">Your Service Care</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">View your bookings and maintenance history.</p>
        </div>
      </aside>

      <main className="customer-shell-main pb-24 lg:ml-[280px] lg:pb-10">
        <header className="customer-shell-navigation sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-white/90 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="lg:hidden"><Brand compact /></div>
          <p className="hidden text-sm font-medium text-muted-foreground lg:block">{today}</p>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted-foreground">Customer</p></div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" className="h-auto gap-1 rounded-full p-1.5" aria-label="Open account menu" disabled={!ready || signingOut} />}>
                <span className="grid size-10 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">{name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()}</span>
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-2">
                <DropdownMenuGroup><DropdownMenuLabel className="truncate px-2 py-2">{name}</DropdownMenuLabel>
                  <DropdownMenuItem render={<Link href="/customer/account" />} className="gap-3 px-2 py-3"><UserRound />My profile</DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/customer/addresses" />} className="gap-3 px-2 py-3"><MapPin />Saved addresses</DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/" />} className="gap-3 px-2 py-3"><Home />Home</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()} disabled={signingOut} className="gap-3 px-2 py-3"><LogOut />{signingOut ? 'Signing out…' : 'Sign out'}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {sessionError && <div role="alert" className="customer-shell-navigation mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-white p-4 text-sm"><span>{sessionError}</span><Button variant="outline" size="sm" onClick={() => setSessionAttempt(value => value + 1)}>Retry session check</Button></div>}
        {ready ? children : !sessionError ? <div className="mx-auto max-w-5xl p-5 sm:p-8"><PageLoading /></div> : null}
      </main>

      <nav aria-label="Mobile navigation" className="customer-shell-navigation fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
        {navItems.map(({ shortLabel, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
              <Icon className="size-5" aria-hidden="true" />
              <span>{shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/customer" className={compact ? 'flex items-center gap-2.5' : 'mb-9 flex items-center gap-3 px-2'}>
      <span className={`grid place-items-center bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(0,80,203,0.18)] ${compact ? 'size-9 rounded-xl' : 'size-11 rounded-2xl'}`}>
        <Snowflake className={compact ? 'size-5' : 'size-6'} aria-hidden="true" />
      </span>
      <span>
        <span className="block font-bold tracking-tight">CoolCare</span>
        {!compact && <span className="block text-xs font-medium text-muted-foreground">Customer portal</span>}
      </span>
    </Link>
  );
}
