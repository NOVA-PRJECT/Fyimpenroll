import type { NextConfig } from "next";
import path from 'node:path'

const isDev = process.env.NODE_ENV === 'development'

const scriptSrc = isDev
  ? "'self' 'unsafe-eval' 'unsafe-inline'"
  : "'self' 'unsafe-inline'"

const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:4000'
const connectSrc = isDev
  ? `'self' ${backendUrl} http://localhost:4000 http://127.0.0.1:4000 https://*.supabase.co`
  : `'self' ${backendUrl} https://*.supabase.co`

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, '..') },
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/login',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/dashboard/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src ${scriptSrc}; worker-src 'self'; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src ${connectSrc}; img-src 'self' data:; frame-ancestors 'none';`,
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
