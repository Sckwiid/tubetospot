import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostDL | Spotify ➜ YouTube',
  description: 'Transform any public Spotify playlist into an anonymous YouTube playlist in one click.',
  icons: {
    icon: '/favicon.ico'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#05060a] text-slate-50 font-sans">
        {children}
      </body>
    </html>
  );
}
