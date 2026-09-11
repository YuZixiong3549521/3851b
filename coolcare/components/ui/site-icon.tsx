import type { ComponentProps, ReactNode } from 'react';
import {
  Snowflake, X, Menu, CalendarDays, BadgeCheck, ChevronDown, Check,
  CircleCheck, QrCode, Camera, Phone, Mail, ArrowRight, ArrowLeft,
  Star, StarHalf, Headset, MousePointerClick, Wrench, FileText,
  Search, UserCheck, Info, CircleAlert, LockKeyhole, Eye, EyeOff,
  LogIn, ShieldCheck, MailCheck, User, House, LockKeyholeOpen,
  UserPlus, ReceiptText, Tag, Thermometer, Droplets, Volume2, Wind,
  PlugZap, Sparkles, type LucideIcon,
} from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  ac_unit: Snowflake, close: X, menu: Menu, calendar_month: CalendarDays,
  verified: BadgeCheck, expand_more: ChevronDown, check: Check,
  task_alt: CircleCheck, check_circle: CircleCheck, qr_code_2: QrCode,
  photo_camera: Camera, call: Phone, mail: Mail, arrow_forward: ArrowRight,
  arrow_back: ArrowLeft, star: Star, star_half: StarHalf, support_agent: Headset,
  touch_app: MousePointerClick, engineering: Wrench, description: FileText,
  search: Search, person_check: UserCheck, build: Wrench, info: Info,
  error: CircleAlert, lock: LockKeyhole, visibility: Eye, visibility_off: EyeOff,
  login: LogIn, verified_user: ShieldCheck, mark_email_read: MailCheck,
  person: User, home: House, lock_clock: LockKeyholeOpen, how_to_reg: UserPlus,
  receipt_long: ReceiptText, local_offer: Tag, thermostat: Thermometer,
  water_drop: Droplets, volume_up: Volume2, air: Wind,
  electrical_services: PlugZap, cleaning_services: Sparkles,
};

// Keeps imported page icon names while all portals render bundled Lucide SVGs.
export function SiteIcon({ children, className, style, ...props }: Omit<ComponentProps<'span'>, 'children'> & { children: ReactNode }) {
  const Icon = icons[String(children).trim()] ?? Info;
  return <span aria-hidden="true" className={className} style={{ display: 'inline-flex', flexShrink: 0, verticalAlign: 'middle', ...style }} {...props}><Icon width="1em" height="1em" strokeWidth={1.8} /></span>;
}
