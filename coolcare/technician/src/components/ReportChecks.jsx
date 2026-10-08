import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { templates } from '../utils/reportChecks.js';
export default function ReportChecks({ rows, onChange, remarks, onRemarksChange }) {
 return <div className="space-y-4">
  <label>Checks template<NativeSelect aria-label="Checks template" value="" onChange={e => {
   if(e.target.value) onChange(templates[e.target.value].map(name => rows.find(r => r.name === name) || {name, done:false, reason:''}));
  }}><option value="">Choose checks to start with</option>{Object.keys(templates).map(name => <option key={name}>{name}</option>)}</NativeSelect></label>
  <h3>Checks completed *</h3><p>Tick the checks completed during this service.</p>
  <div className="report-check-list">
   {rows.map((r,i) => <label key={r.name} className="report-check-row">
    <input type="checkbox" checked={r.done} onChange={e => onChange(rows.map((item,n) => n===i ? {...item,done:e.target.checked} : item))}/>
    <span>{r.name}</span>
   </label>)}
  </div>
  <label>Remarks (optional)<Textarea rows={3} maxLength={2000} value={remarks || ''} onChange={e => onRemarksChange(e.target.value)} placeholder="Add any unfinished work or other service notes." /></label>
 </div>;
}
