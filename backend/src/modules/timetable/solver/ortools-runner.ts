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
  config?: {
    max_time_in_seconds?: number
    num_workers?: number
    random_seed?: number
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
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID'
  assignments: OrtoolsAssignment[]
  diagnostics: string[]
  stats: {
    wall_time_seconds: number
    branches?: number
    conflicts?: number
    objective_value?: number | null
    total_courses: number
    total_sessions_assigned: number
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

export async function runOrtoolsSolver(payload: OrtoolsInputPayload): Promise<OrtoolsSolverResult> {
  const pythonBin = resolvePythonBinary()
  const scriptPath = resolveSolverScriptPath()

  const maxSeconds = payload.config?.max_time_in_seconds ?? 30
  const timeoutMs = (maxSeconds + 15) * 1000

  return new Promise<OrtoolsSolverResult>((resolve) => {
    let child: any
    try {
      child = spawn(pythonBin, [scriptPath, '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err: any) {
      return resolve({
        status: 'MODEL_INVALID',
        assignments: [],
        diagnostics: [`Failed to spawn Python process (${pythonBin}): ${err.message}`],
        stats: {
          wall_time_seconds: 0,
          total_courses: payload.courses.length,
          total_sessions_assigned: 0,
        },
      })
    }

    let stdoutData = ''
    let stderrData = ''
    let isSettled = false

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true
        try {
          child.kill('SIGTERM')
        } catch {}
        resolve({
          status: 'UNKNOWN',
          assignments: [],
          diagnostics: [`Solver execution timed out after ${maxSeconds} seconds`],
          stats: {
            wall_time_seconds: maxSeconds,
            total_courses: payload.courses.length,
            total_sessions_assigned: 0,
          },
        })
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString()
    })

    child.on('error', (err: Error) => {
      clearTimeout(timer)
      if (!isSettled) {
        isSettled = true
        resolve({
          status: 'MODEL_INVALID',
          assignments: [],
          diagnostics: [`Child process error: ${err.message}`],
          stats: {
            wall_time_seconds: 0,
            total_courses: payload.courses.length,
            total_sessions_assigned: 0,
          },
        })
      }
    })

    child.on('close', (code: number) => {
      clearTimeout(timer)
      if (isSettled) return
      isSettled = true

      if (!stdoutData.trim()) {
        return resolve({
          status: 'MODEL_INVALID',
          assignments: [],
          diagnostics: [
            `Solver produced no output. Exit code: ${code}. Stderr: ${stderrData.trim() || 'none'}`,
          ],
          stats: {
            wall_time_seconds: 0,
            total_courses: payload.courses.length,
            total_sessions_assigned: 0,
          },
        })
      }

      try {
        const parsed = JSON.parse(stdoutData) as OrtoolsSolverResult
        if (stderrData.trim()) {
          parsed.diagnostics = [...(parsed.diagnostics || []), `Stderr: ${stderrData.trim()}`]
        }
        resolve(parsed)
      } catch (parseErr: any) {
        resolve({
          status: 'MODEL_INVALID',
          assignments: [],
          diagnostics: [
            `Failed to parse solver JSON output: ${parseErr.message}`,
            `Raw output: ${stdoutData.slice(0, 500)}`,
          ],
          stats: {
            wall_time_seconds: 0,
            total_courses: payload.courses.length,
            total_sessions_assigned: 0,
          },
        })
      }
    })

    // Write input payload to child stdin
    try {
      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    } catch (writeErr: any) {
      clearTimeout(timer)
      if (!isSettled) {
        isSettled = true
        resolve({
          status: 'MODEL_INVALID',
          assignments: [],
          diagnostics: [`Failed to write input to solver stdin: ${writeErr.message}`],
          stats: {
            wall_time_seconds: 0,
            total_courses: payload.courses.length,
            total_sessions_assigned: 0,
          },
        })
      }
    }
  })
}
