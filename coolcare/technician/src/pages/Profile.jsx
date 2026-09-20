import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CalendarCheck, LockKeyhole, UserRound } from 'lucide-react';
import { technicianRequest } from '../services/jobService.js';
export default function Profile({ onChanged }) {
  const [profile, setProfile] = useState(null),
    [form, setForm] = useState(null),
    [edit, setEdit] = useState(false),
    [availability, setAvailability] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [passwordOpen, setPasswordOpen] = useState(false),
    [password, setPassword] = useState({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    }),
    [passwordError, setPasswordError] = useState('');
  const pending = useRef(null);
  async function load() {
    try {
      setError('');
      const p = await technicianRequest('/profile');
      setProfile(p);
      setForm(p);
      setAvailability(p.availability);
      pending.current = null;
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(kind) {
    setBusy(true);
    setError('');
    setNotice('');
    const source = kind === 'profile' ? form : profile;
    pending.current ??= {
      expectedVersion: profile.version,
      fullName: source.fullName,
      phone: source.phone ?? '',
      primaryRegion: source.primaryRegion,
      availability:
        kind === 'availability' ? availability : profile.availability,
    };
    try {
      const p = await technicianRequest('/profile', {
        method: 'PATCH',
        body: pending.current,
      });
      pending.current = null;
      setProfile(p);
      setForm(p);
      setAvailability(p.availability);
      setEdit(false);
      setNotice('Your changes have been saved.');
      onChanged();
    } catch (e) {
      setError(e.message);
      if (e.status && e.status < 500) pending.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function savePassword(e) {
    e.preventDefault();
    setBusy(true);
    setPasswordError('');
    try {
      await technicianRequest('/password', { body: password });
      setPasswordOpen(false);
      setPassword({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setNotice(
        'Password changed successfully. Use your new password next time you sign in.',
      );
    } catch (e) {
      setPasswordError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!profile)
    return (
      <section className="panel empty">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={load}>Try again</Button>
          </>
        ) : (
          'Loading your profile…'
        )}
      </section>
    );
  const disabled = busy || Boolean(pending.current);
  return (
    <>
      {error && (
        <div className="form-error" role="alert">
          {error}{' '}
          {pending.current ? (
            <Button disabled={busy} onClick={() => save('profile')}>
              Retry same changes
            </Button>
          ) : (
            <Button variant="outline" onClick={load}>
              Reload profile
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p className="save-notice" role="status">
          {notice}
        </p>
      )}
      <div className="profile-layout">
        <div className="profile-left">
          <section className="panel profile-card">
            <div className="profile-avatar">
              {profile.fullName
                .split(/\s+/)
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </div>
            <h2>{profile.fullName}</h2>
            <p>Field Technician</p>
            <dl>
              <div>
                <dt>Technician ID</dt>
                <dd>TECH-{profile.technicianId}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="report-status submitted">{profile.status}</dd>
              </div>
            </dl>
          </section>
          <section className="panel profile-section">
            <h2>
              <CalendarCheck size={21} /> Availability
            </h2>
            <label>
              Current status
              <NativeSelect
                aria-label="Availability"
                value={availability}
                disabled={disabled || edit}
                onChange={(e) => setAvailability(e.target.value)}
              >
                {['Available', 'Busy', 'Unavailable', 'On Leave'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </NativeSelect>
            </label>
            <p className="muted">
              Only Available technicians can receive new dispatches. Existing
              jobs remain assigned to you.
            </p>
            <Button
              variant="outline"
              disabled={
                disabled || edit || availability === profile.availability
              }
              onClick={() => save('availability')}
            >
              Update availability
            </Button>
          </section>
        </div>
        <div className="profile-right">
          <section className="panel profile-section">
            <div className="section-heading">
              <h2>
                <UserRound size={21} /> Personal information
              </h2>
              {!edit && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setForm(profile);
                    setEdit(true);
                    setNotice('');
                  }}
                >
                  Edit profile
                </Button>
              )}
            </div>
            <form
              className="portal-form"
              onSubmit={(e) => {
                e.preventDefault();
                save('profile');
              }}
            >
              <div className="profile-fields">
                <label>
                  Full name
                  <Input
                    required
                    maxLength={120}
                    readOnly={!edit}
                    disabled={disabled}
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                  />
                </label>
                <label>
                  Email address
                  <Input readOnly value={profile.email} />
                </label>
                <label>
                  Phone number
                  <Input
                    required
                    minLength={3}
                    maxLength={30}
                    readOnly={!edit}
                    disabled={disabled}
                    value={form.phone ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                  />
                </label>
                <label>
                  Primary region
                  <Input
                    maxLength={120}
                    readOnly={!edit}
                    disabled={disabled}
                    placeholder="Not specified"
                    value={form.primaryRegion}
                    onChange={(e) =>
                      setForm({ ...form, primaryRegion: e.target.value })
                    }
                  />
                </label>
              </div>
              {edit && (
                <div className="portal-actions">
                  <Button type="submit" disabled={disabled}>
                    Save profile
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setEdit(false);
                      setForm(profile);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              <p className="muted">
                Your sign-in email is managed by the administrator. Primary
                region is profile information; dispatch uses availability and
                schedule.
              </p>
            </form>
          </section>
          <section className="panel profile-section">
            <h2>Account details</h2>
            <div className="account-details">
              <div>
                <small>ACCOUNT ID</small>
                <p>{profile.userId}</p>
              </div>
              <div>
                <small>ROLE</small>
                <p>Field Technician</p>
              </div>
              <div>
                <small>MEMBER SINCE</small>
                <p>{String(profile.memberSince).slice(0, 10)}</p>
              </div>
            </div>
            <hr />
            <h2>
              <LockKeyhole size={21} /> Security
            </h2>
            <p>Manage your sign-in password.</p>
            <Button
              variant="outline"
              onClick={() => {
                setPasswordError('');
                setPasswordOpen(true);
              }}
            >
              Change password
            </Button>
          </section>
        </div>
      </div>
      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setPasswordOpen(open);
            if (!open)
              setPassword({
                currentPassword: '',
                newPassword: '',
                confirmPassword: '',
              });
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password and choose a new password of at least 8
            characters.
          </DialogDescription>
          <form onSubmit={savePassword} className="portal-form">
            {passwordError && (
              <p role="alert" className="form-error">
                {passwordError}
              </p>
            )}
            {[
              ['currentPassword', 'Current password'],
              ['newPassword', 'New password'],
              ['confirmPassword', 'Confirm new password'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  type="password"
                  required
                  autoComplete={
                    key === 'currentPassword'
                      ? 'current-password'
                      : 'new-password'
                  }
                  minLength={key === 'currentPassword' ? 1 : 8}
                  maxLength={72}
                  disabled={busy}
                  value={password[key]}
                  onChange={(e) =>
                    setPassword({ ...password, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
