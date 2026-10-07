import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { queryClient } from '../src/lib/query-client';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { SemesterProvider } from '../src/context/SemesterContext';
import { OfflineQueueProvider } from '../src/context/OfflineQueueContext';
import { useTheme } from '../src/hooks/useTheme';

function NavigationGuard() {
  const { session, role, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { colors, isDark, typography } = useTheme();
  const [isTimedOut, setIsTimedOut] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session) {
      // User is not signed in; redirect to login if not already there
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // User is signed in
    if (inAuthGroup) {
      // If currently on login screen, redirect to the role-appropriate group
      if (role === 'student') {
        router.replace('/(student)');
      } else if (role === 'teaching_staff') {
        router.replace('/(teacher)');
      } else if (role === 'hod') {
        router.replace('/(hod)');
      } else if (role === 'campus_director' || role === 'superadmin') {
        router.replace('/(admin)/profile');
      }
      return;
    }

    // Enforce role isolation at navigation level
    const currentGroup = segments[0];
    if (role === 'student' && currentGroup !== '(student)') {
      router.replace('/(student)');
    } else if (role === 'teaching_staff' && currentGroup !== '(teacher)') {
      router.replace('/(teacher)');
    } else if (role === 'hod' && currentGroup !== '(hod)') {
      router.replace('/(hod)');
    } else if (
      (role === 'campus_director' || role === 'superadmin') &&
      currentGroup !== '(admin)'
    ) {
      router.replace('/(admin)/profile');
    }
  }, [session, role, isLoading, segments, router]);

  // Timeout: if loading hasn't resolved in 12s (offline at startup), show retry UI
  useEffect(() => {
    if (!isLoading) {
      setIsTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setIsTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (isLoading) {
    if (isTimedOut) {
      return (
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <Text style={[typography.h3, { color: colors.danger, marginBottom: 12 }]}>
            Unable to Connect
          </Text>
          <Text
            style={[
              typography.body,
              {
                color: colors.textSecondary,
                textAlign: 'center',
                marginBottom: 24,
                paddingHorizontal: 32,
              },
            ]}
          >
            Could not reach the server. Check your connection and try again.
          </Text>
          <TouchableOpacity
            onPress={() => setIsTimedOut(false)}
            style={[styles.retryButton, { borderColor: colors.primary }]}
          >
            <Text style={[typography.button, { color: colors.primary }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(student)" options={{ headerShown: false }} />
        <Stack.Screen name="(teacher)" options={{ headerShown: false }} />
        <Stack.Screen name="(hod)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SemesterProvider>
            <OfflineQueueProvider>
              <NavigationGuard />
            </OfflineQueueProvider>
          </SemesterProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
});
