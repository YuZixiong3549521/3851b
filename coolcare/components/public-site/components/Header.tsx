
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
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
    <header className="bg-ac-surface/80 docked full-width top-0 sticky backdrop-blur-md shadow-sm z-50 transition-all">
      <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto">

        {/* Logo */}
        <Button variant="ghost"
          onClick={(e) => handleNavClick(e, 'home')}
          className="font-headline-sm text-headline-sm font-bold text-ac-primary flex items-center gap-xs cursor-pointer border-none bg-transparent p-0 text-left focus:outline-none"
        >
          <SiteIcon className=" text-ac-primary text-[32px]">
            ac_unit
          </SiteIcon>
          AC Care
        </Button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-md">

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'home')}
            className={`font-label-md text-label-md transition-colors cursor-pointer bg-transparent border-none p-0 ${
              currentPage === 'home'
                ? 'text-ac-primary border-b-2 border-ac-primary pb-1 font-semibold'
                : 'text-ac-on-surface-variant hover:text-ac-primary pb-1'
            }`}
          >
            Home
          </Button>

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'about')}
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            About Us
          </Button>

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'services')}
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Services
          </Button>

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'promotions')}
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Promotions
          </Button>

          <Button variant="ghost"
            onClick={(e) =>
              handleNavClick(e, 'home', 'how-it-works')
            }
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            How It Works
          </Button>

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'faq')}
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            FAQ
          </Button>

          <Button variant="ghost"
            onClick={(e) => handleNavClick(e, 'home', 'contact')}
            className="font-label-md text-label-md text-ac-on-surface-variant hover:text-ac-primary transition-colors cursor-pointer bg-transparent border-none p-0 pb-1"
          >
            Contact
          </Button>

          {/* Logged In User */}
          {currentUser ? (
            <div className="flex items-center gap-sm pl-3 border-l border-ac-outline-variant/50">

              {/* User */}
              <span className="font-label-md text-label-md font-semibold text-ac-primary flex items-center gap-1">
                <span className="w-7 h-7 rounded-full bg-ac-primary-fixed text-ac-primary text-xs flex items-center justify-center font-bold">
                  {currentUser.name
                    .slice(0, 2)
                    .toUpperCase()}
                </span>

                {currentUser.name.split(' ')[0]}
              </span>

              {/* My Bookings */}
              <Button variant="ghost"
                onClick={(e) =>
                  handleNavClick(e, 'bookings')
                }
                className={`font-label-sm text-xs transition-colors cursor-pointer bg-transparent border-none px-2 py-1 ${
                  currentPage === 'bookings'
                    ? 'text-ac-primary font-bold'
                    : 'text-ac-on-surface-variant hover:text-ac-primary'
                }`}
                title="My Bookings"
              >
                My Bookings
              </Button>

              <a href={currentUser.role==='Technician'?'/technician/index.html':currentUser.role==='Admin'?'/admin/inventory':'/customer'} className="text-xs font-semibold text-ac-primary">Dashboard</a>
              {/* Sign Out */}
              <Button variant="ghost"
                onClick={onLogout}
                className="font-label-sm text-xs text-ac-on-surface-variant hover:text-ac-error transition-colors cursor-pointer bg-transparent border-none p-1"
                title="Sign Out"
              >
                Sign Out
              </Button>
            </div>
          ) : (
            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'login')
              }
              className={`font-label-md text-label-md transition-colors cursor-pointer bg-transparent border-none p-0 pb-1 ${
                currentPage === 'login'
                  ? 'text-ac-primary border-b-2 border-ac-primary font-semibold'
                  : 'text-ac-on-surface-variant hover:text-ac-primary'
              }`}
            >
              Login
            </Button>
          )}
        </nav>

        {/* CTA & Mobile Toggle */}
        <div className="flex items-center gap-sm">

          <Button variant="ghost"
            onClick={() => onOpenBooking()}
            className="hidden md:inline-flex items-center justify-center bg-ac-primary text-ac-on-primary font-label-md text-label-md h-12 px-md rounded-full shadow-sm hover:opacity-90 active:scale-95 transition-all cursor-pointer border-none"
          >
            Book a Service
          </Button>

          {/* Mobile Hamburger */}
          <Button variant="ghost"
            aria-label="Menu"
            onClick={() =>
              setMobileMenuOpen(!mobileMenuOpen)
            }
            className="md:hidden p-xs text-ac-primary bg-transparent border-none cursor-pointer flex items-center justify-center"
          >
            <SiteIcon className=" text-[32px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </SiteIcon>
          </Button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-ac-surface border-b border-ac-outline-variant/30 px-gutter py-md space-y-sm shadow-lg animate-in slide-in-from-top duration-200">

          <div className="flex flex-col gap-2">

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'home', 'home')
              }
              className={`text-left py-2 px-3 rounded-lg font-label-md ${
                currentPage === 'home'
                  ? 'bg-ac-primary-fixed text-ac-primary font-bold'
                  : 'text-ac-on-surface'
              }`}
            >
              Home
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'home', 'about')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              About Us
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'home', 'services')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              Services
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(
                  e,
                  'home',
                  'promotions'
                )
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              Promotions
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(
                  e,
                  'home',
                  'how-it-works'
                )
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              How It Works
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'home', 'faq')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              FAQ
            </Button>

            <Button variant="ghost"
              onClick={(e) =>
                handleNavClick(e, 'home', 'contact')
              }
              className="text-left py-2 px-3 rounded-lg font-label-md text-ac-on-surface hover:bg-ac-surface-container-low"
            >
              Contact
            </Button>

            {currentUser && <a href={currentUser.role==='Technician'?'/technician/index.html':currentUser.role==='Admin'?'/admin/inventory':'/customer'} className="px-3 py-2 text-ac-primary font-semibold">Dashboard</a>}
            {/* Mobile Logged In User */}
            {currentUser ? (
              <div className="pt-3 border-t border-ac-outline-variant/30 flex flex-col gap-2">

                <div className="px-3 py-2 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-ac-primary-fixed text-ac-primary text-xs flex items-center justify-center font-bold">
                    {currentUser.name
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>

                  <span className="font-label-md text-ac-primary font-bold">
                    {currentUser.name}
                  </span>
                </div>

                {/* Mobile My Bookings */}
                <Button variant="ghost"
                  onClick={(e) =>
                    handleNavClick(e, 'bookings')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'bookings'
                      ? 'bg-ac-primary-fixed text-ac-primary font-bold'
                      : 'text-ac-on-surface hover:bg-ac-surface-container-low'
                  }`}
                >
                  My Bookings
                </Button>

                {/* Mobile Sign Out */}
                <Button variant="ghost"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout();
                  }}
                  className="text-left py-2 px-3 rounded-lg font-label-md text-ac-error hover:bg-ac-surface-container-low"
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="pt-2 border-t border-ac-outline-variant/30 flex flex-col gap-2">

                <Button variant="ghost"
                  onClick={(e) =>
                    handleNavClick(e, 'login')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'login'
                      ? 'bg-ac-primary-fixed text-ac-primary font-bold'
                      : 'text-ac-on-surface'
                  }`}
                >
                  Login
                </Button>

                <Button variant="ghost"
                  onClick={(e) =>
                    handleNavClick(e, 'register')
                  }
                  className={`text-left py-2 px-3 rounded-lg font-label-md ${
                    currentPage === 'register'
                      ? 'bg-ac-primary-fixed text-ac-primary font-bold'
                      : 'text-ac-on-surface'
                  }`}
                >
                  Create Account
                </Button>
              </div>
            )}

            {/* Mobile Booking */}
            <Button variant="ghost"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenBooking();
              }}
              className="mt-2 w-full inline-flex items-center justify-center bg-ac-primary text-ac-on-primary font-label-md h-12 rounded-full shadow-sm"
            >
              Book a Service
            </Button>

          </div>
        </div>
      )}
    </header>
  );
};