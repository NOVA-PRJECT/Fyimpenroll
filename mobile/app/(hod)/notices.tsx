import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Modal } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { NoticesSchema } from '../../src/api/schemas/portal.schema';
import { queryClient, queryKeys } from '../../src/lib/query-client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { Input } from '../../src/components/common/Input';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

export default function HodNoticesScreen() {
  const { profile } = useAuth();
  const { colors, typography, spacing } = useTheme();

  const deptId = profile?.department_id || '';

  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  // 1. Fetch notices
  const { data: notices, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.hod.notices(deptId),
    queryFn: () => apiClient.get(`${API_ENDPOINTS.NOTICES}?department_id=${deptId}`, { schema: NoticesSchema }),
    enabled: !!deptId,
  });

  // 2. Post notice mutation
  const postMutation = useMutation({
    mutationFn: () =>
      apiClient.post(API_ENDPOINTS.HOD_ANNOUNCEMENTS, {
        department_id: deptId,
        title: title.trim(),
        content: content.trim(),
      }),
    onSuccess: () => {
      setTitle('');
      setContent('');
      setModalVisible(false);
      Alert.alert('Published', 'Department announcement published successfully.');
      queryClient.invalidateQueries({
        queryKey: queryKeys.hod.notices(deptId),
      });
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message || 'Failed to publish announcement.');
    },
  });

  const handlePublish = () => {
    if (!title.trim() || !content.trim()) {
      Alert.alert('Validation Error', 'Both title and content are required.');
      return;
    }
    postMutation.mutate();
  };

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={refetch}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.h2, { color: colors.textPrimary }]}>
            Department Notices
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Publish and manage student circulars.
          </Text>
        </View>

        <Button
          title="New Notice"
          onPress={() => setModalVisible(true)}
          style={{ alignSelf: 'center' }}
        />
      </View>

      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load notices.'}
          onRetry={refetch}
        />
      ) : null}

      {isLoading ? (
        <View style={{ marginTop: 12 }}>
          <Skeleton height={80} style={{ marginVertical: 6 }} />
          <Skeleton height={80} style={{ marginVertical: 6 }} />
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
              Published {notice.created_at ? new Date(notice.created_at).toLocaleDateString() : 'Today'}
            </Text>
          </Card>
        ))
      ) : (
        <Card variant="flat" style={styles.emptyCard}>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No announcements currently active for your department.
          </Text>
        </Card>
      )}

      {/* New Notice Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: 16 }]}>
              Create Department Notice
            </Text>

            <Input
              label="Title"
              placeholder="e.g. Mid-term Assessment Guidelines"
              value={title}
              onChangeText={setTitle}
            />

            <Input
              label="Notice Body"
              placeholder="Write circular details here..."
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={4}
              style={{ minHeight: 80 }}
            />

            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                onPress={() => setModalVisible(false)}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                title="Publish"
                onPress={handlePublish}
                loading={postMutation.isPending}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  noticeCard: {
    marginVertical: 6,
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
    marginTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
});
