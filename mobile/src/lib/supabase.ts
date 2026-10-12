import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env';
import { secureStorage } from './secure-store';
import { createAuthFetch } from './auth-network';

/**
 * Mobile Supabase Client with persistent encrypted session storage via SecureStore.
 */
export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  global: { fetch: createAuthFetch(ENV.SUPABASE_URL, ENV.API_BASE_URL, (...args) => fetch(...args)) },
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
