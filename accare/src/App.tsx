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

// Pre-seeded demo accounts
const SEED_USERS: User[] = [
  {
    id: 'usr_demo_1',
    name: 'Alex Taylor',
    email: 'alex.t@example.com',
    phone: '+1 (555) 019-2834',
    propertyType: 'Residential (2 AC Units)',
    password: 'password123',
  },
  {
    id: 'usr_demo_2',
    name: 'Jamie Lee',
    email: 'jamie.l@example.com',
    phone: '+1 (555) 014-9982',
    propertyType: 'Apartment (1 Unit)',
    password: 'password123',
  },
  {
    id: 'usr_demo_3',
    name: 'Sam Kim',
    email: 'sam.k@example.com',
    phone: '+1 (555) 018-7711',
    propertyType: 'Townhouse (3 Units)',
    password: 'password123',
  },
];

export default function App() {
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

  useEffect(() => {
    try {
      const storedUsers = localStorage.getItem('ac_care_users');

      if (!storedUsers) {
        localStorage.setItem(
          'ac_care_users',
          JSON.stringify(SEED_USERS)
        );
      } else {
        const parsed: User[] = JSON.parse(storedUsers);
        let updated = false;

        SEED_USERS.forEach((seedUser) => {
          const exists = parsed.some(
            (user) =>
              user.email.toLowerCase() ===
              seedUser.email.toLowerCase()
          );

          if (!exists) {
            parsed.push(seedUser);
            updated = true;
          }
        });

        if (updated) {
          localStorage.setItem(
            'ac_care_users',
            JSON.stringify(parsed)
          );
        }
      }

      const storedSession = localStorage.getItem(
        'ac_care_session_user'
      );

      if (storedSession) {
        setCurrentUser(JSON.parse(storedSession));
      }
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }, []);

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
          'Air Conditioning Cleaning'
      );

      showToast(
        'Please log in or create an account before booking a service.'
      );

      navigateTo('login');

      return;
    }

    setBookingServicePrefill(serviceName);
    setBookingModalOpen(true);
  };

  // =========================================
  // LOGIN SUCCESS
  // =========================================

  const handleLoginSuccess = (
    user: User
  ) => {
    setCurrentUser(user);
    setLoginNotice(null);

    try {
      localStorage.setItem(
        'ac_care_session_user',
        JSON.stringify(user)
      );
    } catch (error) {
      console.error(error);
    }

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

  const handleLogout = () => {
    setCurrentUser(null);
    setPendingBookingService(null);
    setBookingModalOpen(false);

    try {
      localStorage.removeItem(
        'ac_care_session_user'
      );
    } catch (error) {
      console.error(error);
    }

    showToast(
      'You have been signed out.'
    );

    navigateTo('home');
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
    <div className="min-h-screen flex flex-col bg-background text-on-surface font-sans selection:bg-primary-container selection:text-on-primary-container">

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-24 right-4 sm:right-6 z-50 bg-primary text-on-primary px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-in slide-in-from-top-4 duration-300 max-w-md">

          <span className="material-symbols-outlined text-tertiary-fixed text-[22px] shrink-0">
            info
          </span>

          <span className="flex-grow">
            {toastMessage}
          </span>

          <button
            onClick={() =>
              setToastMessage(null)
            }
            className="text-on-primary/80 hover:text-white bg-transparent border-none cursor-pointer p-1 shrink-0"
            aria-label="Close notification"
          >
            <span className="material-symbols-outlined text-[18px]">
              close
            </span>
          </button>
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
            <MyBookingsPage
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
          showToast(summary);
        }}
      />

    </div>
  );
}