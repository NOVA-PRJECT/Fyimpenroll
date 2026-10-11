import { SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { FileConstraintStoreService } from './file-constraint-store.service';
import { runOrtoolsSolver, OrtoolsInputPayload } from './ortools-runner';
import { loadGenerationInput } from './loader';
import { validateTimetable, violationsToText } from './validator';
import { DynamicConstraint, AIAssignment, AIGeneratorResponse } from './types';
import { createReviewDraft, saveReviewDraft } from './review-draft';

function formatSolverErrorMessage(raw: string): string {
  if (raw.includes('timetable_entries_unique')) {
    return 'The database still uses the old timetable draft schema. Apply the verified timetable draft repair SQL, then generate again. The save failed atomically; no replacement timetable was committed.';
  }
  if (raw.includes('already exists') || raw.includes('immutable')) {
    return raw;
  }
  if (raw.includes('INFEASIBLE')) {
    return `Timetable generation is mathematically infeasible under current constraints. Check contact hours, teacher availability, and time slot restrictions. ${raw}`;
  }
  if (raw.includes('UNKNOWN') || raw.includes('timed out')) {
    return `Solver reached its execution time limit without finding a complete schedule. This does not prove the schedule is impossible. Review enrollment conflicts, contact hours and available periods. ${raw}`;
  }
  if (raw.includes('Independent validator rejected')) {
    return raw;
  }
  return `Timetable solver failed: ${raw}`;
}

const fileConstraintStore = new FileConstraintStoreService();

export async function runGenerationJob(
  jobId: string,
  academicYear: string,
  semester: number,
  triggeredBy: string,
  supabase: SupabaseClient,
  redis: Redis,
  campusId?: string,
  dynamicConstraints: DynamicConstraint[] = [],
  campusConstraints?: Record<string, any>,
  fencingToken?: string
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
    const { error } = await dbClient.rpc('update_timetable_worker', {
      p_job_id: jobId, p_fencing_token: fencingToken, p_status: 'running', p_progress: progress,
    });
    if (error) throw new Error(`Worker claim rejected: ${error.message}`);
    await redis.set(redisKey, JSON.stringify(payload), { ex: 3600 }).catch(() => {});
  };

  try {
    if (!fencingToken) throw new Error('A worker fencing token is required');
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

    // F33 & R06: Immutable publication guard — NEVER regenerate if published schedule exists for this campus!
    let pubCheckQuery = dbClient
      .from('timetable_entries')
      .select('id')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('status', 'published');

    if (campusId) {
      pubCheckQuery = pubCheckQuery.or(`campus_id.eq.${campusId},department_id.in.(${deptIds.join(',')})`);
    } else {
      pubCheckQuery = pubCheckQuery.in('department_id', deptIds);
    }

    const { data: publishedRows, error: pubCheckErr } = await pubCheckQuery.limit(1);

    if (pubCheckErr) {
      throw new Error(`Could not verify publication state: ${pubCheckErr.message}`);
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

    // R19 & R20: Load effective typed rules and schedule config from durable file store
    const effectiveDoc = fileConstraintStore.getBaseConstraints();
    effectiveDoc.rules = [...(campusConstraints?.rules ?? effectiveDoc.rules), ...dynamicConstraints.map(c => c.typedRule).filter(Boolean)]
      .filter((rule: any) => !rule.targetSemester || rule.targetSemester === semester);
    const ruleHash = fileConstraintStore.computeRuleHash(effectiveDoc);

    await reportProgress(
      25,
      `📚 Loaded ${courses.length} courses across ${parallelGroups.length} parallel baskets. Compiling OR-Tools model (Rule hash: ${ruleHash.slice(0, 12)})...`,
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
        campusPaper: c.campusPaper,
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
        schedule: effectiveDoc.schedule,
        rules: effectiveDoc.rules,
        semester_constraints: effectiveDoc.semester_constraints,
        dynamic_constraints: dynamicConstraints,
      },
      rules: effectiveDoc.rules,
      config: {
        max_time_in_seconds: 240,
        num_workers: 4,
        random_seed: 42,
      },
    };

    await reportProgress(40, '⚙️ Executing local OR-Tools CP-SAT constraint optimization...');

    // 4. Run solver process
    let solverResult = await runOrtoolsSolver(ortoolsPayload);
    if (solverResult.status === 'INFEASIBLE' || solverResult.status === 'UNKNOWN') {
      const completeDiagnostics = solverResult.diagnostics;
      await reportProgress(60, 'Building a conflict-free review draft and listing sessions that cannot fit...');
      solverResult = await runOrtoolsSolver({ ...ortoolsPayload,
        config: { ...ortoolsPayload.config, allow_partial: true, max_time_in_seconds: 60 } });
      solverResult.diagnostics = [...completeDiagnostics, ...solverResult.diagnostics];
      if (solverResult.status === 'UNKNOWN') {
        solverResult.status = 'PARTIAL';
        solverResult.assignments = [];
        solverResult.unscheduled = courses.flatMap(course => [
          ...Array.from({ length: course.theoryHours }, (_, i) => ({ courseId: course.courseId,
            sessionId: `theory-${i + 1}`, sessionType: 'theory' as const, periods: 1,
            reason: 'No verified placement was found before the search limit.' })),
          ...Array.from({ length: Math.ceil(course.practicalHours / 2) }, (_, i) => ({ courseId: course.courseId,
            sessionId: `practical-${i + 1}`, sessionType: 'practical' as const,
            periods: Math.min(2, course.practicalHours - i * 2),
            reason: 'No verified placement was found before the search limit.' })),
        ]);
      }
    }

    await reportProgress(
      70,
      `🔍 Solver completed in ${solverResult.stats.wall_time_seconds.toFixed(2)}s with status ${solverResult.status}. Validating output independently...`,
      { ...solverResult.stats, solverStatus: solverResult.status, wallTime: solverResult.stats.wall_time_seconds }
    );

    // 5. Handle solver status
    if (!['OPTIMAL', 'FEASIBLE', 'PARTIAL'].includes(solverResult.status)) {
      if (solverResult.status === 'INFEASIBLE') {
        throw new Error(
          `OR-Tools proved timetable is INFEASIBLE under current constraints. Diagnostics: ${
            solverResult.diagnostics.join('; ') || 'No feasible slot combination exists'
          }`
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

    // Independent validation with semester context and effective rules (F36, F37, F71, R17, R18, R19, R21)
    const violations = validateTimetable(
      candidateResponse,
      courses,
      slotMap,
      parallelGroups,
      teacherReservations,
      {
        semester,
        effectiveRules: effectiveDoc.rules,
        allowPartial: solverResult.status === 'PARTIAL',
      }
    );

    if (violations.length > 0) {
      const summary = violationsToText(violations).slice(0, 3).join('; ');
      throw new Error(
        `Independent validator rejected solver output with ${violations.length} violation(s): ${summary}`
      );
    }

    if (solverResult.status === 'PARTIAL') {
      const draft = createReviewDraft(solverResult, courses);
      await saveReviewDraft(dbClient, jobId, fencingToken, campusId!, draft);
      await redis.set(redisKey, JSON.stringify({ status: 'completed', progress: 100, jobId,
        stepMessage: `Review draft ready: ${draft.entries.length} periods placed and ${draft.unscheduledPeriods} unscheduled. Publication is blocked until all sessions are resolved.`,
        stats: { ...loadStats, solverStatus: 'PARTIAL', unscheduledPeriods: draft.unscheduledPeriods },
      }), { ex: 3600 }).catch(() => {});
      return;
    }

    await reportProgress(
      80,
      '✅ Schedule independently verified with 0 violations. Preparing database commit...',
      loadStats
    );

    // 7. Stage complete verified assignments for atomic swap (R22)
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
        campus_id: campusId || null,
        time_slot_id: slotUuid,
        is_lab_block: a.isLabBlock,
        session_type: a.sessionType,
        teacher_id: courseObj?.teacherId ?? null,
        status: 'draft',
      });
    }

    // Verify worker lease hasn't expired before committing entries
    const { data: jobCheck } = await dbClient
      .from('timetable_generation_jobs')
      .select('status, error_message')
      .eq('id', jobId)
      .maybeSingle();

    if (jobCheck && jobCheck.status === 'failed') {
      throw new Error(`Worker lease expired or was cancelled before commit: ${jobCheck.error_message || 'Job aborted'}`);
    }

    // 8. Atomic replacement of DRAFT entries (R22)
    await reportProgress(
      90,
      `💾 Committing ${solverResult.assignments.length} verified schedule entries to database atomically...`,
      {
        ...loadStats,
        placedEntries: solverResult.assignments.length,
        solverStatus: solverResult.status,
      }
    );

    const { error: replaceErr } = await dbClient.rpc('atomic_replace_timetable_draft', {
      p_campus_id: campusId, p_academic_year: academicYear, p_semester: semester,
      p_entries: entryRows, p_job_id: jobId, p_fencing_token: fencingToken,
    });
    if (replaceErr) throw new Error(`Atomic draft replacement failed: ${replaceErr.message}`);

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
    await redis.set(redisKey, JSON.stringify(finalPayload), { ex: 3600 }).catch(() => {});
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
        stats: currentStats,
        jobId,
      };
      await redis.set(redisKey, JSON.stringify(failPayload), { ex: 3600 });
    } catch (redisErr) {
      console.error('Warning: Failed to update Redis job failure status:', redisErr);
    }

    // 2. Attempt Database record update
    try {
      await dbClient.rpc('update_timetable_worker', {
        p_job_id: jobId, p_fencing_token: fencingToken, p_status: 'failed', p_progress: 0, p_error: friendlyError,
      });
    } catch (dbErr) {
      console.error('Warning: Failed to update DB job failure status:', dbErr);
    }
  }
}
