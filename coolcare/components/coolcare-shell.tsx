'use client';

import Link from 'next/link';
import {BookingNotifications} from '@/components/booking-notifications';
import { useState, useEffect, useId, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { CalendarDays, ClipboardCheck, Gauge, History, MessageCircle, Snowflake, Sparkles } from 'lucide-react';
import { CustomerAssistant } from '@/components/customer-assistant';
import { Button } from '@/components/ui/button';
import { PortalAccountMenu } from '@/components/portal-account-menu';
import { usePortalSession } from '@/lib/use-portal-session';
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
  const { user, ready: sessionReady, error: sessionError, retry } = usePortalSession('Customer');
  const ready = sessionReady && Boolean(user);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantDialogId = useId();
  const desktopAssistantTrigger = useRef<HTMLButtonElement>(null);
  const mobileAssistantTrigger = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => setNow(new Date());
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
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
          <Button ref={desktopAssistantTrigger} type="button" variant="ghost" disabled={!ready} aria-haspopup="dialog" aria-expanded={assistantOpen} aria-controls={assistantOpen ? assistantDialogId : undefined} onClick={() => setAssistantOpen(true)} className="h-auto min-h-12 w-full justify-start gap-3 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
            <MessageCircle className="size-5" aria-hidden="true" />
            CoolCare Assistant
          </Button>
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
          {user && <PortalAccountMenu user={user} disabled={!ready} />}
        </header>
        {sessionError && <div role="alert" className="customer-shell-navigation mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-white p-4 text-sm"><span>{sessionError}</span><Button variant="outline" size="sm" onClick={retry}>Retry session check</Button></div>}
        {ready ? children : !sessionError ? <div className="mx-auto max-w-5xl p-5 sm:p-8"><PageLoading /></div> : null}
      </main>

      <nav aria-label="Mobile navigation" className="customer-shell-navigation fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
        {navItems.map(({ shortLabel, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
              <Icon className="size-5" aria-hidden="true" />
              <span>{shortLabel}</span>
            </Link>
          );
        })}
        <Button ref={mobileAssistantTrigger} type="button" variant="ghost" disabled={!ready} aria-haspopup="dialog" aria-expanded={assistantOpen} aria-controls={assistantOpen ? assistantDialogId : undefined} onClick={() => setAssistantOpen(true)} className="h-auto min-h-14 flex-col gap-1 rounded-xl px-0 py-0 text-[11px] font-semibold text-muted-foreground">
          <MessageCircle className="size-5" aria-hidden="true" />
          <span>Assistant</span>
        </Button>
      </nav>
      {ready && <BookingNotifications key={user?.id} enabled={!assistantOpen} />}
      {ready && <CustomerAssistant open={assistantOpen} onOpenChange={setAssistantOpen} dialogId={assistantDialogId} returnFocus={() => desktopAssistantTrigger.current?.getClientRects().length ? desktopAssistantTrigger.current : mobileAssistantTrigger.current} onBookingCreated={() => window.dispatchEvent(new Event('coolcare:bookings-updated'))} />}
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
