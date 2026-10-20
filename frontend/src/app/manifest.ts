import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'FYIMP Portal · Kannur University',
    short_name: 'FYIMP Portal',
    description: 'Your Kannur University courses, timetable, attendance and academic progress.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F8F9FF',
    theme_color: '#082042',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
