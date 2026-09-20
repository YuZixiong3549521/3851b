import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignatureImage } from '@/components/signature-image';
export default function SignaturePad({
  label,
  value,
  onChange,
  disabled,
  required,
}) {
  const fileInput = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const canvas = useRef(null),
    drawing = useRef(false),
    [mode, setMode] = useState('preview'),
    [error, setError] = useState('');
  useEffect(() => {
    if (mode === 'draw' && canvas.current) {
      const ctx = canvas.current.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 900, 300);
      ctx.strokeStyle = '#15243b';
      ctx.fillStyle = '#15243b';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, [mode]);
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * 900) / r.width,
      ((e.clientY - r.top) * 300) / r.height,
    ];
  };
  function start(e) {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = point(e),
      ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawing.current || disabled) return;
    const ctx = canvas.current.getContext('2d');
    ctx.lineTo(...point(e));
    ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current.toDataURL('image/png'));
  }
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (
      !['image/png', 'image/jpeg'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError('Choose a PNG or JPEG image up to 2 MB.');
      return;
    }
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      if (alive.current) {
        onChange(data);
        setMode('preview');
      }
    } catch {
      setError('Could not read this image. Please choose it again.');
    }
  }
  function clear() {
    onChange('');
    setMode('preview');
    setError('');
  }
  return (
    <section className="signature-pad">
      <h3>
        {label}
        {required ? ' · New signature required' : ''}
      </h3>
      <p className="muted">
        The named person should sign after reviewing the report. Draw with a
        mouse or finger, or upload their signature image.
      </p>
      {mode === 'draw' ? (
        <canvas
          ref={canvas}
          width={900}
          height={300}
          aria-label={label + ' drawing area'}
          className="signature-canvas"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{ pointerEvents: disabled ? 'none' : undefined }}
        />
      ) : value?.startsWith('data:image/') ? (
        <img
          className="signature-preview"
          src={value}
          alt={label + ' preview'}
        />
      ) : (
        <SignatureImage url={value} label={label} />
      )}
      <div className="portal-actions">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            onChange('');
            setMode('draw');
            if (mode === 'draw') {
              const ctx = canvas.current.getContext('2d');
              ctx.fillStyle = 'white';
              ctx.fillRect(0, 0, 900, 300);
              ctx.fillStyle = '#15243b';
            }
          }}
        >
          {mode === 'draw' ? 'Start again' : 'Draw signature'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || (!value && mode !== 'draw')}
          onClick={clear}
        >
          Clear signature
        </Button>
      </div>
      <div className="signature-upload">
        <p>PNG/JPG, max 2 MB</p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          aria-label={'Upload ' + label.toLowerCase()}
        >
          Upload image
        </Button>
        <Input
          ref={fileInput}
          hidden
          className="hidden"
          type="file"
          accept="image/png,image/jpeg"
          disabled={disabled}
          onChange={upload}
          aria-label={'Upload ' + label.toLowerCase()}
        />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
