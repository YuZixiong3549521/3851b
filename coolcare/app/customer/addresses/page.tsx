'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Archive, CheckCircle2, MapPin, Pencil, Plus, Star } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Address, CustomerContext } from '@/lib/coolcare-types';

type AddressDraft = { addressId?: number; label: string; addressLine: string; postalCode: string; requestId: string };

export default function CustomerAddressesPage() {
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const [archive, setArchive] = useState<Address | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    coolcareApi.getCustomerContext().then(result => { if (active) setContext(result); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load saved addresses.'); });
    return () => { active = false; };
  }, [attempt]);

  function openEditor(address?: Address) {
    setDialogError(''); setNotice('');
    setDraft({ addressId: address?.addressId, label: address?.label ?? '', addressLine: address?.addressLine ?? '', postalCode: address?.postalCode ?? '', requestId: crypto.randomUUID() });
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !context || saving) return;
    setSaving(true); setDialogError('');
    try {
      const input = { addressLine: draft.addressLine.trim(), label: draft.label.trim(), postalCode: draft.postalCode.trim() };
      const address = draft.addressId
        ? await coolcareApi.updateAddress(draft.addressId, input)
        : await coolcareApi.createAddress({ ...input, expectedUserId: context.customer.userId, requestId: draft.requestId });
      setContext(current => current && ({ ...current, addresses: [...current.addresses.filter(item => item.addressId !== draft.addressId && item.addressId !== address.addressId).map(item => ({ ...item, isDefault: address.isDefault ? false : item.isDefault })), address] }));
      setNotice(draft.addressId ? 'Address updated for future bookings. Existing bookings keep their original address.' : 'Your new address has been saved.');
      setDraft(null);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : 'Unable to save this address. Please retry.'); }
    finally { setSaving(false); }
  }

  async function makeDefault(addressId: number) {
    setSaving(true); setError(''); setNotice('');
    try {
      const address = await coolcareApi.setDefaultAddress(addressId);
      setContext(current => current && ({ ...current, addresses: current.addresses.map(item => ({ ...item, isDefault: item.addressId === address.addressId })) }));
      setNotice('Default address updated. It will be selected first for new bookings.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change the default address.'); }
    finally { setSaving(false); }
  }

  async function archiveAddress() {
    if (!archive || saving) return;
    setSaving(true); setDialogError('');
    try {
      await coolcareApi.archiveAddress(archive.addressId);
      // Read the new default chosen by the server after removing an address.
      setContext(current => current && ({ ...current, addresses: current.addresses.filter(item => item.addressId !== archive.addressId) }));
      setArchive(null); setNotice('Address removed from your saved list. Existing bookings are unchanged.');
      try { setContext(await coolcareApi.getCustomerContext()); } catch { setError('Address removed. Refresh to check your current default address.'); }
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : 'Unable to remove this address.'); }
    finally { setSaving(false); }
  }

  const addresses = [...context?.addresses ?? []].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.addressId - b.addressId);
  return <CoolCareShell>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">YOUR ACCOUNT</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Saved addresses</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Manage the places you book service for. Updates apply to new bookings; existing appointments keep their recorded address.</p></div><Button disabled={!context || saving} onClick={() => openEditor()}><Plus className="size-4" />Add new address</Button></div>
      <div className="mt-7 space-y-5">
        {!context && !error && <PageLoading />}
        {error && <div className="space-y-3"><PageError message={error} /><Button variant="outline" onClick={() => setAttempt(value => value + 1)} disabled={saving}>Refresh addresses</Button></div>}
        {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-secondary/20 bg-secondary/5 p-4 text-sm text-secondary"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</p>}
        {context && addresses.length === 0 && <EmptyState title="Save your first service address" description="Add your home or another service address so it is ready the next time you book." />}
        <div className="grid gap-5 sm:grid-cols-2">{addresses.map(address => <Card key={address.addressId} className="rounded-2xl border border-border/80 shadow-sm"><CardContent className="flex h-full flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="size-5" /></div>{Boolean(address.isDefault) && <Badge className="bg-primary/10 text-primary">Default</Badge>}</div>
          <div className="grow"><h2 className="text-lg font-semibold">{address.label || 'Service address'}</h2><p className="mt-2 break-words text-sm leading-6">{address.addressLine}</p>{address.postalCode && <p className="mt-1 text-sm text-muted-foreground">Singapore {address.postalCode}</p>}</div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button variant="outline" size="sm" onClick={() => openEditor(address)} disabled={saving}><Pencil className="size-4" />Edit</Button>{!address.isDefault && <Button variant="outline" size="sm" onClick={() => void makeDefault(address.addressId)} disabled={saving}><Star className="size-4" />Set default</Button>}<Button variant="ghost" size="sm" onClick={() => { setArchive(address); setDialogError(''); }} disabled={saving}><Archive className="size-4" />Remove</Button></div>
        </CardContent></Card>)}</div>
      </div>
    </div>
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) setDraft(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader><DialogTitle>{draft?.addressId ? 'Edit saved address' : 'Add new address'}</DialogTitle><DialogDescription>{draft?.addressId ? 'The updated address will be used for new bookings. Existing appointments and history keep their original address.' : 'Save an address to your account for future bookings.'}</DialogDescription></DialogHeader>
        {draft && <form onSubmit={saveAddress} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="address-label">Label (optional)</Label><Input id="address-label" placeholder="Home or office" maxLength={80} value={draft.label} disabled={saving} onChange={event => setDraft({ ...draft, label: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="saved-address">Service address</Label><Input id="saved-address" autoComplete="street-address" placeholder="Block, street and unit number" required minLength={5} maxLength={255} value={draft.addressLine} disabled={saving} onChange={event => setDraft({ ...draft, addressLine: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="address-postal">Postal code (optional)</Label><Input id="address-postal" autoComplete="postal-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" placeholder="6-digit postal code" value={draft.postalCode} disabled={saving} onChange={event => setDraft({ ...draft, postalCode: event.target.value })} /></div>
          {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving || !draft.addressLine.trim()}>{saving ? 'Saving…' : 'Save address'}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(archive)} onOpenChange={open => { if (!open && !saving) setArchive(null); }}>
      <DialogContent showCloseButton={!saving}><DialogHeader><DialogTitle>Remove saved address?</DialogTitle><DialogDescription>This hides the address from your saved list. It does not cancel or change existing bookings, equipment records or service reports.</DialogDescription></DialogHeader><p className="break-words rounded-lg bg-muted p-3 text-sm">{archive?.addressLine}</p>{dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setArchive(null)}>Keep address</Button><Button disabled={saving} onClick={() => void archiveAddress()}>{saving ? 'Removing…' : 'Remove address'}</Button></DialogFooter></DialogContent>
    </Dialog>
  </CoolCareShell>;
}
