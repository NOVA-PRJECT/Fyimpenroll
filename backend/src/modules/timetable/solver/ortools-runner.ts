import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

export interface OrtoolsCourseItem {
  courseId: string
  courseCode: string
  courseTitle: string
  departmentId: string
  category: string
  theoryHours: number
  practicalHours: number
  isCrossDept: boolean
  studentIds: string[]
  teacherId?: string
  campusPaper?: number
}

export interface OrtoolsParallelGroup {
  groupId: string
  departmentId: string
  category?: string
  courseIds: string[]
}

export interface OrtoolsTeacherReservation {
  teacherId: string
  day: number
  period: number
  source?: string
}

export interface OrtoolsInputPayload {
  academic_year: string
  semester: number
  campus_id?: string
  courses: OrtoolsCourseItem[]
  parallel_groups: OrtoolsParallelGroup[]
  teacher_reservations: OrtoolsTeacherReservation[]
  constraints: Record<string, any>
  rules?: any[]
  config?: {
    max_time_in_seconds?: number
    num_workers?: number
    random_seed?: number
    allow_partial?: boolean
  }
}

export interface OrtoolsAssignment {
  courseId: string
  departmentId: string
  day: number
  period: number
  sessionType: 'theory' | 'practical'
  isLabBlock: boolean
}

export interface OrtoolsSolverResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'PARTIAL' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID'
  assignments: OrtoolsAssignment[]
  unscheduled?: Array<{ courseId: string; sessionId: string; sessionType: 'theory' | 'practical'; periods: number; reason: string }>
  diagnostics: string[]
  stats: {
    wall_time_seconds: number
    branches?: number
    conflicts?: number
    objective_value?: number | null
    rule_hash?: string
    total_courses: number
    total_sessions_assigned: number
    capacity_required_periods?: number
    capacity_available_periods?: number
  }
}

/**
 * Resolves the Python executable to run.
 */
function resolvePythonBinary(): string {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH
  // Defaults to python
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Resolves the absolute path to ortools_solver.py, checking both __dirname and source tree.
 */
function resolveSolverScriptPath(): string {
  const directPath = path.join(__dirname, 'ortools_solver.py')
  if (fs.existsSync(directPath)) return directPath

  const candidates = [
    path.resolve(__dirname, '../../../../src/modules/timetable/solver/ortools_solver.py'),
    path.resolve(process.cwd(), 'src/modules/timetable/solver/ortools_solver.py'),
    path.resolve(process.cwd(), 'backend/src/modules/timetable/solver/ortools_solver.py'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }

  return directPath
}

export async function runOrtoolsSolver(payload: OrtoolsInputPayload, signal?: AbortSignal): Promise<OrtoolsSolverResult> {
  const maxSeconds = Math.max(1, Math.min(900, payload.config?.max_time_in_seconds ?? 300))
  return new Promise(resolve => {
    const child = spawn(resolvePythonBinary(), [resolveSolverScriptPath(), '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = '', outputBytes = 0, errorBytes = 0, failure = '', settled = false
    let escalation: ReturnType<typeof setTimeout> | undefined
    const failed = (message: string): OrtoolsSolverResult => ({ status: 'UNKNOWN', assignments: [], diagnostics: [message],
      stats: { wall_time_seconds: 0, total_courses: payload.courses.length, total_sessions_assigned: 0 } })
    const stop = (message: string) => {
      if (failure || settled) return
      failure = message
      child.kill('SIGTERM')
      escalation = setTimeout(() => { child.kill('SIGKILL') }, 2000)
    }
    const timeout = setTimeout(() => stop(`Solver execution timed out after ${maxSeconds} seconds`), (maxSeconds + 15) * 1000)
    const abort = () => stop('Solver cancelled or worker lease lost')
    const finish = (result: OrtoolsSolverResult) => {
      if (settled) return
      settled = true; clearTimeout(timeout); if (escalation) clearTimeout(escalation)
      signal?.removeEventListener('abort', abort)
      resolve(result)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > 4194304) stop('Solver stdout exceeded 4 MiB limit')
      else stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errorBytes += chunk.length
      if (errorBytes > 262144) stop('Solver stderr exceeded 256 KiB limit')
      else stderr += chunk.toString()
    })
    child.stdin.on('error', error => stop(`Solver input failed: ${error.message}`))
    child.on('error', error => finish(failed(`Solver process failed: ${error.message}`)))
    child.on('close', code => {
      if (failure) return finish(failed(failure))
      if (code !== 0) return finish(failed(`Solver exited with code ${code}: ${stderr.slice(0, 1500)}`))
      try {
        const parsed = JSON.parse(stdout) as OrtoolsSolverResult
        if (!Array.isArray(parsed.assignments) || !Array.isArray(parsed.diagnostics) || !parsed.stats) throw new Error('Malformed solver result')
        finish(parsed)
      } catch { finish(failed(`Solver returned invalid JSON: ${stderr.slice(0, 1500)}`)) }
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try { child.stdin.end(JSON.stringify(payload)) } catch (error) { stop(`Solver input failed: ${(error as Error).message}`) }
  })
}
