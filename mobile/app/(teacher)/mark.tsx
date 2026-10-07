import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import { apiClient } from '../../src/api/client';
import { API_ENDPOINTS } from '../../src/api/endpoints';
import { queryClient, queryKeys } from '../../src/lib/query-client';
import { ScreenContainer } from '../../src/components/layout/ScreenContainer';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { Badge } from '../../src/components/common/Badge';
import { Skeleton } from '../../src/components/common/Skeleton';
import { ErrorView } from '../../src/components/common/ErrorView';

interface StudentItem {
  id: string;
  full_name: string;
  cap_application_number: string | null;
  email: string;
}

interface ActiveSlot {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  period_number: number;
  start_time: string;
  end_time: string;
  session_type: string;
  roster: StudentItem[];
  existing_marks: Array<{ student_id: string; status: string }>;
  is_marked: boolean;
  is_unlocked: boolean;
}

interface CurrentPeriodResponse {
  active_slots: ActiveSlot[];
  next_slot?: {
    id: string;
    course_code: string;
    course_title: string;
    period_number: number;
    start_time: string;
    end_time: string;
  } | null;
  grace_window_minutes?: number;
  message?: string;
}

export default function PeriodMarkingScreen() {
  const { user } = useAuth();
  const { colors, typography, spacing } = useTheme();
  const { isOnline, enqueueAction } = useOfflineQueue();

  const teacherId = user?.id || '';

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [absentStudentIds, setAbsentStudentIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Fetch current active period (or grace window periods)
  const {
    data: periodData,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery<CurrentPeriodResponse>({
    queryKey: queryKeys.teacher.currentPeriod(teacherId),
    queryFn: () => apiClient.get<CurrentPeriodResponse>(API_ENDPOINTS.PERIOD_ATTENDANCE_CURRENT),
    enabled: !!teacherId,
    refetchInterval: 30000, // Re-check active period every 30s
  });

  const activeSlots = periodData?.active_slots || [];
  const nextSlot = periodData?.next_slot;
  const graceWindow = periodData?.grace_window_minutes ?? 15;

  // Auto-select first active slot if none selected or selected is no longer active
  useEffect(() => {
    if (activeSlots.length > 0) {
      if (!selectedSlotId || !activeSlots.some((s: ActiveSlot) => s.id === selectedSlotId)) {
        setSelectedSlotId(activeSlots[0].id);
      }
    } else {
      setSelectedSlotId(null);
    }
  }, [activeSlots, selectedSlotId]);

  // Active selected slot
  const currentSlot = activeSlots.find((s: ActiveSlot) => s.id === selectedSlotId) || activeSlots[0] || null;

  // Initialize existing marks (if attendance was previously submitted)
  useEffect(() => {
    if (currentSlot?.existing_marks && currentSlot.existing_marks.length > 0) {
      const initialAbsents: Record<string, boolean> = {};
      for (const m of currentSlot.existing_marks) {
        if (m.status === 'absent') {
          initialAbsents[m.student_id] = true;
        }
      }
      setAbsentStudentIds(initialAbsents);
    } else {
      setAbsentStudentIds({});
    }
  }, [currentSlot?.id]);

  // Toggle absent state (Default is PRESENT; tapping flags ABSENT)
  const toggleAbsent = (studentId: string) => {
    setAbsentStudentIds((prev) => ({
      ...prev,
      [studentId]: !prev[studentId],
    }));
  };

  const markAllPresent = () => {
    setAbsentStudentIds({});
  };

  // Filter roster by search term
  const roster = currentSlot?.roster || [];
  const filteredRoster = useMemo(() => {
    if (!searchQuery.trim()) return roster;
    const q = searchQuery.toLowerCase();
    return roster.filter(
      (st: StudentItem) =>
        st.full_name.toLowerCase().includes(q) ||
        (st.cap_application_number && st.cap_application_number.toLowerCase().includes(q))
    );
  }, [roster, searchQuery]);

  // Absent & Present counts
  const absentCount = Object.values(absentStudentIds).filter(Boolean).length;
  const presentCount = Math.max(0, roster.length - absentCount);

  // 2. Submission Mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!currentSlot) throw new Error('No active lecture selected');

      const absentList = Object.entries(absentStudentIds)
        .filter(([_, isAbsent]) => isAbsent)
        .map(([id]) => id);

      const payload = {
        timetable_slot_id: currentSlot.id,
        absent_student_ids: absentList,
        client_timestamp: new Date().toISOString(),
      };

      if (!isOnline) {
        await enqueueAction(
          'PERIOD_MARKING',
          API_ENDPOINTS.PERIOD_ATTENDANCE_SUBMIT,
          payload
        );
        return { queued: true, absentCount: absentList.length, presentCount: roster.length - absentList.length };
      }

      const res = await apiClient.post(API_ENDPOINTS.PERIOD_ATTENDANCE_SUBMIT, payload);
      return { ...res, queued: false, absentCount: absentList.length, presentCount: roster.length - absentList.length };
    },
    onSuccess: (res: any) => {
      if (res?.queued) {
        Alert.alert(
          'Saved Offline',
          `Attendance recorded offline (${res.presentCount} present, ${res.absentCount} absent). It will automatically sync when network connects.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Attendance Recorded',
          `Successfully marked ${currentSlot?.course_code}!\n\n✓ Present: ${res.presentCount}\n✗ Absent: ${res.absentCount}`,
          [{ text: 'Done' }]
        );
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.teacher.currentPeriod(teacherId),
      });
    },
    onError: (err: any) => {
      const msg = err?.message || 'Failed to submit attendance.';
      if (msg.toLowerCase().includes('15') || msg.toLowerCase().includes('grace') || msg.toLowerCase().includes('unlock')) {
        Alert.alert(
          'Period Locked (15-Min Grace Expired)',
          'The 15-minute submission window for this period has elapsed. Please request your department HOD to authorize a late-entry unlock.',
          [{ text: 'Understood' }]
        );
      } else {
        Alert.alert('Submission Error', msg);
      }
    },
  });

  return (
    <ScreenContainer
      scrollable
      refreshing={isRefetching}
      onRefresh={refetch}
    >
      {/* Top Header Card */}
      <Card variant="elevated" style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>
              Period Attendance
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              15-Min Grace Window • Exception Marking (Default Present)
            </Text>
          </View>
          {!isOnline && (
            <Badge label="Offline Mode" variant="warning" />
          )}
        </View>

        {/* Multiple Active Slots Switcher (Back-to-back or parallel classes) */}
        {activeSlots.length > 1 && (
          <View
            style={[
              styles.slotPickerRow,
              { borderTopColor: colors.borderLight },
            ]}
          >
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: 6 }]}>
              Select Class:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.slotPillContainer}>
                {activeSlots.map((slot: ActiveSlot) => {
                  const isSelected = slot.id === currentSlot?.id;
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      onPress={() => setSelectedSlotId(slot.id)}
                      style={[
                        styles.slotPill,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.bodySmall,
                          {
                            color: isSelected ? '#FFFFFF' : colors.textPrimary,
                            fontWeight: '600',
                          },
                        ]}
                      >
                        P{slot.period_number}: {slot.course_code}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </Card>

      {/* Loading Skeleton */}
      {isLoading && (
        <View style={{ gap: 12, marginTop: 12 }}>
          <Skeleton height={100} />
          <Skeleton height={60} />
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      )}

      {/* Error View */}
      {error && !isLoading && (
        <ErrorView
          message="Unable to fetch current class schedule. Please check your network or try again."
          onRetry={refetch}
        />
      )}

      {/* NO ACTIVE CLASS EMPTY STATE */}
      {!isLoading && !error && activeSlots.length === 0 && (
        <Card variant="flat" style={styles.emptyStateCard}>
          <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.primaryLight + '30' },
              ]}
            >
              <Ionicons name="time-outline" size={36} color={colors.primary} />
            </View>
          <Text style={[typography.h3, { color: colors.textPrimary, marginTop: 12 }]}>
            No Active Lecture Right Now
          </Text>
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },
            ]}
          >
            Attendance marking opens automatically at class start time and remains available for a{' '}
            <Text style={{ fontWeight: '700', color: colors.primary }}>15-minute</Text> post-period
            grace window.
          </Text>

          {nextSlot && (
            <View
              style={[
                styles.nextSlotBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[typography.caption, { color: colors.primary, fontWeight: '700' }]}>
                NEXT SCHEDULED CLASS
              </Text>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600', marginTop: 2 }]}>
                {nextSlot.course_code}: {nextSlot.course_title}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                Period {nextSlot.period_number} • {nextSlot.start_time.slice(0, 5)} - {nextSlot.end_time.slice(0, 5)}
              </Text>
            </View>
          )}

          <Button
            title="Refresh Schedule"
            onPress={() => refetch()}
            variant="outline"
            style={{ marginTop: 20, minWidth: 160 }}
          />
        </Card>
      )}

      {/* ACTIVE CLASS ATTENDANCE MARKING */}
      {!isLoading && !error && currentSlot && (
        <>
          {/* Active Period Info Banner */}
          <Card variant="outlined" style={styles.activeClassBanner}>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeRow}>
                <Badge
                  label={`${currentSlot.course_code} • Period ${currentSlot.period_number}`}
                  variant="primary"
                />
                {currentSlot.is_marked && (
                  <Badge label="Previously Submitted" variant="neutral" />
                )}
                {currentSlot.is_unlocked && (
                  <Badge label="HOD Unlocked" variant="success" />
                )}
              </View>
              <Text style={[typography.h3, { color: colors.textPrimary, marginTop: 6 }]}>
                {currentSlot.course_title}
              </Text>
              <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                {currentSlot.start_time.slice(0, 5)} - {currentSlot.end_time.slice(0, 5)} •{' '}
                {currentSlot.session_type.toUpperCase()}
              </Text>
            </View>
          </Card>

          {/* Quick Attendance Stats Strip */}
          <View
            style={[
              styles.statsStrip,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.statBox}>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>Enrolled</Text>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>{roster.length}</Text>
            </View>
            <View style={[styles.statBox, { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.success }]}>Present</Text>
              <Text style={[typography.h3, { color: colors.success }]}>{presentCount}</Text>
            </View>
            <View style={[styles.statBox, { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
              <Text style={[typography.caption, { color: colors.danger }]}>Absent</Text>
              <Text style={[typography.h3, { color: colors.danger }]}>{absentCount}</Text>
            </View>
          </View>

          {/* Search and Action Row */}
          <View style={styles.searchAndActionsRow}>
            <View style={[styles.searchContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name="search" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <TextInput
                placeholder="Search by student name or CAP..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={[styles.searchInput, { color: colors.textPrimary }]}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {absentCount > 0 && (
              <TouchableOpacity onPress={markAllPresent} style={styles.clearAllBtn}>
                <Text style={[typography.caption, { color: colors.primary, fontWeight: '600' }]}>
                  Reset All to Present
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 8, marginHorizontal: 4 }]}>
            All students default to Present. Tap any absent student to mark them Absent.
          </Text>

          {/* Student Roster List */}
          {filteredRoster.length === 0 ? (
            <Card variant="flat" style={{ padding: 20, alignItems: 'center' }}>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {searchQuery ? 'No matching students found.' : 'No students registered for this course.'}
              </Text>
            </Card>
          ) : (
            filteredRoster.map((student: StudentItem, idx: number) => {
              const isAbsent = !!absentStudentIds[student.id];
              return (
                <TouchableOpacity
                  key={student.id}
                  activeOpacity={0.7}
                  onPress={() => toggleAbsent(student.id)}
                >
                  <Card
                    variant="outlined"
                    style={[
                      styles.studentCard,
                      isAbsent && {
                        borderColor: colors.danger,
                        backgroundColor: colors.dangerLight + '25',
                      },
                    ]}
                  >
                    <View style={styles.studentCardRow}>
                      <View style={{ width: 28 }}>
                        <Text style={[typography.caption, { color: colors.textSecondary }]}>
                          {idx + 1}
                        </Text>
                      </View>

                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text
                          style={[
                            typography.bodyMedium,
                            {
                              color: isAbsent ? colors.danger : colors.textPrimary,
                              fontWeight: '600',
                            },
                          ]}
                        >
                          {student.full_name}
                        </Text>
                        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 1 }]}>
                          {student.cap_application_number || student.email}
                        </Text>
                      </View>

                      <Badge
                        label={isAbsent ? 'ABSENT' : 'PRESENT'}
                        variant={isAbsent ? 'danger' : 'success'}
                      />
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}

          {/* Submit Attendance Button */}
          {roster.length > 0 && (
            <View style={styles.submitContainer}>
              <Button
                title={
                  submitMutation.isPending
                    ? 'Submitting...'
                    : isOnline
                    ? `Submit Attendance (${presentCount} Present, ${absentCount} Absent)`
                    : `Save Offline (${presentCount} Present, ${absentCount} Absent)`
                }
                onPress={() => submitMutation.mutate()}
                loading={submitMutation.isPending}
                variant="primary"
              />
              <Text
                style={[
                  typography.caption,
                  { color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
                ]}
              >
                15-Minute Grace Window applies. After 15 minutes, late submissions require HOD authorization.
              </Text>
            </View>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slotPickerRow: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  slotPillContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  slotPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  emptyStateCard: {
    padding: 24,
    alignItems: 'center',
    marginVertical: 16,
    borderRadius: 16,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextSlotBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    width: '100%',
    alignItems: 'center',
  },
  activeClassBanner: {
    marginBottom: 10,
    padding: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statsStrip: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  searchAndActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  clearAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  studentCard: {
    marginVertical: 4,
    padding: 12,
  },
  studentCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitContainer: {
    marginTop: 20,
    marginBottom: 40,
  },
});
