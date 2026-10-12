import { test, expect } from 'vitest'
import { campusSessionLabel, formatCampusTime, type CampusAttendanceSession } from '@fyimp/contracts'

test.each([
  ['completed', 'on_time', 'On time'], ['completed', 'late', 'Late'], ['completed', 'early_leave', 'Early leave'],
  ['pending', null, 'Pending'], ['absent', null, 'Absent'],
])('campus UI renders backend state %s/%s as %s', (state, status, label) => {
  expect(campusSessionLabel({ state, status, signed_in_at: null } as CampusAttendanceSession)).toBe(label)
})

test('unloaded status never claims presence or absence', () => {
  expect(campusSessionLabel()).toBe('Unavailable')
})

test('configured times render in 12-hour format without invalid afternoon labels', () => {
  expect(formatCampusTime('09:30:00')).toBe('9:30 AM')
  expect(formatCampusTime('15:30:00')).toBe('3:30 PM')
  expect(formatCampusTime('00:15')).toBe('12:15 AM')
  expect(formatCampusTime('12:00')).toBe('12:00 PM')
  expect(formatCampusTime('15:30:15')).toBe('3:30:15 PM')
})
