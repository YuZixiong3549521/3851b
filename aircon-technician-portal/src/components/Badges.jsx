export const tone=value=>value.toLowerCase().replaceAll(' ','-');
export function StatusBadge({value}){return <span className={`badge status ${tone(value)}`}><span className="dot"/>{value}</span>;}
export function PriorityBadge({value}){return <span className={`badge priority ${tone(value)}`}>{value==='Urgent'?'ϟ ':''}{value}</span>;}
