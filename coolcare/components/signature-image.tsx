'use client';
import { useState } from 'react';
export function SignatureImage({
  url,
  label,
}: {
  url?: string | null;
  label: string;
}) {
  const [failed, setFailed] = useState('');
  if (!url)
    return <p className="text-sm text-muted-foreground">Not recorded</p>;
  if (!/^\/api\/report-signatures\/[0-9a-f-]{36}$/.test(url))
    return (
      <p className="text-sm text-muted-foreground">
        Legacy signature image is unavailable. Upload or draw a new signature
        when editing.
      </p>
    );
  if (failed === url)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Signature image could not be loaded. Refresh the report to retry.
      </p>
    );
  return (
    <img
      src={url}
      alt={label}
      onError={() => setFailed(url)}
      className="signature-preview max-h-48 w-full rounded-lg border bg-white object-contain"
    />
  );
}
