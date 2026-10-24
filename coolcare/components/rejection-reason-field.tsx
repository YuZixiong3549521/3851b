'use client';
import { useEffect, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

const reasons = [
  ['capacity', 'No technician available', 'No technician is available for the requested appointment. Please book another weekday or time.'],
  ['service', 'Service outside our scope', 'The requested work is outside the services we provide. Please contact support to discuss your requirements.'],
  ['address', 'Address or access needs clarification', 'We need more information about the service address or property access. Please update the details and book again.'],
  ['duplicate', 'Duplicate booking', 'Another booking already covers this service at the same address. Please check My Bookings before making another request.'],
  ['details', 'Service details need clarification', 'We need more information about the requested service. Please add the relevant details in Other remarks and book again.'],
] as const;
const selectionFor = (value: string) => reasons.find((reason) => reason[2] === value)?.[0] || (value ? 'other' : '');

export function RejectionReasonField({ id, value, onChange, disabled = false }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [selection, setSelection] = useState<string>(() => selectionFor(value));
  useEffect(() => {
    setSelection((current) => value === '' && current === 'other' ? current : selectionFor(value));
  }, [value]);
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-sm font-semibold">Rejection reason</label>
    <NativeSelect id={id} value={selection} disabled={disabled} onChange={(event) => {
      const next = event.target.value;
      setSelection(next);
      onChange(reasons.find((reason) => reason[0] === next)?.[2] || '');
    }}>
      <option value="">Choose a reason</option>
      {reasons.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      <option value="other">Other — explain the reason</option>
    </NativeSelect>
    {selection === 'other' ? <label htmlFor={`${id}-details`} className="block text-sm">
      Explanation for the customer
      <Textarea id={`${id}-details`} value={value} disabled={disabled} maxLength={500} minLength={3}
        className="mt-2 min-h-24" onChange={(event) => onChange(event.target.value)}
        placeholder="Explain why this request cannot be approved (at least 3 characters)." />
    </label> : value && <p className="rounded-lg bg-slate-50 p-3 text-sm">{value}</p>}
    <p className="text-sm muted">The customer will see this message.</p>
  </div>;
}
