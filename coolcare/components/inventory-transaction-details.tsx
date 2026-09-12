'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet,SheetContent,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { api,ApiError,code,errorText,stockSign,useInventory,useResource,type Transaction } from '@/lib/inventory-client';
import { LoadState,Status } from './inventory-ui';

type Revision = {revision_id:number;changed_at:string;changed_by_name:string;before_quantity:number;after_quantity:number;before_occurred_at:string;after_occurred_at:string;before_remarks:string|null;after_remarks:string|null;stock_before:number;stock_after:number;after_version:number};
export function TransactionDetails({transaction,close}:{transaction:Transaction|null;close:()=>void}) {
  const [locked,setLocked]=useState(false);
  return <Sheet open={!!transaction} onOpenChange={open=>{if(!open&&!locked)close();}}>
    <SheetContent className="transaction-drawer overflow-y-auto" showCloseButton={!locked}>
      <SheetTitle>Transaction Details</SheetTitle>
      <SheetDescription>Stock movements and their correction history</SheetDescription>
      {transaction&&<Details key={transaction.transaction_id} id={transaction.transaction_id} lock={setLocked}/>}
    </SheetContent>
  </Sheet>;
}
function Details({id,lock}:{id:number;lock:(value:boolean)=>void}) {
  const {version,refresh,notify}=useInventory();
  const result=useResource<{transaction:Transaction;revisions:Revision[]}>(`/transactions/${id}`,version);
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const [form,setForm]=useState({quantity:'',occurred_at:'',remarks:''});
  const pending=useRef<{request_id:string;expected_version:number;quantity:number;occurred_at:string;remarks:string}|null>(null);
  const t=result.data?.transaction;
  function begin(){if(!t)return;setForm({quantity:String(t.quantity),occurred_at:t.created_at.replace(' ','T').slice(0,19),remarks:t.remarks||''});pending.current=null;setError('');setEditing(true);}
  async function save(e:React.FormEvent){
    e.preventDefault();if(!t||busy)return;
    pending.current??={request_id:crypto.randomUUID(),expected_version:t.version,quantity:Number(form.quantity),occurred_at:form.occurred_at,remarks:form.remarks};
    setBusy(true);lock(true);setError('');
    try{const saved=await api<{stock_after:number}>(`/transactions/${id}`,'PUT',pending.current);setEditing(false);setUncertain(false);pending.current=null;notify(`Correction saved. Current stock: ${saved.stock_after}.`);refresh();lock(false);}
    catch(e){setError(errorText(e));const unknown=!(e instanceof ApiError)||e.status>=500;setUncertain(unknown);lock(unknown);if(!unknown)pending.current=null;}
    finally{setBusy(false);}
  }
  if(!t)return <LoadState {...result}/>;
  return <>
    <div className="drawer-id">{code('TX',t.transaction_id)} <Status value={t.transaction_type}/></div>
    <h2>{t.part_name}</h2>
    <dl className="data-list">
      <div><dt>Date / time</dt><dd>{t.created_at}</dd></div>
      <div><dt>Last modified</dt><dd>{t.modified_at||'Never modified'}</dd></div>
      <div><dt>Quantity</dt><dd>{t.quantity}</dd></div>
      <div><dt>Current movement</dt><dd>{stockSign(t.stock_delta)}</dd></div>
      <div><dt>Original stock before / after</dt><dd>{t.stock_before??'Not recorded'} / {t.stock_after??'Not recorded'}</dd></div>
      <div><dt>Work order</dt><dd>{t.job_id?code('WO',t.job_id):'Not linked'}</dd></div>
      <div><dt>Recorded by</dt><dd>{t.admin_name||'Not recorded'}</dd></div>
    </dl>
    <h3>Description</h3><p className="remarks">{t.remarks||'No description.'}</p>
    {!editing&&['Stock In','Stock Out'].includes(t.transaction_type)&&<Button onClick={begin}>Edit transaction</Button>}
    {editing&&<form onSubmit={save} className="space-y-4 mt-5">
      <h3>Edit inbound / outbound record</h3>
      <label className="block">Quantity<Input type="number" min="1" max="2147483647" step="1" required value={form.quantity} disabled={busy||uncertain} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
      <label className="block">Transaction date and time<Input type="datetime-local" step="1" required value={form.occurred_at} disabled={busy||uncertain} onChange={e=>setForm({...form,occurred_at:e.target.value})}/></label>
      <label className="block">Description<Textarea aria-label="Description" maxLength={500} value={form.remarks} disabled={busy||uncertain} onChange={e=>setForm({...form,remarks:e.target.value})}/></label>
      <p className="form-hint">Stock changes by the quantity difference. The previous values remain in the change history.</p>
      {error&&<p className="notice error" role="alert">{error}</p>}
      {uncertain&&<p role="status">The result could not be confirmed. Retry the same correction to check it safely.</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||uncertain} onClick={()=>setEditing(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':uncertain?'Retry same correction':'Save correction'}</Button></div>
    </form>}
    <section className="space-y-4 mt-6"><h3>Change history</h3>{result.data?.revisions.length?result.data.revisions.map(r=><article key={r.revision_id} className="border rounded-lg p-3 text-sm space-y-2">
      <p><strong>Version {r.after_version}</strong> · {r.changed_by_name}</p><p>{r.changed_at}</p>
      <p>Quantity: {r.before_quantity} → {r.after_quantity}</p><p>Date: {r.before_occurred_at} → {r.after_occurred_at}</p>
      <p>Previous description: {r.before_remarks||'None'}</p><p>New description: {r.after_remarks||'None'}</p>
      <p>Stock at correction: {r.stock_before} → {r.stock_after}</p>
    </article>):<p>No corrections have been made.</p>}</section>
  </>;
}
