import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { Input } from '../../src/components/common/Input';
import { Button } from '../../src/components/common/Button';
import { Card } from '../../src/components/common/Card';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { ENV } from '../../src/config/env';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const { colors, typography, spacing } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Backend connectivity diagnostic
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [serverLatency, setServerLatency] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const checkServerConnection = async () => {
    setServerStatus('checking');
    setServerError(null);
    const start = Date.now();
    try {
      const data = await apiClient.get(API_ENDPOINTS.HEALTH, { skipAuth: true });
      if (data && data.status === 'ok') {
        setServerLatency(Date.now() - start);
        setServerStatus('online');
      } else {
        setServerStatus('offline');
        setServerError('Unexpected server response');
      }
    } catch (err: any) {
      setServerStatus('offline');
      setServerError(err?.message || 'Connection failed');
    }
  };

  useEffect(() => {
    checkServerConnection();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const { role } = await login(email, password);

      // Route based on authenticated role
      if (role === 'student') {
        router.replace('/(student)');
      } else if (role === 'teaching_staff') {
        router.replace('/(teacher)');
      } else if (role === 'hod') {
        router.replace('/(hod)');
      } else {
        router.replace('/(admin)/profile');
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerContainer}>
          <View
            style={[
              styles.logoBadge,
              { backgroundColor: colors.primary },
            ]}
          >
            <Text style={styles.logoText}>FYIMP</Text>
          </View>
          <Text
            style={[
              typography.h1,
              { color: colors.textPrimary, marginTop: spacing.md },
            ]}
          >
            Welcome Back
          </Text>
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            Sign in with your university account credentials
          </Text>
        </View>

        <Card variant="elevated" style={styles.formCard}>
          {error ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.dangerLight,
                  borderColor: colors.danger,
                },
              ]}
            >
              <Text style={[typography.bodySmall, { color: colors.danger }]}>
                {error}
              </Text>
            </View>
          ) : null}

          <Input
            label="University Email"
            placeholder="student@university.edu"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (error) setError(null);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon="mail-outline"
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError(null);
            }}
            isPassword
            leftIcon="lock-closed-outline"
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            style={{ marginTop: spacing.sm }}
          />
        </Card>

        {/* Backend Connectivity Status Diagnostic */}
        <TouchableOpacity
          onPress={checkServerConnection}
          activeOpacity={0.7}
          style={[
            styles.serverBadge,
            {
              backgroundColor:
                serverStatus === 'online'
                  ? 'rgba(16, 185, 129, 0.08)'
                  : serverStatus === 'offline'
                  ? 'rgba(239, 68, 68, 0.08)'
                  : 'rgba(100, 116, 139, 0.08)',
              borderColor:
                serverStatus === 'online'
                  ? colors.success
                  : serverStatus === 'offline'
                  ? colors.danger
                  : colors.border,
            },
          ]}
        >
          <View style={styles.serverBadgeContent}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    serverStatus === 'online'
                      ? colors.success
                      : serverStatus === 'offline'
                      ? colors.danger
                      : colors.warning,
                },
              ]}
            />
            {serverStatus === 'checking' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  Testing Backend Connection...
                </Text>
              </View>
            ) : serverStatus === 'online' ? (
              <Text style={[typography.caption, { color: colors.success, fontWeight: '600' }]}>
                Backend Online ({ENV.API_BASE_URL.replace(/^http:\/\//, '')}) • {serverLatency}ms
              </Text>
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Text style={[typography.caption, { color: colors.danger, fontWeight: '600' }]}>
                  Backend Offline ({ENV.API_BASE_URL.replace(/^http:\/\//, '')})
                </Text>
                <Text style={[typography.caption, { color: colors.danger, fontSize: 11, marginTop: 2 }]}>
                  Tap to retry • {serverError}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.footerContainer}>
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, textAlign: 'center' },
            ]}
          >
            Four-Year Integrated Multidisciplinary Program (FYIMP)
          </Text>
          <Text
            style={[
              typography.caption,
              { color: colors.textMuted, textAlign: 'center', marginTop: 4 },
            ]}
          >
            Need help? Contact your campus administrative desk.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 32,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 1.5,
  },
  formCard: {
    padding: 20,
  },
  errorBanner: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  serverBadge: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'center',
  },
  serverBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  footerContainer: {
    marginTop: 32,
    alignItems: 'center',
  },
});
