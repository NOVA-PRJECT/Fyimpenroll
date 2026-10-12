import React, { useState } from 'react';
import { campusSessionLabel, formatCampusTime, type CampusAttendanceStatus } from '@fyimp/contracts';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useSemester } from '../../src/hooks/useSemester';
import { useTheme } from '../../src/hooks/useTheme';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { queryClient, queryKeys } from '../../src/lib/query-client';
import { CampusSignInStatusSchema, StudentAttendanceListSchema } from '../../src/api/schemas/attendance.schema';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { Badge } from '../../src/components/common/Badge';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function StudentAttendanceScreen() {
  const { user } = useAuth();
  const { activeSemester } = useSemester();
  const { colors, typography } = useTheme();
  const { isOnline } = useOfflineQueue();

  const userId = user?.id || '';
  const todayStr = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];

  const [locating, setLocating] = useState(false);

  // 1. Fetch campus verification status for today
  const {
    data: campusStatus,
    isLoading: loadingStatus,
    error: statusError,
    refetch: refetchStatus,
    isRefetching: refetchingStatus,
  } = useQuery<CampusAttendanceStatus>({
    queryKey: queryKeys.student.campusStatus(userId, todayStr),
    queryFn: () =>
      apiClient.get<CampusAttendanceStatus>(`${API_ENDPOINTS.CAMPUS_STATUS}/${userId}`, { schema: CampusSignInStatusSchema }),
    refetchInterval: 30000,
    enabled: !!userId,
  });

  // 2. Fetch student's course-level attendance list
  const {
    data: courseAttendanceData,
    isLoading: loadingCourses,
    error: courseError,
    refetch: refetchCourses,
    isRefetching: refetchingCourses,
  } = useQuery({
    queryKey: queryKeys.student.attendanceList(userId, activeSemester),
    queryFn: () =>
      apiClient.get(
        `${API_ENDPOINTS.STUDENT_ATTENDANCE}?semester=${activeSemester}`,
        { schema: StudentAttendanceListSchema }
      ),
    enabled: !!userId,
  });

  const refetchAll = () => {
    refetchStatus();
    refetchCourses();
  };

  // 3. Campus Sign-in Mutation
  const signInMutation = useMutation({
    mutationFn: async () => {
      if (!isOnline) throw new Error('Connect to the internet before signing in. Campus sign-in cannot be saved offline.');
      setLocating(true);
      const latest = await refetchStatus();
      if (latest.error || !latest.data?.can_sign_in) throw new Error(latest.data?.unavailable_reason || 'Unable to verify campus status. Try again.');

      // Step 1: Request foreground location permission
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setLocating(false);
        throw new Error(
          'Location access is required to verify that you are physically on campus.'
        );
      }

      // Step 2: Get high accuracy position
      let locationTimer: ReturnType<typeof setTimeout> | undefined;
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<never>((_, reject) => {
          locationTimer = setTimeout(() => reject(new Error('Getting your location timed out. Move to an open area and try again.')), 15000);
        }),
      ]).finally(() => clearTimeout(locationTimer));

      // Step 3: Check client-side accuracy (50m or better required)
      if (position.mocked) throw new Error('Mock locations cannot be used for campus sign-in.');
      const accuracy = position.coords.accuracy;
      if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50) {
        setLocating(false);
        throw new Error(
          'Location accuracy is unavailable or worse than 50 metres. Move to an open area and try again.'
        );
      }

      const payload = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: accuracy,
        client_timestamp: new Date(position.timestamp).toISOString(),
        mocked: false,
      };

      const res = await apiClient.post(API_ENDPOINTS.CAMPUS_SIGN_IN, payload, { expectedUserId: userId });
      setLocating(false);
      return res;
    },
    onSuccess: (res: any) => {
      Alert.alert('Campus Sign-In Recorded', res?.message || 'Your campus sign-in was recorded.');
      queryClient.invalidateQueries({
        queryKey: queryKeys.student.campusStatus(userId, todayStr),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.student.dashboard(userId),
      });
    },
    onError: (err: any) => {
      setLocating(false);
      Alert.alert('Sign-In Check Failed', err?.message || 'Unable to record campus attendance.');
      void refetchStatus();
    },
  });

  const buttonTitle = !isOnline ? 'Connect to the internet to sign in'
    : loadingStatus ? 'Loading campus status…'
    : campusStatus?.can_sign_in ? campusStatus.active_session === 'morning' ? 'Sign In (Morning Arrival)' : 'Sign In (Evening Departure)'
    : campusStatus?.unavailable_reason || 'Campus sign-in unavailable';
  const buttonDisabled = !isOnline || !!statusError || !campusStatus?.can_sign_in;

  return (
    <ScreenContainer
      scrollable
      refreshing={refetchingStatus || refetchingCourses}
      onRefresh={refetchAll}
    >
      {/* Campus Sign-In Action Card */}
      <Card variant="elevated" style={styles.actionCard}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              Campus Attendance Checkpoint
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              {campusStatus?.campus?.name || 'University Campus'}{campusStatus ? ` • ${campusStatus.campus.radius_meters}m GPS Geofence` : ''}
            </Text>
          </View>
          <View style={styles.gpsBadge}>
            <Ionicons name="navigate" size={14} color={colors.primary} />
            <Text style={[typography.caption, { color: colors.primary, fontWeight: '700', marginLeft: 4 }]}>
              GPS
            </Text>
          </View>
        </View>

        <Text style={[typography.body, { color: colors.textSecondary, marginVertical: 12, lineHeight: 20 }]}>
          Verify your physical presence on campus. Raw GPS coordinates are evaluated in memory and are{' '}
          <Text style={{ fontWeight: '700', color: colors.textPrimary }}>not saved</Text>. The time, result, location accuracy and audit details are retained. Sign-in requires an internet connection.
        </Text>

        {statusError && <ErrorView message={statusError instanceof Error ? statusError.message : 'Unable to load campus status.'} onRetry={refetchStatus} />}
        {/* Action Button */}
        <Button
          title={locating ? 'Acquiring GPS Signal...' : buttonTitle}
          onPress={() => signInMutation.mutate()}
          loading={signInMutation.isPending || locating}
          disabled={buttonDisabled || signInMutation.isPending || locating}
          variant="primary"
          style={{ marginBottom: 12 }}
        />

        {/* Checkpoint Status Readout Grid */}
        <View style={styles.statusReadoutGrid}>
          {/* Morning Checkpoint */}
          <View style={[styles.statusBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[typography.caption, { color: colors.textSecondary, fontWeight: '700' }]}>
              MORNING ARRIVAL
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary, fontSize: 10, marginTop: 1 }]}>
              Cutoff: {campusStatus ? formatCampusTime(campusStatus.campus.morning_cutoff) + ' IST' : '—'}
            </Text>
            <View style={{ marginTop: 6 }}>
              {campusStatus?.morning.state === 'completed' ? (
                <Badge
                  label={campusSessionLabel(campusStatus.morning).toUpperCase()}
                  variant={campusStatus.morning.status === 'on_time' ? 'success' : 'warning'}
                />
              ) : campusStatus?.morning.state === 'pending' ? (
                <Badge label="PENDING" variant="neutral" />
              ) : (
                <Badge label={loadingStatus ? "LOADING" : statusError || !campusStatus ? "UNAVAILABLE" : "ABSENT"} variant="neutral" />
              )}
            </View>
            {campusStatus?.morning.signed_in_at && (
              <Text style={[typography.caption, { color: colors.textSecondary, fontSize: 10, marginTop: 4 }]}>
                {new Date(campusStatus.morning.signed_in_at).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>

          {/* Evening Checkpoint */}
          <View style={[styles.statusBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[typography.caption, { color: colors.textSecondary, fontWeight: '700' }]}>
              EVENING CHECKPOINT
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary, fontSize: 10, marginTop: 1 }]}>
              Cutoff: {campusStatus ? formatCampusTime(campusStatus.campus.evening_cutoff) + ' IST' : '—'}
            </Text>
            <View style={{ marginTop: 6 }}>
              {campusStatus?.evening.state === 'completed' ? (
                <Badge
                  label={campusSessionLabel(campusStatus.evening).toUpperCase()}
                  variant={campusStatus.evening.status === 'on_time' ? 'success' : 'warning'}
                />
              ) : campusStatus?.evening.state === 'pending' ? (
                <Badge label="PENDING" variant="neutral" />
              ) : (
                <Badge label={loadingStatus ? "LOADING" : statusError || !campusStatus ? "UNAVAILABLE" : "ABSENT"} variant="neutral" />
              )}
            </View>
            {campusStatus?.evening.signed_in_at && (
              <Text style={[typography.caption, { color: colors.textSecondary, fontSize: 10, marginTop: 4 }]}>
                {new Date(campusStatus.evening.signed_in_at).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
        </View>
      </Card>

      {/* Course Attendance Header */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Course Attendance (Semester {activeSemester})
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          Period-wise in-class lecture attendance
        </Text>
      </View>

      {courseError ? (
        <ErrorView
          message={courseError instanceof Error ? courseError.message : 'Failed to load course attendance.'}
          onRetry={refetchCourses}
        />
      ) : null}

      {loadingCourses ? (
        <View style={{ gap: 8 }}>
          <Skeleton height={75} />
          <Skeleton height={75} />
          <Skeleton height={75} />
        </View>
      ) : courseAttendanceData?.courses && courseAttendanceData.courses.length > 0 ? (
        courseAttendanceData.courses.map((course: any) => {
          const isAdequate = course.percentage >= 75;
          return (
            <Card key={course.course_id} variant="outlined" style={styles.courseCard}>
              <View style={styles.courseRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyMedium, { color: colors.primary, fontWeight: '700' }]}>
                    {course.course_code}
                  </Text>
                  <Text style={[typography.bodyLarge, { color: colors.textPrimary, marginTop: 2 }]}>
                    {course.course_title}
                  </Text>
                  <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4 }]}>
                    {course.attended_classes} of {course.total_classes} classes attended
                  </Text>
                </View>

                <View style={styles.percentageContainer}>
                  <Text
                    style={[
                      typography.h2,
                      { color: isAdequate ? colors.success : colors.danger },
                    ]}
                  >
                    {course.percentage}%
                  </Text>
                  <Badge
                    label={isAdequate ? 'Eligible' : 'Low Attendance'}
                    variant={isAdequate ? 'success' : 'danger'}
                    style={{ marginTop: 4 }}
                  />
                </View>
              </View>
            </Card>
          );
        })
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No course attendance records found for this semester.
          </Text>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e6f0fa',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusReadoutGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  statusBox: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  courseCard: {
    marginVertical: 4,
    padding: 14,
  },
  courseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  percentageContainer: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
  },
});
