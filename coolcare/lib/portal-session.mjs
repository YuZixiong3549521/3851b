export const LOGIN_PATH = '/#/login';
export const SESSION_CHANNEL = 'coolcare-session';

export function notifySessionChange(message) {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(SESSION_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch { /* Session refresh still covers browsers without this channel. */ }
  }
}

export function getPortalHome(role) {
  return role === 'Customer' ? '/customer' : role === 'Technician' ? '/technician/index.html' : role === 'Admin' ? '/admin/orders' : '/';
}

// Keep return destinations within known routes belonging to the signed-in role.
// Never accept a URL supplied by the browser as an unrestricted redirect.
export function getSafeReturnTo(value, role) {
  if (!['Customer', 'Technician', 'Admin'].includes(role)) return null;
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (value === 'assistant') return role === 'Customer' ? '/customer?assistant=resume' : null;
  if (value === 'bookings') return role === 'Customer' ? '/customer/bookings' : null;
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null;
  const url = new URL(value, 'https://coolcare.invalid');
  if (url.origin !== 'https://coolcare.invalid' || /[%\\]/.test(url.pathname)) return null;
  const routes = {
    Customer: /^\/customer(?:\/(?:book|account|addresses|bookings(?:\/\d+)?|history(?:\/\d+)?))?\/?$/,
    Admin: /^\/admin\/(?:orders(?:\/\d+)?|dispatch|technicians|admins|inventory(?:\/(?:parts(?:\/(?:new|\d+(?:\/edit)?))?|transactions(?:\/new)?))?)\/?$/,
    Technician: /^\/technician\/index\.html$/,
  };
  if (!routes[role]?.test(url.pathname)) return null;
  if (role === 'Technician' && url.hash && !/^#(?:dashboard|jobs|reports|profile)(?:\?.*)?$/.test(url.hash)) return null;
  return url.pathname + url.search + url.hash;
}

export function getPostLoginHref(role, returnTo) {
  return getSafeReturnTo(returnTo, role) || getPortalHome(role);
}

export function getLoginHref(returnPath = '') {
  const safe = ['Customer', 'Technician', 'Admin'].some(role => getSafeReturnTo(returnPath, role));
  return safe ? `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnPath)}` : LOGIN_PATH;
}

export async function readPortalSession(signal) {
  const response = await fetch('/api/public/session', { credentials: 'same-origin', cache: 'no-store', signal });
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error('Unable to check your session. Please retry.');
  const { user } = await response.json();
  if (!user) return null;
  if (!['Customer', 'Technician', 'Admin'].includes(user.role) || !user.id || typeof user.name !== 'string') {
    throw new Error('Unable to check your session. Please retry.');
  }
  return user;
}

export async function redirectToSessionPortal(requiredRole) {
  const user = await readPortalSession();
  if (!user || user.role !== requiredRole) {
    window.dispatchEvent(new Event('coolcare:session-invalid'));
    window.location.replace(user ? getPortalHome(user.role) : getLoginHref(window.location.pathname + window.location.search + window.location.hash));
  }
  return user;
}

let signingOut;
export function signOutSession() {
  if (signingOut) return signingOut;
  signingOut = (async () => {
    const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!sessionResponse.ok) throw new Error('Unable to sign out. Please retry.');
    const { csrf } = await sessionResponse.json();
    if (typeof csrf !== 'string' || !csrf) throw new Error('Unable to sign out. Please retry.');
    const response = await fetch('/api/logout', {
      method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf },
    });
    if (!response.ok) throw new Error('Unable to sign out. Please retry.');
    // No user data or session tokens are stored in the browser notification.
    notifySessionChange('signed-out');
    window.dispatchEvent(new Event('coolcare:signed-out'));
    window.location.replace(LOGIN_PATH);
  })().finally(() => { signingOut = undefined; });
  return signingOut;
}
