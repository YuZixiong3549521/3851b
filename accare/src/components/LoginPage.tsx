import React, { useState, useEffect } from 'react';
import { PageRoute, User } from '../types';

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
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitted, setForgotSubmitted] = useState(false);

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
    const response = await fetch('http://localhost:3001/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      setErrorMessage(
        data.message || 'Invalid email or password. Please try again.'
      );
      return;
    }

    const loggedInUser: User = {
      id: String(data.user.id),
      name: data.user.fullName,
      email: data.user.email,
      phone: data.user.phone || '',
    };

    if (rememberMe) {
      localStorage.setItem(
        'ac_care_current_user',
        JSON.stringify(loggedInUser)
      );
    } else {
      sessionStorage.setItem(
        'ac_care_current_user',
        JSON.stringify(loggedInUser)
      );
    }

    onLoginSuccess(loggedInUser);

  } catch (error) {
    console.error('Login API error:', error);

    setErrorMessage(
      'Unable to connect to the server. Please make sure the backend is running.'
    );
  } finally {
    setIsLoading(false);
  }
};

  const handleQuickLogin = (demoName: string, demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setErrorMessage('');
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      try {
        const storedUsersStr = localStorage.getItem('ac_care_users');
        const storedUsers: User[] = storedUsersStr ? JSON.parse(storedUsersStr) : [];
        const matched = storedUsers.find(
          (u) => u.email.toLowerCase() === demoEmail.toLowerCase()
        );

        const userToLogin: User = matched || {
          id: 'usr_' + Date.now(),
          name: demoName,
          email: demoEmail,
          phone: '+1 (555) 019-2834',
          propertyType: 'Residential (2 AC Units)',
          password: 'password123',
        };

        onLoginSuccess(userToLogin);
      } catch (e) {
        console.error(e);
      }
    }, 300);
  };

  const handleForgotPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim() || !forgotEmail.includes('@')) return;
    setForgotSubmitted(true);
  };

  return (
    <div className="w-full flex-grow bg-surface-container-low py-8 sm:py-12 md:py-16 px-4 sm:px-6 flex flex-col justify-center items-center relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary-fixed via-transparent to-transparent"></div>

      {/* Main Container - Width 420px to 480px, responsive */}
      <div className="w-full max-w-[460px] mx-auto relative z-10">
        {/* Working "Back to Home" button */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBackToHome}
            className="inline-flex items-center gap-1.5 text-primary hover:text-on-primary-fixed-variant text-sm font-semibold transition-colors group cursor-pointer bg-surface/90 backdrop-blur-sm px-4 py-2 rounded-full border border-outline-variant/40 shadow-xs hover:shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-1 transition-transform">
              arrow_back
            </span>
            Back to Home
          </button>
          <span className="text-xs text-on-surface-variant font-medium whitespace-nowrap">
            AC Care Secure Access
          </span>
        </div>

        {/* Notice Banner (e.g. redirected from booking or registration) */}
        {initialNotice && (
          <div className="mb-4 p-3.5 rounded-xl bg-primary-fixed text-on-primary-fixed text-xs sm:text-sm font-medium flex items-start gap-2.5 border border-primary-fixed-dim/60 shadow-xs animate-in fade-in">
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">
              info
            </span>
            <span className="flex-grow">{initialNotice}</span>
          </div>
        )}

        {/* Card */}
        <div className="bg-surface rounded-2xl shadow-md border border-outline-variant/40 p-6 sm:p-8 backdrop-blur-sm">
          {/* Brand header */}
          <div className="text-center mb-6">
            <button
              type="button"
              onClick={handleBackToHome}
              className="inline-flex items-center gap-1.5 text-2xl font-bold text-primary mb-1 cursor-pointer border-none bg-transparent"
            >
              <span className="material-symbols-outlined text-primary text-[32px]">ac_unit</span>
              AC Care
            </button>
            <h1 className="text-2xl font-bold text-on-background mt-1">
              Welcome Back
            </h1>
            <p className="text-sm text-on-surface-variant mt-1.5">
              Sign in to manage your bookings and digital service reports
            </p>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-lg bg-error-container text-on-error-container text-sm flex items-start gap-2 animate-in fade-in">
              <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5 text-error">error</span>
              <span className="flex-grow">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1.5" htmlFor="login-email">
                Email Address
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
                  mail
                </span>
                <input
                  id="login-email"
                  type="email"
                  required
                  placeholder="alex.t@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-medium text-on-surface" htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotModal(true)}
                  className="text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
                  lock
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface bg-transparent border-none p-0 cursor-pointer flex items-center"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant accent-primary cursor-pointer"
                />
                <span className="text-xs text-on-surface-variant">Remember this device</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-primary text-on-primary font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  Sign In
                  <span className="material-symbols-outlined text-[18px]">login</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Fill Options */}
          <div className="mt-5 pt-4 border-t border-outline-variant/30">
            <p className="text-xs text-on-surface-variant text-center mb-2 font-medium">
              Demo Fast Sign-In:
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('Alex Taylor', 'alex.t@example.com')}
                className="py-2 px-2 bg-surface-container-low hover:bg-primary-fixed/40 text-primary border border-outline-variant/40 rounded-lg text-xs font-semibold transition-colors text-center cursor-pointer"
              >
                Alex T. (Customer)
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('Jamie Lee', 'jamie.l@example.com')}
                className="py-2 px-2 bg-surface-container-low hover:bg-primary-fixed/40 text-primary border border-outline-variant/40 rounded-lg text-xs font-semibold transition-colors text-center cursor-pointer"
              >
                Jamie L. (New User)
              </button>
            </div>
          </div>

          {/* Social Sign In Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-outline-variant/40"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-surface px-2 text-on-surface-variant font-medium">Or continue with</span>
            </div>
          </div>

          {/* Social Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleQuickLogin('Google User', 'user@gmail.com')}
              className="flex items-center justify-center gap-2 py-2.5 px-3 border border-outline-variant rounded-lg bg-surface-container-lowest hover:bg-surface-container-low text-on-surface text-xs font-medium transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Google
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('Apple User', 'user@icloud.com')}
              className="flex items-center justify-center gap-2 py-2.5 px-3 border border-outline-variant rounded-lg bg-surface-container-lowest hover:bg-surface-container-low text-on-surface text-xs font-medium transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.85.94-2.93-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.77-.96 2.82 1.02.08 2.06-.49 2.69-1.26z" />
              </svg>
              Apple
            </button>
          </div>

          {/* Link to Registration */}
          <div className="mt-6 text-center pt-4 border-t border-outline-variant/30">
            <p className="text-sm text-on-surface-variant">
              Don't have an account yet?{' '}
              <button
                type="button"
                onClick={() => onNavigate('register')}
                className="text-primary font-bold hover:underline bg-transparent border-none p-0 cursor-pointer inline"
              >
                Create an account
              </button>
            </p>
          </div>
        </div>

        {/* Security and reassurance badge */}
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px] text-tertiary-container">
              lock
            </span>
            256-bit SSL Encrypted
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px] text-primary">
              verified_user
            </span>
            Official AC Care Portal
          </span>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface w-full max-w-sm rounded-2xl shadow-xl border border-outline-variant p-6 relative">
            <button
              type="button"
              onClick={() => {
                setShowForgotModal(false);
                setForgotSubmitted(false);
              }}
              className="absolute top-4 right-4 text-outline hover:text-on-surface bg-transparent border-none cursor-pointer"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <h3 className="text-lg font-bold text-on-background mb-1">
              Reset Password
            </h3>
            <p className="text-xs text-on-surface-variant mb-4">
              Enter your registered email address and we will send you instructions to reset your password.
            </p>

            {forgotSubmitted ? (
              <div className="text-center py-4 space-y-3">
                <div className="w-12 h-12 rounded-full bg-tertiary-fixed text-tertiary-container mx-auto flex items-center justify-center">
                  <span className="material-symbols-outlined text-[28px]">mark_email_read</span>
                </div>
                <p className="text-sm font-medium text-on-background">
                  Reset link sent to <span className="font-bold text-primary">{forgotEmail}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(false);
                    setForgotSubmitted(false);
                  }}
                  className="w-full py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold cursor-pointer border-none"
                >
                  Return to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-on-surface mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="flex-1 py-2 border border-outline-variant rounded-lg text-sm text-on-surface bg-transparent cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold cursor-pointer border-none"
                  >
                    Send Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

