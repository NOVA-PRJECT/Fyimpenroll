import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException,
  UnprocessableEntityException } from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuthUser } from '../../core/auth/types';
import { loadGenerationInput } from './solver/loader';
import { FileConstraintStoreService } from './solver/file-constraint-store.service';
import { ManualEntry, ManualPublishSchema, ManualTimetableRequest, RuleDefinitionSchema } from './solver/schemas';
import { validateManualEntries } from './solver/manual-validation';
import { loadTimetableAudience } from './timetable-audience';
import { z } from 'zod';
import { RuleDefinition } from './solver/types';
import { fetchByIdChunks } from '../../core/database/pagination.util';

@Injectable()
export class ManualTimetableService {
  constructor(private readonly supabase: SupabaseService) {}

  private async context(academicYear: string, semester: number, user: AuthUser) {
    if (user.role !== 'campus_director' || !user.campus_id) throw new ForbiddenException('A campus director is required for manual scheduling.');
    const { data, error } = await this.supabase.admin.rpc('timetable_manual_context', {
      p_campus_id: user.campus_id, p_academic_year: academicYear, p_semester: semester,
      p_actor_id: user.userId, p_expected_term: user.term_version,
    });
    if (error) this.databaseError(error);
    if (!data?.revision) throw new InternalServerErrorException('Manual timetable context could not be verified.');
    return data;
  }

  private databaseError(error: { code?: string; message: string }): never {
    if (error.code === 'P4030') throw new ForbiddenException(error.message);
    if (['P4090', '40001', '40P01'].includes(error.code || '')) throw new ConflictException(error.message);
    throw new BadRequestException(error.message);
  }

  private async load(academicYear: string, semester: number, user: AuthUser) {
    // Capture a revision BEFORE loading dependent rows. The commit checks it under the lifecycle lock.
    const context = await this.context(academicYear, semester, user);
    let input: Awaited<ReturnType<typeof loadGenerationInput>>;
    try { input = await loadGenerationInput(this.supabase.admin, academicYear, semester, user.campus_id!); }
    catch (error) { throw new UnprocessableEntityException((error as Error).message); }
    const manual = context.job.metadata?.manualDraft;
    const rules = z.array(RuleDefinitionSchema).max(100).parse(manual?.rules ?? context.job.metadata?.effectiveRules ??
      new FileConstraintStoreService().getEffectiveConstraints(user.campus_id!, semester).rules) as RuleDefinition[];
    const raw = manual?.entries ?? context.job.metadata?.reviewDraft?.entries ?? context.entries.map((entry: any) => ({
      courseId: entry.course_id, day: entry.time_slots.day_of_week, period: entry.time_slots.period_number,
      sessionType: entry.session_type, isLabBlock: entry.is_lab_block,
    }));
    const entries: ManualEntry[] = raw.map((entry: ManualEntry) => ({ courseId: entry.courseId, day: entry.day,
      period: entry.period, sessionType: entry.sessionType, isLabBlock: entry.isLabBlock }));
    return { context, input, rules, entries, manual };
  }

  async get(academicYear: string, semester: number, user: AuthUser) {
    const { context, input, rules, entries, manual } = await this.load(academicYear, semester, user);
    const audience = await loadTimetableAudience(this.supabase.admin, user.campus_id!, academicYear, semester);
    const { data: departments, error } = await this.supabase.admin.from('departments').select('id,name,code')
      .eq('campus_id', user.campus_id).order('name');
    if (error) this.databaseError(error);
    const teachers = await fetchByIdChunks<{ id: string; full_name: string }>(
      [...new Set(input.courses.map(course => course.teacherId).filter((id): id is string => !!id))],
      ids => this.supabase.admin.from('faculty').select('id,full_name').in('id', ids).order('id'));
    return { revision: context.revision, entries, rules, published: context.published,
      saved: !!manual, mode: manual?.mode ?? 'follow_rules', reason: manual?.reason ?? '',
      courses: input.courses.map(({ studentIds: _students, conflictSummary: _conflicts, ...course }) => ({ ...course,
        teacherName: teachers.find(teacher => teacher.id === course.teacherId)?.full_name ?? null,
        enrolledDepartmentIds: audience.courseDepartments.get(course.courseId) || [] })),
      departments: (departments || []).filter(department => audience.departmentCounts.has(department.id)),
      parallelGroups: input.parallelGroups,
      report: validateManualEntries(entries, input.courses, input.slotMap, input.parallelGroups,
        input.teacherReservations, semester, rules) };
  }

  private async candidate(request: ManualTimetableRequest, user: AuthUser) {
    const loaded = await this.load(request.academicYear, request.semester, user);
    if (loaded.context.published) throw new ConflictException('Published timetables cannot be edited.');
    if (request.revision !== loaded.context.revision) throw new ConflictException('The timetable or its inputs changed. Reload the manual editor before saving.');
    const report = validateManualEntries(request.entries, loaded.input.courses, loaded.input.slotMap,
      loaded.input.parallelGroups, loaded.input.teacherReservations, request.semester, loaded.rules);
    return { ...loaded, report };
  }

  async preview(request: ManualTimetableRequest, user: AuthUser) {
    const { report } = await this.candidate(request, user);
    return { report, canSave: request.mode === 'allow_overrides' ? !!request.reason.trim() : report.blockingViolations.length === 0 };
  }

  async save(request: ManualTimetableRequest, user: AuthUser) {
    const { rules, report } = await this.candidate(request, user);
    if (request.mode === 'follow_rules' && report.blockingViolations.length) {
      throw new UnprocessableEntityException({ message: 'This placement breaks scheduling rules.', violations: report.blockingViolations });
    }
    if (request.mode === 'allow_overrides' && !request.reason.trim()) throw new BadRequestException('Explain why scheduling rules are being overridden.');
    const draft = { entries: request.entries, rules, mode: request.mode, reason: request.reason, report,
      savedBy: user.userId, savedAt: new Date().toISOString() };
    const { data, error } = await this.supabase.admin.rpc('commit_manual_timetable', {
      p_campus_id: user.campus_id, p_academic_year: request.academicYear, p_semester: request.semester,
      p_actor_id: user.userId, p_expected_term: user.term_version, p_revision: request.revision,
      p_draft: draft, p_publish: false,
    });
    if (error) this.databaseError(error);
    return { ...data, report };
  }

  async publish(request: z.infer<typeof ManualPublishSchema>, user: AuthUser) {
    const loaded = await this.load(request.academicYear, request.semester, user);
    if (!loaded.manual) throw new BadRequestException('Save the manual timetable before publication.');
    const candidate = { ...request, entries: loaded.entries, mode: loaded.manual.mode, reason: loaded.manual.reason };
    const { report } = await this.candidate(candidate, user);
    if (!loaded.entries.length) throw new BadRequestException('An empty timetable cannot be published.');
    if (candidate.mode === 'follow_rules' && report.violations.length) {
      throw new UnprocessableEntityException({ message: 'Complete the timetable and resolve all rule violations before publishing.', violations: report.violations });
    }
    if (candidate.mode === 'allow_overrides' && (!request.acknowledgeOverrides || !candidate.reason?.trim())) {
      throw new BadRequestException('Acknowledge the rule overrides and missing hours before publication.');
    }
    const { data, error } = await this.supabase.admin.rpc('commit_manual_timetable', {
      p_campus_id: user.campus_id, p_academic_year: request.academicYear, p_semester: request.semester,
      p_actor_id: user.userId, p_expected_term: user.term_version, p_revision: request.revision,
      p_draft: { ...loaded.manual, report, publishedBy: user.userId }, p_publish: true,
    });
    if (error) this.databaseError(error);
    return data;
  }
}
