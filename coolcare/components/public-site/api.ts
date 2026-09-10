// Same-origin, HttpOnly session cookies; no credentials or sessions in browser storage.
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
