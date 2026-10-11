// ─── Slot Identity ────────────────────────────────────────────────────────────
export type SlotId = string; // uuid from time_slots table
export const DAYS = [1, 2, 3, 4, 5] as const; // Mon–Fri

// ─── Course Node ──────────────────────────────────────────────────────────────
export interface CourseNode {
  courseId: string;
  departmentId: string;
  departmentName: string;
  courseCode: string;
  courseTitle: string;
  category: string;
  theoryHours: number;
  practicalHours: number;
  isCrossDept: boolean;
  studentIds: Set<string>;
  teacherId?: string;
  // Human-readable conflict summary: "Conflicts with CS302 (12 students), PHY201 (3 students)"
  conflictSummary: string;
}

// ─── Teacher Reservations (F37) ──────────────────────────────────────────────
export interface TeacherReservation {
  teacherId: string;
  day: number; // 1-5
  period: number; // 1-6
  sourceCourseId?: string;
  sourceCampusId?: string;
  sourceSemester?: number;
}

// ─── Parallel Groups ──────────────────────────────────────────────────────────
export interface ParallelGroup {
  groupId: string;
  departmentId: string;
  category?: string;
  isCampusWide?: boolean;
  courseIds: string[];
  courseCodes: string[]; // for prompt readability
}

// ─── Slot Map ─────────────────────────────────────────────────────────────────
// slotMap[dayNumber][periodNumber] = slotUuid
export type SlotMap = Map<number, Map<number, SlotId>>;
// Reverse: slotUuid → { day, period }
export type SlotLookup = Map<SlotId, { day: number; period: number }>;

// ─── AI Generator Output ──────────────────────────────────────────────────────
export interface AIAssignment {
  courseId: string;
  slots: Array<{
    day: number; // 1–5
    period: number; // 1–6
    sessionType: 'theory' | 'practical';
    isLabBlock: boolean;
    // For lab blocks, this slot is one of a pair. Both periods have isLabBlock: true.
  }>;
}

export interface AIGeneratorResponse {
  assignments: AIAssignment[];
  unplaced?: Array<{
    courseId: string;
    reason: string;
  }>;
}

// ─── Final Output ─────────────────────────────────────────────────────────────
export interface SlotAssignment {
  courseId: string;
  departmentId: string;
  timeSlotId: SlotId;
  sessionType: 'theory' | 'practical';
  isLabBlock: boolean;
}

export interface UnresolvableCourse {
  courseId: string;
  departmentId: string;
  sessionType: 'theory' | 'practical';
  reason: string;
  conflictingStudentCount: number;
  blockingCourseIds: string[];
}

export interface GenerationResult {
  assignments: SlotAssignment[];
  conflicts: UnresolvableCourse[];
}

// ─── Validation ───────────────────────────────────────────────────────────────
export interface ValidationViolation {
  type:
    | 'student_conflict'
    | 'teacher_conflict'
    | 'hours_mismatch'
    | 'invalid_lab_block'
    | 'lunch_overlap'
    | 'hours_exceeded'
    | 'half_block_overlap'
    | 'category_slot_mismatch'
    | 'mixed_category_conflict'
    | 'invalid_window'
    | 'unplaced_course';
  courseId?: string;
  studentId?: string;
  teacherId?: string;
  day?: number;
  period?: number;
  detail: string;
}

// ─── Dynamic Constraints & Typed Rule Specification (R19) ───────────────────
export type RuleKind =
  | 'NO_STUDENT_OVERLAP'
  | 'NO_TEACHER_OVERLAP'
  | 'TEACHER_RESERVATIONS'
  | 'NO_LUNCH_OVERLAP'
  | 'EXACT_CONTACT_HOURS'
  | 'LAB_CONSECUTIVE_PAIR'
  | 'P6_LAST_RESORT'
  | 'THEORY_SPREAD'
  | 'DEPARTMENT_TIME_PREFERENCE'
  | 'DAY_WINDOW'
  | 'CATEGORY_WINDOW'
  | 'SESSION_BLOCK'
  | 'PARALLEL_CATEGORY_SYNC'
  | 'CAMPUS_TIME_LIMIT';

export type RuleScope = 'global' | 'campus' | 'semester' | 'category' | 'course' | 'department';

export interface RuleDefinition {
  id: string;
  kind: RuleKind;
  scope: RuleScope;
  targetSemester?: number;
  targetCategory?: string;
  targetCourseId?: string;
  targetDepartmentId?: string;
  isHard: boolean;
  weight?: number; // for soft constraints / penalties
  parameters?: Record<string, any>;
  version: number;
  description: string;
}

export interface TimetableScheduleConfig {
  days: string[];
  periods: Array<{
    number: number;
    start: string;
    end: string;
    label: string;
    extended?: boolean;
  }>;
  lunch: {
    start: string;
    end: string;
  };
  extended_period_policy?: string;
}

export interface EffectiveRuleDocument {
  version: number;
  schedule: TimetableScheduleConfig;
  rules: RuleDefinition[];
  hard_constraints?: string[];
  soft_constraints?: string[];
  semester_constraints?: Record<
    string,
    {
      hard_constraints?: string[];
      soft_constraints?: string[];
    }
  >;
}

// Sent in the generate API request body by the Campus Director
export interface DynamicConstraint {
  id: string; // client-generated uuid, for UI list keys
  text: string; // plain English sentence
  category?: 'hard' | 'soft'; // whether strict invariant or preference
  typedRule?: RuleDefinition; // structured rule if typed
}
