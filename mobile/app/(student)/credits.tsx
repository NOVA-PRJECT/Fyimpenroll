import { freshRead } from '../../src/lib/data-refresh';
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

interface CategoryItem {
  category: string;
  title: string;
  earned: number;
  min3Year: number;
  min4Year: number;
  shortfall3Year: number;
  shortfall4Year: number;
  isMet3Year: boolean;
  isMet4Year: boolean;
}

interface LevelBandItem {
  band: string;
  title: string;
  earned: number;
  minimum: number;
  shortfall: number;
  isMet: boolean;
}

interface DeptItem {
  departmentId: string;
  departmentName: string;
  earned: number;
  count: number;
}

interface ExitMilestone {
  title: string;
  eligible: boolean;
  totalCredits: number;
  requiredCredits: number;
  totalShortfall: number;
  unmetCategories: string[];
  unmetBands: string[];
  primaryShortfall: string;
}

interface CreditLedgerResponse {
  student: {
    id: string;
    fullName: string;
    capApplicationNumber: string;
    currentSemester: number;
    academicYearJoined: string;
    departmentName: string;
    campusName: string;
  };
  totalCredits: number;
  categories: CategoryItem[];
  levelBands: LevelBandItem[];
  byDepartment: DeptItem[];
  exitEligibility: {
    threeYear: ExitMilestone;
    fourYear: ExitMilestone;
    fiveYear: ExitMilestone;
  };
  registeredCourses: Array<{
    id: string;
    courseCode: string;
    title: string;
    credits: number;
    category: string;
    normalizedCategory: string;
    levelBand: string;
    departmentName: string;
    semester: number;
  }>;
}

export default function StudentCreditsScreen() {
  const { user } = useAuth();
  const { colors, typography } = useTheme();

  const userId = user?.id || '';

  const { data, isLoading, error, refetch, isRefetching } = useQuery<CreditLedgerResponse>({
    queryKey: queryKeys.student.credits(userId),
    queryFn: () => apiClient.get(API_ENDPOINTS.CREDIT_LEDGER_ME),
    enabled: !!userId,
  });

  const totalEarned = data?.totalCredits ?? 0;
  // Progress against 4-year Honours standard (177 credits)
  const targetCredits = 177;
  const progressPct = Math.min(Math.round((totalEarned / targetCredits) * 100), 100);

  return (
    <ScreenContainer scrollable refreshing={isRefetching} onRefresh={() => freshRead(() => refetch())}>
      {/* 1. Total Credits Summary Card */}
      <Card variant="elevated" style={styles.summaryCard}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Degree Credit Accumulation
        </Text>
        <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
          KU-FYIMP Regulation 2024 Audit Framework
        </Text>

        {isLoading ? (
          <View style={{ marginTop: 16 }}>
            <Skeleton height={32} width="40%" />
            <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
          </View>
        ) : (
          <View style={styles.progressContainer}>
            <View style={styles.creditsRow}>
              <Text style={[typography.h1, { color: colors.primary, fontWeight: '800' }]}>
                {totalEarned}
              </Text>
              <Text style={[typography.h3, { color: colors.textSecondary, marginLeft: 6 }]}>
                Earned Credits
              </Text>
            </View>

            {/* Custom Progress Bar */}
            <View style={[styles.progressBarBackground, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${progressPct}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                typography.caption,
                { color: colors.textSecondary, marginTop: 6, textAlign: 'right' },
              ]}
            >
              {progressPct}% of 4-Year Honours Target (177 CR)
            </Text>
          </View>
        )}
      </Card>

      {/* Error View */}
      {error ? (
        <ErrorView
          message={error instanceof Error ? error.message : 'Failed to load credit ledger.'}
          onRetry={() => freshRead(() => refetch())}
        />
      ) : null}

      {/* 2. Exit Eligibility Milestones */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Exit Eligibility Milestones
        </Text>
      </View>

      {isLoading ? (
        <Card variant="outlined">
          <Skeleton height={60} style={{ marginVertical: 6 }} />
          <Skeleton height={60} style={{ marginVertical: 6 }} />
        </Card>
      ) : data?.exitEligibility ? (
        <Card variant="outlined" style={{ padding: 12 }}>
          {/* 3-Year Exit */}
          <View style={styles.milestoneBlock}>
            <View style={styles.milestoneRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>
                  3-Year UG Exit (133 Credits)
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {data.exitEligibility.threeYear.primaryShortfall}
                </Text>
              </View>
              <Badge
                label={data.exitEligibility.threeYear.eligible ? 'Eligible' : 'In Progress'}
                variant={data.exitEligibility.threeYear.eligible ? 'success' : 'neutral'}
              />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* 4-Year Honours Exit */}
          <View style={styles.milestoneBlock}>
            <View style={styles.milestoneRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>
                  4-Year Honours Exit (177 Credits)
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {data.exitEligibility.fourYear.primaryShortfall}
                </Text>
              </View>
              <Badge
                label={data.exitEligibility.fourYear.eligible ? 'Eligible' : 'In Progress'}
                variant={data.exitEligibility.fourYear.eligible ? 'success' : 'neutral'}
              />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* 5-Year PG Exit */}
          <View style={styles.milestoneBlock}>
            <View style={styles.milestoneRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>
                  5-Year Integrated PG (217 Credits)
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {data.exitEligibility.fiveYear.primaryShortfall}
                </Text>
              </View>
              <Badge
                label={data.exitEligibility.fiveYear.eligible ? 'Eligible' : 'In Progress'}
                variant={data.exitEligibility.fiveYear.eligible ? 'success' : 'neutral'}
              />
            </View>
          </View>
        </Card>
      ) : null}

      {/* 3. Curricular Category Breakdown */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Curricular Categories
        </Text>
      </View>

      {isLoading ? (
        <View>
          <Skeleton height={50} style={{ marginVertical: 4 }} />
          <Skeleton height={50} style={{ marginVertical: 4 }} />
          <Skeleton height={50} style={{ marginVertical: 4 }} />
        </View>
      ) : data?.categories && data.categories.length > 0 ? (
        data.categories.map((cat) => (
          <Card key={cat.category} variant="outlined" style={styles.categoryCard}>
            <View style={styles.categoryRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]}>
                  {cat.title}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                  {cat.min3Year > 0 ? `3-Year: ${cat.min3Year} cr` : ''}
                  {cat.min4Year > 0 ? ` • 4-Year: ${cat.min4Year} cr` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[typography.bodyLarge, { color: colors.primary, fontWeight: '800' }]}>
                  {cat.earned} CR
                </Text>
                <Badge
                  label={cat.isMet3Year ? 'Met (3Y)' : cat.min3Year === 0 ? 'Optional' : `-${cat.shortfall3Year} cr`}
                  variant={cat.isMet3Year ? 'success' : cat.min3Year === 0 ? 'neutral' : 'danger'}
                />
              </View>
            </View>
          </Card>
        ))
      ) : null}

      {/* 4. Level Band Breakdown */}
      <View style={styles.sectionHeader}>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>
          Course Level Bands
        </Text>
      </View>

      {isLoading ? (
        <View>
          <Skeleton height={50} style={{ marginVertical: 4 }} />
          <Skeleton height={50} style={{ marginVertical: 4 }} />
        </View>
      ) : data?.levelBands && data.levelBands.length > 0 ? (
        <Card variant="outlined" style={{ padding: 12 }}>
          {data.levelBands.map((band, idx) => (
            <React.Fragment key={band.band}>
              <View style={styles.bandRow}>
                <View>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {band.title} ({band.band})
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    Regulation bound: Min {band.minimum} Credits
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[typography.bodyMedium, { color: colors.primary, fontWeight: '700' }]}>
                    {band.earned} / {band.minimum} CR
                  </Text>
                  <Badge
                    label={band.isMet ? 'Met' : `-${band.shortfall} cr`}
                    variant={band.isMet ? 'success' : 'danger'}
                  />
                </View>
              </View>
              {idx < data.levelBands.length - 1 && (
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
              )}
            </React.Fragment>
          ))}
        </Card>
      ) : null}

      {/* 5. Department Distribution */}
      {data?.byDepartment && data.byDepartment.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              Credits by Department
            </Text>
          </View>
          <Card variant="outlined" style={{ padding: 12 }}>
            {data.byDepartment.map((dept, idx) => (
              <React.Fragment key={dept.departmentId}>
                <View style={styles.deptRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                      {dept.departmentName}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>
                      {dept.count} {dept.count === 1 ? 'course' : 'courses'} registered
                    </Text>
                  </View>
                  <Text style={[typography.bodyLarge, { color: colors.primary, fontWeight: '800' }]}>
                    {dept.earned} CR
                  </Text>
                </View>
                {idx < data.byDepartment.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                )}
              </React.Fragment>
            ))}
          </Card>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    marginBottom: 16,
  },
  progressContainer: {
    marginTop: 12,
  },
  creditsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressBarBackground: {
    height: 10,
    borderRadius: 5,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  sectionHeader: {
    marginTop: 18,
    marginBottom: 8,
  },
  milestoneBlock: {
    paddingVertical: 6,
  },
  milestoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  categoryCard: {
    marginVertical: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  bandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  deptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
});
