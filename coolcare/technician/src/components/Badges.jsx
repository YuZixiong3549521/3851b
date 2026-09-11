import { Badge } from '@/components/ui/badge';
export const tone=value=>value.toLowerCase().replaceAll(' ','-');
export function StatusBadge({value}){return <Badge variant="outline" className={`badge status ${tone(value)}`}><span className="dot"/>{value}</Badge>;}
export function PriorityBadge({value}){return <Badge variant="outline" className={`badge priority ${tone(value)}`}>{value==='Urgent'?'ϟ ':''}{value}</Badge>;}
