// Same-origin, HttpOnly session cookies; no credentials or sessions in browser storage.
export function loginErrorMessage(status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const body = data as { error?: unknown; message?: unknown };
    for (const message of [body.error, body.message]) {
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  if (status === 401) return 'Invalid email or password. Please try again.';
  if (status === 403) return 'Sign-in was blocked. Refresh the page and try again.';
  if (status === 429) return 'Too many sign-in attempts. Please wait 15 minutes and try again.';
  if (status >= 500) return 'The sign-in service is unavailable. Please try again shortly.';
  return 'Unable to sign in. Please try again.';
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Omit<Response, 'json'> & {json(): Promise<any>}> {
  const headers=new Headers(init.headers);
  if(init.method && !['GET','HEAD'].includes(init.method)){
    const response=await window.fetch('/api/session');
    if(!response.ok)throw new Error('Unable to start a session.');
    const session=await response.json() as {csrf:string};
    headers.set('X-CSRF-Token',session.csrf);
  }
  return window.fetch(path,{...init,headers,credentials:'same-origin'});
}
