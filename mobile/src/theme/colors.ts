/**
 * University Brand & Theme Color Tokens
 */

export const brandColors = {
  primary: '#1E3A8A', // Deep Academic Navy
  primaryLight: '#3B82F6',
  primaryDark: '#172554',
  accent: '#F59E0B', // Gold
  accentLight: '#FBBF24',
  success: '#047857', // Accessible on pale status backgrounds
  successLight: '#D1FAE5',
  warning: '#92400E', // Amber text
  warningLight: '#FEF3C7',
  danger: '#B91C1C', // Red
  dangerLight: '#FEE2E2',
};

export const lightColors = {
  ...brandColors,
  background: '#F8FAFC',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#64748B',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  tabBarBackground: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
  tabBarActive: '#1E3A8A',
  tabBarInactive: '#64748B',
  skeletonBase: '#E2E8F0',
  skeletonHighlight: '#F8FAFC',
};

export const darkColors = {
  ...brandColors,
  primary: '#93C5FD',
  primaryLight: '#BFDBFE',
  success: '#6EE7B7',
  successLight: '#064E3B',
  warning: '#FCD34D',
  warningLight: '#451A03',
  danger: '#FCA5A5',
  dangerLight: '#450A0A',
  background: '#0F172A',
  surface: '#1E293B',
  card: '#1E293B',
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#94A3B8',
  border: '#334155',
  borderLight: '#1E293B',
  tabBarBackground: '#0F172A',
  tabBarBorder: '#1E293B',
  tabBarActive: '#60A5FA',
  tabBarInactive: '#94A3B8',
  skeletonBase: '#334155',
  skeletonHighlight: '#475569',
};

export type ThemeColors = typeof lightColors;
