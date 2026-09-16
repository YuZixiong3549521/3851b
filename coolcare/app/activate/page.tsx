'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Snowflake, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Invitation = {
  fullName: string;
  email: string;
  roleName: 'Admin' | 'Technician';
  expiresAt: string;
};

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const session = await fetch('/api/session', { credentials: 'same-origin' });
  if (!session.ok) throw new Error('Unable to start a secure session.');
  const { csrf } = (await session.json()) as { csrf: string };
  const response = await fetch('/api/public' + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      data.error || data.message || 'Unable to complete account activation.',
    );
  return data as T;
}

export default function ActivateAccountPage() {
  const token = useRef(''),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [password, setPassword] = useState(''),
    [confirmPassword, setConfirmPassword] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const value =
      new URLSearchParams(window.location.search).get('token') || '';
    token.current = value;
    if (!value) {
      void Promise.resolve().then(() => {
        setError(
          'This activation link is incomplete. Ask an administrator to send a new invitation.',
        );
        setLoading(false);
      });
      return;
    }
    publicPost<{ invitation: Invitation }>('/staff-invitations/validate', {
      token: value,
    })
      .then((result) => setInvitation(result.invitation))
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const result = await publicPost<{ user: { role: string } }>(
        '/staff-invitations/accept',
        { token: token.current, password, confirmPassword },
      );
      window.location.replace(
        result.user.role === 'Admin'
          ? '/admin/orders'
          : '/technician/index.html',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to activate this account.',
      );
      setSaving(false);
    }
  }
  return (
    <main className="min-h-screen bg-[linear-gradient(145deg,#eef5ff,#f3fffd)] px-5 py-12">
      <div className="mx-auto max-w-lg">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-3 text-xl font-bold text-primary"
        >
          <span className="grid size-11 place-items-center rounded-full bg-primary text-white">
            <Snowflake className="size-6" />
          </span>
          CoolCare
        </Link>
        <Card className="rounded-3xl shadow-xl">
          <CardHeader>
            <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck />
            </div>
            <CardTitle className="text-2xl">
              Activate your staff account
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <output className="text-sm text-muted-foreground">
                Checking your invitation…
              </output>
            )}
            {!loading && error && !invitation && (
              <div>
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
                >
                  {error}
                </p>
                <Button
                  nativeButton={false}
                  render={<Link href="/#/login" />}
                  variant="outline"
                  className="mt-5"
                >
                  Back to sign in
                </Button>
              </div>
            )}
            {invitation && (
              <form onSubmit={submit} className="space-y-5">
                <div className="rounded-2xl bg-muted p-4 text-sm">
                  <p className="font-semibold">{invitation.fullName}</p>
                  <p className="text-muted-foreground">{invitation.email}</p>
                  <p className="mt-2 font-medium text-primary">
                    {invitation.roleName}
                  </p>
                </div>
                <label
                  htmlFor="activation-password"
                  className="block text-sm font-medium"
                >
                  Password
                  <Input
                    id="activation-password"
                    className="mt-2 h-11"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label
                  htmlFor="activation-password-confirmation"
                  className="block text-sm font-medium"
                >
                  Confirm password
                  <Input
                    id="activation-password-confirmation"
                    className="mt-2 h-11"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
                {error && (
                  <p
                    role="alert"
                    className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
                  >
                    {error}
                  </p>
                )}
                <Button type="submit" className="h-11 w-full" disabled={saving}>
                  {saving ? 'Activating…' : 'Activate account'}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  This invitation is single-use and expires 48 hours after it
                  was sent.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
