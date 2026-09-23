'use client';

import { useRef, useState } from 'react';
import { ChevronDown, ClipboardCheck, Home, LayoutDashboard, LogOut, MapPin, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getPortalHome, signOutSession } from '@/lib/portal-session.mjs';

export function PortalAccountMenu({ user, disabled = false, onNavigate, beforeSignOut }: {
  user: { name: string; role?: string };
  disabled?: boolean;
  onNavigate?: (href: string) => void;
  beforeSignOut?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const initials = user.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const links = [
    { label: 'Home', href: '/', Icon: Home },
    { label: user.role === 'Admin' ? 'Admin portal' : user.role === 'Technician' ? 'Technician portal' : 'Customer portal', href: getPortalHome(user.role), Icon: LayoutDashboard },
    ...(user.role === 'Customer' ? [
      { label: 'My Bookings', href: '/customer/bookings', Icon: ClipboardCheck },
      { label: 'My profile', href: '/customer/account', Icon: UserRound },
      { label: 'Saved addresses', href: '/customer/addresses', Icon: MapPin },
    ] : user.role === 'Technician' ? [{ label: 'My profile', href: '/technician/index.html#profile', Icon: UserRound }] : []),
  ];
  async function signOut() {
    if (pending.current) return;
    if (beforeSignOut && !beforeSignOut()) {
      setError('Save or cancel your changes before signing out.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try { await signOutSession(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign out. Please retry.');
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <DropdownMenu open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) setError(''); } }}>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" disabled={disabled || busy} aria-label="Open account menu" className="portal-account-trigger h-auto min-h-11 shrink-0 gap-2 rounded-xl px-2 py-1.5 hover:bg-primary/5 aria-expanded:bg-primary/5" />}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{initials || <UserRound className="size-4" />}</span>
        <span className="hidden min-w-0 text-left sm:block"><span className="block max-w-36 truncate text-sm font-semibold text-foreground">{user.name}</span><span className="block text-xs text-muted-foreground">{user.role}</span></span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="portal-account-menu w-64 max-w-[calc(100vw-24px)] p-2">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2"><span className="block truncate font-semibold text-foreground">{user.name}</span><span className="block pt-1">{user.role} account</span></DropdownMenuLabel>
          {links.map(({ label, href, Icon }) => <DropdownMenuItem key={label} disabled={busy} className="min-h-11 gap-3 px-2 py-3" render={<a href={href} onClick={event => { if (onNavigate) { event.preventDefault(); onNavigate(href); } }} />}><Icon aria-hidden="true" />{label}</DropdownMenuItem>)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem closeOnClick={false} disabled={busy} variant="destructive" onClick={() => void signOut()} className="min-h-11 gap-3 px-2 py-3"><LogOut aria-hidden="true" />{busy ? 'Signing out…' : 'Sign out'}</DropdownMenuItem>
        {error && <p role="alert" className="px-2 py-3 text-sm text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
