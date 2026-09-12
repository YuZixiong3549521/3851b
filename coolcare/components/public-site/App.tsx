'use client';
import { SiteIcon } from '@/components/ui/site-icon';

import { Button } from '@/components/ui/button';
import { apiFetch } from './api';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { PageRoute, User } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { BookingModal } from './components/BookingModal';
import MyBookingsPage from './components/MyBookingsPage';

export default function App() {
  const [sessionReady,setSessionReady]=useState(false);
  const [bookingVersion,setBookingVersion]=useState(0);
  const [currentPage, setCurrentPage] = useState<PageRoute>('home');
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  const [bookingServicePrefill, setBookingServicePrefill] =
    useState<string | undefined>(undefined);

  const [pendingBookingService, setPendingBookingService] =
    useState<string | null>(null);

  const [toastMessage, setToastMessage] =
    useState<string | null>(null);

  const [loginNotice, setLoginNotice] =
    useState<string | null>(null);

  const [prefilledLoginEmail, setPrefilledLoginEmail] =
    useState<string>('');

  // =========================================
  // INITIALIZE USERS AND EXISTING SESSION
  // =========================================

  useEffect(() => { apiFetch('/api/public/session').then(r=>r.json()).then(data=>setCurrentUser(data.user)).catch(()=>setToastMessage('Unable to connect to the server. Please reload.')).finally(()=>setSessionReady(true)); }, []);

  // =========================================
  // HASH ROUTING
  // =========================================

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;

      if (
        hash.startsWith('#/login') ||
        hash === '#login'
      ) {
        setCurrentPage('login');
      } else if (
        hash.startsWith('#/register') ||
        hash === '#register'
      ) {
        setCurrentPage('register');
      } else if (
        hash.startsWith('#/bookings') ||
        hash === '#bookings'
      ) {
        setCurrentPage('bookings');
      } else {
        setCurrentPage('home');

        if (
          hash &&
          hash !== '#' &&
          hash !== '#/' &&
          !hash.startsWith('#/')
        ) {
          const sectionId = hash.replace('#', '');
          const element = document.getElementById(sectionId);

          if (element) {
            setTimeout(() => {
              element.scrollIntoView({
                behavior: 'smooth',
              });
            }, 100);
          }
        }
      }
    };

    handleHashChange();

    window.addEventListener(
      'hashchange',
      handleHashChange
    );

    return () => {
      window.removeEventListener(
        'hashchange',
        handleHashChange
      );
    };
  }, []);

  // =========================================
  // NAVIGATION
  // =========================================

  useEffect(()=>{if(sessionReady && currentPage==='bookings' && !currentUser){setLoginNotice('Please sign in to view your bookings.');setCurrentPage('login');window.location.hash='#/login';}},[sessionReady,currentPage,currentUser]);

  const navigateTo = (
    page: PageRoute,
    targetHash?: string
  ) => {
    if (page === 'login') {
      setCurrentPage('login');
      window.location.hash = '#/login';

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });

      return;
    }

    if (page === 'register') {
      setCurrentPage('register');
      window.location.hash = '#/register';

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });

      return;
    }

    if (page === 'bookings') {
      if(currentUser?.role==='Technician'){window.location.assign('/technician/index.html');return;}
      if(currentUser?.role==='Admin'){window.location.assign('/admin/inventory');return;}
      if (!currentUser) {
        setLoginNotice(
          'Please sign in to view your bookings.'
        );

        setCurrentPage('login');
        window.location.hash = '#/login';

        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        });

        return;
      }

      setCurrentPage('bookings');
      window.location.hash = '#/bookings';

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });

      return;
    }

    // HOME
    setCurrentPage('home');

    if (targetHash) {
      window.location.hash =
        targetHash.startsWith('#')
          ? targetHash
          : `#${targetHash}`;

      setTimeout(() => {
        const element = document.getElementById(
          targetHash.replace('#', '')
        );

        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
          });
        }
      }, 50);
    } else {
      window.location.hash = '#/';

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  // =========================================
  // BOOKING AUTHENTICATION GUARD
  // =========================================

  const handleOpenBooking = (
    serviceName?: string
  ) => {
    if (!currentUser) {
      setLoginNotice(
        'Please log in or create an account before booking a service.'
      );

      setPendingBookingService(
        serviceName ||
          'Cleaning'
      );

      showToast(
        'Please log in or create an account before booking a service.'
      );

      navigateTo('login');

      return;
    }

    if(currentUser.role!=='Customer'){showToast('Please sign in with a customer account to book a service.');return;}
    setBookingServicePrefill(serviceName);
    setBookingModalOpen(true);
  };

  // =========================================
  // LOGIN SUCCESS
  // =========================================

  const handleLoginSuccess = (
    user: User
  ) => {
    if (user.role === 'Technician') { window.location.assign('/technician/index.html'); return; }
    if (user.role === 'Admin') { window.location.assign('/admin/inventory'); return; }
    setCurrentUser(user);
    setLoginNotice(null);

    showToast(
      `Welcome back, ${user.name}!`
    );

    if (pendingBookingService) {
      const savedService =
        pendingBookingService;

      setPendingBookingService(null);

      navigateTo('home');

      setTimeout(() => {
        setBookingServicePrefill(
          savedService
        );

        setBookingModalOpen(true);
      }, 300);
    } else {
      navigateTo('home');
    }
  };

  // =========================================
  // REGISTER SUCCESS
  // =========================================

  const handleRegisterSuccess = (
    registeredUser: User
  ) => {
    setPrefilledLoginEmail(
      registeredUser.email
    );

    setLoginNotice(
      'Account created successfully! Please sign in with your credentials.'
    );

    showToast(
      'Account created successfully! Please sign in with your password.'
    );

    navigateTo('login');
  };

  // =========================================
  // LOGOUT
  // =========================================

  const handleLogout = async () => {
    try { const response=await apiFetch('/api/public/logout',{method:'POST'}); if(!response.ok)throw new Error();setCurrentUser(null);setPendingBookingService(null);setBookingModalOpen(false);showToast('You have been signed out.');navigateTo('home'); } catch { showToast('Sign out failed. Please retry.'); }
  };

  // =========================================
  // TOAST
  // =========================================

  const showToast = (
    message: string
  ) => {
    setToastMessage(message);

    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // =========================================
  // UI
  // =========================================

  return (
    <div className="ac-site min-h-screen flex flex-col bg-ac-background text-ac-on-surface font-ac-sans selection:bg-ac-primary-container selection:text-ac-on-primary-container">

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-24 right-4 sm:right-6 z-50 bg-ac-primary text-ac-on-primary px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-in slide-in-from-top-4 duration-300 max-w-md">

          <SiteIcon className=" text-ac-tertiary-fixed text-[22px] shrink-0">
            info
          </SiteIcon>

          <span className="flex-grow">
            {toastMessage}
          </span>

          <Button variant="ghost"
            onClick={() =>
              setToastMessage(null)
            }
            className="text-ac-on-primary/80 hover:text-white bg-transparent border-none cursor-pointer p-1 shrink-0"
            aria-label="Close notification"
          >
            <SiteIcon className=" text-[18px]">
              close
            </SiteIcon>
          </Button>
        </div>
      )}

      {/* Header */}
      <Header
        currentPage={currentPage}
        onNavigate={navigateTo}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenBooking={handleOpenBooking}
      />

      {/* Content */}
      <div className="flex-grow flex flex-col">

        {currentPage === 'home' && (
          <HomePage
            onNavigate={navigateTo}
            onOpenBooking={handleOpenBooking}
          />
        )}

        {currentPage === 'login' && (
          <LoginPage
            onNavigate={navigateTo}
            onLoginSuccess={handleLoginSuccess}
            initialNotice={loginNotice}
            initialEmail={prefilledLoginEmail}
            onClearNotice={() =>
              setLoginNotice(null)
            }
          />
        )}

        {currentPage === 'register' && (
          <RegisterPage
            onNavigate={navigateTo}
            onRegisterSuccess={
              handleRegisterSuccess
            }
          />
        )}

        {currentPage === 'bookings' &&
          currentUser && (
            <MyBookingsPage key={bookingVersion}
              user={currentUser}
              onBackHome={() =>
                navigateTo('home')
              }
            />
          )}

      </div>

      {/* Footer */}
      <Footer
        onNavigate={navigateTo}
        onOpenBooking={handleOpenBooking}
      />

      {/* Booking Modal */}
      <BookingModal
        isOpen={bookingModalOpen}
        onClose={() =>
          setBookingModalOpen(false)
        }
        defaultService={
          bookingServicePrefill
        }
        currentUser={currentUser}
        onNavigate={navigateTo}
        onBookingConfirmed={(summary) => {
          setBookingVersion(v=>v+1);
          showToast(summary);
        }}
      />

    </div>
  );
}
