import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/hooks/useAuth';
import { useSemester } from '../../src/hooks/useSemester';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { queryKeys } from '../../src/lib/query-client';
import { StudentDashboardSchema, type StudentDashboard } from '../../src/api/schemas/student.schema';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Skeleton } from '../../src/components/common/Skeleton';
import { Badge } from '../../src/components/common/Badge';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function StudentHomeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { activeSemester } = useSemester();
  const { colors, typography } = useTheme();

  const userId = user?.id || '';

  const { data, isLoading, error, refetch, isRefetching } = useQuery<StudentDashboard>({
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
        <Text style={[typography.caption, { color: colors.textSecondary, letterSpacing: 1.5, marginBottom: 8 }]}>YOUR CAMPUS AT A GLANCE</Text>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          Hello, {profile?.full_name || 'Student'}
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Semester {activeSemester} • {profile?.department_name || 'Academic Dept'}
        </Text>
      </View>

      <View style={styles.quickActions}>
        {([
          { label: 'Campus sign-in', hint: 'Verify your presence', icon: 'location-outline', path: '/(student)/attendance' },
          { label: 'My courses', hint: 'View your subjects', icon: 'book-outline', path: '/(student)/courses' },
        ] as const).map((action) => (
          <TouchableOpacity key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
            onPress={() => router.push(action.path)} activeOpacity={0.7}
            style={[styles.quickAction, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name={action.icon} size={24} color={colors.primary} />
            <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginTop: 12 }]}>{action.label}</Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4 }]}>{action.hint}</Text>
          </TouchableOpacity>
        ))}
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
          <View>
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
                      : data?.attendanceSummary?.campusSignInStatus?.morning === 'absent' ? 'danger' : 'warning'
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
                      : data?.attendanceSummary?.campusSignInStatus?.evening === 'absent' ? 'danger' : 'neutral'
                  }
                  style={{ marginTop: 6 }}
                />
              </View>
            </View>
            {data?.attendanceSummary.overallPercentage != null ? (
              <>
                <View accessibilityRole="progressbar" accessibilityLabel="Overall attendance"
                  accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(100, data.attendanceSummary.overallPercentage)) }}
                  style={[styles.progressTrack, { backgroundColor: colors.borderLight }]}>
                  <View style={{ height: '100%', borderRadius: 4, width: `${Math.max(0, Math.min(100, data.attendanceSummary.overallPercentage))}%`,
                    backgroundColor: data.attendanceSummary.overallPercentage >= 75 ? colors.success : colors.danger }} />
                </View>
                <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 8 }]}>
                  {data.attendanceSummary.totalPresent} of {data.attendanceSummary.totalClasses} classes attended · 75% target
                </Text>
              </>
            ) : null}
          </View>
        )}
      </Card>

      {/* Today's Timetable Slots */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Today's classes
        </Text>
      </View>

      {isLoading ? (
        <View>
          <Skeleton height={64} style={{ marginVertical: 6 }} />
          <Skeleton height={64} style={{ marginVertical: 6 }} />
          <Skeleton height={64} style={{ marginVertical: 6 }} />
        </View>
      ) : data?.todaySlots && data.todaySlots.length > 0 ? (
        data.todaySlots.map((slot) => (
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
          <Ionicons name="calendar-clear-outline" size={28} color={colors.textMuted} style={{ marginBottom: 12 }} />
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
          <Ionicons name="notifications-outline" size={28} color={colors.textMuted} style={{ marginBottom: 12 }} />
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No new announcements today.
          </Text>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  quickAction: { flex: 1, minWidth: 130, padding: 16, borderWidth: 1, borderRadius: 18 },
  progressTrack: { height: 8, borderRadius: 4, marginTop: 20, overflow: 'hidden' },
  welcomeSection: {
    marginBottom: 16,
  },
  summaryCard: {
    marginBottom: 20,
  },
  attendanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
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
    flexWrap: 'wrap',
    gap: 8,
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
