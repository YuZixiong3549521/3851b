import {CalendarDays} from 'lucide-react';
import {formatDate} from '../utils/jobs.js';
export default function Header({page,total,today}){return <header className="header"><div><h1>{page==='jobs'?'My Jobs':'Technician Dashboard'}</h1><p>{page==='jobs'?`${total} jobs assigned` : <>Welcome back, <strong>Daniel</strong></>}</p></div><div className="header-date"><CalendarDays size={18}/>{formatDate(today,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div></header>;}
