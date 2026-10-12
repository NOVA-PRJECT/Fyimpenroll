/**
 * App-wide constants
 */

import { ROLES as SHARED_ROLES } from '@fyimp/contracts';
export type { Role as UserRole } from '@fyimp/contracts';
export const ROLES = { ...SHARED_ROLES, SUPERADMIN: SHARED_ROLES.SUPER_ADMIN };

export const STORAGE_KEYS = {
  AUTH_SESSION: 'fyimp_auth_session',
  OFFLINE_QUEUE: 'fyimp_offline_queue',
  ACTIVE_SEMESTER: 'fyimp_active_semester',
  PUSH_TOKEN: 'fyimp_expo_push_token',
};

export const MIN_TOUCH_TARGET_SIZE = 44; // 44x44 pt minimum for iOS HIG & Android accessibility
