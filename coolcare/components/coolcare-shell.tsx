'use client';

import Link from 'next/link';
import {useState,useEffect} from 'react';
import { PortalSwitcher } from '@/components/portal-switcher';
import { usePathname } from 'next/navigation';
import { CalendarDays, ClipboardCheck, Gauge, History, Snowflake, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

const navItems = [
  { label: 'Dashboard', shortLabel: 'Dashboard', href: '/customer', icon: Gauge },
  { label: 'Book Service', shortLabel: 'Book', href: '/customer/book', icon: CalendarDays },
  { label: 'My Bookings', shortLabel: 'Bookings', href: '/customer/bookings', icon: ClipboardCheck },
  { label: 'Maintenance History', shortLabel: 'History', href: '/customer/history', icon: History },
];

export function CoolCareShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [name,setName]=useState('Customer');
  useEffect(()=>{fetch('/api/public/session').then(r=>r.json()).then((d:any)=>{if(d.user?.role!=='Customer'){window.location.assign('/#/login');return;}setName(d.user.name);});},[]);
  const today = new Intl.DateTimeFormat('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const isActive = (href: string) => href === '/customer' ? pathname === '/customer' : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[280px] border-r border-border bg-white px-5 py-7 lg:flex lg:flex-col">
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

      <main className="pb-24 lg:ml-[280px] lg:pb-10">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-white/90 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="lg:hidden"><Brand compact /></div>
          <p className="hidden text-sm font-medium text-muted-foreground lg:block">{today}</p>
          <div className="flex items-center gap-3"><PortalSwitcher current="customer" />
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted-foreground">Customer</p></div>
            <div className="grid size-10 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">{name.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}</div>
          </div>
        </header>
        {children}
      </main>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
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
