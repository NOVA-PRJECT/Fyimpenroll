import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserRole } from '../config/constants';
import { queryClient } from '../lib/query-client';
import { apiClient, setOnUnauthorizedCallback } from '../api/client';
import { ProfileResponseSchema } from '../api/schemas/auth.schema';
import { API_ENDPOINTS } from '../api/endpoints';
import { ENV } from '../config/env';
import { Alert } from 'react-native';
import { ProfileRequests, withAuthDeadline } from '../lib/auth-network';

export interface UserProfile {
  must_change_password?: boolean;
  id?: string;
  full_name?: string | null;
  current_semester?: number | null;
  department_id?: string | null;
  campus_id?: string | null;
  department_name?: string | null;
  campus_name?: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  profile: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ role: UserRole; redirectTo?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const authEpoch = useRef(0);
  const activeToken = useRef<string | null>(null);
  const loggingIn = useRef(false);
  const signingOut = useRef<Promise<void> | null>(null);
  const profiles = useRef(new ProfileRequests<{ role: UserRole; profile: UserProfile } | null>());

  // Resolve roles only from the authenticated backend profile endpoint.
  const fetchProfileAndRole = useCallback(
    async (currentSession: Session): Promise<{ role: UserRole; profile: UserProfile } | null> => {
      return profiles.current.load(currentSession.access_token, () => withAuthDeadline(async signal => {
        try {
          const token = currentSession.access_token;
          const response = await fetch(
            `${ENV.API_BASE_URL.replace(/\/$/, '')}${API_ENDPOINTS.AUTH_PROFILE}`,
            {
              signal,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (response.ok) {
            const rawData = await response.json();
            const parsed = ProfileResponseSchema.safeParse(rawData);
            if (parsed.success) {
              const fetchedRole = parsed.data.role as UserRole;
              const p = parsed.data.profile;
              const profileData: UserProfile = {
                id: currentSession.user.id,
                must_change_password: parsed.data.must_change_password ?? false,
                full_name: p.full_name,
                current_semester: p.current_semester,
                department_id: p.department_id,
                campus_id: p.campus_id,
                department_name: p.departments?.name,
                campus_name: p.campuses?.name,
              };
              return { role: fetchedRole, profile: profileData };
            }
          }
        } catch (err) {
          console.warn('[AuthContext] Backend profile fetch failed:', err);
        }
        return null;
      }));
    },
    []
  );

  const logout = useCallback((): Promise<void> => {
    if (signingOut.current) return signingOut.current;
    authEpoch.current++;
    activeToken.current = null;
    profiles.current.clear();
    setIsLoading(true);
    queryClient.clear();
    const operation = (async () => {
      try {
        // The SDK's global logout fetch is routed through the backend once.
        // The SDK still removes encrypted credentials and emits SIGNED_OUT.
        const { error } = await supabase.auth.signOut();
        if (error) Alert.alert('Session revocation', 'Signed out on this device. Server session revocation could not be confirmed.');
      } catch {
        Alert.alert('Sign out', 'Sign out could not be fully confirmed. Check your connection and retry.');
      } finally {
        setSession(null); setUser(null); setRole(null); setProfile(null);
        queryClient.clear();
        setIsLoading(false);
        signingOut.current = null;
      }
    })();
    signingOut.current = operation;
    return operation;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const epoch = authEpoch.current;
    const result = await fetchProfileAndRole(session);
    if (epoch !== authEpoch.current || activeToken.current !== session.access_token) return;
    if (result) {
      setRole(result.role);
      setProfile(result.profile);
    } else {
      setRole(null);
      setProfile(null);
    }
  }, [session, fetchProfileAndRole]);

  // Handle 401 interceptor trigger
  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      if (!signingOut.current) void logout();
    });
    return () => setOnUnauthorizedCallback(null);
  }, [logout]);

  // Initial session restoration on mount
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      const epoch = authEpoch.current;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!isMounted || epoch !== authEpoch.current) return;
        if (error || !data.session) {
          if (isMounted) {
            setSession(null);
            setUser(null);
            setRole(null);
            setProfile(null);
            setIsLoading(false);
          }
          return;
        }

        const currentSession = data.session;
        activeToken.current = currentSession.access_token;
        if (isMounted) {
          setSession(currentSession);
          setUser(currentSession.user);
        }

        const roleResult = await fetchProfileAndRole(currentSession);
        if (isMounted && epoch === authEpoch.current && activeToken.current === currentSession.access_token) {
          if (roleResult) {
            setRole(roleResult.role);
            setProfile(roleResult.profile);
          } else {
            setRole(null);
            setProfile(null);
          }
          setIsLoading(false);
        }
      } catch (e) {
        console.error('[AuthContext] Initialization error:', e);
        if (isMounted) setIsLoading(false);
      }
    }

    initAuth();

    // Listen to token refresh and auth events from Supabase
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;
      if (event === 'SIGNED_OUT' || !newSession) {
        authEpoch.current++;
        activeToken.current = null;
        profiles.current.clear();
        setSession(null); setUser(null); setRole(null); setProfile(null);
        queryClient.clear();
        setIsLoading(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (signingOut.current || loggingIn.current) return;
        activeToken.current = newSession.access_token;
        const epoch = ++authEpoch.current;
        setSession(newSession);
        setUser(newSession.user);
        // Do not await network work inside the SDK's auth notification lock.
        void fetchProfileAndRole(newSession).then(result => {
          if (!isMounted || epoch !== authEpoch.current || activeToken.current !== newSession.access_token) return;
          setRole(result?.role ?? null);
          setProfile(result?.profile ?? null);
          setIsLoading(false);
        });
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfileAndRole]);

  const login = async (
    email: string,
    password: string
  ): Promise<{ role: UserRole; redirectTo?: string }> => {
    if (signingOut.current || loggingIn.current) throw new Error('A session change is already in progress.');
    loggingIn.current = true;
    const epoch = ++authEpoch.current;
    setIsLoading(true);
    try {
      const loginResult = await apiClient.post(API_ENDPOINTS.AUTH_LOGIN, { email: email.trim(), password }, { skipAuth: true });
      if (epoch !== authEpoch.current) throw new Error('Session changed during login.');
      const { data, error } = await supabase.auth.setSession({ access_token: loginResult.token, refresh_token: loginResult.refreshToken });
      if (error || !data.session) throw new Error(error?.message || 'Could not establish session');

      if (epoch !== authEpoch.current) throw new Error('Session changed during login.');
      activeToken.current = data.session.access_token;
      setSession(data.session);
      setUser(data.user);

      const result = await fetchProfileAndRole(data.session);
      if (epoch !== authEpoch.current) throw new Error('Session changed during login.');
      if (!result) {
        throw new Error('Could not resolve user role. Contact administration.');
      }

      setRole(result.role);
      setProfile(result.profile);

      return { role: result.role, redirectTo: loginResult.redirectTo };
    } finally {
      loggingIn.current = false;
      if (epoch === authEpoch.current) setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        role,
        profile,
        isLoading,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
