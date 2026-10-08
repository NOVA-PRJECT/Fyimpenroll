// generator.ts exports the local OR-Tools CP-SAT solver and validator interfaces (Plan 06)

export { runOrtoolsSolver } from './ortools-runner';
export type { OrtoolsInputPayload, OrtoolsSolverResult, OrtoolsAssignment } from './ortools-runner';
export { validateTimetable, violationsToText } from './validator';
export { detectParallelGroups, loadGenerationInput } from './loader';
export { buildTimetablePrompt } from './prompt-builder';
