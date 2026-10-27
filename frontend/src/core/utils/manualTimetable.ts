export interface ManualEntry {
  courseId: string;
  day: number;
  period: number;
  sessionType: 'theory' | 'practical';
  isLabBlock: boolean;
}

export function defaultSessionType(course: { theoryHours: number; practicalHours: number }, preferred: 'theory' | 'practical'): 'theory' | 'practical' {
  if (course.theoryHours === 0 && course.practicalHours > 0) return 'practical';
  if (course.practicalHours === 0 && course.theoryHours > 0) return 'theory';
  return preferred;
}

/** Groups can overlap. A linked edit must include the complete connected basket. */
export function linkedCourseIds(courseId: string, groups: { courseIds: string[] }[]): string[] {
  const linked = new Set([courseId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (!group.courseIds.some(id => linked.has(id))) continue;
      for (const id of group.courseIds) if (!linked.has(id)) { linked.add(id); changed = true; }
    }
  }
  return [...linked];
}

/** Theory blocks stop at lunch. Practical sessions move as their original two-period pair. */
export function sessionPeriods(entries: ManualEntry[], selected: ManualEntry): number[] {
  const periods = entries.filter(entry => entry.courseId === selected.courseId && entry.day === selected.day &&
    entry.sessionType === selected.sessionType).map(entry => entry.period).sort((a, b) => a - b);
  const index = periods.indexOf(selected.period);
  if (selected.sessionType === 'practical') {
    for (let cursor = 0; cursor < periods.length;) {
      const pair = periods[cursor + 1] === periods[cursor] + 1 && periods[cursor] !== 3;
      const block = periods.slice(cursor, cursor + (pair ? 2 : 1));
      if (block.includes(selected.period)) return block;
      cursor += block.length;
    }
    return [selected.period];
  }
  let first = index, last = index;
  while (first > 0 && periods[first - 1] === periods[first] - 1 && periods[first] !== 4) first--;
  while (last < periods.length - 1 && periods[last + 1] === periods[last] + 1 && periods[last] !== 3) last++;
  return periods.slice(first, last + 1);
}

export function editManualSession(entries: ManualEntry[], selected: ManualEntry, linked: string[],
  target?: { day: number; period: number }): ManualEntry[] {
  const periods = sessionPeriods(entries, selected);
  const affected = entries.filter(entry => linked.includes(entry.courseId) && entry.day === selected.day && periods.includes(entry.period));
  const remaining = entries.filter(entry => !affected.includes(entry));
  if (!target) return remaining;
  return [...remaining, ...affected.map(entry => ({ ...entry, day: target.day,
    period: target.period + entry.period - periods[0] }))];
}
