// generator.ts is now a thin wrapper.
// All logic lives in ai-generator.ts, validator.ts, and prompt-builder.ts.

export { runAIGeneration } from './ai-generator';
export { validateTimetable } from './validator';
export { buildTimetablePrompt } from './prompt-builder';
export { detectParallelGroups } from './loader';
