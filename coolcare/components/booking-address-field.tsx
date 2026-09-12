'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Address, CreateAddressInput } from '@/lib/coolcare-types';

export function BookingAddressField({ addresses, value, expectedUserId, onChange, onAddressSaved, onEditingChange }: {
  addresses: Address[];
  value: string;
  expectedUserId: number;
  onChange: (value: string) => void;
  onAddressSaved: (address: Address) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', addressLine: '', postalCode: '' });
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<CreateAddressInput | null>(null);
  const selected = addresses.find(address => address.addressLine === value);

  useEffect(() => { onEditingChange(adding || busy || retryLocked); }, [adding, busy, retryLocked, onEditingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onEditingChange(false); };
  }, [onEditingChange]);

  function startAdding() {
    setDraft({ label: '', addressLine: selected ? '' : value, postalCode: '' });
    setError(''); setNotice(''); setAdding(true);
  }

  async function saveAddress() {
    if (inFlight.current) return;
    if (!pending.current) {
      const addressLine = draft.addressLine.trim();
      const postalCode = draft.postalCode.trim();
      if (addressLine.length < 5 || addressLine.length > 255) { setError('Enter a service address between 5 and 255 characters.'); return; }
      if (postalCode && !/^\d{6}$/.test(postalCode)) { setError('Enter a six-digit Singapore postal code, or leave it blank.'); return; }
      pending.current = { addressLine, label: draft.label.trim(), postalCode, expectedUserId, requestId: crypto.randomUUID() };
    }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const address = await coolcareApi.createAddress(pending.current);
      if (!mounted.current) return;
      onAddressSaved(address);
      pending.current = null; setRetryLocked(false); setAdding(false); setNotice('Address saved and selected for this booking.');
    } catch (reason) {
      if (!mounted.current) return;
      const rejected = reason instanceof Error && 'status' in reason && Number(reason.status) < 500;
      if (rejected) pending.current = null;
      setRetryLocked(!rejected);
      setError((reason instanceof Error ? reason.message : 'Unable to save this address.') + (rejected ? '' : ' Retry with the same details to safely retrieve or save the address.'));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  return <div className="space-y-5">
    {addresses.length > 0 && <div><FieldLabel htmlFor="saved-service-address">Saved addresses</FieldLabel><NativeSelect id="saved-service-address" value={selected?.addressId ?? ''} disabled={adding} onChange={event => { const address = addresses.find(item => item.addressId === Number(event.target.value)); if (address) { onChange(address.addressLine); setNotice(''); } }} className="mt-2 h-12 w-full"><option value="">Choose a saved address</option>{addresses.map(address => <option key={address.addressId} value={address.addressId}>{address.label ? address.label + ' · ' : ''}{address.addressLine}{address.postalCode ? ' · ' + address.postalCode : ''}</option>)}</NativeSelect></div>}
    <div><FieldLabel htmlFor="service-address">Service address</FieldLabel><Input id="service-address" value={value} disabled={adding} minLength={5} maxLength={255} onChange={event => { onChange(event.target.value); setNotice(''); }} placeholder="Street address, building and apartment / unit" className="mt-2 h-12" /><p className="mt-2 text-xs leading-5 text-muted-foreground">You can edit this address directly. A new address is saved with your booking.</p></div>
    {!adding && <Button type="button" variant="outline" onClick={startAdding}><Plus className="size-4" />Add new address</Button>}
    {adding && <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-5" role="group" aria-label="Add new address">
      <div className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-primary" />Add new address</div>
      <fieldset disabled={busy || retryLocked} className="min-w-0 space-y-4">
        <div><FieldLabel htmlFor="new-address-label">Address label <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="new-address-label" maxLength={80} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="Home or Office" className="mt-2" /></div>
        <div><FieldLabel htmlFor="new-address-line">New service address</FieldLabel><Input id="new-address-line" minLength={5} maxLength={255} value={draft.addressLine} onChange={event => setDraft({ ...draft, addressLine: event.target.value })} placeholder="Street address, building and apartment / unit" className="mt-2" /></div>
        <div><FieldLabel htmlFor="new-address-postal">Postal code <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="new-address-postal" inputMode="numeric" maxLength={6} value={draft.postalCode} onChange={event => setDraft({ ...draft, postalCode: event.target.value })} placeholder="Six-digit postal code" className="mt-2" /></div>
      </fieldset>
      {error && <p role="alert" className="text-sm leading-6 text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={saveAddress}>{busy ? 'Saving address…' : retryLocked ? 'Retry saving address' : 'Save address'}</Button><Button type="button" variant="ghost" disabled={busy || retryLocked} onClick={() => { setAdding(false); setError(''); }}>Cancel</Button></div>
    </div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
  </div>;
}
