/**
 * Application environment configuration
 * Sourced strictly from EXPO_PUBLIC_* variables
 */

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const portalUrl = process.env.EXPO_PUBLIC_PORTAL_URL;

if (!apiBaseUrl) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_API_BASE_URL');
}
if (!supabaseUrl) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_SUPABASE_URL');
}
if (!supabaseAnonKey) {
  throw new Error('Missing required environment variable: EXPO_PUBLIC_SUPABASE_ANON_KEY');
}
if (!portalUrl) throw new Error('Missing required environment variable: EXPO_PUBLIC_PORTAL_URL');
const parsedPortalUrl = new URL(portalUrl);
if (!['https:', 'http:'].includes(parsedPortalUrl.protocol) || parsedPortalUrl.username || parsedPortalUrl.password) {
  throw new Error('EXPO_PUBLIC_PORTAL_URL must be a public HTTP(S) portal URL');
}

export const ENV = {
  API_BASE_URL: apiBaseUrl,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseAnonKey,
  PORTAL_URL: portalUrl.replace(/\/+$/, ''),
};

