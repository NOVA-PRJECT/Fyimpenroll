import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../src/hooks/useAuth';
import { useSemester } from '../../../src/hooks/useSemester';
import { useTheme } from '../../../src/hooks/useTheme';
import { apiClient } from '../../../src/api/client';
import { API_ENDPOINTS } from '../../../src/api/endpoints';
import { CourseSchema } from '../../../src/api/schemas/student.schema';
import { queryKeys } from '../../../src/lib/query-client';
import { ScreenContainer } from '../../../src/components/layout/ScreenContainer';
import { Card } from '../../../src/components/common/Card';
import { Badge } from '../../../src/components/common/Badge';
import { Skeleton } from '../../../src/components/common/Skeleton';
import { ErrorView } from '../../../src/components/common/ErrorView';

export default function CoursesListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { activeSemester } = useSemester();
  const { colors, typography } = useTheme();

  const userId = user?.id || '';

  const { data: courses, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.student.courses(userId, activeSemester),
    queryFn: () =>
      apiClient.get(
        `${API_ENDPOINTS.STUDENT_COURSES}?semester=${activeSemester}`, { schema: CourseSchema.array() }
      ),
    enabled: !!userId,
  });

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      <View style={styles.header}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          Semester {activeSemester} Registrations
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: 4 }]}>
          Select a course to view detailed syllabus, instructors, and weekly slot schedule.
        </Text>
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load courses.'}
          onRetry={refetch}
        />
      ) : null}

      {isLoading ? (
        <View>
          <Skeleton height={80} style={{ marginVertical: 6 }} />
          <Skeleton height={80} style={{ marginVertical: 6 }} />
          <Skeleton height={80} style={{ marginVertical: 6 }} />
        </View>
      ) : courses && courses.length > 0 ? (
        courses.map((course: any) => (
          <TouchableOpacity
            key={course.id}
            activeOpacity={0.7}
            onPress={() => router.push(`/(student)/courses/${course.id}` as any)}
          >
            <Card variant="outlined" style={styles.courseCard}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Badge label={course.category || 'Core'} variant="primary" />
                  <Text
                    style={[
                      typography.h3,
                      { color: colors.textPrimary, marginTop: 8 },
                    ]}
                  >
                    {course.title}
                  </Text>
                  <Text
                    style={[
                      typography.bodySmall,
                      { color: colors.textSecondary, marginTop: 2 },
                    ]}
                  >
                    Code: {course.code} • Faculty: {course.faculty_name || 'Assigned'}
                  </Text>
                </View>

                <View style={styles.creditsBadge}>
                  <Text
                    style={[
                      typography.h2,
                      { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    {course.credits}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    Credits
                  </Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No courses enrolled for Semester {activeSemester}.
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
  courseCard: {
    marginVertical: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  creditsBadge: {
    alignItems: 'center',
    marginLeft: 16,
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: '#E2E8F0',
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
});
