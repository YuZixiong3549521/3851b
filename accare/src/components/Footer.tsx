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
    <footer className="bg-surface-container full-width relative border-t border-outline-variant" id="contact">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-md py-xl px-gutter max-w-container-max mx-auto">
        {/* Brand Column */}
        <div className="flex flex-col gap-sm">
          <button
            onClick={(e) => handleNav(e, 'home')}
            className="font-headline-sm text-headline-sm font-bold text-primary flex items-center gap-xs mb-xs cursor-pointer border-none bg-transparent p-0 text-left"
          >
            <span className="material-symbols-outlined text-primary text-[28px]">ac_unit</span>
            AC Care
          </button>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Reliable Air Conditioning Service, Made Simple.
          </p>
          <div className="flex gap-sm mt-sm">
            <button
              type="button"
              className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-primary hover:bg-primary hover:text-on-primary transition-colors shadow-sm cursor-pointer border-none"
              title="QR Code"
            >
              <span className="material-symbols-outlined">qr_code_2</span>
            </button>
            <button
              type="button"
              className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-primary hover:bg-primary hover:text-on-primary transition-colors shadow-sm cursor-pointer border-none"
              title="Photo Camera"
            >
              <span className="material-symbols-outlined">photo_camera</span>
            </button>
          </div>
        </div>

        {/* Quick Links */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-on-background mb-xs">Quick Links</h4>
          <button
            onClick={(e) => handleNav(e, 'home', 'home')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Home
          </button>
          <button
            onClick={(e) => handleNav(e, 'home', 'about')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            About Us
          </button>
          <button
            onClick={(e) => handleNav(e, 'home', 'services')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Services
          </button>
          <button
            onClick={(e) => handleNav(e, 'home', 'promotions')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Promotions
          </button>
        </div>

        {/* Customer Actions */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-on-background mb-xs">Customer Actions</h4>
          <button
            onClick={(e) => handleNav(e, 'login')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Login
          </button>
          <button
            onClick={(e) => handleNav(e, 'register')}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Create Account
          </button>
          <button
            onClick={() => onOpenBooking()}
            className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-all text-left bg-transparent border-none p-0 cursor-pointer"
          >
            Book Service
          </button>
        </div>

        {/* Contact Info */}
        <div className="flex flex-col gap-sm">
          <h4 className="font-label-md text-label-md font-semibold text-on-background mb-xs">Contact Us</h4>
          <div className="flex items-start gap-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[20px] mt-1">call</span>
            <div>
              <p className="font-body-md text-body-md font-medium text-on-surface">1-800-AC-CARE</p>
              <p className="font-label-sm text-label-sm opacity-80">Mon-Sat, 8am-8pm</p>
            </div>
          </div>
          <div className="flex items-center gap-xs text-on-surface-variant mt-xs">
            <span className="material-symbols-outlined text-[20px]">mail</span>
            <p className="font-body-md text-body-md">support@accare.example.com</p>
          </div>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-outline-variant/30 py-md px-gutter text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">
          © 2024 AC Care. Reliable Air Conditioning Service, Made Simple.
        </p>
      </div>
    </footer>
  );
};
