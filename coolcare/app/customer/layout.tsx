import './globals.css';
import { Inter } from 'next/font/google';
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
export const metadata = { title: 'CoolCare | Customer Portal' };
export default function CustomerLayout({children}: {children: React.ReactNode}) { return <div className={`customer-theme ${inter.variable} antialiased`}>{children}</div>; }
