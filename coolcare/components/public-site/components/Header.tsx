import React, { useEffect, useRef, useState } from 'react';
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { OpenBooking, PageRoute, User } from '../types';

interface HeaderProps {
  currentPage: PageRoute;
  onNavigate: (page: PageRoute, hash?: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  onOpenBooking: OpenBooking;
}

const navigation = [
  { label: 'Home', hash: 'home' },
  { label: 'Services & pricing', hash: 'services' },
  { label: 'How it works', hash: 'how-it-works' },
  { label: 'FAQ', hash: 'faq' },
  { label: 'Contact', hash: 'contact' },
];

export const Header: React.FC<HeaderProps> = ({ currentPage, onNavigate, currentUser, onLogout, onOpenBooking }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const isCustomer = !currentUser?.role || currentUser.role === 'Customer';
  const dashboard = currentUser?.role === 'Technician' ? '/technician/index.html'
    : currentUser?.role === 'Admin' ? '/admin/inventory' : '/customer';

  useEffect(() => setMobileMenuOpen(false), [currentPage, currentUser?.id]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    const desktop = window.matchMedia('(min-width: 1280px)');
    const onResize = () => { if (desktop.matches) setMobileMenuOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onResize);
    };
  }, [mobileMenuOpen]);

  const navigate = (page: PageRoute, hash?: string) => {
    setMobileMenuOpen(false);
    onNavigate(page, hash);
  };
  const book = () => { setMobileMenuOpen(false); onOpenBooking(); };
  const signOut = () => { setMobileMenuOpen(false); onLogout(); };

  return (
    <header className="sticky top-0 z-50 bg-ac-surface/95 backdrop-blur-md shadow-sm">
      <div className="flex h-20 items-center justify-between gap-4 px-gutter max-w-container-max mx-auto">
        <Button variant="ghost" onClick={() => navigate('home', 'home')}
          aria-label="CoolCare home" className="h-11 gap-2 px-0 text-headline-sm font-bold text-ac-primary">
          <SiteIcon className="text-[30px]">ac_unit</SiteIcon>CoolCare
        </Button>

        <nav aria-label="Main navigation" className="hidden xl:flex items-center gap-1">
          {navigation.map(({ label, hash }) => (
            <Button key={hash} variant="ghost" onClick={() => navigate('home', hash)}
              aria-current={currentPage === 'home' && hash === 'home' ? 'page' : undefined}
              className="h-11 px-3 text-label-md text-ac-on-surface-variant hover:text-ac-primary">
              {label}
            </Button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden xl:block">
            {currentUser ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" aria-label="Open account menu"
                  className="h-11 gap-2 px-2 text-ac-primary" />}>
                  <span className="flex size-8 items-center justify-center rounded-full bg-ac-primary-fixed text-xs font-bold" aria-hidden="true">
                    {currentUser.name.trim().slice(0, 2).toUpperCase()}
                  </span>
                  <span className="max-w-24 truncate">{currentUser.name.split(' ')[0]}</span>
                  <SiteIcon>expand_more</SiteIcon>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate px-3 py-2">{currentUser.name}</DropdownMenuLabel>
                    <DropdownMenuItem render={<a href={dashboard} />} className="min-h-11 px-3 gap-2">
                      <SiteIcon>home</SiteIcon>Dashboard
                    </DropdownMenuItem>
                    {isCustomer && <DropdownMenuItem onClick={() => navigate('bookings')} className="min-h-11 px-3 gap-2">
                      <SiteIcon>calendar_month</SiteIcon>My Bookings
                    </DropdownMenuItem>}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="min-h-11 px-3" variant="destructive">Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : <Button variant="ghost" onClick={() => navigate('login')} className="h-11 px-3 text-ac-primary">Login</Button>}
          </div>

          {isCustomer ? <Button onClick={book} className="hidden sm:inline-flex h-11 rounded-full bg-ac-primary px-5 text-ac-on-primary hover:bg-ac-primary/90">
            Book a service
          </Button> : <a href={dashboard} className="hidden sm:inline-flex h-11 items-center rounded-full bg-ac-primary px-5 text-sm font-semibold text-ac-on-primary">Dashboard</a>}

          <Button ref={menuButton} variant="ghost" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="xl:hidden size-11 p-2 text-ac-primary">
            <SiteIcon className="text-[28px]">{mobileMenuOpen ? 'close' : 'menu'}</SiteIcon>
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div id="mobile-navigation" className="xl:hidden max-h-[calc(100dvh-5rem)] overflow-y-auto border-t border-ac-outline-variant/40 bg-ac-surface px-gutter py-4 shadow-lg">
          <nav aria-label="Mobile navigation" className="grid grid-cols-2 gap-1">
            {navigation.map(({ label, hash }) => <Button key={hash} variant="ghost" onClick={() => navigate('home', hash)}
              className="h-11 justify-start px-3 text-ac-on-surface">{label}</Button>)}
          </nav>
          <div className="mt-3 border-t border-ac-outline-variant/40 pt-3">
            {currentUser ? (
              <>
                <p className="mb-2 truncate px-3 text-sm text-ac-on-surface-variant">Signed in as <span className="font-semibold text-ac-primary">{currentUser.name}</span></p>
                <div className="grid grid-cols-2 gap-1">
                  <a href={dashboard} onClick={() => setMobileMenuOpen(false)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ac-primary hover:bg-ac-primary-fixed/30">Dashboard</a>
                  {isCustomer && <Button variant="ghost" onClick={() => navigate('bookings')} className="h-11 justify-start px-3 text-ac-primary">My Bookings</Button>}
                  <Button variant="ghost" onClick={signOut} className="h-11 justify-start px-3 text-ac-error">Sign out</Button>
                </div>
              </>
            ) : <div className="grid grid-cols-2 gap-1">
              <Button variant="ghost" onClick={() => navigate('login')} className="h-11 justify-start px-3 text-ac-primary">Login</Button>
              <Button variant="ghost" onClick={() => navigate('register')} className="h-11 justify-start px-3 text-ac-primary">Create account</Button>
            </div>}
            {isCustomer && <Button onClick={book} className="mt-3 h-12 w-full rounded-full bg-ac-primary text-ac-on-primary hover:bg-ac-primary/90">Book a service</Button>}
          </div>
        </div>
      )}
    </header>
  );
};
