
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
          <div className="flex gap-sm mt-sm">
            <Button variant="ghost"
              type="button"
              className="w-10 h-10 rounded-full bg-ac-surface flex items-center justify-center text-ac-primary hover:bg-ac-primary hover:text-ac-on-primary transition-colors shadow-sm cursor-pointer border-none"
              title="QR Code"
            >
              <SiteIcon className="">qr_code_2</SiteIcon>
            </Button>
            <Button variant="ghost"
              type="button"
              className="w-10 h-10 rounded-full bg-ac-surface flex items-center justify-center text-ac-primary hover:bg-ac-primary hover:text-ac-on-primary transition-colors shadow-sm cursor-pointer border-none"
              title="Photo Camera"
            >
              <SiteIcon className="">photo_camera</SiteIcon>
            </Button>
          </div>
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
            Promotions
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

        {/* Contact Info */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-ac-on-background mb-xs">Contact Us</h4>
          <div className="flex items-start gap-xs text-ac-on-surface-variant">
            <SiteIcon className=" text-[20px] mt-1">call</SiteIcon>
            <div>
              <p className="font-body-md text-body-md font-medium text-ac-on-surface">1-800-AC-CARE</p>
              <p className="font-label-sm text-label-sm opacity-80">Mon-Sat, 8am-8pm</p>
            </div>
          </div>
          <div className="flex items-center gap-xs text-ac-on-surface-variant mt-xs">
            <SiteIcon className=" text-[20px]">mail</SiteIcon>
            <p className="font-body-md text-body-md">support@accare.example.com</p>
          </div>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-ac-outline-variant/30 py-md px-gutter text-center">
        <p className="font-body-md text-body-md text-ac-on-surface-variant">
          © 2024 AC Care. Reliable Air Conditioning Service, Made Simple.
        </p>
      </div>
    </footer>
  );
};
