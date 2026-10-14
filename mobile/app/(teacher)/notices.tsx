import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { NoticesSchema } from '../../src/api/schemas/portal.schema';
import { queryKeys } from '../../src/lib/query-client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function TeacherNoticesScreen() {
  const { profile } = useAuth();
  const { colors, typography, spacing } = useTheme();

  const deptId = profile?.department_id;

  const { data: notices, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.teacher.notices(deptId ?? undefined),
    queryFn: () => apiClient.get(API_ENDPOINTS.NOTICES, { schema: NoticesSchema }),
  });

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      <View style={styles.header}>
        <Text style={[typography.h2, { color: colors.textPrimary }]}>
          Department Announcements
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: 4 }]}>
          Official notices and circulars from department administration.
        </Text>
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load notices.'}
          onRetry={refetch}
        />
      ) : null}

      {isLoading ? (
        <View>
          <Skeleton height={90} style={{ marginVertical: 6 }} />
          <Skeleton height={90} style={{ marginVertical: 6 }} />
          <Skeleton height={90} style={{ marginVertical: 6 }} />
        </View>
      ) : notices && notices.length > 0 ? (
        notices.map((notice: any) => (
          <Card key={notice.id} variant="outlined" style={styles.noticeCard}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              {notice.title}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: 6, lineHeight: 22 }]}>
              {notice.content}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: 10 }]}>
              {notice.created_at
                ? new Date(notice.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Recent'}
            </Text>
          </Card>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No active department notices at this time.
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
  noticeCard: {
    marginVertical: 6,
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
});
