export type PageRoute = 'home' | 'login' | 'register' | 'bookings';

export interface User {
  id: number | string;
  name: string;
  email: string;
  phone?: string;
  propertyType?: string;
  password?: string;
}
export interface Booking {
  id: number;
  user_id: number;
  service_type: string;
  service_package: string;
  number_of_units: number;
  preferred_date: string;
  time_window: string;
  service_address: string;
  symptoms?: string;
  special_notes?: string;
  booking_status: string;
  created_at: string;
}

export interface ServiceItem {
  id: number | string;
  title: string;
  badge?: string;
  image: string;
  alt: string;
  features: string[];
  ctaText: string;
}

export interface ProblemItem {
  id: number | string;
  name: string;
  description?: string;
  icon: string;
  colorClass: string;
  textColorClass: string;
}

export interface TestimonialItem {
  name: string;
  role: string;
  initials: string;
  avatarBg: string;
  avatarTextColor: string;
  rating: number;
  text: string;
}

export interface PromotionItem {
  tag: string;
  tagClass: string;
  tagTextClass: string;
  title: string;
  description: string;
  ctaText: string;
  isPrimary?: boolean;
}

export interface FaqItem {
  id: number | string;
  question: string;
  answer: string;
}
