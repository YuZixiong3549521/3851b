
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { apiFetch as fetch } from '../api';
import React, { useState } from 'react';
import { PageRoute, User } from '../types';

interface RegisterPageProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onRegisterSuccess: (user: User) => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigate, onRegisterSuccess }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyType, setPropertyType] = useState('Apartment / Condo (1-2 Units)');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleBackToHome = (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate('home');
  };

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErrorMessage('');

  // Validate full name
  if (!fullName.trim()) {
    setErrorMessage('Please provide your full name.');
    return;
  }

  // Validate email
  if (!email.trim() || !email.includes('@')) {
    setErrorMessage('Please enter a valid email address.');
    return;
  }

  // Validate phone number
  if (!phone.trim()) {
    setErrorMessage('Please enter your contact phone number.');
    return;
  }

  // Validate password
  if (!password || password.length < 8) {
    setErrorMessage('Password must be at least 8 characters long.');
    return;
  }

  // Check that both passwords match
  if (password !== confirmPassword) {
    setErrorMessage('Passwords do not match. Please try again.');
    return;
  }

  // Check terms and conditions
  if (!agreeTerms) {
    setErrorMessage(
      'Please agree to the Terms of Service and Privacy Policy to continue.'
    );
    return;
  }

  setIsLoading(true);

  try {
    const response = await fetch(
      '/api/public/register',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          propertyType: propertyType,
          password: password,
          confirmPassword: confirmPassword,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setErrorMessage(
        data.message || 'Registration failed. Please try again.'
      );
      return;
    }

    const newUser: User = {
      id: String(data.user?.id || ''),
      name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      propertyType: propertyType,
    };

    onRegisterSuccess(newUser);

  } catch (error) {
    console.error('Registration error:', error);

    setErrorMessage(
      'Unable to connect to the CoolCare server. Please make sure the server is running.'
    );
  } finally {
    setIsLoading(false);
  }
};

  return (
    <div className="w-full flex-grow bg-ac-surface-container-low py-8 sm:py-12 md:py-16 px-4 sm:px-6 flex flex-col justify-center items-center relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-ac-primary-fixed via-transparent to-transparent"></div>

      {/* Main Container - Width 500px to 600px, responsive */}
      <div className="w-full max-w-[560px] mx-auto relative z-10">
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
            New Customer Registration
          </span>
        </div>

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
              Create Your Account
            </h1>
            <p className="text-sm text-ac-on-surface-variant mt-1.5">
              Book aircon services, manage your addresses and keep your maintenance reports in one place
            </p>
            <p className="mt-2 text-xs font-medium text-ac-on-surface-variant">Staff accounts are invitation only. This form creates a Customer account.</p>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-lg bg-ac-error-container text-ac-on-error-container text-sm flex items-start gap-2 animate-in fade-in">
              <SiteIcon className=" text-[20px] shrink-0 mt-0.5 text-ac-error">error</SiteIcon>
              <span className="flex-grow">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-name">
                Full Name
              </label>
              <div className="relative">
                <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                  person
                </SiteIcon>
                <Input
                  id="reg-name"
                  type="text"
                  required
                  placeholder="e.g. Alex Taylor"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-email">
                  Email Address
                </label>
                <div className="relative">
                  <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                    mail
                  </SiteIcon>
                  <Input
                    id="reg-email"
                    type="email"
                    required
                    placeholder="alex@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-phone">
                  Phone Number
                </label>
                <div className="relative">
                  <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                    call
                  </SiteIcon>
                  <Input
                    id="reg-phone"
                    type="tel"
                    required
                    placeholder="+65 9123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-property">
                Property / Air Conditioning Units
              </label>
              <div className="relative">
                <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                  home
                </SiteIcon>
                <NativeSelect
                  id="reg-property"
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  className="w-full pl-10 pr-8 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm appearance-none cursor-pointer"
                >
                  <option value="Apartment / Condo (1-2 Units)">Apartment / Condo (1–2 Units)</option>
                  <option value="Townhouse / Medium Residence (3-4 Units)">Townhouse / Medium Residence (3–4 Units)</option>
                  <option value="Landed House / Large Residence (5+ Units)">Landed House / Large Residence (5+ Units)</option>
                  <option value="Commercial Office / Retail Space">Commercial Office / Retail Space</option>
                </NativeSelect>

              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-password">
                  Password
                </label>
                <div className="relative">
                  <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                    lock
                  </SiteIcon>
                  <Input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="At least 6 chars"
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
                    <SiteIcon className=" text-[18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </SiteIcon>
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ac-on-surface mb-1.5" htmlFor="reg-confirm-password">
                  Confirm Password
                </label>
                <div className="relative">
                  <SiteIcon className=" absolute left-3 top-1/2 -translate-y-1/2 text-ac-outline text-[20px]">
                    lock_clock
                  </SiteIcon>
                  <Input
                    id="reg-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-ac-outline-variant bg-ac-surface-container-lowest text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 text-sm transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Terms Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <Input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-ac-primary focus:ring-ac-primary border-ac-outline-variant accent-ac-primary cursor-pointer shrink-0"
                />
                <span className="text-xs text-ac-on-surface-variant leading-normal">
                  I agree to CoolCare's{' '}
                  <span className="text-ac-primary font-medium underline">Terms of Service</span> and{' '}
                  <span className="text-ac-primary font-medium underline">Privacy Policy</span>, and consent to service notification SMS/emails.
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <Button variant="ghost"
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-ac-primary text-ac-on-primary font-semibold rounded-lg shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  Create Account
                  <SiteIcon className=" text-[18px]">how_to_reg</SiteIcon>
                </>
              )}
            </Button>
          </form>

          {/* Link to Login */}
          <div className="mt-6 text-center pt-4 border-t border-ac-outline-variant/30">
            <p className="text-sm text-ac-on-surface-variant">
              Already have an account?{' '}
              <Button variant="ghost"
                type="button"
                onClick={() => onNavigate('login')}
                className="text-ac-primary font-bold hover:underline bg-transparent border-none p-0 cursor-pointer inline"
              >
                Sign In
              </Button>
            </p>
          </div>
        </div>

        {/* Benefits list */}
        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-xs text-ac-on-surface-variant">
          <div className="p-2.5 bg-ac-surface/80 rounded-xl border border-ac-outline-variant/30 backdrop-blur-xs">
            <SiteIcon className=" text-[20px] text-ac-primary block mb-1">
              verified
            </SiteIcon>
            <span className="font-medium">Service Tracking</span>
          </div>
          <div className="p-2.5 bg-ac-surface/80 rounded-xl border border-ac-outline-variant/30 backdrop-blur-xs">
            <SiteIcon className=" text-[20px] text-ac-tertiary-container block mb-1">
              receipt_long
            </SiteIcon>
            <span className="font-medium">Digital Reports</span>
          </div>
          <div className="p-2.5 bg-ac-surface/80 rounded-xl border border-ac-outline-variant/30 backdrop-blur-xs">
            <SiteIcon className=" text-[20px] text-ac-primary block mb-1">
              local_offer
            </SiteIcon>
            <span className="font-medium">Quarterly Care</span>
          </div>
        </div>
      </div>
    </div>
  );
};
