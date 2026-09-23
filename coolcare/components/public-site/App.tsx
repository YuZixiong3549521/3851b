'use client';

/** @license SPDX-License-Identifier: Apache-2.0 */

import React, { useEffect, useState } from 'react';
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { getLoginHref, getPostLoginHref } from '@/lib/portal-session.mjs';
import { usePortalSession } from '@/lib/use-portal-session';
import type { BookingIntent, OpenBooking, PageRoute, User } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { BookingModal } from './components/BookingModal';

function sectionId(hash: string) {
  const id = hash.replace(/^#/, '');
  return id === 'promotions' ? 'services' : id === 'about' ? 'how-it-works' : id;
}

export default function App() {
  const { user: currentUser, ready: sessionReady, error: sessionError, retry: retrySession, acceptLogin } = usePortalSession();
  const [currentPage, setCurrentPage] = useState<PageRoute>('home');
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingPrefill, setBookingPrefill] = useState<BookingIntent>();
  const [pendingAction, setPendingAction] = useState<BookingIntent | 'bookings' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [prefilledLoginEmail, setPrefilledLoginEmail] = useState('');
  const [loginReturnTo, setLoginReturnTo] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setBookingModalOpen(false);
      setBookingPrefill(undefined);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const route = hash.split('?')[0];
      if (route === '#/login' || route === '#/register') {
        const returnTo = new URLSearchParams(hash.split('?')[1] || '').get('returnTo');
        setLoginReturnTo(returnTo);
        if (returnTo === 'assistant') {
          setLoginNotice(notice => notice || 'Sign in to continue your saved booking in CoolCare Assistant.');
        }
      } else {
        setLoginReturnTo(null);
      }
      setCurrentPage(hash.startsWith('#/login') || hash === '#login' ? 'login'
        : hash.startsWith('#/register') || hash === '#register' ? 'register'
        : hash.startsWith('#/bookings') || hash === '#bookings' ? 'bookings' : 'home');
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (currentPage !== 'home') return;
    const scrollToSection = () => {
      const hash = window.location.hash;
      if (hash && !hash.startsWith('#/')) {
        document.getElementById(sectionId(hash))?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    const timer = window.setTimeout(scrollToSection, 80);
    window.addEventListener('hashchange', scrollToSection);
    return () => { window.clearTimeout(timer); window.removeEventListener('hashchange', scrollToSection); };
  }, [currentPage]);

  // Preserve old homepage bookmarks while using the shared customer booking pages.
  useEffect(() => {
    if (!sessionReady || sessionError || currentPage !== 'bookings') return;
    if (currentUser) {
      window.location.replace(getPostLoginHref(currentUser.role, 'bookings'));
    } else {
      setPendingAction('bookings');
      setLoginNotice('Please sign in to view your bookings.');
      setCurrentPage('login');
      window.location.hash = getLoginHref('bookings').slice(1);
    }
  }, [sessionReady, sessionError, currentPage, currentUser]);

  const navigateTo = (page: PageRoute, targetHash?: string) => {
    const returnTo = page === 'bookings' ? 'bookings' : loginReturnTo;
    if (page === 'bookings') {
      if (!sessionReady || sessionError) {
        setToastMessage(sessionError ? 'Unable to load your session. Reload the page to try again.' : 'Your account is still loading. Please try again shortly.');
        return;
      }
      if (currentUser) {
        window.location.assign(getPostLoginHref(currentUser.role, 'bookings'));
        return;
      }
      setPendingAction('bookings');
      setLoginReturnTo('bookings');
      setLoginNotice('Please sign in to view your bookings.');
      page = 'login';
    }
    setCurrentPage(page);
    window.location.hash = page === 'home' ? (targetHash ? `#${sectionId(targetHash)}` : '#/')
      : page === 'login' ? getLoginHref(returnTo || undefined).slice(1)
      : `#/${page}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    if (page === 'home' && targetHash) {
      window.setTimeout(() => document.getElementById(sectionId(targetHash))?.scrollIntoView({ behavior: 'smooth' }), 80);
    } else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenBooking: OpenBooking = (serviceName, options) => {
    if (!sessionReady || sessionError) {
      setToastMessage(sessionError ? 'Unable to load your session. Reload the page to try again.' : 'Your account is still loading. Please try again shortly.');
      return;
    }
    const intent: BookingIntent = { serviceName, ...options, key: crypto.randomUUID() };
    if (!currentUser) {
      setPendingAction(intent);
      setLoginNotice('Sign in or create an account to continue. We will keep your service selection ready.');
      navigateTo('login');
      return;
    }
    if (currentUser.role !== 'Customer') {
      setToastMessage('Please sign in with a customer account to book a service.');
      return;
    }
    // A generic Book service button reopens the current draft without overwriting it.
    setBookingPrefill(serviceName || options ? intent : undefined);
    setBookingModalOpen(true);
  };

  const handleLoginSuccess = (user: User) => {
    const id = Number(user.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !user.role || !['Customer', 'Technician', 'Admin'].includes(user.role)) {
      retrySession();
      setToastMessage('Unable to verify your account. Please try again.');
      return;
    }
    acceptLogin({ ...user, id, role: user.role });
    setLoginNotice(null);
    if (user.role !== 'Customer') { window.location.assign(getPostLoginHref(user.role, loginReturnTo)); return; }
    if (pendingAction && pendingAction !== 'bookings') {
      setBookingPrefill(pendingAction);
      setPendingAction(null);
      navigateTo('home');
      setBookingModalOpen(true);
      setToastMessage(`Welcome back, ${user.name}! Your service selection is ready.`);
    } else {
      window.location.assign(getPostLoginHref(user.role, pendingAction === 'bookings' ? 'bookings' : loginReturnTo));
    }
  };

  const handleRegisterSuccess = (user: User) => {
    setPrefilledLoginEmail(user.email);
    setLoginNotice(pendingAction && pendingAction !== 'bookings'
      ? 'Account created successfully! Sign in to continue with your saved service selection.'
      : 'Account created successfully! Please sign in with your password.');
    navigateTo('login');
  };

  useEffect(() => {
    if (!sessionReady || sessionError || currentPage !== 'login' || !currentUser) return;
    // An existing session also honours a safe deep link, including a session opened in another tab.
    if (currentUser.role === 'Customer' && pendingAction && pendingAction !== 'bookings') {
      setBookingPrefill(pendingAction);
      setPendingAction(null);
      setLoginNotice(null);
      setCurrentPage('home');
      window.location.hash = '#/';
      setBookingModalOpen(true);
      return;
    }
    window.location.replace(getPostLoginHref(currentUser.role, pendingAction === 'bookings' ? 'bookings' : loginReturnTo));
  }, [sessionReady, sessionError, currentPage, currentUser, pendingAction, loginReturnTo]);

  return (
    <div className="ac-site min-h-screen flex flex-col bg-ac-background text-ac-on-surface font-ac-sans selection:bg-ac-primary-container selection:text-ac-on-primary-container">
      {toastMessage && <div role="status" className="fixed top-24 right-4 left-4 sm:left-auto sm:right-6 z-50 bg-ac-primary text-ac-on-primary px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium max-w-md">
        <SiteIcon className="text-ac-tertiary-fixed text-[22px] shrink-0">info</SiteIcon>
        <span className="flex-grow">{toastMessage}</span>
        <Button variant="ghost" onClick={() => setToastMessage(null)} className="text-ac-on-primary/80 hover:text-white p-1 shrink-0" aria-label="Close notification"><SiteIcon className="text-[18px]">close</SiteIcon></Button>
      </div>}
      <Header currentPage={currentPage} onNavigate={navigateTo} currentUser={currentUser} onOpenBooking={handleOpenBooking} />
      {sessionError && <div role="alert" className="mx-auto my-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-xl border border-ac-outline-variant px-4 py-3 text-sm">
        <p>We could not load your account. Try again before booking or opening your dashboard.</p>
        <Button variant="outline" onClick={retrySession}>Try again</Button>
      </div>}
      <div className="flex-grow flex flex-col">
        {currentPage === 'home' && <HomePage currentUser={currentUser} onNavigate={navigateTo} onOpenBooking={handleOpenBooking} />}
        {currentPage === 'login' && <LoginPage onNavigate={navigateTo} onLoginSuccess={handleLoginSuccess} initialNotice={loginNotice} initialEmail={prefilledLoginEmail} onClearNotice={() => setLoginNotice(null)} />}
        {currentPage === 'register' && <RegisterPage onNavigate={navigateTo} onRegisterSuccess={handleRegisterSuccess} />}
        {currentPage === 'bookings' && <p role="status" className="mx-auto px-6 py-20">{sessionError ? 'Bookings are unavailable until your account can be loaded.' : 'Opening your bookings…'}</p>}
      </div>
      <Footer currentUser={currentUser} onNavigate={navigateTo} onOpenBooking={handleOpenBooking} />
      <BookingModal isOpen={bookingModalOpen} onClose={() => setBookingModalOpen(false)} prefill={bookingPrefill} currentUser={currentUser} onNavigate={navigateTo} onBookingConfirmed={setToastMessage} />
    </div>
  );
}
