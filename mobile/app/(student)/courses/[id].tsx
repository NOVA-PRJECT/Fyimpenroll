import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../src/hooks/useAuth';
import { useSemester } from '../../../src/hooks/useSemester';
import { CourseSchema, type Course } from '../../../src/api/schemas/student.schema';
import { useTheme } from '../../../src/hooks/useTheme';
import { apiClient } from '../../../src/api/client';
import { API_ENDPOINTS } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/lib/query-client';
import { ScreenContainer } from '../../../src/components/layout/ScreenContainer';
import { Card } from '../../../src/components/common/Card';
import { Badge } from '../../../src/components/common/Badge';
import { Skeleton } from '../../../src/components/common/Skeleton';
import { ErrorView } from '../../../src/components/common/ErrorView';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { activeSemester } = useSemester();
  const { colors, typography, spacing } = useTheme();

  const userId = user?.id || '';

  const { data: course, isLoading, error, refetch, isRefetching } = useQuery<Course>({
    queryKey: queryKeys.student.courseDetail(userId, id || '', activeSemester),
    queryFn: () => apiClient.get(`${API_ENDPOINTS.STUDENT_COURSES}/${id}?semester=${activeSemester}`, { schema: CourseSchema }),
    enabled: !!userId && !!id,
  });

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load course details.'}
          onRetry={refetch}
        />
      ) : null}

      {isLoading ? (
        <View>
          <Skeleton height={120} />
          <Skeleton height={200} style={{ marginTop: 16 }} />
        </View>
      ) : course ? (
        <>
          <Card variant="elevated" style={styles.summaryCard}>
            <Badge label={course.category || 'Core'} variant="primary" />
            <Text
              style={[
                typography.h1,
                { color: colors.textPrimary, marginTop: spacing.sm },
              ]}
            >
              {course.title}
            </Text>
            <Text style={[typography.body, { color: colors.primary, fontWeight: '700', marginTop: 4 }]}>
              {course.code} • {course.credits} Credits
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 4 }]}>
              Instructor: {course.faculty_name || 'Assigned Faculty'}
            </Text>
          </Card>

          <Card variant="outlined" style={styles.sectionCard}>
            <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 8 }]}>
              Course Description & Syllabus
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary, lineHeight: 22 }]}>
              {course.description ||
                'No course description has been published.'}
            </Text>
          </Card>

          <Card variant="outlined" style={styles.sectionCard}>
            <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 8 }]}>
              Prerequisites & Requirements
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {course.prerequisite_points.length ? course.prerequisite_points.map((point, index) => `${index + 1}. ${point}`).join('\n') : course.prerequisites || 'None specified.'}
            </Text>
          </Card>
        </>
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Course information not found.
          </Text>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    marginBottom: 16,
  },
  sectionCard: {
    marginBottom: 12,
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
});
