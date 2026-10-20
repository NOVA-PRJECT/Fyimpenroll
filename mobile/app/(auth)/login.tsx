import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Keyboard, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { Input } from '../../src/components/common/Input';
import { Button } from '../../src/components/common/Button';
import { Card } from '../../src/components/common/Card';

export default function LoginScreen() {
  const { login } = useAuth();
  const { colors, typography, spacing } = useTheme();
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (submitting.current) return;
    if (!email.trim() || !password) {
      setError('Enter your university email and password to continue.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid university email address.');
      return;
    }
    submitting.current = true;
    Keyboard.dismiss();
    setError(null);
    setLoading(true);
    try {
      // The root navigation guard routes every authenticated role consistently.
      await login(email.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.content}>
            <View style={[styles.brand, { backgroundColor: colors.primaryDark }]}>
              <View style={styles.brandRow}>
                <Ionicons name="school-outline" size={28} color="#FBBF24" />
                <Text style={styles.brandName}>FYIMP PORTAL</Text>
              </View>
              <Text style={styles.brandTitle}>Your campus.{'\n'}All in one place.</Text>
              <Text style={styles.brandDescription}>Keep up with classes, attendance and your academic progress.</Text>
            </View>
            <Card variant="outlined" style={styles.formCard}>
              <Text accessibilityRole="header" style={[typography.h1, { color: colors.textPrimary }]}>Welcome back</Text>
              <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg }]}>
                Sign in with your university account.
              </Text>
              {error ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.errorBanner, { backgroundColor: colors.dangerLight }]}>
                  <Text style={[typography.body, { color: colors.danger }]}>{error}</Text>
                </View>
              ) : null}
              <Input
                label="University email" placeholder="you@university.edu" value={email}
                onChangeText={(text) => { setEmail(text); setError(null); }}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                autoComplete="email" textContentType="username" returnKeyType="next"
                onSubmitEditing={() => passwordInput.current?.focus()} submitBehavior="submit"
                editable={!loading} leftIcon="mail-outline"
              />
              <Input
                ref={passwordInput} label="Password" placeholder="Enter your password" value={password}
                onChangeText={(text) => { setPassword(text); setError(null); }}
                isPassword autoCapitalize="none" autoCorrect={false}
                autoComplete="current-password" textContentType="password" returnKeyType="go"
                onSubmitEditing={handleLogin} editable={!loading} leftIcon="lock-closed-outline"
              />
              <Button title={loading ? 'Signing in…' : 'Sign in'} onPress={handleLogin} loading={loading} style={{ marginTop: spacing.sm }} />
            </Card>
            <View style={styles.help}>
              <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={[typography.bodySmall, styles.helpText, { color: colors.textSecondary }]}>
                Trouble signing in? Contact your campus administrative desk for account assistance.
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg }]}>
              Four-Year Integrated Multidisciplinary Program
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  brand: { borderRadius: 24, padding: 28, marginBottom: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandName: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, letterSpacing: 2, flexShrink: 1 },
  brandTitle: { color: '#FFFFFF', fontSize: 32, lineHeight: 40, fontWeight: '700', marginTop: 28 },
  brandDescription: { color: '#CBD5E1', fontSize: 15, lineHeight: 23, marginTop: 12 },
  formCard: { padding: 24, borderRadius: 24 },
  errorBanner: { padding: 14, borderRadius: 12, marginBottom: 20 },
  help: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20, paddingHorizontal: 8 },
  helpText: { flex: 1, lineHeight: 19 },
});
