'use client';
import { useState } from 'react';
export type ServicePhoto = {
  photoId: number;
  url: string | null;
  description: string | null;
  uploadedAt: string;
};
function Photo({ photo }: { photo: ServicePhoto }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="overflow-hidden rounded-xl border bg-white">
      {photo.url && !failed ? (
        <a
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          aria-label={'Open service photo ' + photo.photoId}
        >
          <img
            src={photo.url}
            alt={photo.description || 'Service process photo'}
            onError={() => setFailed(true)}
            className="h-40 w-full object-cover"
          />
        </a>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">Photo unavailable</p>
      )}
      <figcaption className="space-y-2 p-3">
        <p className="whitespace-pre-wrap break-words text-sm">
          {photo.description || 'No note recorded'}
        </p>
        <p className="text-xs text-muted-foreground">
          Recorded:{' '}
          {new Date(photo.uploadedAt).toLocaleString('en-GB', {
            timeZone: 'Asia/Singapore',
          })}{' '}
          (SGT)
        </p>
      </figcaption>
    </figure>
  );
}
export function ServicePhotoGallery({ photos }: { photos: ServicePhoto[] }) {
  return photos.length ? (
    <div className="grid gap-4 sm:grid-cols-2">
      {photos.map((p) => (
        <Photo key={p.photoId} photo={p} />
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">No service photos uploaded.</p>
  );
}
