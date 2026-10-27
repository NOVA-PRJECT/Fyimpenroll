'use client'

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSessionType, editManualSession, linkedCourseIds, ManualEntry, sessionPeriods } from '@/core/utils/manualTimetable';
import styles from './manual.module.css';

type Mode = 'follow_rules' | 'allow_overrides';
interface Violation { type: string; detail: string; courseId?: string; day?: number; period?: number }
interface Report {
  violations: Violation[]; blockingViolations: Violation[]; warnings: Violation[];
  remaining: { courseId: string; courseCode: string; courseName: string; sessionType: string; periods: number }[];
  unscheduledPeriods: number; complete: boolean;
}
interface Course {
  courseId: string; courseCode: string; courseTitle: string; departmentId: string; departmentName: string;
  enrolledDepartmentIds: string[]; theoryHours: number; practicalHours: number; teacherId?: string; teacherName?: string | null;
}
interface State {
  revision: string; entries: ManualEntry[]; published: boolean; saved: boolean; mode: Mode; reason: string;
  courses: Course[]; departments: { id: string; name: string }[]; parallelGroups: { courseIds: string[] }[]; report: Report;
}
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const times = ['09:30–10:30', '10:30–11:30', '11:30–12:30', '13:30–14:30', '14:30–15:30', '15:30–16:30'];
function message(data: { message?: string | string[] }) {
  return Array.isArray(data.message) ? data.message.join(', ') : data.message || 'The timetable request failed.';
}

export default function ManualTimetableEditor({ academicYear, semester, onSaved, onClose, onDirtyChange }: {
  academicYear: string; semester: number; onSaved: () => void; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [mode, setMode] = useState<Mode>('follow_rules');
  const [reason, setReason] = useState('');
  const [department, setDepartment] = useState('');
  const [courseId, setCourseId] = useState('');
  const [sessionType, setSessionType] = useState<'theory' | 'practical'>('theory');
  const [parallelTypes, setParallelTypes] = useState<Record<string, 'theory' | 'practical'>>({});
  const [duration, setDuration] = useState(1);
  const [day, setDay] = useState(1);
  const [period, setPeriod] = useState(1);
  const [linked, setLinked] = useState(true);
  const [selected, setSelected] = useState<ManualEntry | null>(null);
  const [undo, setUndo] = useState<ManualEntry[][]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [canSave, setCanSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    setBusy(true); setError(null); setReport(null); requestId.current++;
    try {
      const response = await fetch(`/api/timetable/manual?academicYear=${encodeURIComponent(academicYear)}&semester=${semester}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(message(data));
      setState(data); setEntries(data.entries); setMode(data.mode); setReason(data.reason);
      setReport(data.report); setSelected(null); setUndo([]); setAcknowledged(false);
      setCanSave(data.mode === 'allow_overrides' ? !!data.reason.trim() : data.report.blockingViolations.length === 0);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }, [academicYear, semester]);

  useEffect(() => { void load(); }, [load]);

  const dirty = !!state && (JSON.stringify(entries) !== JSON.stringify(state.entries) || mode !== state.mode || reason !== state.reason);
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!state || state.published || busy) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    setReport(null); setCanSave(false); setChecking(true); setAcknowledged(false);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/timetable/manual/preview', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ academicYear, semester, revision: state.revision, entries, mode, reason }) });
        const data = await response.json();
        if (id !== requestId.current) return;
        if (!response.ok) throw new Error(message(data));
        setReport(data.report); setCanSave(data.canSave); setError(null);
      } catch (error) {
        if (!controller.signal.aborted && id === requestId.current) setError((error as Error).message);
      } finally { if (id === requestId.current) setChecking(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [academicYear, semester, state, entries, mode, reason, busy]);

  function change(next: ManualEntry[]) {
    setUndo(previous => [...previous.slice(-19), entries]); setEntries(next);
    setFeedback(''); setError(null); setAcknowledged(false);
  }
  const visibleCourses = state?.courses.filter(course => !department || course.departmentId === department || course.enrolledDepartmentIds.includes(department)) || [];
  const affectedIds = state && courseId ? (mode === 'follow_rules' || linked ? linkedCourseIds(courseId, state.parallelGroups) : [courseId]) : [];
  const affected = state?.courses.filter(course => affectedIds.includes(course.courseId)) || [];
  const visibleEntries = entries.filter(entry => visibleCourses.some(course => course.courseId === entry.courseId));
  const readOnly = busy || !!state?.published;
  const typeForCourse = (course: Course) => course.courseId === courseId ? sessionType :
    parallelTypes[course.courseId] ?? defaultSessionType(course, sessionType);

  function add() {
    if (!courseId || !state) return;
    const additions = affected.flatMap(course => Array.from({ length: duration }, (_, offset) => ({
      courseId: course.courseId, day, period: period + offset, sessionType: typeForCourse(course), isLabBlock: typeForCourse(course) === 'practical',
    })));
    if (period + duration - 1 > 6) { setError('The session extends past the last period. Choose an earlier slot.'); return; }
    if (additions.some(entry => entries.some(existing => existing.courseId === entry.courseId && existing.day === entry.day && existing.period === entry.period))) {
      setError('One of these courses already occupies the selected slot. Select its session to move it.'); return;
    }
    change([...entries, ...additions]);
  }
  function edit(remove: boolean) {
    if (!selected) return;
    const next = editManualSession(entries, selected, affectedIds, remove ? undefined : { day, period });
    if (next.some(entry => entry.period > 6)) { setError('The complete session must fit within the day.'); return; }
    if (new Set(next.map(entry => `${entry.courseId}:${entry.day}:${entry.period}`)).size !== next.length) {
      setError('This move overlaps another session of the same course. Choose a different slot.'); return;
    }
    change(next); setSelected(null);
  }
  async function save() {
    if (!state) return;
    setBusy(true); setError(null); setFeedback('');
    try {
      const response = await fetch('/api/timetable/manual', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear, semester, revision: state.revision, entries, mode, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(message(data));
      setState({ ...state, revision: data.revision, entries, mode, reason, report: data.report, saved: true });
      setReport(data.report); setUndo([]); setFeedback('Manual draft saved.'); onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!state) return;
    setBusy(true); setError(null); setFeedback('');
    try {
      const response = await fetch('/api/timetable/manual/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear, semester, revision: state.revision, acknowledgeOverrides: acknowledged }) });
      const data = await response.json();
      if (!response.ok || data.success !== true || !data.publishedCount) throw new Error(message(data));
      setState({ ...state, published: true, revision: data.revision });
      setFeedback(`Published ${data.publishedCount} sessions. The timetable is now locked.`); onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section className={styles.editor} aria-label="Manual timetable editor" aria-busy={busy}>
    <div className={styles.heading}><div><h2>Manual timetable fallback</h2>
      <p>Semester {semester} · {academicYear}. Place the sessions the generator could not schedule.</p></div>
      <button type="button" onClick={onClose} disabled={busy || dirty}>Close editor</button></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {feedback && <p role="status" className={styles.success}>{feedback}</p>}
    <div className={styles.toolbar}><button type="button" onClick={() => void load()} disabled={busy}>Reload saved timetable{dirty ? ' (discard edits)' : ''}</button>
      {!state?.published && <button type="button" disabled={readOnly || !undo.length} onClick={() => {
        const previous = undo[undo.length - 1]; setUndo(undo.slice(0, -1)); setEntries(previous); setSelected(null);
      }}>Undo last edit</button>}
      {dirty && <span role="status">Unsaved changes</span>}{busy && <span role="status">Loading…</span>}</div>
    {state && <>
      {state.published && <p className={styles.success}>Published timetable — placement editing is locked.</p>}
      <fieldset disabled={readOnly} className={styles.mode}><legend>Scheduling mode</legend>
        <label><input type="radio" name="manual-mode" checked={mode === 'follow_rules'} onChange={() => { setMode('follow_rules'); setLinked(true); }} /> Follow rules</label>
        <label><input type="radio" name="manual-mode" checked={mode === 'allow_overrides'} onChange={() => setMode('allow_overrides')} /> Allow rule overrides</label>
        <p>{mode === 'follow_rules' ? 'Scheduling violations block saving. Missing hours may remain in a draft.' :
          'Scheduling violations and missing hours can be accepted. They remain visible and are recorded when you publish.'}</p>
        {mode === 'allow_overrides' && <label className={styles.reason}>Reason for overrides
          <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} rows={2} required /></label>}
      </fieldset>
      <p className={styles.note}>Teacher–course assignments are managed exclusively by the HOD. This editor changes session placement only.</p>
      <div className={styles.form}>
        <label>Department<select value={department} onChange={event => { setDepartment(event.target.value); setCourseId(''); setSelected(null); }} disabled={busy}>
          <option value="">All departments</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select></label>
        <label>Course<select value={courseId} onChange={event => { setCourseId(event.target.value); setParallelTypes({}); setSelected(null); }} disabled={readOnly}>
          <option value="">Choose a course</option>{visibleCourses.map(course => <option key={course.courseId} value={course.courseId}>{course.courseCode} — {course.courseTitle}</option>)}
        </select></label>
        <label>Session<select value={sessionType} onChange={event => { const value = event.target.value as 'theory' | 'practical'; setSessionType(value); setDuration(value === 'practical' ? 2 : 1); }} disabled={readOnly || !!selected}>
          <option value="theory">Theory</option><option value="practical">Practical</option></select></label>
        <label>Periods<select value={duration} onChange={event => setDuration(Number(event.target.value))} disabled={readOnly || !!selected}>
          {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Day<select value={day} onChange={event => setDay(Number(event.target.value))} disabled={readOnly}>
          {days.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
        <label>Starting period<select value={period} onChange={event => setPeriod(Number(event.target.value))} disabled={readOnly}>
          {times.map((time, index) => <option key={time} value={index + 1}>P{index + 1} · {time}</option>)}</select></label>
      </div>
      {courseId && <div className={styles.affected}>
        <label><input type="checkbox" checked={mode === 'follow_rules' || linked} disabled={readOnly || mode === 'follow_rules'} onChange={event => setLinked(event.target.checked)} /> Include linked parallel courses</label>
        <p>Affected: {affected.map(course => `${course.courseCode} (${course.departmentName})`).join(', ')}.</p>
        <p>HOD-assigned teachers: {affected.map(course => `${course.courseCode}: ${course.teacherName || (course.teacherId ? 'Assigned by HOD' : 'Unassigned — contact HOD')}`).join('; ')}.</p>
        {!selected && affected.length > 1 && <div className={styles.form}>{affected.map(course => <label key={course.courseId}>
          {course.courseCode} session type<select value={typeForCourse(course)} disabled={readOnly || course.courseId === courseId}
            onChange={event => setParallelTypes(previous => ({ ...previous, [course.courseId]: event.target.value as 'theory' | 'practical' }))}>
            <option value="theory">Theory</option><option value="practical">Practical</option>
          </select></label>)}</div>}
        <p>{selected ? `Selected ${days[selected.day - 1]} session: P${sessionPeriods(entries, selected).join(', P')}. Choose a destination to move the full session.` :
          'All affected courses share the full duration. Check each course’s theory/practical type and review the validation below.'}</p>
      </div>}
      {!state.published && <div className={styles.toolbar}>
        {!selected ? <button type="button" onClick={add} disabled={readOnly || !courseId}>Place session</button> : <>
          <button type="button" onClick={() => edit(false)} disabled={readOnly}>Move selected session</button>
          <button type="button" onClick={() => edit(true)} disabled={readOnly}>Remove selected session</button>
          <button type="button" onClick={() => setSelected(null)} disabled={readOnly}>Cancel selection</button></>}
      </div>}
      <div className={styles.tableWrap}><table className={styles.grid}><caption>Click an empty cell to choose a destination. Select a session to move or remove it.</caption>
        <thead><tr><th scope="col">Day</th>{times.map((time, index) => <th scope="col" key={time}>P{index + 1}<small>{time}</small></th>)}</tr></thead>
        <tbody>{days.map((name, dayIndex) => <tr key={name}><th scope="row">{name}</th>{times.map((_, periodIndex) => {
          const cell = visibleEntries.filter(entry => entry.day === dayIndex + 1 && entry.period === periodIndex + 1);
          const invalid = report?.violations.some(item => item.day === dayIndex + 1 && item.period === periodIndex + 1);
          return <td key={periodIndex} className={invalid ? styles.invalid : day === dayIndex + 1 && period === periodIndex + 1 ? styles.target : ''}>
            {!cell.length && <button type="button" className={styles.empty} disabled={readOnly} onClick={() => { setDay(dayIndex + 1); setPeriod(periodIndex + 1); }}>Choose slot</button>}
            {cell.map(entry => { const course = state.courses.find(course => course.courseId === entry.courseId); return <button type="button" key={entry.courseId}
              className={`${styles.session} ${selected?.courseId === entry.courseId && selected.day === entry.day && sessionPeriods(entries, selected).includes(entry.period) ? styles.selected : ''}`}
              disabled={readOnly} onClick={() => { setSelected(entry); setCourseId(entry.courseId); setSessionType(entry.sessionType); setDuration(sessionPeriods(entries, entry).length); }}>
              <strong>{course?.courseCode}</strong><small>{course?.courseTitle}</small><small>{entry.sessionType} · {course?.departmentName}</small>
            </button>; })}
          </td>;
        })}</tr>)}</tbody></table></div>
      <div className={styles.report} aria-live="polite">
        {checking && <p>Checking placements against the campus timetable…</p>}
        {report && <>
          <h3>Timetable review</h3><p>{entries.length} periods placed · {report.unscheduledPeriods} periods missing · {report.violations.length} rule violations · {report.warnings.length} warnings</p>
          <details open={report.remaining.length > 0}><summary>Remaining hours ({report.unscheduledPeriods})</summary>
            <ul>{report.remaining.map(item => <li key={`${item.courseId}:${item.sessionType}`}>{item.courseCode} — {item.periods} {item.sessionType} period(s)</li>)}</ul></details>
          {!!report.violations.length && <details open><summary>Rule violations {mode === 'allow_overrides' ? '(will be recorded as overrides)' : ''}</summary>
            <ul>{report.violations.map((item, index) => <li key={index}>{item.detail}</li>)}</ul></details>}
          {!!report.warnings.length && <details><summary>Preferences and teacher warnings</summary><ul>{report.warnings.map((item, index) => <li key={index}>{item.detail}</li>)}</ul></details>}
        </>}
      </div>
      {!state.published && <div className={styles.publication}>
        <button type="button" className={styles.primary} disabled={readOnly || checking || !canSave || (!dirty && state.saved)} onClick={() => void save()}>Save manual draft</button>
        {mode === 'allow_overrides' && <label><input type="checkbox" checked={acknowledged} disabled={readOnly || dirty || !report}
          onChange={event => setAcknowledged(event.target.checked)} /> I have reviewed and accept the listed rule violations and missing hours for publication.</label>}
        <p>Publishing makes this timetable visible to students and faculty and locks its placements.</p>
        <button type="button" className={styles.primary} disabled={readOnly || dirty || !state.saved || !report || checking || !entries.length ||
          (mode === 'follow_rules' ? report.violations.length > 0 : !acknowledged || !reason.trim())} onClick={() => void publish()}>
          {mode === 'allow_overrides' ? 'Publish with recorded overrides' : 'Publish complete timetable'}</button>
      </div>}
    </>}
  </section>;
}
