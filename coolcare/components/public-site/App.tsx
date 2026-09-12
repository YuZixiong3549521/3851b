'use client';

/** @license SPDX-License-Identifier: Apache-2.0 */

import React, { useEffect, useState } from 'react';
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { apiFetch } from './api';
import type { BookingIntent, OpenBooking, PageRoute, User } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { BookingModal } from './components/BookingModal';

function dashboardPath(user: User) {
  return user.role === 'Technician' ? '/technician/index.html' : user.role === 'Admin' ? '/admin/inventory' : '/customer';
}

function sectionId(hash: string) {
  const id = hash.replace(/^#/, '');
  return id === 'promotions' ? 'services' : id === 'about' ? 'how-it-works' : id;
}

export default function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageRoute>('home');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingPrefill, setBookingPrefill] = useState<BookingIntent>();
  const [pendingAction, setPendingAction] = useState<BookingIntent | 'bookings' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [prefilledLoginEmail, setPrefilledLoginEmail] = useState('');
  const [resumeAssistant, setResumeAssistant] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch('/api/public/session').then(async response => {
      if (!response.ok) throw new Error('Unable to load your session.');
      const data = await response.json();
      if (active) setCurrentUser(data.user ?? null);
    }).catch(() => {
      if (active) setSessionError(true);
    }).finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      // Only this named local destination is accepted, never an arbitrary redirect URL.
      if (hash.split('?')[0] === '#/login' && new URLSearchParams(hash.split('?')[1] || '').get('returnTo') === 'assistant') {
        setResumeAssistant(true);
        setLoginNotice('Sign in to continue your saved booking in CoolCare Assistant.');
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
      window.location.replace(currentUser.role === 'Customer' ? '/customer/bookings' : dashboardPath(currentUser));
    } else {
      setPendingAction('bookings');
      setLoginNotice('Please sign in to view your bookings.');
      setCurrentPage('login');
      window.location.hash = '#/login';
    }
  }, [sessionReady, sessionError, currentPage, currentUser]);

  const navigateTo = (page: PageRoute, targetHash?: string) => {
    if (page === 'bookings') {
      if (!sessionReady || sessionError) {
        setToastMessage(sessionError ? 'Unable to load your session. Reload the page to try again.' : 'Your account is still loading. Please try again shortly.');
        return;
      }
      if (currentUser) {
        window.location.assign(currentUser.role === 'Customer' ? '/customer/bookings' : dashboardPath(currentUser));
        return;
      }
      setPendingAction('bookings');
      setLoginNotice('Please sign in to view your bookings.');
      page = 'login';
    }
    setCurrentPage(page);
    window.location.hash = page === 'home' ? (targetHash ? `#${sectionId(targetHash)}` : '#/') : `#/${page}`;
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
    setCurrentUser(user);
    setSessionError(false);
    setLoginNotice(null);
    if (user.role !== 'Customer') { window.location.assign(dashboardPath(user)); return; }
    if (pendingAction && pendingAction !== 'bookings') {
      setBookingPrefill(pendingAction);
      setPendingAction(null);
      navigateTo('home');
      setBookingModalOpen(true);
      setToastMessage(`Welcome back, ${user.name}! Your service selection is ready.`);
    } else {
      window.location.assign(pendingAction === 'bookings' ? '/customer/bookings' : resumeAssistant ? '/customer?assistant=resume' : '/customer');
    }
  };

  const handleRegisterSuccess = (user: User) => {
    setPrefilledLoginEmail(user.email);
    setLoginNotice(pendingAction && pendingAction !== 'bookings'
      ? 'Account created successfully! Sign in to continue with your saved service selection.'
      : 'Account created successfully! Please sign in with your password.');
    navigateTo('login');
  };

  const handleLogout = async () => {
    try {
      const response = await apiFetch('/api/public/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      setCurrentUser(null);
      setPendingAction(null);
      setResumeAssistant(false);
      setBookingPrefill(undefined);
      setBookingModalOpen(false);
      setToastMessage('You have been signed out.');
      navigateTo('home');
    } catch { setToastMessage('Sign out failed. Please retry.'); }
  };

  return (
    <div className="ac-site min-h-screen flex flex-col bg-ac-background text-ac-on-surface font-ac-sans selection:bg-ac-primary-container selection:text-ac-on-primary-container">
      {toastMessage && <div role="status" className="fixed top-24 right-4 left-4 sm:left-auto sm:right-6 z-50 bg-ac-primary text-ac-on-primary px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium max-w-md">
        <SiteIcon className="text-ac-tertiary-fixed text-[22px] shrink-0">info</SiteIcon>
        <span className="flex-grow">{toastMessage}</span>
        <Button variant="ghost" onClick={() => setToastMessage(null)} className="text-ac-on-primary/80 hover:text-white p-1 shrink-0" aria-label="Close notification"><SiteIcon className="text-[18px]">close</SiteIcon></Button>
      </div>}
      <Header currentPage={currentPage} onNavigate={navigateTo} currentUser={currentUser} onLogout={handleLogout} onOpenBooking={handleOpenBooking} />
      {sessionError && <div role="alert" className="mx-auto my-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-xl border border-ac-outline-variant px-4 py-3 text-sm">
        <p>We could not load your account. Reload before booking or opening your dashboard.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
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
