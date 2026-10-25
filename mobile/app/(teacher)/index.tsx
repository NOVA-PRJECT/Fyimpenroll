import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { TeacherScheduleSchema } from '../../src/api/schemas/portal.schema';
import { queryKeys } from '../../src/lib/query-client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Badge } from '../../src/components/common/Badge';
import { Button } from '../../src/components/common/Button';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function TeacherHomeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors, typography } = useTheme();

  const teacherId = user?.id || '';
  const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];

  const { data: periods, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.teacher.scheduledPeriods(teacherId, todayStr),
    queryFn: async () => (await apiClient.get(
      `${API_ENDPOINTS.FACULTY_SCHEDULED_PERIODS}?date=${todayStr}`, { schema: TeacherScheduleSchema }
    )).periods,
    enabled: !!teacherId,
  });

  if (error && !periods) return <ScreenContainer><ErrorView message={error.message} onRetry={refetch} /></ScreenContainer>;

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      <View style={styles.welcomeSection}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          Welcome, Prof. {profile?.full_name || 'Faculty Member'}
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {profile?.department_name || 'Department'} • {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        </Text>
      </View>

      {/* Quick Summary Card */}
      <Card variant="elevated" style={styles.summaryCard}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Teaching Schedule
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: 4 }]}>
          You have {periods?.length ?? 0} scheduled lectures today.
        </Text>

        <Button
          title="Mark Current Period Attendance"
          onPress={() => router.push('/(teacher)/mark')}
          style={{ marginTop: 12 }}
        />
      </Card>

      {/* Scheduled Periods List */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Today's Scheduled Periods
        </Text>
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load scheduled periods.'}
          onRetry={refetch}
        />
      ) : null}

      {isLoading ? (
        <View>
          <Skeleton height={75} style={{ marginVertical: 6 }} />
          <Skeleton height={75} style={{ marginVertical: 6 }} />
          <Skeleton height={75} style={{ marginVertical: 6 }} />
        </View>
      ) : periods && periods.length > 0 ? (
        periods.map((period: any) => (
          <Card key={period.timetable_slot_id} variant="outlined" style={styles.periodCard}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.timeBadgeRow}>
                  <Text style={[typography.bodyMedium, { color: colors.primary, fontWeight: '700' }]}>
                    {period.start_time} - {period.end_time}
                  </Text>
                  <Badge label={`Period ${period.period_number}`} variant="primary" style={{ marginLeft: 8 }} />
                </View>

                <Text style={[typography.h3, { color: colors.textPrimary, marginTop: 4 }]}>
                  {period.course_title}
                </Text>

                <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                  Course: {period.course_code} • Room: {period.room_number || 'Room TBA'}
                </Text>
              </View>

              <Badge
                label={period.is_marked ? 'Marked' : 'Pending'}
                variant={period.is_marked ? 'success' : 'warning'}
              />
            </View>
          </Card>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No teaching slots scheduled for today.
          </Text>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  welcomeSection: {
    marginBottom: 16,
  },
  summaryCard: {
    marginBottom: 20,
  },
  sectionHeader: {
    marginBottom: 8,
    marginTop: 8,
  },
  periodCard: {
    marginVertical: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
});
