import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { customerSupportEmail } from '@/lib/customer-support';
import { apiFetch as fetch, loginErrorMessage } from '../api';
import React, { useState, useEffect } from 'react';
import { PageRoute, User } from '../types';

const demoAccounts = [
  { label: 'Alice Tan (Customer)', email: 'alice.tan@coolcare.demo' },
  { label: 'Chris Lim (Technician)', email: 'chris.lim@coolcare.demo' },
  { label: 'Norshida (Admin)', email: 'norshida@coolcare.demo' },
] as const;

interface LoginPageProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onLoginSuccess: (user: User) => void;
  initialNotice?: string | null;
  initialEmail?: string;
  onClearNotice?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onNavigate,
  onLoginSuccess,
  initialNotice,
  initialEmail,
  onClearNotice,
}) => {
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  const handleBackToHome = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClearNotice) onClearNotice();
    onNavigate('home');
  };

  const handleQuickLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setShowPassword(false);
    setErrorMessage('');
    document.getElementById('login-password')?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErrorMessage('');

  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password;

  if (!cleanEmail || !cleanEmail.includes('@')) {
    setErrorMessage('Please enter a valid email address.');
    return;
  }

  if (!cleanPassword) {
    setErrorMessage('Please enter your password.');
    return;
  }

  setIsLoading(true);

  try {
    const response = await fetch('/api/public/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword, rememberMe,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      setErrorMessage(loginErrorMessage(response.status, data));
      return;
    }

    const loggedInUser: User = {
      id: String(data.user.id),
      name: data.user.name,
      email: data.user.email,
      phone: data.user.phone || '', role: data.user.role,
    };

    onLoginSuccess(loggedInUser);

  } catch (error) {
    console.error('Login API error:', error);

    setErrorMessage(
      'Unable to connect to the server. Please check your connection and try again.'
    );
  } finally {
    setIsLoading(false);
  }
};

  return (
    <div className="w-full flex-grow bg-ac-surface-container-low py-8 sm:py-12 md:py-16 px-4 sm:px-6 flex flex-col justify-center items-center relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-ac-primary-fixed via-transparent to-transparent"></div>

      {/* Main Container - Width 420px to 480px, responsive */}
      <div className="w-full max-w-[460px] mx-auto relative z-10">
        {/* Working "Back to Home" button */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <Button variant="ghost"
            type="button"
            onClick={handleBackToHome}
            className="inline-flex items-center gap-1.5 text-ac-primary hover:text-ac-on-primary-fixed-variant text-sm font-semibold transition-colors group cursor-pointer bg-ac-surface/90 backdrop-blur-sm px-4 py-2 rounded-full border border-ac-outline-variant/40 shadow-xs hover:shadow-sm"
          >
            <SiteIcon className=" text-[18px] group-hover:-translate-x-1 transition-transform">
              arrow_back
            </SiteIcon>
            Back to Home
          </Button>
          <span className="text-xs text-ac-on-surface-variant font-medium whitespace-nowrap">
            CoolCare Secure Access
          </span>
        </div>

        {/* Notice Banner (e.g. redirected from booking or registration) */}
        {initialNotice && (
          <div className="mb-4 p-3.5 rounded-xl bg-ac-primary-fixed text-ac-on-primary-fixed text-xs sm:text-sm font-medium flex items-start gap-2.5 border border-ac-primary-fixed-dim/60 shadow-xs animate-in fade-in">
            <SiteIcon className=" text-ac-primary text-[20px] shrink-0 mt-0.5">
              info
            </SiteIcon>
            <span className="flex-grow">{initialNotice}</span>
          </div>
        )}

        {/* Card */}
        <div className="bg-ac-surface rounded-2xl shadow-md border border-ac-outline-variant/40 p-6 sm:p-8 backdrop-blur-sm">
          {/* Brand header */}
          <div className="text-center mb-6">
            <Button variant="ghost"
              type="button"
              onClick={handleBackToHome}
              className="inline-flex items-center gap-1.5 text-2xl font-bold text-ac-primary mb-1 cursor-pointer border-none bg-transparent"
            >
              <SiteIcon className=" text-ac-primary text-[32px]">ac_unit</SiteIcon>
              CoolCare
            </Button>
            <h1 className="text-2xl font-bold text-ac-on-background mt-1">
              Welcome Back
            </h1>
            <p className="text-sm text-ac-on-surface-variant mt-1.5">
              Sign in to manage your bookings and digital service reports
            </p>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div role="alert" className="mb-4 p-3.5 rounded-lg bg-ac-error-container text-ac-on-error-container text-sm flex items-start gap-2 animate-in fade-in">
              <SiteIcon className=" text-[20px] shrink-0 mt-0.5 text-ac-error">error</SiteIcon>
              <span className="flex-grow">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="login-email">
                Email Address
              </label>
              <div className="relative">
                <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                  mail
                </SiteIcon>
                <Input
                  id="login-email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-medium text-ac-on-surface" htmlFor="login-password">
                  Password
                </label>
                <Button variant="ghost"
                  type="button"
                  onClick={() => setShowForgotModal(true)}
                  className="text-xs text-ac-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                >
                  Forgot password?
                </Button>
              </div>
              <div className="relative">
                <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                  lock
                </SiteIcon>
                <Input
                  id="login-password"
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                />
                <Button variant="ghost"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ac-outline hover:text-ac-on-surface bg-transparent border-none p-0 cursor-pointer flex items-center"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <SiteIcon className=" text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </SiteIcon>
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-ac-primary focus:ring-ac-primary border-ac-outline-variant accent-ac-primary cursor-pointer"
                />
                <span className="text-xs text-ac-on-surface-variant">Remember this device</span>
              </label>
            </div>

            <Button variant="ghost"
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-ac-primary text-ac-on-primary font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  Sign In
                  <SiteIcon className=" text-[18px]">login</SiteIcon>
                </>
              )}
            </Button>
          </form>

          <section aria-labelledby="demo-sign-in-heading" className="mt-6 border-t border-ac-outline-variant/30 pt-4">
            <h2 id="demo-sign-in-heading" className="text-center text-sm font-medium text-ac-on-surface-variant">
              Demo Fast Sign-In
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {demoAccounts.map((account, index) => (
                <Button
                  key={account.email}
                  type="button"
                  variant="outline"
                  disabled={isLoading}
                  aria-pressed={email === account.email}
                  onClick={() => handleQuickLogin(account.email)}
                  className={`min-h-11 w-full whitespace-normal rounded-lg border-ac-outline-variant/40 bg-ac-primary-fixed/30 px-3 py-3 text-xs font-semibold text-ac-primary hover:bg-ac-primary-fixed/60 ${index === 2 ? 'sm:col-span-2' : ''}`}
                >
                  {account.label}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs leading-5 text-ac-on-surface-variant">
              Choose an account, enter its password, then click Sign In.
            </p>
          </section>

          {/* Link to Registration */}
          <div className="mt-6 text-center pt-4 border-t border-ac-outline-variant/30">
            <p className="text-sm text-ac-on-surface-variant">
              Don't have an account yet?{' '}
              <Button variant="ghost"
                type="button"
                onClick={() => onNavigate('register')}
                className="text-ac-primary font-bold hover:underline bg-transparent border-none p-0 cursor-pointer inline"
              >
                Create an account
              </Button>
            </p>
          </div>
        </div>

        {/* Security and reassurance badge */}
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-ac-on-surface-variant">
          <span className="flex items-center gap-1">
            <SiteIcon className=" text-[16px] text-ac-tertiary-container">
              lock
            </SiteIcon>
            Your Service Account
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <SiteIcon className=" text-[16px] text-ac-primary">
              verified_user
            </SiteIcon>
            Official CoolCare Portal
          </span>
        </div>
      </div>

      {showForgotModal && (
        <Dialog open onOpenChange={setShowForgotModal}>
          <DialogContent className="ac-site max-h-[85dvh] overflow-y-auto bg-ac-surface rounded-2xl shadow-xl border border-ac-outline-variant p-6" aria-describedby="account-access-help">
            <DialogTitle className="pr-6 text-lg font-bold text-ac-on-background">Help accessing your account</DialogTitle>
            <div id="account-access-help" className="space-y-3 text-sm leading-6 text-ac-on-surface-variant">
              <p>Contact our support team if you have forgotten your password or cannot sign in. Automatic password reset emails are not currently available.</p>
              <p>Include the email address on your account. Never send your password. The team will need to verify your identity before helping with account access.</p>
            </div>
            <a href={'mailto:' + customerSupportEmail + '?subject=' + encodeURIComponent('CoolCare account access help')}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ac-primary px-4 py-3 text-sm font-semibold text-ac-on-primary hover:bg-ac-primary/90">
              <SiteIcon>mail</SiteIcon> Email support
            </a>
            <p className="break-all text-xs text-ac-on-surface-variant">{customerSupportEmail}</p>
            <p className="text-xs text-ac-on-surface-variant">Opens your email app. No message is sent automatically.</p>
            <Button variant="outline" onClick={() => setShowForgotModal(false)}>Return to Sign In</Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
