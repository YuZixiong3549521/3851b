'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Mail, MapPin, Save, UserRound } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Customer } from '@/lib/coolcare-types';

export default function CustomerAccountPage() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    coolcareApi.getCustomerContext().then(({ customer: profile }) => {
      if (!active) return;
      setCustomer(profile); setName(profile.fullName); setPhone(profile.phone ?? '');
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load your profile.'); });
    return () => { active = false; };
  }, [attempt]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !customer) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const profile = await coolcareApi.updateProfile({ fullName: name.trim(), phone: phone.trim(), expectedUserId: customer.userId });
      setCustomer(profile); setName(profile.fullName); setPhone(profile.phone ?? ''); setSaved(true);
      window.dispatchEvent(new Event('coolcare:profile-updated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your profile. Please retry.');
    } finally { setSaving(false); }
  }

  const changed = customer && (name.trim() !== customer.fullName || phone.trim() !== (customer.phone ?? ''));
  return <CoolCareShell>
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <p className="text-sm font-semibold text-primary">YOUR ACCOUNT</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">My profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">Keep your contact details up to date for future service visits.</p>
      <div className="mt-7">
        {!customer && !error && <PageLoading />}
        {!customer && error && <div className="space-y-4"><PageError message={error} /><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
        {customer && <Card className="rounded-2xl border border-border/80 shadow-sm">
          <CardHeader className="p-6 pb-0"><CardTitle className="flex items-center gap-2 text-xl"><UserRound className="size-5 text-primary" />Contact details</CardTitle></CardHeader>
          <CardContent className="p-6 pt-3">
            <form onSubmit={saveProfile} className="space-y-6">
              <div className="space-y-2"><Label htmlFor="profile-name">Full name</Label><Input id="profile-name" autoComplete="name" required maxLength={120} value={name} onChange={event => { setName(event.target.value); setSaved(false); }} disabled={saving} /></div>
              <div className="space-y-2"><Label htmlFor="profile-phone">Phone number</Label><Input id="profile-phone" type="tel" autoComplete="tel" minLength={3} maxLength={30} value={phone} onChange={event => { setPhone(event.target.value); setSaved(false); }} disabled={saving} /><p className="text-xs leading-5 text-muted-foreground">Used by the service team to coordinate your visit.</p></div>
              <div className="space-y-2"><Label htmlFor="profile-email">Email address</Label><Input id="profile-email" type="email" value={customer.email} readOnly autoComplete="email" className="bg-muted/40" aria-describedby="email-note" /><p id="email-note" className="flex gap-2 text-xs leading-5 text-muted-foreground"><Mail className="mt-0.5 size-4 shrink-0" />Your sign-in email is read-only. Booking notifications use this address.</p></div>
              {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
              {saved && <p role="status" className="flex items-center gap-2 text-sm text-secondary"><CheckCircle2 className="size-4" />Your profile has been saved.</p>}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"><Button type="submit" disabled={saving || !changed || !name.trim()}><Save className="size-4" />{saving ? 'Saving…' : 'Save changes'}</Button><Button nativeButton={false} render={<Link href="/customer/addresses" />} variant="outline"><MapPin className="size-4" />Manage saved addresses</Button></div>
            </form>
          </CardContent>
        </Card>}
      </div>
    </div>
  </CoolCareShell>;
}
