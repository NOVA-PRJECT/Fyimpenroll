const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { AuthGuard } = require('../dist/core/auth/guards/auth.guard')
const { AuthService } = require('../dist/modules/auth/auth.service')
const { CURRENT_POLICY_VERSION } = require('../dist/modules/consent/consent.constants')
const fs = require('node:fs')
const path = require('node:path')

// ── Mock Helpers ────────────────────────────────────────────────────────────

function createMockSupabaseService(options = {}) {
  const {
    getUserResult = { data: { user: { id: 'u1', email: 'user@test.edu', app_metadata: { role: 'student', accepted_policy_version: CURRENT_POLICY_VERSION } } }, error: null },
    studentData = { id: 'u1', department_id: 'd1', campus_id: 'c1', must_change_password: false, current_semester: 3, full_name: 'Test Student' },
    facultyData = null,
    adminData = null,
    consentRecord = { policy_version: CURRENT_POLICY_VERSION },
  } = options

  return {
    admin: {
      auth: {
        getUser: async (token) => getUserResult,
        admin: {
          updateUserById: async (id, data) => ({ data: { id, ...data }, error: null }),
          getUserById: async (id) => ({
            data: {
              user: {
                id,
                email: 'test@kannur.edu',
                app_metadata: { role: 'student', must_change_password: true },
              },
            },
            error: null,
          }),
          signOut: async (id) => ({ error: null }),
        },
      },
      from: (table) => {
        let selectedFields = ''
        let filterId = ''
        let filterVersion = ''

        const builder = {
          select: (fields) => {
            selectedFields = fields
            return builder
          },
          eq: (col, val) => {
            if (col === 'id' || col === 'user_id') filterId = val
            if (col === 'policy_version') filterVersion = val
            return builder
          },
          maybeSingle: async () => {
            if (table === 'students') return { data: studentData, error: null }
            if (table === 'faculty') {
              if (filterId === 'h1') return { data: { id: 'h1', role: 'hod', department_id: 'd1', campus_id: 'c1' }, error: null }
              if (filterId === 'd1') return { data: { id: 'd1', role: 'campus_director', department_id: 'd1', campus_id: 'c1' }, error: null }
              if (filterId === 'ts1') return { data: { id: 'ts1', role: 'teaching_staff', department_id: 'd1', campus_id: 'c1' }, error: null }
              return { data: facultyData, error: null }
            }
            if (table === 'admins') return { data: adminData, error: null }
            if (table === 'consent_records') {
              if (filterVersion === CURRENT_POLICY_VERSION) {
                return { data: consentRecord, error: null }
              }
              return { data: null, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => builder.maybeSingle(),
          update: (data) => ({
            eq: async (col, val) => {
              if (options.failProfileUpdate) {
                return { error: { message: 'Database write timeout' } }
              }
              return { error: null }
            },
          }),
        }
        return builder
      },
    },
    createAuthClient: () => ({
      auth: {
        signInWithPassword: async ({ email, password }) => {
          if (password === 'wrong-password') {
            return { data: null, error: { message: 'Invalid credentials' } }
          }
          return {
            data: {
              user: { id: 'u1', email },
              session: {
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
                expires_in: 3600,
              },
            },
            error: null,
          }
        },
        refreshSession: async ({ refresh_token }) => {
          if (refresh_token === 'revoked-token') {
            return { data: null, error: { message: 'Token revoked' } }
          }
          return {
            data: {
              user: {
                id: 'u1',
                email: 'teacher@kannur.edu',
                app_metadata: { role: 'teacher', must_change_password: true },
              },
              session: {
                access_token: 'refreshed-access-token',
                refresh_token: 'rotated-refresh-token',
                expires_in: 3600,
              },
            },
            error: null,
          }
        },
      },
    }),
  }
}

function createMockExecutionContext(request) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Plan 02: Accounts, Sessions, Consent & Security (F07, F08, F09, F10, F11, F12, F57, F62)', () => {

  describe('1. F07: Restricted Session Separation (AuthGuard)', () => {
    it('allows restricted student access to profile and password change endpoints', async () => {
      const supabase = createMockSupabaseService({
        getUserResult: {
          data: {
            user: {
              id: 's1',
              email: 'student@kannur.edu',
              app_metadata: { role: 'student', must_change_password: true, accepted_policy_version: CURRENT_POLICY_VERSION },
            },
          },
          error: null,
        },
        studentData: { id: 's1', department_id: 'd1', campus_id: 'c1', must_change_password: true, current_semester: 1 },
      })
      const guard = new AuthGuard(supabase)

      // Test allowed profile endpoint
      const reqProfile = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/auth/profile',
        method: 'GET',
      }
      const canAccessProfile = await guard.canActivate(createMockExecutionContext(reqProfile))
      assert.equal(canAccessProfile, true)
      assert.equal(reqProfile.user.must_change_password, true)

      // Test allowed change-password endpoint
      const reqChange = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/auth/change-password',
        method: 'POST',
      }
      const canAccessChange = await guard.canActivate(createMockExecutionContext(reqChange))
      assert.equal(canAccessChange, true)

      // Test allowed consent status endpoint
      const reqConsent = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/consent/status',
        method: 'GET',
      }
      const canAccessConsent = await guard.canActivate(createMockExecutionContext(reqConsent))
      assert.equal(canAccessConsent, true)
    })

    it('blocks restricted student from general dashboard APIs with 403 Forbidden', async () => {
      const supabase = createMockSupabaseService({
        getUserResult: {
          data: {
            user: {
              id: 's1',
              email: 'student@kannur.edu',
              app_metadata: { role: 'student', must_change_password: true, accepted_policy_version: CURRENT_POLICY_VERSION },
            },
          },
          error: null,
        },
        studentData: { id: 's1', department_id: 'd1', campus_id: 'c1', must_change_password: true, current_semester: 1 },
      })
      const guard = new AuthGuard(supabase)

      const reqDashboard = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/student/dashboard-summary',
        method: 'GET',
      }

      await assert.rejects(
        async () => guard.canActivate(createMockExecutionContext(reqDashboard)),
        (err) => {
          assert.equal(err.status, 403)
          assert.equal(err.response.must_change_password, true)
          return true
        },
      )
    })
  })

  describe('2. F08: Password Flag Preservation & Role Scoping', () => {
    it('preserves must_change_password for teacher and student in determineUserRoute', async () => {
      const supabase = createMockSupabaseService({
        facultyData: { id: 't1', role: 'teacher', department_id: 'd1', campus_id: 'c1' },
      })
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }), resetLoginLimits: async () => {} },
        { log: async () => {} },
        { warn: () => {} },
      )

      // Teacher with flag set preserves it
      const teacherRoute = await authService.determineUserRoute('t1', 'teacher', true)
      assert.equal(teacherRoute.role, 'teacher')
      assert.equal(teacherRoute.must_change_password, true)

      // Non-teacher faculty (e.g. HOD, director, teaching_staff) never forced
      const hodRoute = await authService.determineUserRoute('h1', 'hod', true)
      assert.equal(hodRoute.role, 'hod')
      assert.equal(hodRoute.must_change_password, false)

      const directorRoute = await authService.determineUserRoute('d1', 'campus_director', true)
      assert.equal(directorRoute.role, 'campus_director')
      assert.equal(directorRoute.must_change_password, false)

      const staffRoute = await authService.determineUserRoute('ts1', 'teaching_staff', true)
      assert.equal(staffRoute.role, 'teaching_staff')
      assert.equal(staffRoute.must_change_password, false)
    })

    it('AuthGuard clears must_change_password for non-student, non-teacher roles', async () => {
      const supabase = createMockSupabaseService({
        getUserResult: {
          data: {
            user: {
              id: 'h1',
              email: 'hod@kannur.edu',
              // Metadata maliciously or erroneously set must_change_password: true
              app_metadata: { role: 'hod', must_change_password: true, accepted_policy_version: CURRENT_POLICY_VERSION },
            },
          },
          error: null,
        },
        facultyData: { id: 'h1', role: 'hod', department_id: 'd1', campus_id: 'c1' },
      })
      const guard = new AuthGuard(supabase)

      const req = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/hod/courses',
        method: 'GET',
      }

      // Should succeed because HOD is never forced into password change
      const allowed = await guard.canActivate(createMockExecutionContext(req))
      assert.equal(allowed, true)
      assert.equal(req.user.must_change_password, false)
    })
  })

  describe('3. F09 & F10: Verified Password Change & Atomic Profile Sync', () => {
    it('completePasswordReset rejects missing verified password confirmation (F09)', async () => {
      const supabase = createMockSupabaseService()
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      await assert.rejects(
        async () => authService.completePasswordReset('u1', { passwordUpdated: false }),
        (err) => {
          assert.match(err.message, /Verified password update confirmation required/)
          return true
        },
      )
    })

    it('returns structured partial-failure SYNC_FAILED when database profile write fails (F10)', async () => {
      const supabase = createMockSupabaseService({ failProfileUpdate: true })
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      const result = await authService.completePasswordReset('u1', { passwordUpdated: true })
      assert.equal(result.success, false)
      assert.equal(result.code, 'SYNC_FAILED')
      assert.equal(result.canRetrySync, true)
    })

    it('syncPasswordStatus allows safe retry of synchronization after partial failure', async () => {
      const supabase = createMockSupabaseService({ failProfileUpdate: false })
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      const result = await authService.syncPasswordStatus('u1')
      assert.equal(result.success, true)
      assert.match(result.message, /Password synchronization complete/)
    })
  })

  describe('4. F11: Access / Refresh Token Lifecycle & Concurrency', () => {
    it('refreshSession rotates token and returns updated credentials', async () => {
      const supabase = createMockSupabaseService({
        facultyData: { id: 'u1', role: 'teacher', department_id: 'd1', campus_id: 'c1' },
      })
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      const result = await authService.refreshSession('valid-refresh-token')
      assert.equal(result.token, 'refreshed-access-token')
      assert.equal(result.refreshToken, 'rotated-refresh-token')
      assert.equal(result.role, 'teacher')
      assert.equal(result.must_change_password, true)
    })

    it('deduplicates concurrent refresh requests using in-flight caching', async () => {
      const supabase = createMockSupabaseService({
        facultyData: { id: 'u1', role: 'teacher', department_id: 'd1', campus_id: 'c1' },
      })
      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      // Fire two concurrent refresh calls with the same token
      const [res1, res2] = await Promise.all([
        authService.refreshSession('concurrent-token'),
        authService.refreshSession('concurrent-token'),
      ])

      assert.deepEqual(res1, res2)
    })

    it('logout calls Supabase admin signOut to revoke refresh session', async () => {
      let revokedUserId = null
      const supabase = createMockSupabaseService()
      supabase.admin.auth.admin.signOut = async (userId) => {
        revokedUserId = userId
        return { error: null }
      }

      const authService = new AuthService(
        supabase,
        { checkLimit: async () => ({ success: true }) },
        { log: async () => {} },
        { warn: () => {} },
      )

      await authService.logout({ userId: 'u1', role: 'student' }, '127.0.0.1')
      assert.equal(revokedUserId, 'u1')
    })
  })

  describe('5. F12: Versioned Consent Enforcement', () => {
    it('blocks normal operations when user consent is not on CURRENT_POLICY_VERSION', async () => {
      const supabase = createMockSupabaseService({
        getUserResult: {
          data: {
            user: {
              id: 'u1',
              email: 'student@kannur.edu',
              app_metadata: { role: 'student', accepted_policy_version: '2024-old-version' },
            },
          },
          error: null,
        },
        studentData: { id: 'u1', department_id: 'd1', campus_id: 'c1', must_change_password: false },
        consentRecord: null, // No database record for current version
      })
      const guard = new AuthGuard(supabase)

      const reqCourses = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/student/dashboard-summary',
        method: 'GET',
      }

      await assert.rejects(
        async () => guard.canActivate(createMockExecutionContext(reqCourses)),
        (err) => {
          assert.equal(err.status, 403)
          assert.equal(err.response.consent_required, true)
          assert.equal(err.response.current_policy_version, CURRENT_POLICY_VERSION)
          return true
        },
      )
    })

    it('allows consent status and acceptance routes even if consent is outdated', async () => {
      const supabase = createMockSupabaseService({
        getUserResult: {
          data: {
            user: {
              id: 'u1',
              email: 'student@kannur.edu',
              app_metadata: { role: 'student', accepted_policy_version: '2024-old-version' },
            },
          },
          error: null,
        },
        studentData: { id: 'u1', department_id: 'd1', campus_id: 'c1', must_change_password: false },
        consentRecord: null,
      })
      const guard = new AuthGuard(supabase)

      const reqConsentStatus = {
        headers: { authorization: 'Bearer valid-token' },
        originalUrl: '/api/consent/status',
        method: 'GET',
      }
      const allowed = await guard.canActivate(createMockExecutionContext(reqConsentStatus))
      assert.equal(allowed, true)
    })
  })

  describe('6. F57: Shared Route Role Permissions (routeConfig)', () => {
    const routeConfigPath = path.resolve(__dirname, '../../frontend/src/core/security/routeConfig.ts')
    const routeConfigContent = fs.readFileSync(routeConfigPath, 'utf8')

    it('SHARED_DASHBOARD_ROUTES allows student, teacher, hod, director, and superadmin for credit ledger', () => {
      assert.ok(routeConfigContent.includes("'/dashboard/credit-ledger'"))
      const match = routeConfigContent.match(/'\/dashboard\/credit-ledger':\s*\[([^\]]+)\]/)
      assert.ok(match, 'credit ledger route should be defined in SHARED_DASHBOARD_ROUTES')
      const allowedRoles = match[1]
      assert.ok(allowedRoles.includes("'student'"))
      assert.ok(allowedRoles.includes("'teacher'"))
      assert.ok(allowedRoles.includes("'hod'"))
      assert.ok(allowedRoles.includes("'campus_director'"))
      assert.ok(allowedRoles.includes("'superadmin'"))
    })

    it('SHARED_DASHBOARD_ROUTES strictly excludes teaching_staff (roster-only boundary)', () => {
      const match = routeConfigContent.match(/'\/dashboard\/credit-ledger':\s*\[([^\]]+)\]/)
      assert.ok(match, 'credit ledger route should be defined in SHARED_DASHBOARD_ROUTES')
      const allowedRoles = match[1]
      assert.equal(allowedRoles.includes('teaching_staff'), false)
    })
  })
})
