import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/hooks/useAuth';
import { useSemester } from '../../src/hooks/useSemester';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { queryKeys } from '../../src/lib/query-client';
import { StudentDashboardSchema } from '../../src/api/schemas/student.schema';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Skeleton } from '../../src/components/common/Skeleton';
import { Badge } from '../../src/components/common/Badge';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function StudentHomeScreen() {
  const { user, profile } = useAuth();
  const { activeSemester } = useSemester();
  const { colors, typography, spacing } = useTheme();

  const userId = user?.id || '';

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.student.dashboard(userId, activeSemester, new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)),
    queryFn: () =>
      apiClient.get(
        `${API_ENDPOINTS.STUDENT_DASHBOARD}?semester=${activeSemester}`,
        { schema: StudentDashboardSchema }
      ),
    enabled: !!userId,
  });

  if (error && !data) return <ScreenContainer><ErrorView message={error.message} onRetry={refetch} /></ScreenContainer>;

  return (
    <ScreenContainer
      scrollable
      refreshing={isRefetching}
      onRefresh={refetch}
    >
      {/* Welcome Banner */}
      <View style={styles.welcomeSection}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          Hello, {profile?.full_name || 'Student'}
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Semester {activeSemester} • {profile?.department_name || 'Academic Dept'}
        </Text>
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Could not load dashboard data.'}
          onRetry={refetch}
        />
      ) : null}

      {/* Quick Attendance Summary Card */}
      <Card variant="elevated" style={styles.summaryCard}>
        <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 8 }]}>
          Attendance Overview
        </Text>
        {isLoading ? (
          <View>
            <Skeleton height={24} width="50%" />
            <Skeleton height={16} width="80%" style={{ marginTop: 8 }} />
          </View>
        ) : (
          <View style={styles.attendanceRow}>
            <View>
              <Text
                style={[
                  typography.h1,
                  {
                    color:
                      (data?.attendanceSummary?.overallPercentage ?? 0) >= 75
                        ? colors.success
                        : colors.danger,
                  },
                ]}
              >
                {data?.attendanceSummary?.overallPercentage == null ? '—' : `${data.attendanceSummary.overallPercentage}%`}
              </Text>
              <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
                {data?.attendanceSummary?.totalClasses ? 'Overall Attendance' : 'No marked classes yet'}
              </Text>
            </View>

            <View style={styles.badgeGroup}>
              <Badge
                label={
                  data?.attendanceSummary?.campusSignInStatus?.morning === 'completed'
                    ? 'Morning In'
                    : data?.attendanceSummary?.campusSignInStatus?.morning === 'absent' ? 'Morning Missed' : 'Morning Pending'
                }
                variant={
                  data?.attendanceSummary?.campusSignInStatus?.morning === 'completed'
                    ? 'success'
                    : 'warning'
                }
              />
              <Badge
                label={
                  data?.attendanceSummary?.campusSignInStatus?.evening === 'completed'
                    ? 'Evening In'
                    : data?.attendanceSummary?.campusSignInStatus?.evening === 'absent' ? 'Evening Missed' : 'Evening Pending'
                }
                variant={
                  data?.attendanceSummary?.campusSignInStatus?.evening === 'completed'
                    ? 'success'
                    : 'neutral'
                }
                style={{ marginTop: 6 }}
              />
            </View>
          </View>
        )}
      </Card>

      {/* Today's Timetable Slots */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Today's Scheduled Periods
        </Text>
      </View>

      {isLoading ? (
        <View>
          <Skeleton height={64} style={{ marginVertical: 6 }} />
          <Skeleton height={64} style={{ marginVertical: 6 }} />
          <Skeleton height={64} style={{ marginVertical: 6 }} />
        </View>
      ) : data?.todaySlots && data.todaySlots.length > 0 ? (
        data.todaySlots.map((slot: any) => (
          <Card key={slot.id} variant="outlined" style={styles.slotCard}>
            <View style={styles.slotHeader}>
              <Text style={[typography.bodyMedium, { color: colors.primary, fontWeight: '700' }]}>
                {slot.start_time} - {slot.end_time}
              </Text>
              <Badge label={slot.course_code} variant="primary" />
            </View>
            <Text style={[typography.bodyLarge, { color: colors.textPrimary, marginTop: 4 }]}>
              {slot.course_title}
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              Room: {slot.room_number || 'TBA'} • Faculty: {slot.faculty_name || 'Assigned'}
            </Text>
          </Card>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No scheduled classes for today.
          </Text>
        </Card>
      )}

      {/* Latest Announcement */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Latest Announcement
        </Text>
      </View>

      {isLoading ? (
        <Skeleton height={80} />
      ) : data?.latestAnnouncement ? (
        <Card variant="outlined" style={styles.announcementCard}>
          <Text style={[typography.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
            {data.latestAnnouncement.title}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 6 }]}>
            {data.latestAnnouncement.content}
          </Text>
        </Card>
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No new announcements today.
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
  attendanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  badgeGroup: {
    alignItems: 'flex-end',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  slotCard: {
    marginVertical: 4,
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  announcementCard: {
    marginBottom: 24,
  },
  emptyCard: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
