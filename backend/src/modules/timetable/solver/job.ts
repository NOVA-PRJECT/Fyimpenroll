import { SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { runOrtoolsSolver, OrtoolsInputPayload } from './ortools-runner';
import { loadGenerationInput } from './loader';
import { validateTimetable, violationsToText } from './validator';
import { DynamicConstraint, AIAssignment, AIGeneratorResponse } from './types';

function formatSolverErrorMessage(raw: string): string {
  if (raw.includes('already exists') || raw.includes('immutable')) {
    return raw;
  }
  if (raw.includes('INFEASIBLE')) {
    return `Timetable generation is mathematically infeasible under current constraints. Check contact hours, teacher availability, and time slot restrictions. ${raw}`;
  }
  if (raw.includes('UNKNOWN') || raw.includes('timed out')) {
    return 'Solver reached its execution time limit without finding a complete schedule. You may retry or relax conflicting soft preferences.';
  }
  if (raw.includes('Independent validator rejected')) {
    return raw;
  }
  return `Timetable solver failed: ${raw}`;
}

const BASE_CONSTRAINTS_PATH = path.join(__dirname, 'constraints.base.json');

function loadMergedConstraints(campusSettingsConstraints?: Record<string, any>): {
  constraints: Record<string, any>;
  ruleHash: string;
} {
  let base: Record<string, any> = {};
  try {
    if (fs.existsSync(BASE_CONSTRAINTS_PATH)) {
      base = JSON.parse(fs.readFileSync(BASE_CONSTRAINTS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('Warning: Could not read base constraints JSON:', err);
  }

  const merged = {
    ...base,
    ...(campusSettingsConstraints || {}),
  };

  const ruleHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(merged))
    .digest('hex')
    .slice(0, 16);

  return { constraints: merged, ruleHash };
}

export async function runGenerationJob(
  jobId: string,
  academicYear: string,
  semester: number,
  triggeredBy: string,
  supabase: SupabaseClient,
  redis: Redis,
  campusId?: string,
  dynamicConstraints: DynamicConstraint[] = [],
  campusConstraints?: Record<string, any>
): Promise<void> {
  const redisKey = `timetable:job:${academicYear}:${semester}${campusId ? `:${campusId}` : ''}`;
  const dbClient = supabase;

  let currentStats: Record<string, any> = {};

  const reportProgress = async (
    progress: number,
    stepMessage: string,
    stats: Record<string, any> = {}
  ) => {
    currentStats = { ...currentStats, ...stats };
    const payload = {
      status: 'running',
      progress,
      stepMessage,
      stats: currentStats,
      jobId,
    };
    await redis.set(redisKey, JSON.stringify(payload), { ex: 3600 });
    try {
      await dbClient
        .from('timetable_generation_jobs')
        .update({
          progress,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    } catch {
      // Non-blocking progress sync
    }
  };

  try {
    // 1. Mark running
    await dbClient
      .from('timetable_generation_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', jobId);

    await reportProgress(5, '🚀 Initializing OR-Tools CP-SAT timetable generation job...');

    // Resolve campus departments
    let deptIds: string[] = [];
    if (campusId) {
      const { data: depts, error: deptsErr } = await dbClient
        .from('departments')
        .select('id')
        .eq('campus_id', campusId);

      if (deptsErr) {
        throw new Error(`Failed to resolve campus departments: ${deptsErr.message}`);
      }
      deptIds = (depts || []).map((d: any) => d.id);
    } else {
      throw new Error('Cannot execute timetable generation without explicit campusId scope');
    }

    if (deptIds.length === 0) {
      throw new Error('Campus has no registered departments. Generation cannot proceed.');
    }

    // F33: Immutable publication guard — NEVER regenerate if published schedule exists!
    const { data: publishedRows, error: pubCheckErr } = await dbClient
      .from('timetable_entries')
      .select('id')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('status', 'published')
      .in('department_id', deptIds)
      .limit(1);

    if (pubCheckErr) {
      console.warn('Warning: Error checking published entries:', pubCheckErr);
    }

    if (publishedRows && publishedRows.length > 0) {
      throw new Error(
        `Cannot regenerate timetable: A published timetable already exists for ${academicYear} Semester ${semester}. Published timetables are strictly immutable (F33).`
      );
    }

    // 2. Load input data with live status callback (20%)
    const {
      courses,
      slotMap,
      slotLookup,
      studentDeptMap,
      parallelGroups,
      teacherReservations,
      preflightDiagnostics,
      stats: loadStats,
    } = await loadGenerationInput(
      dbClient,
      academicYear,
      semester,
      campusId,
      async (p, msg, st) => {
        await reportProgress(Math.min(20, p), msg, st || {});
      }
    );

    // Load effective constraints snapshot (F39)
    const { constraints: effectiveConstraints, ruleHash } = loadMergedConstraints(campusConstraints);

    await reportProgress(
      25,
      `📚 Loaded ${courses.length} courses across ${parallelGroups.length} parallel baskets. Compiling OR-Tools model (Rule hash: ${ruleHash})...`,
      { ...loadStats, preflightDiagnosticsCount: preflightDiagnostics.length }
    );

    // 3. Prepare payload for local OR-Tools CP-SAT Solver
    const ortoolsPayload: OrtoolsInputPayload = {
      academic_year: academicYear,
      semester,
      campus_id: campusId,
      courses: courses.map((c) => ({
        courseId: c.courseId,
        courseCode: c.courseCode,
        courseTitle: c.courseTitle,
        departmentId: c.departmentId,
        category: c.category,
        theoryHours: c.theoryHours,
        practicalHours: c.practicalHours,
        isCrossDept: c.isCrossDept,
        studentIds: Array.from(c.studentIds),
        teacherId: c.teacherId,
      })),
      parallel_groups: parallelGroups.map((g) => ({
        groupId: g.groupId,
        departmentId: g.departmentId,
        category: g.category,
        courseIds: g.courseIds,
      })),
      teacher_reservations: teacherReservations.map((r) => ({
        teacherId: r.teacherId,
        day: r.day,
        period: r.period,
        source: `sem_${r.sourceSemester || 'other'}_crs_${r.sourceCourseId || 'other'}`,
      })),
      constraints: {
        ...effectiveConstraints,
        dynamic_constraints: dynamicConstraints,
      },
      config: {
        max_time_in_seconds: 30,
        num_workers: 4,
        random_seed: 42,
      },
    };

    await reportProgress(40, '⚙️ Executing local OR-Tools CP-SAT constraint optimization...');

    // 4. Run solver process
    const solverResult = await runOrtoolsSolver(ortoolsPayload);

    await reportProgress(
      70,
      `🔍 Solver completed in ${solverResult.stats.wall_time_seconds.toFixed(2)}s with status ${solverResult.status}. Validating output independently...`,
      { solverStatus: solverResult.status, wallTime: solverResult.stats.wall_time_seconds }
    );

    // 5. Handle solver status
    if (solverResult.status !== 'OPTIMAL' && solverResult.status !== 'FEASIBLE') {
      if (solverResult.status === 'INFEASIBLE') {
        throw new Error(
          `OR-Tools proved timetable is INFEASIBLE under current constraints. Diagnostics: ${
            solverResult.diagnostics.join('; ') || 'No feasible slot combination exists'
          }`
        );
      } else if (solverResult.status === 'UNKNOWN') {
        throw new Error(
          'OR-Tools solver execution timed out without proving a feasible schedule (UNKNOWN). Retry or review constraint density.'
        );
      } else {
        throw new Error(
          `OR-Tools solver model error (${solverResult.status}): ${solverResult.diagnostics.join('; ')}`
        );
      }
    }

    // 6. Map solver assignments into format expected by validator
    const assignmentsByCourse = new Map<string, AIAssignment>();
    for (const a of solverResult.assignments) {
      let cAssign = assignmentsByCourse.get(a.courseId);
      if (!cAssign) {
        cAssign = { courseId: a.courseId, slots: [] };
        assignmentsByCourse.set(a.courseId, cAssign);
      }
      cAssign.slots.push({
        day: a.day,
        period: a.period,
        sessionType: a.sessionType,
        isLabBlock: a.isLabBlock,
      });
    }

    const candidateResponse: AIGeneratorResponse = {
      assignments: Array.from(assignmentsByCourse.values()),
    };

    // Independent validation (F36, F37, F71)
    const violations = validateTimetable(
      candidateResponse,
      courses,
      slotMap,
      parallelGroups,
      teacherReservations
    );

    if (violations.length > 0) {
      const summary = violationsToText(violations).slice(0, 3).join('; ');
      throw new Error(
        `Independent validator rejected solver output with ${violations.length} violation(s): ${summary}`
      );
    }

    await reportProgress(
      80,
      '✅ Schedule independently verified with 0 violations. Preparing database commit...',
      loadStats
    );

    // 7. Atomic replacement of DRAFT entries ONLY (F33 & F34)
    // Only delete draft entries for this campus, academic year, and semester! Never touch published entries!
    const { error: deleteErr } = await dbClient
      .from('timetable_entries')
      .delete()
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('status', 'draft')
      .in('department_id', deptIds);

    if (deleteErr) {
      console.warn('Warning: Error deleting prior draft entries:', deleteErr);
    }

    // Clear old unresolved conflicts strictly scoped to this campus's courses (F34)
    const { data: campusCourses } = await dbClient
      .from('courses')
      .select('id')
      .in('department_id', deptIds);

    const campusCourseIds = (campusCourses || []).map((c: any) => c.id);
    if (campusCourseIds.length > 0) {
      await dbClient
        .from('timetable_conflicts')
        .delete()
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .in('course_id', campusCourseIds);
    }

    // 8. Bulk insert new draft assignments (90%)
    await reportProgress(
      90,
      `💾 Committing ${solverResult.assignments.length} verified schedule entries to database...`,
      {
        ...loadStats,
        placedEntries: solverResult.assignments.length,
        solverStatus: solverResult.status,
      }
    );

    const entryRows: any[] = [];
    for (const a of solverResult.assignments) {
      const daySlots = slotMap.get(a.day);
      const slotUuid = daySlots?.get(a.period);
      if (!slotUuid) {
        throw new Error(`Missing time_slots uuid for day ${a.day} period ${a.period}`);
      }

      const courseObj = courses.find((c) => c.courseId === a.courseId);

      entryRows.push({
        academic_year: academicYear,
        semester,
        course_id: a.courseId,
        department_id: a.departmentId,
        time_slot_id: slotUuid,
        is_lab_block: a.isLabBlock,
        session_type: a.sessionType,
        teacher_id: courseObj?.teacherId ?? null,
        status: 'draft',
      });
    }

    // Insert in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < entryRows.length; i += CHUNK_SIZE) {
      const chunk = entryRows.slice(i, i + CHUNK_SIZE);
      const { error: insertErr } = await dbClient.from('timetable_entries').insert(chunk);
      if (insertErr) {
        throw new Error(`Failed to save timetable entries: ${insertErr.message}`);
      }
    }

    // 9. Mark complete (100%)
    await dbClient
      .from('timetable_generation_jobs')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', jobId);

    const completionMsg = `🎉 OR-Tools Timetable generated successfully with ${solverResult.assignments.length} entries (${solverResult.status}). Zero violations!`;

    const finalPayload = {
      status: 'completed',
      progress: 100,
      stepMessage: completionMsg,
      stats: {
        ...loadStats,
        savedEntriesCount: solverResult.assignments.length,
        solverStatus: solverResult.status,
        wallTime: solverResult.stats.wall_time_seconds,
        ruleHash,
      },
      jobId,
    };
    await redis.set(redisKey, JSON.stringify(finalPayload), { ex: 3600 });
  } catch (err: any) {
    console.error('Timetable generation job failed:', err);

    const friendlyError = formatSolverErrorMessage(err.message || String(err));

    // 1. Attempt Redis update first (fast in-memory notification for frontend polling)
    try {
      const failPayload = {
        status: 'failed',
        progress: 0,
        stepMessage: `Generation failed: ${friendlyError}`,
        errorMessage: friendlyError,
        jobId,
      };
      await redis.set(redisKey, JSON.stringify(failPayload), { ex: 3600 });
    } catch (redisErr) {
      console.error('Warning: Failed to update Redis job failure status:', redisErr);
    }

    // 2. Attempt Database record update
    try {
      await dbClient
        .from('timetable_generation_jobs')
        .update({
          status: 'failed',
          error_message: friendlyError,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    } catch (dbErr) {
      console.error('Warning: Failed to update DB job failure status:', dbErr);
    }
  }
}
