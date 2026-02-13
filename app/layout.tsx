import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const font = Space_Grotesk({ subsets: ['latin'], variable: '--font-sg', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'GhostDL | Spotify ➜ YouTube',
  description: 'Transform any public Spotify playlist into an anonymous YouTube playlist in one click.',
  icons: {
    icon: '/favicon.ico'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body className="bg-[#05060a] text-slate-50 font-sans">
        {children}
      </body>
    </html>
  );
}
