import './globals.css'
import './theme.css'
import DataProvider from '@/components/DataProvider'
import { ApiRefreshInit } from '../components/ApiRefreshInit'
import ThemeToggle from '@/components/ThemeToggle'
import ThemeBootstrap from '@/components/ThemeBootstrap'
import LogoutDialog from '@/components/LogoutDialog'
import type { Metadata, Viewport } from 'next'
import { PwaProvider } from '@/components/pwa/PwaProvider'

export const metadata: Metadata = {
  title: 'FYIMP COURSE REGISTRATION KUC',
  description: 'Academic Excellence Digitally Preserved.',
  applicationName: 'FYIMP Portal',
  appleWebApp: { capable: true, title: 'FYIMP Portal', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = { themeColor: '#082042' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout loads these fonts on every page. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <PwaProvider><DataProvider>
        <ThemeBootstrap />
        <ApiRefreshInit />
        {children}
        <LogoutDialog />
        <ThemeToggle />
        </DataProvider></PwaProvider>
      </body>
    </html>
  );
}
