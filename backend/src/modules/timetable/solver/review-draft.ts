import { SupabaseClient } from '@supabase/supabase-js';
import { CourseNode } from './types';
import { OrtoolsSolverResult } from './ortools-runner';

export function createReviewDraft(result: OrtoolsSolverResult, courses: CourseNode[]) {
  const byId = new Map(courses.map(course => [course.courseId, course]));
  const remaining = result.unscheduled || [];
  for (const course of courses) {
    for (const sessionType of ['theory', 'practical'] as const) {
      const placed = result.assignments.filter(a => a.courseId === course.courseId && a.sessionType === sessionType).length;
      const pending = remaining.filter(a => a.courseId === course.courseId && a.sessionType === sessionType)
        .reduce((sum, a) => sum + a.periods, 0);
      const required = sessionType === 'theory' ? course.theoryHours : course.practicalHours;
      if (placed + pending !== required) throw new Error(`Incomplete draft accounting for ${course.courseCode} ${sessionType}.`);
    }
  }
  const entries = result.assignments.map((a, index) => {
    const course = byId.get(a.courseId);
    if (!course) throw new Error('Draft references an unknown course.');
    return { ...a, id: `review-${index}`, courseName: course.courseTitle, courseCode: course.courseCode,
      category: course.category, departmentName: course.departmentName, status: 'review_draft' };
  });
  const conflicts = remaining.map((session, index) => {
    const course = byId.get(session.courseId);
    if (!course || !Number.isInteger(session.periods) || session.periods < 1) throw new Error('Invalid unscheduled session.');
    return { ...session, id: `unscheduled-${index}`, courseName: course.courseTitle, courseCode: course.courseCode,
      departmentId: course.departmentId, departmentName: course.departmentName,
      reason: `${session.periods} ${session.sessionType} period(s) unscheduled. ${session.reason}`,
      conflictingStudentCount: course.studentIds.size };
  });
  return { kind: 'review_draft' as const, entries, conflicts, unscheduledPeriods: remaining.reduce((sum, s) => sum + s.periods, 0),
    diagnostics: result.diagnostics, stats: result.stats };
}

/** Durable preview only: never touches timetable_entries or creates a publishable fingerprint. */
export async function saveReviewDraft(db: SupabaseClient, jobId: string, fencingToken: string,
  campusId: string, draft: ReturnType<typeof createReviewDraft>) {
  const { data: job, error } = await db.from('system_logs').select('metadata, updated_at')
    .eq('id', jobId).eq('log_type', 'timetable_job').eq('campus_id', campusId)
    .eq('status', 'running').eq('metadata->>fencing_token', fencingToken).maybeSingle();
  if (error || !job) throw new Error('Missing or stale worker claim for review draft.');
  const metadata = { ...job.metadata, reviewDraft: draft };
  delete metadata.draft_hash;
  const cutoff = new Date(Date.now() - (Number(job.metadata?.lease_seconds) || 600) * 1000).toISOString();
  const { data: saved, error: saveError } = await db.from('system_logs').update({
    status: 'completed', progress: 100, error_message: null, metadata,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', jobId).eq('log_type', 'timetable_job').eq('campus_id', campusId)
    .eq('status', 'running').eq('metadata->>fencing_token', fencingToken).gt('updated_at', cutoff)
    .select('id').maybeSingle();
  if (saveError || !saved) throw new Error('Stale or expired worker claim; review draft was not saved.');
}

export async function readReviewDraft(db: SupabaseClient, campusId: string, academicYear: string, semester: number) {
  const { data: job, error } = await db.from('system_logs').select('status, metadata')
    .eq('log_type', 'timetable_job').eq('campus_id', campusId).eq('academic_year', academicYear)
    .eq('semester', semester).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('Could not verify the current timetable review state.');
  return job?.status === 'completed' && job.metadata?.reviewDraft?.kind === 'review_draft' ? job.metadata.reviewDraft : null;
}
