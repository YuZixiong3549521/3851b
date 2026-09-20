import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
export default function LogoutButton() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function logout() {
    setBusy(true);
    setError('');
    try {
      const s = await fetch('/api/session', { credentials: 'include' });
      const { csrf } = await s.json();
      const r = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf },
      });
      if (!r.ok) throw new Error('Sign out failed. Please retry.');
      window.location.assign('/#/login');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="sidebar-logout">
      <Button
        variant="ghost"
        aria-label="Log out"
        disabled={busy}
        onClick={logout}
      >
        <LogOut size={18} />
        <span>Log out</span>
      </Button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
