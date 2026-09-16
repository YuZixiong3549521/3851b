import React from 'react';
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { customerSupportEmail } from '@/lib/customer-support';
import type { OpenBooking, PageRoute, User } from '../types';

interface FooterProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onOpenBooking: OpenBooking;
  currentUser: User | null;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate, onOpenBooking, currentUser }) => {
  const isCustomer = !currentUser?.role || currentUser.role === 'Customer';
  const dashboard = currentUser?.role === 'Technician' ? '/technician/index.html'
    : currentUser?.role === 'Admin' ? '/admin/orders' : '/customer';
  const linkClass = 'h-auto min-h-11 justify-start whitespace-normal px-0 py-2 text-left text-body-md text-ac-on-surface-variant hover:text-ac-primary';

  return (
    <footer id="contact" className="scroll-mt-24 border-t border-ac-outline-variant bg-ac-surface-container">
      <div className="mx-auto grid max-w-container-max grid-cols-1 gap-8 px-gutter py-xl sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Button variant="ghost" onClick={() => onNavigate('home', 'home')} aria-label="CoolCare home"
            className="mb-3 h-11 gap-2 px-0 text-headline-sm font-bold text-ac-primary">
            <SiteIcon className="text-[28px]">ac_unit</SiteIcon>CoolCare
          </Button>
          <p className="max-w-xs text-body-md text-ac-on-surface-variant">Air conditioning care for your home in Singapore.</p>
          <p className="mt-3 max-w-xs text-body-sm text-ac-on-surface-variant">Cleaning, repairs and one annual plan for quarterly cleaning.</p>
        </div>

        <nav aria-label="Footer navigation">
          <h2 className="mb-2 text-label-md font-semibold text-ac-on-background">Explore</h2>
          <div className="flex flex-col items-start">
            <Button variant="ghost" onClick={() => onNavigate('home', 'services')} className={linkClass}>Services & pricing</Button>
            <Button variant="ghost" onClick={() => onNavigate('home', 'how-it-works')} className={linkClass}>How it works</Button>
            <Button variant="ghost" onClick={() => onNavigate('home', 'faq')} className={linkClass}>FAQs</Button>
          </div>
        </nav>

        <div>
          <h2 className="mb-2 text-label-md font-semibold text-ac-on-background">Your account</h2>
          <div className="flex flex-col items-start">
            {currentUser ? <>
              <a href={dashboard} className="inline-flex min-h-11 items-center py-2 text-body-md text-ac-on-surface-variant hover:text-ac-primary">Dashboard</a>
              {isCustomer && <Button variant="ghost" onClick={() => onNavigate('bookings')} className={linkClass}>My Bookings</Button>}
            </> : <>
              <Button variant="ghost" onClick={() => onNavigate('login')} className={linkClass}>Login</Button>
              <Button variant="ghost" onClick={() => onNavigate('register')} className={linkClass}>Create account</Button>
            </>}
            {isCustomer && <Button variant="ghost" onClick={() => onOpenBooking()} className={linkClass}>Book a service</Button>}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-label-md font-semibold text-ac-on-background">Contact support</h2>
          <p className="text-body-md text-ac-on-surface-variant">Questions about a service or an existing booking? Email our team.</p>
          <a href={`mailto:${customerSupportEmail}?subject=${encodeURIComponent('CoolCare service enquiry')}`}
            className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-body-md font-semibold text-ac-primary underline-offset-4 hover:underline">
            <SiteIcon>mail</SiteIcon>{customerSupportEmail}
          </a>
          <p className="mt-3 text-body-sm text-ac-on-surface-variant">Service visits: Monday–Friday.<br />Closed on Saturdays and Sundays.</p>
          <p className="mt-2 text-body-sm text-ac-on-surface-variant">For booking enquiries, include your booking reference.</p>
        </div>
      </div>
      <div className="border-t border-ac-outline-variant/40 px-gutter py-6 text-center text-body-sm text-ac-on-surface-variant">
        © {new Date().getFullYear()} CoolCare. Air conditioning care, made simple.
      </div>
    </footer>
  );
};
