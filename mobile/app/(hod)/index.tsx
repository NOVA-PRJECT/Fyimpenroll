import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { queryKeys } from '../../src/lib/query-client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Badge } from '../../src/components/common/Badge';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function HodHomeScreen() {
  const { profile } = useAuth();
  const { colors, typography, spacing } = useTheme();

  const deptId = profile?.department_id || '';
  const todayStr = new Date().toISOString().split('T')[0];

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.hod.absenceSummary(deptId, todayStr),
    queryFn: () =>
      apiClient.get(`${API_ENDPOINTS.HOD_ABSENCE_SUMMARY}?date=${todayStr}`),
    enabled: !!deptId,
  });

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      <View style={styles.header}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          {profile?.department_name || 'Department'} Dashboard
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Daily Attendance & Department Absence Tracking ({todayStr})
        </Text>
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load department metrics.'}
          onRetry={refetch}
        />
      ) : null}

      {/* Metric Cards Row */}
      <View style={styles.metricsGrid}>
        <Card variant="elevated" style={styles.metricCard}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            TOTAL ENROLLED
          </Text>
          {isLoading ? (
            <Skeleton height={28} width="60%" style={{ marginTop: 6 }} />
          ) : (
            <Text style={[typography.h1, { color: colors.primary, marginTop: 4 }]}>
              {data?.totalStudents ?? 0}
            </Text>
          )}
        </Card>

        <Card variant="elevated" style={styles.metricCard}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            ABSENT TODAY
          </Text>
          {isLoading ? (
            <Skeleton height={28} width="60%" style={{ marginTop: 6 }} />
          ) : (
            <Text style={[typography.h1, { color: colors.danger, marginTop: 4 }]}>
              {data?.absentCount ?? 0}
            </Text>
          )}
        </Card>
      </View>

      <Card variant="outlined" style={styles.rateCard}>
        <View style={styles.rateRow}>
          <View>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              Department Attendance Rate
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              Combined morning & evening verified presence
            </Text>
          </View>
          {isLoading ? (
            <Skeleton height={32} width={50} />
          ) : (
            <Text
              style={[
                typography.h1,
                {
                  color:
                    (data?.attendanceRate ?? 100) >= 80
                      ? colors.success
                      : colors.warning,
                  fontWeight: '800',
                },
              ]}
            >
              {data?.attendanceRate ?? 100}%
            </Text>
          )}
        </View>
      </Card>

      {/* Critical Absence Flags */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Critical Attendance Alerts ({'<'}75%)
        </Text>
      </View>

      {isLoading ? (
        <View>
          <Skeleton height={60} style={{ marginVertical: 4 }} />
          <Skeleton height={60} style={{ marginVertical: 4 }} />
        </View>
      ) : data?.flaggedStudents && data.flaggedStudents.length > 0 ? (
        data.flaggedStudents.map((student: any) => (
          <Card key={student.id} variant="outlined" style={styles.flagCard}>
            <View style={styles.flagRow}>
              <View>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                  {student.full_name}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  Roll: {student.roll_number || 'N/A'} • Sem {student.current_semester}
                </Text>
              </View>
              <Badge label={`${student.attendance_percentage}%`} variant="danger" />
            </View>
          </Card>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No students currently below the critical 75% attendance threshold.
          </Text>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  metricCard: {
    flex: 1,
    padding: 16,
  },
  rateCard: {
    marginVertical: 8,
    padding: 16,
  },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeader: {
    marginTop: 16,
    marginBottom: 8,
  },
  flagCard: {
    marginVertical: 4,
  },
  flagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
  },
});
