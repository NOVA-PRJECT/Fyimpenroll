import { dataReadDomains, type DataDomain } from '@fyimp/contracts';
import type { QueryKey } from '@tanstack/react-query';
let refreshes = 0;
export const isFreshMobileRead = () => refreshes > 0;
export async function freshRead<T>(load: () => Promise<T>): Promise<T> {
  refreshes++;
  try { return await load(); } finally { refreshes--; }
}
export function mobileQueryDomains(key: QueryKey): DataDomain[] {
  const name = String(key[1] || key[0]);
  if (key[0] === 'dated-marks') return dataReadDomains('/api/attendance/period/slot-marks');
  if (key[0] === 'dated-schedule' || key[0] === 'teacher') return dataReadDomains('/api/attendance/period/teacher-schedule');
  if (key[0] === 'hod') return dataReadDomains('/api/attendance/campus/roster');
  if (key[0] === 'auth') return ['people'];
  if (key[0] === 'consent') return [];
  const endpoint = name === 'attendance-list' ? '/api/student/attendance'
    : name === 'course-detail' ? '/api/student/courses/detail'
    : name === 'credits' ? '/api/credit-ledger/me' : /campus|sign-in/.test(name)
    ? '/api/attendance/campus/status/me' : '/api/student/' + (name === 'dashboard' ? 'overview' : name);
  return dataReadDomains(endpoint);
}
