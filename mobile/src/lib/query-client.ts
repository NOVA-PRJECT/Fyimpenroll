import { QueryClient } from '@tanstack/react-query';

/**
 * Central TanStack Query v5 client configuration.
 * Optimized for mobile network environments with in-memory offline read cache.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours (in memory retention)
      retry: 2,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false, // On mobile, we avoid aggressive window focus refetches
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Standardized query keys across all roles and domains.
 * All user-scoped keys explicitly include userId or departmentId to prevent session bleed.
 */
export const queryKeys = {
  auth: {
    me: (userId: string) => ['auth', 'me', userId] as const,
    profile: (userId: string) => ['auth', 'profile', userId] as const,
  },
  student: {
    dashboard: (userId: string, semester?: number, date?: string) => semester === undefined
      ? ['student', 'dashboard', userId] as const
      : ['student', 'dashboard', userId, semester, date] as const,
    timetable: (userId: string, semester?: number) =>
      ['student', 'timetable', userId, semester ?? 'current'] as const,
    attendanceList: (userId: string, semester?: number) =>
      ['student', 'attendance-list', userId, semester ?? 'current'] as const,
    campusSignInToday: (userId: string, dateStr: string) =>
      ['student', 'campus-sign-in', userId, dateStr] as const,
    campusStatus: (userId: string, dateStr: string) =>
      ['student', 'campus-status', userId, dateStr] as const,
    courses: (userId: string, semester?: number) =>
      ['student', 'courses', userId, semester ?? 'current'] as const,
    courseDetail: (userId: string, courseId: string, semester?: number) =>
      ['student', 'course-detail', userId, courseId, semester ?? 'current'] as const,
    credits: (userId: string) => ['student', 'credits', userId] as const,
  },
  teacher: {
    currentPeriod: (teacherId: string) => ['teacher', 'current-period', teacherId] as const,
    scheduledPeriods: (teacherId: string, dateStr: string) =>
      ['teacher', 'scheduled-periods', teacherId, dateStr] as const,
    slotRoster: (teacherId: string, slotId: string, dateStr: string) =>
      ['teacher', 'slot-roster', teacherId, slotId, dateStr] as const,
  },
  hod: {
    absenceSummary: (deptId: string, dateStr: string) =>
      ['hod', 'absence-summary', deptId, dateStr] as const,
    signInRoster: (deptId: string, dateStr: string) =>
      ['hod', 'sign-in-roster', deptId, dateStr] as const,
  },
};
