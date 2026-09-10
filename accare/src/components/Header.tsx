import React, { useState } from 'react';
import { PageRoute, User } from '../types';

interface HeaderProps {
  currentPage: PageRoute;
  onNavigate: (page: PageRoute, hash?: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  onOpenBooking: (serviceName?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  onNavigate,
  currentUser,
  onLogout,
  onOpenBooking,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (
    e: React.MouseEvent,
    page: PageRoute,
    hash?: string
  ) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    onNavigate(page, hash);
  };

  return (
    <header className="bg-surface/80 docked full-width top-0 sticky backdrop-blur-md shadow-sm z-50 transition-all">
      <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto">

        {/* Logo */}
        <button
          onClick={(e) => handleNavClick(e, 'home')}
          className="font-headline-sm text-headline-sm font-bold text-primary flex items-center gap-xs cursor-pointer border-none bg-transparent p-0 text-left focus:outline-none"
        >
          <span className="material-symbols-outlined text-primary text-[32px]">
            ac_unit
          </span>
          AC Care
        </button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-md">

          <button
            onClick={(e) => handleNavClick(e, 'home', 'home')}
            className={`font-label-md text-label-md transition-colors cursor-pointer bg-transparent border-none p-0 ${
              currentPage === 'home'
                ? 'text-primary border-b-2 border-primary pb-1 font-semibold'
                : 'text-on-surface-variant hover:text-primary pb-1'
            }`}
          >
            Home
          </button>

          <button
            onClick={(e) => handleNavClick(e, 'home', 'about')}
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            About Us
          </button>

          <button
            onClick={(e) => handleNavClick(e, 'home', 'services')}
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Services
          </button>

          <button
            onClick={(e) => handleNavClick(e, 'home', 'promotions')}
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Promotions
          </button>

          <button
            onClick={(e) =>
              handleNavClick(e, 'home', 'how-it-works')
            }
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            How It Works
          </button>

          <button
            onClick={(e) => handleNavClick(e, 'home', 'faq')}
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            FAQ
          </button>

          <button
            onClick={(e) => handleNavClick(e, 'home', 'contact')}
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Contact
          </button>

          {/* Logged In User */}
          {currentUser ? (
            <div className="flex items-center gap-sm pl-3 border-l border-outline-variant/50">

              {/* User */}
              <span className="font-label-md text-label-md font-semibold text-primary flex items-center gap-1">
                <span className="w-7 h-7 rounded-full bg-primary-fixed text-primary text-xs flex items-center justify-center font-bold">
                  {currentUser.name
                    .slice(0, 2)
                    .toUpperCase()}
                </span>

                {currentUser.name.split(' ')[0]}
              </span>

              {/* My Bookings */}
              <button
                onClick={(e) =>
                  handleNavClick(e, 'bookings')
                }
                className={`font-label-sm text-xs transition-colors cursor-pointer bg-transparent border-none px-2 py-1 ${
                  currentPage === 'bookings'
                    ? 'text-primary font-bold'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
                title="My Bookings"
              >
                My Bookings
              </button>

              {/* Sign Out */}
              <button
                onClick={onLogout}
                className="font-label-sm text-xs text-on-surface-variant hover:text-error transition-colors cursor-pointer bg-transparent border-none p-1"
                title="Sign Out"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={(e) =>
                handleNavClick(e, 'login')
              }
              className={`font-label-md text-label-md transition-colors cursor-pointer bg-transparent border-none p-0 pb-1 ${
                currentPage === 'login'
                  ? 'text-primary border-b-2 border-primary font-semibold'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              Login
            </button>
          )}
        </nav>

        {/* CTA & Mobile Toggle */}
        <div className="flex items-center gap-sm">

          <button
            onClick={() => onOpenBooking()}
            className="hidden md:inline-flex items-center justify-center bg-primary text-on-primary font-label-md text-label-md h-12 px-md rounded-full shadow-sm hover:opacity-90 active:scale-95 transition-all cursor-pointer border-none"
          >
            Book a Service
          </button>

          {/* Mobile Hamburger */}
          <button
            aria-label="Menu"
            onClick={() =>
              setMobileMenuOpen(!mobileMenuOpen)
            }
            className="md:hidden p-xs text-primary bg-transparent border-none cursor-pointer flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[32px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-surface border-b border-outline-variant/30 px-gutter py-md space-y-sm shadow-lg animate-in slide-in-from-top duration-200">

          <div className="flex flex-col gap-2">

            <button
              onClick={(e) =>
                handleNavClick(e, 'home', 'home')
              }
              className={`text-left py-2 px-3 rounded-lg font-label-md ${
                currentPage === 'home'
                  ? 'bg-primary-fixed text-primary font-bold'
                  : 'text-on-surface'
              }`}
            >
              Home
            </button>

            <button
              onClick={(e) =>
                handleNavClick(e, 'home', 'about')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              About Us
            </button>

            <button
              onClick={(e) =>
                handleNavClick(e, 'home', 'services')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              Services
            </button>

            <button
              onClick={(e) =>
                handleNavClick(
                  e,
                  'home',
                  'promotions'
                )
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              Promotions
            </button>

            <button
              onClick={(e) =>
                handleNavClick(
                  e,
                  'home',
                  'how-it-works'
                )
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              How It Works
            </button>

            <button
              onClick={(e) =>
                handleNavClick(e, 'home', 'faq')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              FAQ
            </button>

            <button
              onClick={(e) =>
                handleNavClick(e, 'home', 'contact')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-on-surface hover:bg-surface-container-low"
            >
              Contact
            </button>

            {/* Mobile Logged In User */}
            {currentUser ? (
              <div className="pt-3 border-t border-outline-variant/30 flex flex-col gap-2">

                <div className="px-3 py-2 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary-fixed text-primary text-xs flex items-center justify-center font-bold">
                    {currentUser.name
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>

                  <span className="font-label-md text-primary font-bold">
                    {currentUser.name}
                  </span>
                </div>

                {/* Mobile My Bookings */}
                <button
                  onClick={(e) =>
                    handleNavClick(e, 'bookings')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'bookings'
                      ? 'bg-primary-fixed text-primary font-bold'
                      : 'text-on-surface hover:bg-surface-container-low'
                  }`}
                >
                  My Bookings
                </button>

                {/* Mobile Sign Out */}
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout();
                  }}
                  className="text-left py-2 px-3 rounded-lg font-label-md text-error hover:bg-surface-container-low"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="pt-2 border-t border-outline-variant/30 flex flex-col gap-2">

                <button
                  onClick={(e) =>
                    handleNavClick(e, 'login')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'login'
                      ? 'bg-primary-fixed text-primary font-bold'
                      : 'text-on-surface'
                  }`}
                >
                  Login
                </button>

                <button
                  onClick={(e) =>
                    handleNavClick(e, 'register')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'register'
                      ? 'bg-primary-fixed text-primary font-bold'
                      : 'text-on-surface'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* Mobile Booking */}
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenBooking();
              }}
              className="mt-2 w-full inline-flex items-center justify-center bg-primary text-on-primary font-label-md h-12 rounded-full shadow-sm"
            >
              Book a Service
            </button>

          </div>
        </div>
      )}
    </header>
  );
};