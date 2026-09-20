import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ServicePhotoGallery } from '@/components/service-photo-gallery';
import { technicianRequest } from '../services/jobService.js';
export default function ServicePhotos({ jobId, disabled, onLockedChange }) {
  const [photos, setPhotos] = useState([]),
    [items, setItems] = useState([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [loading, setLoading] = useState(true);
  const input = useRef(null),
    inFlight = useRef(false),
    pending = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onLockedChange(busy || uncertain);
    return () => onLockedChange(false);
  }, [busy, uncertain, onLockedChange]);
  const load = async () => {
    try {
      const d = await technicianRequest('/reports/' + jobId + '/photos');
      if (alive.current) setPhotos(d.photos);
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [jobId]);
  async function select(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setError('');
    setNotice('');
    if (items.length + files.length > 5) {
      setError('Choose up to 5 photos per batch.');
      return;
    }
    if (
      files.some(
        (f) =>
          !['image/png', 'image/jpeg'].includes(f.type) ||
          f.size > 5 * 1024 * 1024,
      )
    ) {
      setError('Choose PNG/JPEG photos up to 5 MB each.');
      return;
    }
    setBusy(true);
    try {
      const next = await Promise.all(
        files.map(async (f) => ({
          id: crypto.randomUUID(),
          name: f.name,
          description: '',
          image: await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(f);
          }),
        })),
      );
      if (alive.current) setItems((v) => [...v, ...next]);
    } catch {
      setError('Could not read the selected photos.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function upload() {
    if (inFlight.current || busy || disabled) return;
    inFlight.current = true;
    setError('');
    setNotice('');
    setBusy(true);
    pending.current ??= items.map((i) => ({
      requestId: i.id,
      description: i.description.trim(),
      image: i.image,
    }));
    try {
      while (pending.current.length) {
        const item = pending.current[0];
        await technicianRequest('/reports/' + jobId + '/photos', {
          body: item,
        });
        pending.current.shift();
        setItems((v) => v.filter((i) => i.id !== item.requestId));
      }
      pending.current = null;
      setUncertain(false);
      setNotice('Photos and notes saved.');
      await load();
    } catch (e) {
      setError(e.message);
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const locked = disabled || busy || uncertain;
  return (
    <section className="service-photos space-y-4">
      <h3>Service process photos</h3>
      <p className="muted">
        Add photos taken before, during or after the service, with a note for
        each. Upload your selected photos before signing the report.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="save-notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p>Loading photos…</p>
      ) : (
        <ServicePhotoGallery photos={photos} />
      )}
      <Button
        type="button"
        variant="outline"
        disabled={locked || items.length >= 5 || photos.length >= 30}
        onClick={() => input.current.click()}
      >
        Add photos
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg"
        disabled={locked}
        onChange={select}
      />
      <p className="muted">
        PNG/JPG · up to 5 MB each · 5 per batch · 30 per report. Click a saved
        photo to open it.
      </p>
      {items.map((i) => (
        <div className="photo-draft" key={i.id}>
          <img src={i.image} alt={'Selected photo: ' + i.name} />
          <label>
            Photo note *
            <Textarea
              aria-label={'Note for ' + i.name}
              required
              maxLength={255}
              value={i.description}
              disabled={locked}
              placeholder="For example: Before cleaning — dust on the filter."
              onChange={(e) =>
                setItems((v) =>
                  v.map((x) =>
                    x.id === i.id ? { ...x, description: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={() => setItems((v) => v.filter((x) => x.id !== i.id))}
          >
            Remove selected photo
          </Button>
        </div>
      ))}
      {items.length > 0 && (
        <Button
          type="button"
          disabled={
            disabled ||
            busy ||
            (!uncertain && items.some((i) => !i.description.trim()))
          }
          onClick={upload}
        >
          {busy
            ? 'Uploading…'
            : uncertain
              ? 'Retry same uploads'
              : 'Upload photos & notes'}
        </Button>
      )}
      {uncertain && (
        <p role="status">
          The upload result is uncertain. Retry to confirm it without adding a
          duplicate photo.
        </p>
      )}
    </section>
  );
}
