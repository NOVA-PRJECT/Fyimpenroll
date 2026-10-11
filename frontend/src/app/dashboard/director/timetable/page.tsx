'use client'

import NavigationLink from '@/components/NavigationLink';
import { sessionRedirect } from '@/core/security/session-response';
import { useRouter } from 'next/navigation';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import type { SchedulingRule } from './BrowserRulesEditor';
const BrowserRulesEditor = dynamic(() => import('./BrowserRulesEditor'));
import { downloadBlob } from '@/core/utils/downloadFile';
import { entriesForDepartment } from '@/core/utils/campusTimetable';
import styles from './timetable.module.css';

interface TimetableEntry {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  category?: string;
  departmentId: string;
  departmentName: string;
  departmentCode?: string;
  day: number;
  period: number;
  startTime: string;
  endTime: string;
  isLabBlock: boolean;
  sessionType?: 'theory' | 'practical';
  status: string;
}

interface ConflictItem {
  id?: string;
  courseId: string;
  courseName: string;
  courseCode?: string;
  departmentId?: string;
  departmentName?: string;
  departmentCode?: string;
  reason: string;
  conflictingStudentCount: number;
  sessionType?: 'theory' | 'practical';
  periods?: number;
}

interface BaseConstraintsData {
  campusId: string;
  rules: SchedulingRule[];
}

const DAYS_MAP: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const DAYS_LIST = [1, 2, 3, 4, 5, 6];

const PERIODS = [
  { num: 1, label: 'P1', time: '09:30 - 10:30' },
  { num: 2, label: 'P2', time: '10:30 - 11:30' },
  { num: 3, label: 'P3', time: '11:30 - 12:30' },
  { num: 4, label: 'P4', time: '13:30 - 14:30' },
  { num: 5, label: 'P5', time: '14:30 - 15:30' },
  { num: 6, label: 'P6', time: '15:30 - 16:30' },
];

export default function CampusDirectorTimetablePage() {
  const router = useRouter();

  const [academicYear, setAcademicYear] = useState('2026-27');
  const [semester, setSemester] = useState(1);
  const [registrationClosed, setRegistrationClosed] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [currentDeadline, setCurrentDeadline] = useState<string | null>(null);
  const [closingWindow, setClosingWindow] = useState(false);
  const [showCloseWindowConfirmModal, setShowCloseWindowConfirmModal] = useState(false);

  // Dynamic Constraints & Base Rules Modal State
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [baseConstraints, setBaseConstraints] = useState<BaseConstraintsData | null>(null);
  const [rulesReady, setRulesReady] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const constraintsRequest = useRef(0);

  // Generation Overlay & Job status state
  const [showGenerationOverlay, setShowGenerationOverlay] = useState(false);
  const [jobStatus, setJobStatus] = useState<'idle' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [jobProgress, setJobProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [stepMessage, setStepMessage] = useState<string | null>(null);

  // ETC Countdown Timer (5m 30s estimated duration)
  const [etcSeconds, setEtcSeconds] = useState<number>(330);
  const etcIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timetable data state
  const [allEntries, setAllEntries] = useState<TimetableEntry[]>([]);
  const [allConflicts, setAllConflicts] = useState<ConflictItem[]>([]);
  const [reviewDraft, setReviewDraft] = useState(false);
  const [unscheduledPeriods, setUnscheduledPeriods] = useState(0);
  const [departments, setDepartments] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [conflictDeptFilter, setConflictDeptFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  // Export Modal state
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportType, setExportType] = useState<'excel' | 'pdf'>('excel');
  const [exportTargetDept, setExportTargetDept] = useState<string>('all');
  const [printTargetDept, setPrintTargetDept] = useState<string>('all');

  // Publish state
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishModalError, setPublishModalError] = useState<string | null>(null);
  const [publishConflicts, setPublishConflicts] = useState<{courseName: string; reason: string; conflictingStudentCount: number}[] | null>(null);

  // Feedback banners
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch base constraints for the active semester
  const fetchBaseConstraints = useCallback(async () => {
    const request = ++constraintsRequest.current;
    setRulesReady(false);
    setRulesError(null);
    try {
      const res = await fetch(`/api/timetable/constraints?semester=${semester}`);
      if (!res.ok) throw new Error('Scheduling rules couldn’t be loaded. Please try again.');
      if (res.ok) {
        const data = await res.json();
        if (request !== constraintsRequest.current) return;
        const key = `fyimp:rules:${data.campusId}`;
        const saved = localStorage.getItem(key);
        let rules = data.rules;
        if (saved) {
          try { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) rules = parsed; } catch { localStorage.removeItem(key); }
        }
        setBaseConstraints({ ...data, rules });
        setRulesReady(true);
      }
    } catch (error) {
      if (request === constraintsRequest.current) setRulesError(error instanceof Error ? error.message : 'Scheduling rules couldn’t be loaded.');
    }
  }, [semester]);

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
    fetchBaseConstraints();
  }, [fetchBaseConstraints]);

  function saveBrowserRules(rules: SchedulingRule[]) {
    if (!baseConstraints) return;
    try {
      localStorage.setItem(`fyimp:rules:${baseConstraints.campusId}`, JSON.stringify(rules));
      setBaseConstraints({ ...baseConstraints, rules });
      setShowRulesModal(false);
    } catch { setErrorMsg('Browser storage is unavailable. Allow local storage before saving rules.'); }
  }

  function resetBrowserRules() {
    if (!baseConstraints) return;
    localStorage.removeItem(`fyimp:rules:${baseConstraints.campusId}`);
    setShowRulesModal(false);
    void fetchBaseConstraints();
  }

  // Live fetch function directly from API
  const fetchEntries = useCallback(
    async (forceRefresh = false) => {
      if (!academicYear || !semester) return;

      setLoading(true);
      setError(null);

      try {
        const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : '';
        const res = await fetch(`/api/timetable/entries?academicYear=${academicYear}&semester=${semester}${cacheBuster}`);
        if (!res.ok) throw new Error(`Failed to load timetable (${res.status})`);
        const data = await res.json();

        const entriesList = data.entries ?? [];
        const conflictsList = data.conflicts ?? [];
        let deptList = data.departments ?? [];

        if (!deptList || deptList.length === 0) {
          const deptMap = new Map<string, string>();
          entriesList.forEach((e: TimetableEntry) => {
            if (e.departmentId) deptMap.set(e.departmentId, e.departmentName);
          });
          deptList = Array.from(deptMap.entries()).map(([id, name]) => ({ id, name }));
        }

        setAllEntries(entriesList);
        setAllConflicts(conflictsList);
        setReviewDraft(data.reviewDraft === true);
        setUnscheduledPeriods(data.unscheduledPeriods || 0);
        setDepartments(deptList);
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : ''));
      } finally {
        setLoading(false);
      }
    },
    [academicYear, semester]
  );

  const invalidateCache = useCallback(() => {
    fetchEntries(true);
  }, [fetchEntries]);

  // Selector change effect: Reset banners & fetch job status
  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser view state after hydration or resets a changed cohort.
    setErrorMsg(null);
    setSuccessMsg(null);
    setJobError(null);
    setError(null);
    setJobStatus('idle');
    setJobProgress(0);
    setStepMessage(null);
    setShowGenerationOverlay(false);

    if (!academicYear || !semester) return;

    fetch(`/api/timetable/job-status?academicYear=${academicYear}&semester=${semester}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.status && data.status !== 'idle') {
          setJobStatus(data.status);
          setJobProgress(data.progress || 0);
          if (data.stepMessage) setStepMessage(data.stepMessage);
          if (data.status === 'failed') {
            setJobError(data.errorMessage || data.error || 'Generation job failed');
          }
        }
      })
      .catch(() => {});
  }, [academicYear, semester]);

  // Single fetch on mount / selector change
  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch the selected cohort from the API.
    fetchEntries(true);
  }, [fetchEntries]);

  // Check live registration status from campus settings
  useEffect(() => {
    const controller = new AbortController();
    async function loadSettings() {
      try {
        const res = await fetch('/api/director/settings', { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        const destination = sessionRedirect(res.status, data);
        if (destination) { router.replace(destination); return; }
        if (!res.ok || !data.settings) throw new Error('Campus settings couldn’t be loaded. Please try again.');
        setCurrentDeadline(data.settings.deadline ?? null);
        setRegistrationClosed(!data.settings.deadline || new Date() >= new Date(data.settings.deadline));
        setSettingsReady(true);
        setSettingsError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSettingsReady(false);
          setSettingsError(error instanceof Error ? error.message : 'Campus settings couldn’t be loaded.');
        }
      }
    }
    loadSettings();
    return () => controller.abort();
  }, [router, settingsRetry]);

  // Set default selected department once data loads (prefer first department with active entries)
  useEffect(() => {
    if (departments.length > 0 && (!selectedDeptId || (selectedDeptId !== 'VIEW_ALL_CONFLICTS' && !departments.some((d) => d.id === selectedDeptId)))) {
      const deptWithEntries = departments.find((d) => allEntries.some((e) => e.departmentId === d.id));
      if (deptWithEntries) {

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Clears a selection invalidated by a refreshed external roster.
        setSelectedDeptId(deptWithEntries.id);
      } else {
        setSelectedDeptId(departments[0].id);
      }
    } else if (allEntries.length > 0 && !selectedDeptId) {
      setSelectedDeptId(allEntries[0].departmentId);
    }
  }, [allEntries, departments, selectedDeptId]);

  // Poll job status when running or queued
  useEffect(() => {
    if (jobStatus !== 'running' && jobStatus !== 'queued') return;

    let consecutiveErrors = 0;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/timetable/job-status?academicYear=${academicYear}&semester=${semester}`);
        if (!res.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= 6) {
            clearInterval(interval);
            setJobStatus('failed');
            setJobError('Unable to reach server to check generation progress. Please check your network connection and retry.');
          }
          return;
        }
        consecutiveErrors = 0;
        const data = await res.json();

        setJobStatus(data.status);
        setJobProgress(data.progress || 0);
        if (data.stepMessage) setStepMessage(data.stepMessage);

        if (data.status === 'completed') {
          clearInterval(interval);
          setSuccessMsg(data.stepMessage || 'Timetable generated successfully!');
          const storageKey = `fyimp:constraints:${academicYear}:${semester}`;
          sessionStorage.removeItem(storageKey);
          invalidateCache();

          setTimeout(() => {
            setShowGenerationOverlay(false);
          }, 1500);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setJobError(data.errorMessage || data.error || 'Generation job failed');
        }
      } catch (err) {
        consecutiveErrors++;
        console.error('Job status polling error:', err);
        if (consecutiveErrors >= 6) {
          clearInterval(interval);
          setJobStatus('failed');
          setJobError('Network connection to server timed out. Please check your internet connection and try clicking "Retry Generation".');
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [jobStatus, academicYear, semester, invalidateCache]);

  // ETC Countdown: starts at 3:00 when overlay opens, counts down, stops when overlay closes
  useEffect(() => {
    if (showGenerationOverlay && (jobStatus === 'running' || jobStatus === 'queued')) {
      if (etcIntervalRef.current) clearInterval(etcIntervalRef.current);
      etcIntervalRef.current = setInterval(() => {
        setEtcSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else {
      if (etcIntervalRef.current) {
        clearInterval(etcIntervalRef.current);
        etcIntervalRef.current = null;
      }
    }
    return () => {
      if (etcIntervalRef.current) clearInterval(etcIntervalRef.current);
    };
  }, [showGenerationOverlay, jobStatus]);

  async function handleCloseRegistrationWindow(proceedWithGeneration: boolean = false) {
    setClosingWindow(true);
    setErrorMsg(null);
    try {
      const nowIso = new Date().toISOString();
      const res = await fetch('/api/director/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: nowIso }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (typeof data.message === 'string' ? data.message : data.message?.error) || data.error || 'Failed to close registration window';
        setErrorMsg(msg);
        setClosingWindow(false);
        return;
      }
      setCurrentDeadline(nowIso);
      setRegistrationClosed(true);
      setShowCloseWindowConfirmModal(false);
      setSuccessMsg('Registration window closed successfully. Timetable generation is now unlocked.');
      setClosingWindow(false);

      if (proceedWithGeneration) {
        await executeGeneration();
      }
    } catch {
      setErrorMsg('Network error while closing registration window');
      setClosingWindow(false);
    }
  }

  // Handle Generate Timetable
  async function handleGenerate() {
    if (!settingsReady || !rulesReady || !baseConstraints) return;
    if (!registrationClosed) {
      setShowCloseWindowConfirmModal(true);
      return;
    }
    await executeGeneration();
  }

  async function executeGeneration() {
    if (!settingsReady || !rulesReady || !baseConstraints) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setJobError(null);
    setEtcSeconds(330); // 5 minutes 30 seconds (5 to 6 min range), independent of progress
    setShowGenerationOverlay(true);

    try {
      const res = await fetch('/api/timetable/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicYear,
          semester,
          rules: baseConstraints?.rules,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorText = (typeof data.message === 'string' ? data.message : data.message?.error) || data.error || 'Failed to start timetable generation';
        setErrorMsg(errorText);
        setJobError(errorText);
        setJobStatus('failed');
        return;
      }

      setJobStatus('queued');
      setJobProgress(5);
    } catch {
      const networkErr = 'Network error starting timetable generation';
      setErrorMsg(networkErr);
      setJobError(networkErr);
      setJobStatus('failed');
    }
  }

  async function handlePublish(force = false) {
    if (!settingsReady || loading || error) return;
    if (reviewDraft || allConflicts.length > 0) {
      setErrorMsg('Resolve unscheduled sessions and generate a complete verified timetable before publication.');
      return;
    }
    setPublishing(true);
    setPublishModalError(null);
    setPublishConflicts(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/timetable/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear, semester, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data.message === 'string'
          ? data.message
          : data.message?.error || data.error || 'Failed to publish timetable';

        if (data.conflicts && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          setPublishConflicts(data.conflicts);
          setPublishModalError(msg);
        } else {
          setPublishModalError(msg);
          setErrorMsg(msg);
        }
      } else {
        const countMsg = data.publishedCount ? ` (${data.publishedCount} active sessions)` : '';
        setSuccessMsg((data.message || 'Timetable published successfully') + countMsg);
        setShowPublishModal(false);
        setPublishModalError(null);
        setPublishConflicts(null);
        // Instantly update entries locally to show "published" status
        setAllEntries((prev) => prev.map((e) => ({ ...e, status: 'published' })));
        invalidateCache();
      }
    } catch {
      const netErr = 'Network error while publishing timetable. Please check your connection.';
      setPublishModalError(netErr);
      setErrorMsg(netErr);
    } finally {
      setPublishing(false);
    }
  }

  // Open Export Modal for Excel or PDF
  function handleOpenExportModal(type: 'excel' | 'pdf') {
    setExportType(type);
    setExportTargetDept('all');
    setShowExportModal(true);
  }

  // Confirm Export from Modal
  async function handleConfirmExport() {
    const targetDept = exportTargetDept;
    setShowExportModal(false);

    if (exportType === 'excel') {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'FYIMP Academic Portal';

      const deptMap = new Map<string, { id: string; name: string; code: string }>();

      departments.forEach((d) => {
        deptMap.set(d.id, { id: d.id, name: d.name, code: d.code || d.name });
      });

      allEntries.forEach((e) => {
        if (e.departmentId && !deptMap.has(e.departmentId)) {
          deptMap.set(e.departmentId, {
            id: e.departmentId,
            name: e.departmentName || 'Department',
            code: e.departmentName || 'Dept',
          });
        }
      });

      const deptsToExport = targetDept === 'all'
        ? Array.from(deptMap.values())
        : Array.from(deptMap.values()).filter((d) => d.id === targetDept);

      const usedSheetNames = new Set<string>();
      function getUniqueSheetName(rawName: string): string {
        let clean = rawName.replace(/[:\\/?*\[\]]/g, '').trim().substring(0, 30);
        if (!clean) clean = 'Sheet';
        let unique = clean;
        let counter = 1;
        while (usedSheetNames.has(unique.toLowerCase())) {
          const suffix = `_${counter}`;
          unique = clean.substring(0, 30 - suffix.length) + suffix;
          counter++;
        }
        usedSheetNames.add(unique.toLowerCase());
        return unique;
      }

      if (targetDept === 'all') {
        const allSheetRows: string[][] = [
          [`KANNUR UNIVERSITY — ALL DEPARTMENTS ${reviewDraft ? 'INCOMPLETE REVIEW DRAFT' : 'TIMETABLE OVERVIEW'}`],
          [`Academic Year: ${academicYear} | Semester: ${semester}`],
          [],
        ];

        deptsToExport.forEach((dept, idx) => {
          const deptEntries = entriesForDepartment(allEntries, dept.id, departments.find(d => d.id === dept.id)?.code);

          allSheetRows.push([`DEPARTMENT: ${dept.name.toUpperCase()} (${dept.code || dept.name})`]);
          allSheetRows.push(['Day / Period', ...PERIODS.map((p) => `${p.label} (${p.time})`)]);

          DAYS_LIST.forEach((dayNum) => {
            const row: string[] = [DAYS_MAP[dayNum]];
            PERIODS.forEach((p) => {
              const entries = deptEntries.filter((e) => e.day === dayNum && e.period === p.num);
              if (entries.length > 0) {
                const text = entries
                  .map((e) => `${e.courseCode} - ${e.courseName}${e.isLabBlock ? ' [LAB]' : ''}`)
                  .join(' / ');
                row.push(text);
              } else {
                row.push('—');
              }
            });
            allSheetRows.push(row);
          });

          if (idx < deptsToExport.length - 1) {
            for (let i = 0; i < 6; i++) {
              allSheetRows.push([]);
            }
          }
        });

        const allWs = wb.addWorksheet(getUniqueSheetName('All Departments'));
        allSheetRows.forEach((row) => allWs.addRow(row));
      }

      deptsToExport.forEach((dept) => {
        const deptEntries = entriesForDepartment(allEntries, dept.id, dept.code);
        const sheetData: string[][] = [
          [`KANNUR UNIVERSITY — ${dept.name.toUpperCase()} ${reviewDraft ? 'INCOMPLETE REVIEW DRAFT' : 'TIMETABLE'}`],
          [`Academic Year: ${academicYear} | Semester: ${semester}`],
          [],
          ['Day / Period', ...PERIODS.map((p) => `${p.label} (${p.time})`)],
        ];

        DAYS_LIST.forEach((dayNum) => {
          const row: string[] = [DAYS_MAP[dayNum]];
          PERIODS.forEach((p) => {
            const entries = deptEntries.filter((e) => e.day === dayNum && e.period === p.num);
            if (entries.length > 0) {
              const text = entries
                .map((e) => `${e.courseCode} - ${e.courseName}${e.isLabBlock ? ' [LAB]' : ''}`)
                .join(' / ');
              row.push(text);
            } else {
              row.push('—');
            }
          });
          sheetData.push(row);
        });

        const sheetName = getUniqueSheetName(dept.code || dept.name);
        const ws = wb.addWorksheet(sheetName);
        sheetData.forEach((row) => ws.addRow(row));
      });

      const selectedDeptObj = deptMap.get(targetDept);
      if (reviewDraft) {
        const pendingSheet = wb.addWorksheet(getUniqueSheetName('Unscheduled sessions'));
        pendingSheet.addRow(['REVIEW DRAFT — INCOMPLETE; NOT FOR PUBLICATION']);
        pendingSheet.addRow(['Course code', 'Course', 'Department', 'Session', 'Remaining periods', 'Reason']);
        allConflicts.filter(c => targetDept === 'all' || c.departmentId === targetDept).forEach(c =>
          pendingSheet.addRow([c.courseCode, c.courseName, c.departmentName, c.sessionType, c.periods, c.reason]));
        pendingSheet.columns.forEach(column => { column.width = 25; });
      }
      const fileTag = targetDept === 'all' ? 'All_Departments' : (selectedDeptObj?.code || selectedDeptObj?.name || 'Department');
      const filename = `FYIMP_${reviewDraft ? 'Review_Draft' : 'Timetable'}_${fileTag}_${academicYear}_Sem${semester}.xlsx`;
      const excelBuffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      setPrintTargetDept(targetDept);
      setTimeout(() => {
        window.print();
      }, 150);
    }
  }

  // Flexible Department Filter (matches both UUID and Department Code)
  const visibleEntries = !selectedDeptId || selectedDeptId === 'VIEW_ALL_CONFLICTS'
    ? allEntries
    : entriesForDepartment(allEntries, selectedDeptId, departments.find(d => d.id === selectedDeptId)?.code);

  function handleDeptChange(deptId: string) {
    setSelectedDeptId(deptId);
  }

  function getEntriesAt(day: number, period: number): TimetableEntry[] {
    return visibleEntries.filter((e) => Number(e.day) === Number(day) && Number(e.period) === Number(period));
  }

  const hasUnresolvedConflicts = allConflicts.length > 0;
  const isViewingConflictsSection = selectedDeptId === 'VIEW_ALL_CONFLICTS';

  const displayedConflicts = conflictDeptFilter === 'all'
    ? allConflicts
    : allConflicts.filter((c) => c.departmentId === conflictDeptFilter);

  const totalConflictingStudents = allConflicts.reduce((sum, c) => sum + (c.conflictingStudentCount || 0), 0);
  const impactedDeptIds = new Set(allConflicts.map((c) => c.departmentId).filter(Boolean));

  return (
    <div className={styles.pageWrapper}>
      {/* Top Navigation */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Image
            src="/knrunilogo.png"
            alt="KU"
            width={26}
            height={28}
            style={{ width: 'auto', height: '28px' }}
          />
          <div>
            <p className={styles.topBarTitle}>Timetable Management</p>
            <p className={styles.topBarSubtitle}>Campus Director Dashboard (AI-Powered Engine)</p>
          </div>
        </div>
        <NavigationLink className={styles.backBtn} href="/dashboard/director">
          ← Back to Dashboard
        </NavigationLink>
      </div>

      <div className={styles.mainContent}>
        {reviewDraft && <div role="status" className={styles.bannerWarning}>
          <strong>Incomplete review draft — {unscheduledPeriods} course periods remain unscheduled.</strong>
          <p>The displayed sessions satisfy the scheduling rules. Review the unscheduled sessions, adjust the catalogue or rules as appropriate, then generate again. This draft cannot be published.</p>
          <button onClick={() => setSelectedDeptId('VIEW_ALL_CONFLICTS')}>View unscheduled sessions</button>
        </div>}
        {!rulesReady && !rulesError && <p role="status">Loading scheduling rules…</p>}
        {rulesError && <div role="alert" className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">{rulesError}<button onClick={() => fetchBaseConstraints()}>Try again</button></div>}
        {!settingsReady && !settingsError && <p role="status">Loading campus settings…</p>}
        {settingsError && <div role="alert" className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">{settingsError}<button onClick={() => setSettingsRetry(value => value + 1)}>Try again</button></div>}
        {/* Registration Window Warning Banner */}
        {settingsReady && !registrationClosed && (
          <div className={styles.registrationWarningBanner}>
            <div className={styles.registrationWarningContent}>
              <span className={styles.registrationWarningIcon}>⚠️</span>
              <div>
                <p className={styles.registrationWarningTitle}>
                  Student Registration Window is Currently Open
                </p>
                <p className={styles.registrationWarningText}>
                  Registrations are open until {currentDeadline ? new Date(currentDeadline).toLocaleString('en-IN') : 'the set deadline'}. Student registrations must be closed before generating timetables so enrollments remain stable.
                </p>
              </div>
            </div>
            <NavigationLink
              type="button"
              className={styles.closeWindowQuickBtn}
              href="/dashboard/director"
            >
              Go to Registration Window →
            </NavigationLink>
          </div>
        )}

        {/* Controls Card */}
        <div className={styles.headerCard}>
          <div className={styles.controlsRow}>
            <div className={styles.controlsLeft}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Academic Year</label>
                <select
                  className={styles.select}
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                >
                  <option value="2026-27">2026-27</option>
                  <option value="2025-26">2025-26</option>
                  <option value="2024-25">2024-25</option>
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Semester</label>
                <select
                  className={styles.select}
                  value={semester}
                  onChange={(e) => setSemester(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                    <option key={s} value={s}>
                      Semester {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rules & Constraints Modal Trigger Button */}
              <button
                className={styles.rulesTriggerBtn}
                onClick={() => setShowRulesModal(true)}
                title="Manage custom and base scheduling constraints"
              >
                <span>⚙️ Scheduling Rules</span>
                <span className={styles.rulesBadge}>{baseConstraints?.rules.length ?? 0} Rules</span>
              </button>
            </div>

            <div className={styles.controlsRight}>
              <button
                className={styles.generateBtn}
                onClick={handleGenerate}
                disabled={!settingsReady || !rulesReady || !baseConstraints || jobStatus === 'running' || jobStatus === 'queued'}
                title={
                  !registrationClosed
                    ? 'Registration window must be closed before generation'
                    : 'Generate automated AI timetable'
                }
              >
                {jobStatus === 'running' || jobStatus === 'queued' ? 'Generating...' : '⚡ Generate AI Timetable'}
              </button>

              {(allEntries.length > 0 || reviewDraft) && (
                <>
                  <button
                    className={styles.exportExcelBtn}
                    onClick={() => handleOpenExportModal('excel')}
                    title="Export timetable as Excel workbook (.xlsx)"
                  >
                    📊 Export Excel (.xlsx)
                  </button>

                  <button
                    className={styles.exportPdfBtn}
                    onClick={() => handleOpenExportModal('pdf')}
                    title="Export timetable as PDF"
                  >
                    📄 Export PDF
                  </button>

                  <button
                    className={styles.exportExcelBtn}
                    onClick={() => {
                      setPublishModalError(null);
                      setPublishConflicts(null);
                      setShowPublishModal(true);
                    }}
                    disabled={!settingsReady || loading || !!error || reviewDraft || allConflicts.length > 0}
                    title="Publish timetable for students and faculty"
                    style={{ background: '#059669' }}
                  >
                    🚀 Publish Timetable
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Feedback Banners */}
        {errorMsg && <div className={styles.bannerError}>❌ {errorMsg}</div>}
        {successMsg && <div className={styles.bannerSuccess}>✓ {successMsg}</div>}

        {/* Page-level Fetch Error State with Retry Button */}
        {error && (
          <div className={styles.bannerError} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>❌ {error}</span>
            <button
              style={{
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                padding: '0.3rem 0.75rem',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
              onClick={() => invalidateCache()}
            >
              Retry
            </button>
          </div>
        )}

        {/* Prominent Conflicts Notice Banner with Instant Navigation */}
        {hasUnresolvedConflicts && (
          <div className={styles.bannerWarning} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <p style={{ fontWeight: 700, margin: '0 0 0.25rem 0', fontSize: '0.95rem' }}>
                ⚠️ {allConflicts.length} Course Scheduling Conflict(s) Require Attention
              </p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#78350f' }}>
                Required sessions remain unscheduled under the current hours, available periods and scheduling rules.
              </p>
            </div>
            <button
              style={{
                background: '#dc2626',
                color: '#ffffff',
                border: 'none',
                padding: '0.45rem 0.9rem',
                borderRadius: '0.35rem',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
              onClick={() => setSelectedDeptId('VIEW_ALL_CONFLICTS')}
            >
              🔍 View All {allConflicts.length} Conflicts →
            </button>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className={styles.tabsContainer}>
          {departments.map((dept) => (
            <button
              key={dept.id}
              className={`${styles.tab} ${selectedDeptId === dept.id ? styles.activeTab : ''}`}
              onClick={() => handleDeptChange(dept.id)}
              title={dept.name}
            >
              {dept.code || dept.name}
            </button>
          ))}

          {/* Dedicated Conflicts Tab Button */}
          {hasUnresolvedConflicts && (
            <button
              className={`${styles.conflictsTab} ${isViewingConflictsSection ? styles.activeConflictsTab : ''}`}
              onClick={() => setSelectedDeptId('VIEW_ALL_CONFLICTS')}
              title="View all scheduling conflicts across campus"
            >
              ⚠️ Unresolved Conflicts ({allConflicts.length})
            </button>
          )}
        </div>

        {/* VIEW 1: Dedicated Full Conflicts Section */}
        {isViewingConflictsSection ? (
          <div className={styles.conflictsSectionCard}>
            <div className={styles.conflictsSectionHeader}>
              <div>
                <h3 className={styles.conflictsSectionTitle}>
                  ⚠️ Campus Scheduling Conflicts ({allConflicts.length})
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  These required sessions remain unscheduled. Partially scheduled courses may still appear in the timetable grid.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>Filter Department:</span>
                <select
                  className={styles.select}
                  value={conflictDeptFilter}
                  onChange={(e) => setConflictDeptFilter(e.target.value)}
                >
                  <option value="all">All Departments ({allConflicts.length})</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code || d.name} ({allConflicts.filter((c) => c.departmentId === d.id).length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Summary Stat Cards */}
            <div className={styles.conflictsSummaryGrid}>
              <div className={styles.conflictStatCard}>
                <p className={styles.conflictStatValue}>{allConflicts.length}</p>
                <p className={styles.conflictStatLabel}>Unscheduled Sessions</p>
              </div>
              <div className={styles.conflictStatCard}>
                <p className={styles.conflictStatValue}>{impactedDeptIds.size}</p>
                <p className={styles.conflictStatLabel}>Impacted Departments</p>
              </div>
              <div className={styles.conflictStatCard}>
                <p className={styles.conflictStatValue}>{totalConflictingStudents}</p>
                <p className={styles.conflictStatLabel}>Total Student Impacts</p>
              </div>
            </div>

            {/* List of Individual Conflict Cards */}
            <div className={styles.conflictsList}>
              {displayedConflicts.map((c, idx) => (
                <div key={c.id || idx} className={styles.conflictItem}>
                  <div className={styles.conflictHeader}>
                    <div className={styles.conflictCourseTitle}>
                      {c.courseCode ? `[${c.courseCode}] ` : ''}{c.courseName}
                    </div>
                    {c.departmentName && (
                      <span className={styles.conflictDeptBadge}>
                        🏢 Department: {c.departmentName}
                      </span>
                    )}
                  </div>

                  <div className={styles.conflictReason}>
                    <strong>Conflict Reason:</strong> {c.reason}
                  </div>

                  <div className={styles.conflictFooter}>
                    <span>👥 Impacted Students: <strong>{c.conflictingStudentCount} student(s)</strong></span>
                    {c.departmentId && (
                      <button
                        style={{
                          background: '#002147',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '0.3rem',
                          padding: '0.25rem 0.65rem',
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        onClick={() => handleDeptChange(c.departmentId!)}
                      >
                        View {c.departmentCode || c.departmentName} Grid →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* VIEW 2: Regular Department Timetable Grid */
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: '#6366f1', background: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Loading timetable data...</p>
              </div>
            ) : departments.length > 0 ? (
              <div>
                {/* Active Department Header Banner */}
                {(() => {
                  const activeDept = departments.find((d) => d.id === selectedDeptId);
                  return (
                    <div className={styles.activeDeptBanner}>
                      <span className={styles.activeDeptTitle}>
                        🏛️ {activeDept?.name || 'Department'} ({activeDept?.code || 'Dept'}) Timetable
                      </span>
                      <span className={styles.activeDeptSub}>
                        Semester {semester} • Academic Year {academicYear}
                      </span>
                    </div>
                  );
                })()}

                <div className={styles.gridWrapper}>
                  <table className={styles.gridTable}>
                    <thead>
                      <tr>
                        <th style={{ width: '15%' }}>Day / Period</th>
                        {PERIODS.map((p) => (
                          <th key={p.num}>{p.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS_LIST.map((dayNum) => (
                        <tr key={dayNum}>
                          <td style={{ fontWeight: 700, background: '#f8fafc' }}>{DAYS_MAP[dayNum]}</td>
                          {PERIODS.map((p) => {
                            const entries = getEntriesAt(dayNum, p.num);
                            const isParallelSlot = entries.length > 1;
                            return (
                              <td key={p.num}>
                                {entries.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    {entries.map((entry, idx) => (
                                      <div key={entry.id || idx} className={styles.cellCourse}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                          <div className={styles.cellCourseCode}>{entry.courseCode}</div>
                                          {isParallelSlot && (
                                            <span
                                              style={{
                                                fontSize: '0.62rem',
                                                fontWeight: 700,
                                                background: '#dbeafe',
                                                color: '#1d4ed8',
                                                padding: '0.05rem 0.25rem',
                                                borderRadius: '0.2rem',
                                              }}
                                              title="Parallel Course (Alternative Elective)"
                                            >
                                              [P]
                                            </span>
                                          )}
                                        </div>
                                        <div className={styles.cellCourseTitle}>{entry.courseName}</div>
                                        {entry.isLabBlock && <span className={styles.labBadge}>Lab Block (2h)</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b', background: '#ffffff', borderRadius: '0.5rem' }}>
                <p>No timetable entries generated yet for Semester {semester} ({academicYear}).</p>
                <p style={{ fontSize: '0.85rem' }}>Click <strong>&quot;Generate AI Timetable&quot;</strong> above to run the scheduler.</p>
              </div>
            )}

            {/* In-Department Conflicts List (Below Grid) */}
            {hasUnresolvedConflicts && (
              <div className={styles.conflictsSectionCard} style={{ marginTop: '2rem' }}>
                <div className={styles.conflictsSectionHeader}>
                  <h4 className={styles.conflictsSectionTitle} style={{ fontSize: '1rem' }}>
                    ⚠️ Scheduling Conflicts in Active View ({allConflicts.filter((c) => !selectedDeptId || c.departmentId === selectedDeptId).length} of {allConflicts.length})
                  </h4>
                  <button
                    style={{
                      background: '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.35rem 0.85rem',
                      borderRadius: '0.3rem',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedDeptId('VIEW_ALL_CONFLICTS')}
                  >
                    Open Full Conflicts Dashboard →
                  </button>
                </div>

                <div className={styles.conflictsList}>
                  {allConflicts
                    .filter((c) => !selectedDeptId || c.departmentId === selectedDeptId)
                    .map((c, idx) => (
                      <div key={c.id || idx} className={styles.conflictItem}>
                        <div className={styles.conflictHeader}>
                          <div className={styles.conflictCourseTitle}>
                            {c.courseCode ? `[${c.courseCode}] ` : ''}{c.courseName}
                          </div>
                          {c.departmentName && (
                            <span className={styles.conflictDeptBadge}>
                              🏢 {c.departmentName}
                            </span>
                          )}
                        </div>
                        <div className={styles.conflictReason}>
                          <strong>Reason:</strong> {c.reason}
                        </div>
                        <div className={styles.conflictFooter}>
                          <span>👥 Impacted Students: <strong>{c.conflictingStudentCount} student(s)</strong></span>
                        </div>
                      </div>
                    ))}

                  {allConflicts.filter((c) => !selectedDeptId || c.departmentId === selectedDeptId).length === 0 && (
                    <p style={{ margin: '0.5rem 0', color: '#166534', fontWeight: 600, fontSize: '0.85rem' }}>
                      ✓ Zero conflicts in this department! (The remaining {allConflicts.length} conflict(s) are in other campus departments).
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FULL-SCREEN GENERATION PROGRESS OVERLAY */}
      {showGenerationOverlay && (
        <div className={styles.generationOverlay}>
          <div className={styles.generationModalCard}>
            <div className={styles.generationModalHeader}>
              <div className={styles.generationModalIcon}>
                {jobStatus === 'completed' ? '✓' : (jobStatus === 'failed' || !!jobError) ? '⚠️' : '✨'}
              </div>
              <div style={{ flex: 1 }}>
                <h3 className={styles.generationModalTitle}>
                  <span>AI Timetable Scheduler</span>
                  {(jobStatus === 'running' || jobStatus === 'queued') && !jobError && (
                    <span style={{ fontSize: '0.7rem', color: '#818cf8', background: 'rgba(99, 102, 241, 0.2)', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600 }}>
                      LIVE PROCESSING
                    </span>
                  )}
                </h3>
                <p className={styles.generationModalSubtitle}>
                  {jobError
                    ? jobError
                    : jobStatus === 'completed'
                    ? (stepMessage || '🎉 Timetable generation complete! All department schedules placed.')
                    : (stepMessage || '🧠 Processing scheduling constraints and student registrations with OR-Tools...')}
                </p>
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#818cf8' }}>
                {jobProgress}%
              </div>
            </div>

            {/* Progress Bar Track */}
            <div className={styles.aiProgressTrack} style={{ height: '8px', background: 'rgba(255, 255, 255, 0.1)' }}>
              <div
                className={styles.aiProgressFill}
                style={{
                  width: `${jobProgress}%`,
                  background: jobStatus === 'failed' ? '#ef4444' : 'linear-gradient(90deg, #6366f1, #a855f7)',
                }}
              />
            </div>

            {/* Step Pills */}
            <div className={styles.aiStepsContainer}>
              <div className={`${styles.aiStepPill} ${jobProgress >= 20 ? (jobProgress > 20 ? styles.aiStepDone : styles.aiStepActive) : ''}`}>
                <span>{jobProgress > 20 ? '✓' : '1'}</span>
                <span>Input Loaded</span>
              </div>
              <div className={`${styles.aiStepPill} ${jobProgress >= 40 ? (jobProgress > 40 ? styles.aiStepDone : styles.aiStepActive) : ''}`}>
                <span>{jobProgress > 40 ? '✓' : '2'}</span>
                <span>Scheduling</span>
              </div>
              <div className={`${styles.aiStepPill} ${jobProgress >= 70 ? (jobProgress > 70 ? styles.aiStepDone : styles.aiStepActive) : ''}`}>
                <span>{jobProgress > 70 ? '✓' : '3'}</span>
                <span>Validation</span>
              </div>
              <div className={`${styles.aiStepPill} ${jobProgress === 100 ? styles.aiStepDone : ''}`}>
                <span>{jobProgress === 100 ? '✓' : '4'}</span>
                <span>Ready</span>
              </div>
            </div>

            {/* ETC Countdown — independent 3-min timer, stops when overlay closes */}
            {(jobStatus === 'running' || jobStatus === 'queued') && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '1rem',
                padding: '0.75rem 1.25rem',
                background: 'rgba(99,102,241,0.12)',
                borderRadius: '0.6rem',
                border: '1px solid rgba(99,102,241,0.25)',
                width: '100%',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>⏱</span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.65rem', color: '#a5b4fc', letterSpacing: '0.05em', fontWeight: 600 }}>
                      ESTIMATED TIME REMAINING
                    </span>
                    <span style={{
                      fontSize: '1.7rem',
                      fontWeight: 800,
                      color: etcSeconds <= 30 ? '#f87171' : etcSeconds <= 60 ? '#fb923c' : '#c4b5fd',
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing: '0.04em',
                      lineHeight: 1.1,
                    }}>
                      {etcSeconds > 0
                        ? `${Math.floor(etcSeconds / 60).toString().padStart(2, '0')}:${(etcSeconds % 60).toString().padStart(2, '0')}`
                        : 'Finishing up...'}
                    </span>
                  </div>
                </div>
                {etcSeconds <= 30 && etcSeconds > 0 && (
                  <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700, background: 'rgba(52,211,153,0.15)', padding: '0.25rem 0.6rem', borderRadius: '0.3rem' }}>
                    Almost done!
                  </span>
                )}
              </div>
            )}

            {/* Footer Buttons for Failed, Completed, or Error States */}
            {(jobStatus === 'failed' || jobStatus === 'completed' || !!jobError) && (
              <div className={styles.generationModalFooter} style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                {(jobStatus === 'failed' || !!jobError) && (
                  <button
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.5rem',
                      padding: '0.65rem 1.25rem',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(79, 70, 229, 0.3)',
                    }}
                    onClick={handleGenerate}
                  >
                    ⚡ Retry Generation
                  </button>
                )}
                <button
                  className={styles.generationModalCloseBtn}
                  onClick={() => {
                    setShowGenerationOverlay(false);
                    setJobError(null);
                  }}
                >
                  {jobStatus === 'completed' ? 'View Generated Timetable →' : 'Close Overlay'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showRulesModal && baseConstraints && <BrowserRulesEditor rules={baseConstraints.rules} onSave={saveBrowserRules} onReset={resetBrowserRules} onClose={() => setShowRulesModal(false)} />}

      {/* Dedicated PDF Print Section */}
      <div className={styles.printArea}>
        {reviewDraft && <div>
          <h2>INCOMPLETE REVIEW DRAFT — NOT FOR PUBLICATION</h2>
          <p>{unscheduledPeriods} course periods remain unscheduled.</p>
          <ul>{allConflicts.filter(c => printTargetDept === 'all' || c.departmentId === printTargetDept).map((c, index) =>
            <li key={c.id || index}>{c.courseCode}: {c.reason}</li>)}</ul>
        </div>}
        {(printTargetDept === 'all'
          ? (departments.length > 0 ? departments : Array.from(new Set(allEntries.map((e) => e.departmentId))).map((id) => ({ id, name: allEntries.find((e) => e.departmentId === id)?.departmentName || 'Department' })))
          : departments.filter((d) => d.id === printTargetDept)
        ).map((dept) => {
          const deptEntries = entriesForDepartment(allEntries, dept.id, departments.find(d => d.id === dept.id)?.code);
          return (
            <div key={dept.id} className={styles.printDeptSection}>
              <div className={styles.printHeader}>
                <h2>KANNUR UNIVERSITY — {dept.name.toUpperCase()} TIMETABLE</h2>
                <p>Academic Year: {academicYear} | Semester: {semester}</p>
              </div>
              <table className={styles.gridTable}>
                <thead>
                  <tr>
                    <th style={{ width: '15%' }}>Day / Period</th>
                    {PERIODS.map((p) => (
                      <th key={p.num}>{p.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS_LIST.map((dayNum) => (
                    <tr key={dayNum}>
                      <td style={{ fontWeight: 700, background: '#f8fafc' }}>{DAYS_MAP[dayNum]}</td>
                      {PERIODS.map((p) => {
                        const entries = deptEntries.filter((e) => e.day === dayNum && e.period === p.num);
                        const isParallelSlot = entries.length > 1;
                        return (
                          <td key={p.num}>
                            {entries.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {entries.map((entry, idx) => (
                                  <div key={entry.id || idx} className={styles.cellCourse}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                      <div className={styles.cellCourseCode}>{entry.courseCode}</div>
                                      {isParallelSlot && (
                                        <span
                                          style={{
                                            fontSize: '0.62rem',
                                            fontWeight: 700,
                                            background: '#dbeafe',
                                            color: '#1d4ed8',
                                            padding: '0.05rem 0.25rem',
                                            borderRadius: '0.2rem',
                                          }}
                                        >
                                          [P]
                                        </span>
                                      )}
                                    </div>
                                    <div className={styles.cellCourseTitle}>{entry.courseName}</div>
                                    {entry.isLabBlock && <span className={styles.labBadge}>Lab Block (2h)</span>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Export Options Modal */}
      {showExportModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>
              {exportType === 'excel' ? '📊 Export Excel (.xlsx)' : '📄 Export PDF'}
            </h3>
            <p className={styles.modalSubtitle}>
              Select which department schedule you want to export for Semester {semester} ({academicYear}):
            </p>

            <div className={styles.fieldGroup} style={{ marginTop: '1.25rem' }}>
              <label className={styles.label}>Select Export Scope</label>
              <select
                className={styles.select}
                style={{ width: '100%' }}
                value={exportTargetDept}
                onChange={(e) => setExportTargetDept(e.target.value)}
              >
                <option value="all">🌐 All Departments (Entire Campus)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    🏢 {d.name} ({d.code || d.name})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className={styles.modalCancelBtn}
                style={{
                  background: 'transparent',
                  border: '1px solid #cbd5e1',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  background: exportType === 'excel' ? '#166534' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '0.375rem',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
                onClick={handleConfirmExport}
              >
                {exportType === 'excel' ? 'Download Excel →' : 'Print / Export PDF →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Modal */}
      {showPublishModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className={styles.modalTitle} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>🚀</span> Confirm Timetable Publication
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowPublishModal(false);
                  setPublishModalError(null);
                  setPublishConflicts(null);
                }}
                disabled={publishing}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.1rem',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '0.25rem',
                }}
              >
                ✕
              </button>
            </div>

            <p className={styles.modalSubtitle} style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
              Are you sure you want to publish the timetable for <strong>Semester {semester} ({academicYear})</strong>? Once published, the schedule will instantly be activated and visible to all faculty members and enrolled students.
            </p>

            {publishModalError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '0.5rem',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#991b1b',
                }}
              >
                <strong>⚠️ Note:</strong> {publishModalError}
              </div>
            )}

            {publishConflicts && publishConflicts.length > 0 && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '0.5rem',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  fontSize: '0.8rem',
                  color: '#92400e',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                  {publishConflicts.length} Conflict{publishConflicts.length > 1 ? 's' : ''} Detected:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.4 }}>
                  {publishConflicts.map((c, idx) => (
                    <li key={idx} style={{ marginBottom: '0.25rem' }}>
                      <strong>{c.courseName}:</strong> {c.reason} ({c.conflictingStudentCount} student{c.conflictingStudentCount === 1 ? '' : 's'})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                style={{
                  background: 'transparent',
                  border: '1px solid #cbd5e1',
                  padding: '0.55rem 1rem',
                  borderRadius: '0.375rem',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  color: '#475569',
                }}
                onClick={() => {
                  setShowPublishModal(false);
                  setPublishModalError(null);
                  setPublishConflicts(null);
                }}
                disabled={publishing}
              >
                Cancel
              </button>

              {publishConflicts && publishConflicts.length > 0 ? (
                <button
                  type="button"
                  style={{
                    background: '#d97706',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.55rem 1.25rem',
                    borderRadius: '0.375rem',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: publishing ? 'not-allowed' : 'pointer',
                    opacity: publishing ? 0.7 : 1,
                  }}
                  onClick={() => handlePublish(true)}
                  disabled={publishing}
                >
                  {publishing ? 'Publishing...' : 'Publish Anyway with Conflicts ⚠️'}
                </button>
              ) : (
                <button
                  type="button"
                  style={{
                    background: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.55rem 1.25rem',
                    borderRadius: '0.375rem',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: publishing ? 'not-allowed' : 'pointer',
                    opacity: publishing ? 0.7 : 1,
                  }}
                  onClick={() => handlePublish(false)}
                  disabled={publishing}
                >
                  {publishing ? 'Publishing...' : 'Yes, Publish Timetable 🚀'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Confirm Close Window & Generate Modal */}
      {showCloseWindowConfirmModal && (
        <div className={styles.rulesModalOverlay}>
          <div className={styles.rulesModal} style={{ maxWidth: '460px' }}>
            <div className={styles.rulesModalHeader}>
              <h3 className={styles.rulesModalTitle}>
                <span>⚠️ Registration Window Open</span>
              </h3>
              <button
                className={styles.rulesModalCloseBtn}
                onClick={() => setShowCloseWindowConfirmModal(false)}
                disabled={closingWindow}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '1.25rem 1.5rem' }}>
              <p style={{ margin: '0 0 0.85rem 0', color: '#1e293b', fontSize: '0.92rem', lineHeight: '1.5' }}>
                Student registration is currently open until{' '}
                <strong>{currentDeadline ? new Date(currentDeadline).toLocaleString('en-IN') : 'the set deadline'}</strong>.
              </p>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.85rem', lineHeight: '1.5' }}>
                To schedule an accurate timetable with no course conflicts, student registrations must be closed before generating. Would you like to close registrations now and generate the timetable?
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: '1px solid #cbd5e1',
                    padding: '0.55rem 1rem',
                    borderRadius: '0.45rem',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    color: '#475569',
                  }}
                  onClick={() => setShowCloseWindowConfirmModal(false)}
                  disabled={closingWindow}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{
                    background: '#002147',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.55rem 1.25rem',
                    borderRadius: '0.45rem',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: closingWindow ? 'not-allowed' : 'pointer',
                    opacity: closingWindow ? 0.7 : 1,
                  }}
                  onClick={() => handleCloseRegistrationWindow(true)}
                  disabled={closingWindow}
                >
                  {closingWindow ? 'Closing & Generating...' : 'Close Window & Generate ⚡'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
