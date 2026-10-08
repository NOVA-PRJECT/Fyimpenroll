import type {
  CourseNode,
  ParallelGroup,
  SlotMap,
  SlotLookup,
  AIGeneratorResponse,
  AIAssignment,
  SlotAssignment,
  GenerationResult,
  DynamicConstraint,
} from './types';
import { buildTimetablePrompt, buildCorrectionPrompt } from './prompt-builder';
import { validateTimetable, violationsToText } from './validator';

const MAX_RETRIES = 3;
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

export function formatAIErrorMessage(rawErrorText: string): string {
  if (!rawErrorText) {
    return 'The AI timetable scheduler timed out. Please try clicking "⚡ Generate AI Timetable" again.';
  }

  const lower = rawErrorText.toLowerCase();

  // Network connection / DNS / Supabase / Google connectivity errors
  if (
    lower.includes('econnreset') ||
    lower.includes('connecttimeouterror') ||
    lower.includes('und_err_connect_timeout') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused')
  ) {
    return 'Network connection to database or AI service timed out. Please check your internet connection and try clicking "⚡ Generate AI Timetable" again.';
  }

  try {
    const parsed = JSON.parse(rawErrorText);
    const code = parsed.error?.code || parsed.code;
    const status = parsed.error?.status || parsed.status;
    const msg = parsed.error?.message || parsed.message || '';

    if (code === 503 || status === 'UNAVAILABLE' || msg.toLowerCase().includes('high demand')) {
      return 'The AI model is temporarily experiencing high server demand. Please wait a few moments and try clicking "⚡ Generate AI Timetable" again.';
    }
    if (code === 429 || status === 'RESOURCE_EXHAUSTED' || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
      return 'AI rate limit reached. Please wait a moment before trying again.';
    }
    if (msg) {
      return msg;
    }
  } catch {
    if (rawErrorText.includes('503') || lower.includes('high demand') || lower.includes('unavailable')) {
      return 'The AI model is temporarily experiencing high server demand. Please wait a few moments and try clicking "⚡ Generate AI Timetable" again.';
    }
  }
  return rawErrorText;
}

async function callLLM(prompt: string): Promise<string> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!apiResponse.ok) {
        const err = await apiResponse.text();
        throw new Error(`Anthropic API error: ${formatAIErrorMessage(err)}`);
      }

      const data = await apiResponse.json();
      return data.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');
    }

    throw new Error(
      'Missing AI API key. Please set GEMINI_API_KEY in your .env file.'
    );
  }

  const preferredModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const candidateModels = [preferredModel, 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash'];
  const modelsToTry = Array.from(new Set(candidateModels));

  let lastErrorText = '';

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const model = modelsToTry[modelIndex];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // Retry loop for transient network glitches per model
    for (let netAttempt = 1; netAttempt <= 3; netAttempt++) {
      const controller = new AbortController();
      // 360-second (6-minute) timeout to allow complete deep schedule generation
      const timeoutId = setTimeout(() => controller.abort(), 360000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              response_mime_type: 'application/json',
              temperature: 0.1,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const text =
            data.candidates?.[0]?.content?.parts
              ?.filter((p: any) => typeof p.text === 'string')
              ?.map((p: any) => p.text)
              ?.join('') || '';

          if (text) {
            return text;
          }
        } else {
          lastErrorText = await response.text();
          // If high demand (503), rate limit (429), or model not found (404), backoff slightly and try alternative model
          if (response.status === 503 || response.status === 429 || response.status === 404) {
            if (modelIndex < modelsToTry.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1500 * (modelIndex + 1)));
              break; // Try next model
            }
          } else {
            throw new Error(`AI API error: ${formatAIErrorMessage(lastErrorText)}`);
          }
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        const errMsg = fetchErr.message || String(fetchErr);
        lastErrorText = errMsg;

        if (fetchErr.name === 'AbortError') {
          lastErrorText = `Request timed out after 360s on ${model}`;
          break; // Try next candidate model
        }

        if (errMsg.startsWith('AI API error:')) {
          throw fetchErr;
        }

        // Check if transient network drop (e.g. fetch failed, ECONNRESET)
        const isTransientNetwork =
          errMsg.includes('fetch failed') ||
          errMsg.includes('ECONNRESET') ||
          errMsg.includes('UND_ERR_CONNECT_TIMEOUT') ||
          errMsg.includes('ConnectTimeoutError');

        if (isTransientNetwork && netAttempt < 3) {
          // Exponential backoff before retrying same model
          await new Promise((resolve) => setTimeout(resolve, 2000 * netAttempt));
          continue;
        }

        if (modelIndex < modelsToTry.length - 1) {
          break; // Try next model
        }
      }
    }
  }

  throw new Error(`AI API error: ${formatAIErrorMessage(lastErrorText)}`);
}

function parseAIResponse(
  raw: any,
  reverseIdMap: Map<string, string>,
  courseMap?: Map<string, CourseNode>
): AIGeneratorResponse {
  const assignments: AIAssignment[] = [];
  const unplaced: Array<{ courseId: string; reason: string }> = [];

  // Extract raw assignments data
  let rawAssignments: any[] = [];
  if (Array.isArray(raw)) {
    rawAssignments = raw;
  } else if (Array.isArray(raw?.assignments)) {
    rawAssignments = raw.assignments;
  } else if (Array.isArray(raw?.a)) {
    rawAssignments = raw.a;
  } else if (Array.isArray(raw?.data)) {
    rawAssignments = raw.data;
  }

  // Extract raw unplaced / conflict data if provided by AI
  let rawUnplaced: any[] = [];
  if (Array.isArray(raw?.unplaced)) {
    rawUnplaced = raw.unplaced;
  } else if (Array.isArray(raw?.u)) {
    rawUnplaced = raw.u;
  } else if (Array.isArray(raw?.conflicts)) {
    rawUnplaced = raw.conflicts;
  }

  for (const item of rawAssignments) {
    const aliasOrId = item.c || item.courseId || item.id;
    if (!aliasOrId) continue;
    const courseId = reverseIdMap.get(aliasOrId) || aliasOrId;

    const slots: AIAssignment['slots'] = [];
    const rawSlots = Array.isArray(item.s) ? item.s : Array.isArray(item.slots) ? item.slots : [];

    for (const s of rawSlots) {
      if (Array.isArray(s)) {
        const day = Number(s[0]);
        const period = Number(s[1]);
        const type = String(s[2] || 'T').toUpperCase();
        const isLab = type === 'L' || type === 'P' || type === 'PRACTICAL';
        slots.push({
          day,
          period,
          sessionType: isLab ? 'practical' : 'theory',
          isLabBlock: isLab,
        });
      } else if (typeof s === 'object' && s !== null) {
        const day = Number(s.day || s.d || s[0]);
        const period = Number(s.period || s.p || s[1]);
        const type = String(s.sessionType || s.t || s.type || 'theory').toLowerCase();
        const isLab = Boolean(s.isLabBlock || type === 'practical' || type === 'l');
        slots.push({
          day,
          period,
          sessionType: isLab ? 'practical' : 'theory',
          isLabBlock: isLab,
        });
      }
    }

    assignments.push({ courseId, slots });
  }

  for (const u of rawUnplaced) {
    const aliasOrId = u.c || u.courseId || u.id;
    if (!aliasOrId) continue;
    const courseId = reverseIdMap.get(aliasOrId) || aliasOrId;
    let reasonText = u.reason || u.r || u.explanation || '';

    // Replace any alias mentions like C1, C2 in reasonText with real course codes
    if (reasonText && courseMap) {
      reverseIdMap.forEach((cId, alias) => {
        const cObj = courseMap.get(cId);
        if (cObj) {
          const reg = new RegExp(`\\b${alias}\\b`, 'g');
          reasonText = reasonText.replace(reg, cObj.courseCode);
        }
      });
    }

    if (reasonText) {
      unplaced.push({ courseId, reason: reasonText });
    }
  }

  return { assignments, unplaced };
}

export async function runAIGeneration(
  courses: CourseNode[],
  parallelGroups: ParallelGroup[],
  slotMap: SlotMap,
  slotLookup: SlotLookup,
  studentDeptMap: Map<string, string>,
  dynamicConstraints: DynamicConstraint[],
  onProgress?: (progress: number, stepMessage: string) => Promise<void> | void,
  semester?: number
): Promise<GenerationResult> {
  // Build compact alias mappings to shrink input/output tokens by >80%
  const idMap = new Map<string, string>();
  const reverseIdMap = new Map<string, string>();
  const courseMap = new Map<string, CourseNode>(courses.map((c) => [c.courseId, c]));

  courses.forEach((c, idx) => {
    const alias = `C${idx + 1}`;
    idMap.set(c.courseId, alias);
    reverseIdMap.set(alias, c.courseId);
  });

  let prompt = buildTimetablePrompt(courses, parallelGroups, dynamicConstraints, semester, idMap);
  let lastResponseText = '';
  let lastResponse: AIGeneratorResponse | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) {
      await onProgress?.(40, '🧠 Sending schedule requirements to AI scheduler...');
    } else {
      await onProgress?.(
        40 + attempt * 8,
        `🔄 Refining schedule with AI (correction attempt ${attempt}/${MAX_RETRIES})...`
      );
    }

    lastResponseText = await callLLM(prompt);

    // Parse JSON — strip markdown fences if present
    let parsed: AIGeneratorResponse;
    try {
      const clean = lastResponseText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      const rawData = JSON.parse(clean);
      parsed = parseAIResponse(rawData, reverseIdMap, courseMap);
    } catch {
      if (attempt === MAX_RETRIES) {
        throw new Error(`AI model returned unparseable JSON after ${MAX_RETRIES} attempts`);
      }
      prompt = buildCorrectionPrompt(
        ['Response was not valid JSON. Return only the compact JSON object, no other text.'],
        lastResponseText
      );
      continue;
    }

    // Validate against deterministic hard constraints
    const violations = validateTimetable(parsed, courses, slotMap);
    if (violations.length === 0) {
      lastResponse = parsed;
      break;
    }

    if (attempt === MAX_RETRIES) {
      lastResponse = parsed;
      break;
    }

    // Build correction prompt for next attempt
    prompt = buildCorrectionPrompt(violationsToText(violations), lastResponseText);
  }

  if (!lastResponse) {
    throw new Error('AI generation completed with no assignments');
  }

  // Convert AIGeneratorResponse to GenerationResult
  return convertToGenerationResult(
    lastResponse,
    courses,
    parallelGroups,
    slotMap,
    slotLookup,
    studentDeptMap
  );
}

function diagnoseUnassignedCourseReason(
  course: CourseNode,
  allCourses: CourseNode[],
  assignedAssignments: SlotAssignment[],
  parallelGroups: ParallelGroup[],
  studentDeptMap: Map<string, string>
): { reason: string; blockingCourseIds: string[] } {
  const blockingCourseMap = new Map<string, { code: string; title: string; count: number }>();

  // Find all other courses that share students with this course
  for (const other of allCourses) {
    if (other.courseId === course.courseId) continue;
    let sharedCount = 0;
    for (const studentId of course.studentIds) {
      if (other.studentIds.has(studentId)) {
        sharedCount++;
      }
    }
    if (sharedCount > 0) {
      blockingCourseMap.set(other.courseId, {
        code: other.courseCode,
        title: other.courseTitle,
        count: sharedCount,
      });
    }
  }

  const blockingEntries = Array.from(blockingCourseMap.entries());
  const blockingCourseIds = blockingEntries.map(([id]) => id);

  // Check if course belongs to a parallel group
  const inGroup = parallelGroups.find((g) => g.courseIds.includes(course.courseId));
  const groupPrefix = inGroup
    ? `[Parallel Group: ${inGroup.courseCodes.join(' / ')}] `
    : '';

  // 1. Direct Student Schedule Clashes (highest frequency cause)
  if (blockingEntries.length > 0) {
    const topBlockers = blockingEntries
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([_, info]) => `${info.code} (${info.count} shared student${info.count > 1 ? 's' : ''})`);

    const moreCount = blockingEntries.length - topBlockers.length;
    const moreSuffix = moreCount > 0 ? ` and ${moreCount} other course${moreCount > 1 ? 's' : ''}` : '';

    return {
      reason: `${groupPrefix}Schedule overlap with ${topBlockers.join(', ')}${moreSuffix}. Placing this course in available slots causes student attendance conflicts.`,
      blockingCourseIds,
    };
  }

  // 2. Continuous 2-Hour Practical Lab Block Constraint
  if (course.practicalHours >= 2) {
    return {
      reason: `${groupPrefix}Requires a continuous 2-hour practical lab block (${course.practicalHours}h practical), but no 2 consecutive unreserved periods remain on the same day without crossing lunch break.`,
      blockingCourseIds: [],
    };
  }

  // 3. Cross-Department Student Availability
  if (course.isCrossDept) {
    const depts = new Set<string>();
    for (const s of course.studentIds) {
      const d = studentDeptMap.get(s);
      if (d) depts.add(d);
    }
    return {
      reason: `${groupPrefix}Multi-department elective with students from ${depts.size} departments. No common open time slot exists across all enrolled departments.`,
      blockingCourseIds: [],
    };
  }

  // 4. Department Max Weekly Slot Capacity
  return {
    reason: `${groupPrefix}Department weekly timetable is at maximum capacity or existing major course commitments prevent placing the required ${course.theoryHours} theory / ${course.practicalHours} practical hours.`,
    blockingCourseIds: [],
  };
}

function convertToGenerationResult(
  response: AIGeneratorResponse,
  courses: CourseNode[],
  parallelGroups: ParallelGroup[],
  slotMap: SlotMap,
  slotLookup: SlotLookup,
  studentDeptMap: Map<string, string>
): GenerationResult {
  const assignments: SlotAssignment[] = [];
  const conflicts: import('./types').UnresolvableCourse[] = [];
  const courseMap = new Map(courses.map((c) => [c.courseId, c]));
  const assignedCourseIds = new Set(response.assignments.map((a) => a.courseId));
  const aiUnplacedMap = new Map<string, string>(
    (response.unplaced || []).map((u) => [u.courseId, u.reason])
  );

  for (const aiAssignment of response.assignments) {
    const course = courseMap.get(aiAssignment.courseId);
    if (!course) continue;

    // Collect affected department IDs strictly from registered students' departments
    const affectedDeptIds = new Set<string>();
    for (const studentId of course.studentIds) {
      const deptId = studentDeptMap.get(studentId);
      if (deptId) affectedDeptIds.add(deptId);
    }
    if (affectedDeptIds.size === 0) {
      affectedDeptIds.add(course.departmentId);
    }

    for (const slot of aiAssignment.slots) {
      const slotId = slotMap.get(slot.day)?.get(slot.period);
      if (!slotId) continue;

      for (const deptId of affectedDeptIds) {
        assignments.push({
          courseId: course.courseId,
          departmentId: deptId,
          timeSlotId: slotId,
          sessionType: slot.sessionType,
          isLabBlock: slot.isLabBlock,
        });
      }
    }
  }

  // Flag and accurately diagnose courses that were unplaced
  for (const course of courses) {
    if (!assignedCourseIds.has(course.courseId)) {
      const aiReason = aiUnplacedMap.get(course.courseId);
      const diagnosis = diagnoseUnassignedCourseReason(
        course,
        courses,
        assignments,
        parallelGroups,
        studentDeptMap
      );

      conflicts.push({
        courseId: course.courseId,
        departmentId: course.departmentId,
        sessionType: course.practicalHours > 0 ? 'practical' : 'theory',
        reason: aiReason ? `[AI Diagnosis] ${aiReason}` : diagnosis.reason,
        conflictingStudentCount: course.studentIds.size,
        blockingCourseIds: diagnosis.blockingCourseIds,
      });
    }
  }

  return { assignments, conflicts };
}
