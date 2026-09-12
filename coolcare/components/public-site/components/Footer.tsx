
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import React from 'react';
import { PageRoute } from '../types';

interface FooterProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onOpenBooking: (serviceName?: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate, onOpenBooking }) => {
  const handleNav = (e: React.MouseEvent, page: PageRoute, hash?: string) => {
    e.preventDefault();
    onNavigate(page, hash);
  };

  return (
    <footer className="bg-ac-surface-container full-width relative border-t border-ac-outline-variant" id="contact">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-md py-xl px-gutter max-w-container-max mx-auto">
        {/* Brand Column */}
        <div className="flex flex-col gap-sm">
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'home')}
            className="font-headline-sm text-headline-sm font-bold text-ac-primary flex items-center gap-xs mb-xs cursor-pointer border-none bg-transparent p-0 text-left"
          >
            <SiteIcon className=" text-ac-primary text-[28px]">ac_unit</SiteIcon>
            AC Care
          </Button>
          <p className="font-body-md text-body-md text-ac-on-surface-variant">
            Reliable Air Conditioning Service, Made Simple.
          </p>

        </div>

        {/* Quick Links */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-ac-on-background mb-xs">Quick Links</h4>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'home', 'home')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Home
          </Button>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'home', 'about')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            About Us
          </Button>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'home', 'services')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Services
          </Button>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'home', 'promotions')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Pricing
          </Button>
        </div>

        {/* Customer Actions */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-ac-on-background mb-xs">Customer Actions</h4>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'login')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Login
          </Button>
          <Button variant="ghost"
            onClick={(e) => handleNav(e, 'register')}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Create Account
          </Button>
          <Button variant="ghost"
            onClick={() => onOpenBooking()}
            className="font-body-md text-body-md text-ac-on-surface-variant hover:text-ac-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Book Service
          </Button>
        </div>

        {/* Booking help */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-ac-on-background mb-xs">Booking Help</h4>
          <p className="font-body-md text-body-md text-ac-on-surface-variant">Sign in to review your appointments. Unassigned requests can be cancelled or rescheduled in My Bookings.</p>
          <Button variant="ghost" onClick={(event) => handleNav(event, 'bookings')} className="justify-start px-0 text-ac-primary">Open My Bookings</Button>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-ac-outline-variant/30 py-md px-gutter text-center">
        <p className="font-body-md text-body-md text-ac-on-surface-variant">
          © {new Date().getFullYear()} AC Care. Reliable Air Conditioning Service, Made Simple.
        </p>
      </div>
    </footer>
  );
};
