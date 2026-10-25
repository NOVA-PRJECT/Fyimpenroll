import React, { useState } from 'react';
import { View, Text, TextInput, Button, ScrollView, Linking } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { supabase } from '../lib/supabase';
import { ENV } from '../config/env';

export function AccountAccessGate({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const consent = useQuery({ queryKey: ['consent', user?.id], queryFn: () => apiClient.get<{ accepted: boolean; currentVersion: string }>('/api/consent/status'), enabled: !!user });
  if (!user) return <>{children}</>;
  if (!profile) return <View style={{ padding: 32 }}><Text>Account status could not be loaded.</Text><Button title="Retry" onPress={() => void refreshProfile()} /><Button title="Sign out" onPress={() => void logout()} /></View>;
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Please retry'); } finally { setBusy(false); }
  };
  if (profile.must_change_password) return <ScrollView contentContainerStyle={{ padding: 32, gap: 16 }}>
    <Text style={{ fontSize: 24 }}>Change your password</Text>
    <TextInput accessibilityLabel="Current password" placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
    <TextInput accessibilityLabel="New password" placeholder="New password (at least 8 characters)" secureTextEntry value={password} onChangeText={setPassword} />
    <Text>{error}</Text>
    <Button title={needsSync ? 'Retry account synchronization' : 'Change password'} disabled={busy || (!needsSync && password.length < 8)} onPress={() => void run(async () => {
      const result = await apiClient.post(needsSync ? '/api/auth/sync-password-status' : '/api/auth/change-password', needsSync ? {} : { current_password: current, new_password: password });
      if (!result.success) { setNeedsSync(true); throw new Error(result.message); }
      if (result.token && result.refreshToken) await supabase.auth.setSession({ access_token: result.token, refresh_token: result.refreshToken });
      else await supabase.auth.refreshSession();
      setCurrent(''); setPassword(''); await refreshProfile();
    })} />
    <Button title="Sign out" onPress={() => void logout()} />
  </ScrollView>;
  if (consent.isPending || consent.isError) return <View style={{ padding: 32 }}><Text>{consent.isPending ? 'Checking account consent…' : 'Consent service unavailable. Your session is preserved.'}</Text><Button title="Retry" onPress={() => void consent.refetch()} /></View>;
  if (!consent.data?.accepted) return <ScrollView contentContainerStyle={{ padding: 32, gap: 16 }}>
    <Text style={{ fontSize: 24 }}>Data privacy and terms</Text>
    <Text>Policy version: {consent.data?.currentVersion}</Text>
    <Text>Your identity, course registrations, timetable and attendance records are used for institutional administration. Location is used to validate campus sign-in; raw GPS coordinates are not retained by the backend.</Text>
    <Button title="Read privacy policy" onPress={() => void Linking.openURL(`${ENV.PORTAL_URL}/privacy-policy`)} />
    <Button title="Read terms of use" onPress={() => void Linking.openURL(`${ENV.PORTAL_URL}/terms-of-use`)} />
    <Text>{error}</Text>
    <Button title="I agree and continue" disabled={busy} onPress={() => void run(async () => {
      await apiClient.post('/api/consent/accept', { policy_version: consent.data?.currentVersion });
      await supabase.auth.refreshSession(); await consent.refetch();
    })} />
    <Button title="Decline and sign out" onPress={() => void logout()} />
  </ScrollView>;
  return <>{children}</>;
}
