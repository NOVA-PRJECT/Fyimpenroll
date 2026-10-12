import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  ViewStyle,
  RefreshControl,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';

interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
}

export const ScreenContainer: React.FC<ScreenContainerProps> = ({
  children,
  scrollable = false,
  style,
  contentContainerStyle,
  refreshing = false,
  onRefresh,
  edges = ['top', 'left', 'right'],
}) => {
  const { colors, layout, spacing, typography } = useTheme();
  const { isOnline, pendingActions } = useOfflineQueue();

  const hasPending =
    !!pendingActions.CAMPUS_SIGN_IN || !!pendingActions.PERIOD_MARKING;

  const offlineBanner = !isOnline || hasPending ? (
    <View
      style={[
        styles.offlineBanner,
        {
          backgroundColor: !isOnline ? colors.danger : colors.warning,
        },
      ]}
    >
      <Text style={[typography.caption, { color: '#FFFFFF', textAlign: 'center' }]}>
        {!isOnline
          ? 'You are offline. Campus sign-in requires a connection. Saved class attendance will sync when reconnected.'
          : 'Pending actions queued for sync...'}
      </Text>
    </View>
  ) : null;

  if (scrollable) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.container, { backgroundColor: colors.background }, style]}
      >
        {offlineBanner}
        <ScrollView
          contentContainerStyle={[
            {
              padding: layout.screenPadding,
              paddingBottom: spacing.xxl,
            },
            contentContainerStyle,
          ]}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.container,
        { backgroundColor: colors.background, padding: layout.screenPadding },
        style,
      ]}
    >
      {offlineBanner}
      {children}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlineBanner: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 6,
  },
});
