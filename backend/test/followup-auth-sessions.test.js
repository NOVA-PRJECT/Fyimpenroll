const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { AuthService } = require('../dist/modules/auth/auth.service')
const { StudentService } = require('../dist/modules/student/student.service')
const { AuthGuard } = require('../dist/core/auth/guards/auth.guard')
const { CURRENT_POLICY_VERSION } = require('../dist/modules/consent/consent.constants')

// ── Mock Helpers ────────────────────────────────────────────────────────────

function createMockSupabaseService(options = {}) {
  const {
    initialMustChange = true,
    initialPendingSync = false,
    role = 'student',
    failProfileUpdate = false,
    signOutError = null,
  } = options

  const userRecord = {
    id: 'user-001',
    email: 'user@kannur.edu',
    app_metadata: {
      role,
      must_change_password: initialMustChange,
      pending_profile_sync: initialPendingSync,
      accepted_policy_version: CURRENT_POLICY_VERSION,
    },
  }

  let lastSignOutArg = null

  return {
    _userRecord: userRecord,
    getSignOutArg: () => lastSignOutArg,
    admin: {
      auth: {
        getUser: async (token) => {
          if (token === 'expired-jwt') {
            return { data: null, error: { message: 'JWT expired', status: 401 } }
          }
          return { data: { user: userRecord }, error: null }
        },
        admin: {
          getUserById: async (id) => ({
            data: { user: userRecord },
            error: null,
          }),
          updateUserById: async (id, payload) => {
            if (payload.app_metadata) {
              userRecord.app_metadata = {
                ...userRecord.app_metadata,
                ...payload.app_metadata,
              }
            }
            return { data: { user: userRecord }, error: null }
          },
          signOut: async (jwtOrId, scope) => {
            lastSignOutArg = { arg: jwtOrId, scope }
            if (signOutError) {
              return { data: null, error: signOutError }
            }
            return { data: null, error: null }
          },
        },
      },
      from: (table) => {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: userRecord.id,
                  full_name: 'Test Account',
                  current_semester: 2,
                  department_id: 'dept-1',
                  campus_id: 'campus-1',
                  must_change_password: userRecord.app_metadata.must_change_password,
                },
                error: null,
              }),
              maybeSingle: async () => ({
                data: {
                  id: userRecord.id,
                  full_name: 'Test Account',
                  current_semester: 2,
                  department_id: 'dept-1',
                  campus_id: 'campus-1',
                  must_change_password: userRecord.app_metadata.must_change_password,
                },
                error: null,
              }),
            }),
          }),
          update: (fields) => ({
            eq: async (col, val) => {
              if (failProfileUpdate) {
                return { error: { message: 'Database write failure: connection timeout' } }
              }
              if (fields.must_change_password !== undefined) {
                userRecord._dbMustChange = fields.must_change_password
              }
              return { error: null }
            },
          }),
        }
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
              user: userRecord,
              session: {
                access_token: 'fresh-access-jwt',
                refresh_token: 'fresh-refresh-token',
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

function createMockRateLimiter() {
  return {
    loginLimiter: {},
    emailLoginLimiter: {},
    checkLimit: async () => ({ success: true }),
    resetLoginLimits: async () => {},
  }
}

function createMockAuditLogger() {
  const logs = []
  return {
    logs,
    log: async (entry) => {
      logs.push(entry)
    },
  }
}

function createMockServerLogger() {
  const warnings = []
  return {
    warnings,
    warn: (msg) => warnings.push(msg),
    log: () => {},
    error: () => {},
  }
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Follow-up Plan 02: Password changes, session refresh and logout (R02, R30, R31, R32)', () => {
  // ── R02: Password Change Bypass Prevention & Server-Trusted Sync ───────────

  it('R02-1: Direct call to syncPasswordStatus without verified pending state is rejected with 400', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: false,
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    await assert.rejects(
      async () => {
        await authService.syncPasswordStatus('user-001')
      },
      (err) => {
        assert.equal(err.status, 400)
        assert.match(err.message, /No verified pending password update found/)
        return true
      },
    )

    // Account MUST remain restricted
    assert.equal(mockSupabase._userRecord.app_metadata.must_change_password, true)
    assert.equal(mockSupabase._userRecord.app_metadata.pending_profile_sync, false)
  })

  it('R02-2: completePasswordReset rejects client boolean passwordUpdated: true without new password', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: false,
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    await assert.rejects(
      async () => {
        await authService.completePasswordReset('user-001', { passwordUpdated: true })
      },
      (err) => {
        assert.equal(err.status, 400)
        assert.match(err.message, /Client assertions are not accepted/)
        return true
      },
    )

    // Account MUST remain restricted
    assert.equal(mockSupabase._userRecord.app_metadata.must_change_password, true)
  })

  it('R02-3: Real password update with database sync failure returns SYNC_FAILED and sets pending_profile_sync', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: false,
      failProfileUpdate: true,
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    const user = {
      userId: 'user-001',
      email: 'user@kannur.edu',
      role: 'student',
      must_change_password: true,
    }

    const result = await authService.changePassword('old-password', 'NewSecurePass123', user)

    assert.equal(result.success, false)
    assert.equal(result.code, 'SYNC_FAILED')
    assert.equal(result.canRetrySync, true)

    // Must still be restricted because database profile sync failed
    assert.equal(mockSupabase._userRecord.app_metadata.must_change_password, true)
    // BUT pending_profile_sync MUST be true to allow recovery
    assert.equal(mockSupabase._userRecord.app_metadata.pending_profile_sync, true)
  })

  it('R02-4: Successful syncPasswordStatus with pending_profile_sync completes recovery and clears flags', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: true, // Server-trusted proof that Auth update completed
      failProfileUpdate: false,
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    const result = await authService.syncPasswordStatus('user-001')

    assert.equal(result.success, true)
    assert.equal(result.message, 'Password synchronization complete.')

    // Flags are now completely cleared
    assert.equal(mockSupabase._userRecord.app_metadata.must_change_password, false)
    assert.equal(mockSupabase._userRecord.app_metadata.pending_profile_sync, false)
    assert.equal(mockSupabase._userRecord._dbMustChange, false)
  })

  // ── R32: Teacher Cookie Password Change Flow ────────────────────────────────

  it('R32: Newly created teacher updates temporary password via cookie session without email reset link', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: false,
      role: 'teacher',
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    const teacherUser = {
      userId: 'user-001',
      email: 'teacher@kannur.edu',
      role: 'teacher',
      department_id: 'dept-1',
      campus_id: 'campus-1',
      must_change_password: true,
    }

    const result = await authService.changePassword('temp-pass', 'PermPass9876!', teacherUser)

    assert.equal(result.success, true)
    assert.equal(result.token, 'fresh-access-jwt')
    assert.equal(mockSupabase._userRecord.app_metadata.must_change_password, false)
    assert.equal(mockSupabase._userRecord.app_metadata.pending_profile_sync, false)
  })

  // ── R31: Supabase Admin SignOut with JWT and Error Inspection ───────────────

  it('R31-1: Logout passes access JWT (not userId) to admin.signOut(jwt, "global")', async () => {
    const mockSupabase = createMockSupabaseService()
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    const userWithJwt = {
      userId: 'user-001',
      email: 'user@kannur.edu',
      role: 'student',
      token: 'jwt-access-token-xyz',
    }

    const result = await authService.logout(userWithJwt, '192.168.1.1')

    assert.equal(result.success, true)
    assert.equal(result.revoked, true)

    const signOutArg = mockSupabase.getSignOutArg()
    assert.ok(signOutArg, 'admin.signOut was called')
    assert.equal(signOutArg.arg, 'jwt-access-token-xyz', 'Must pass the access JWT, not user UUID')
    assert.equal(signOutArg.scope, 'global')
  })

  it('R31-2: Logout accurately inspects and logs Supabase revocation errors', async () => {
    const mockSupabase = createMockSupabaseService({
      signOutError: { message: 'Provider network timeout during revocation' },
    })
    const auditLogger = createMockAuditLogger()
    const serverLogger = createMockServerLogger()
    const rateLimiter = createMockRateLimiter()

    const authService = new AuthService(mockSupabase, rateLimiter, auditLogger, serverLogger)

    const userWithJwt = {
      userId: 'user-001',
      email: 'user@kannur.edu',
      role: 'student',
      token: 'jwt-access-token-xyz',
    }

    const result = await authService.logout(userWithJwt, '192.168.1.1')

    assert.equal(result.success, true)
    assert.equal(result.revoked, false, 'Revocation failure must be reported')

    // Audit log should capture failure status
    const logoutLog = auditLogger.logs.find((l) => l.eventType === 'user_logout')
    assert.ok(logoutLog)
    assert.equal(logoutLog.status, 'failure')
    assert.equal(logoutLog.metadata.error, 'Provider network timeout during revocation')

    // Server logger should record warning
    assert.ok(serverLogger.warnings.some((w) => w.includes('Provider network timeout')))
  })

  // ── R30: Deduplicated Refresh & Mutation Safety Contract ───────────────────

  it('R30-1: AuthGuard rejects expired token with 401 Unauthorized', async () => {
    const mockSupabase = createMockSupabaseService()
    const authGuard = new AuthGuard(mockSupabase)

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer expired-jwt' },
        }),
      }),
    }

    await assert.rejects(
      async () => {
        await authGuard.canActivate(mockContext)
      },
      (err) => {
        assert.equal(err.status, 401)
        assert.match(err.message, /expired authentication session/)
        return true
      },
    )
  })

  it('R30-2: AuthGuard restricts non-allowlisted routes when must_change_password is true', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      role: 'student',
    })
    const authGuard = new AuthGuard(mockSupabase)

    // Request to regular student dashboard endpoint
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid-jwt' },
          path: '/api/student/dashboard-summary',
        }),
      }),
    }

    await assert.rejects(
      async () => {
        await authGuard.canActivate(mockContext)
      },
      (err) => {
        assert.equal(err.status, 403)
        assert.equal(err.response.must_change_password, true)
        return true
      },
    )

    // Request to allowed restricted endpoint (/api/auth/change-password) succeeds
    const allowedContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid-jwt' },
          path: '/api/auth/change-password',
        }),
      }),
    }

    const canAccess = await authGuard.canActivate(allowedContext)
    assert.equal(canAccess, true)
  })

  it('R30-3: StudentService.changePassword aligns with pending_profile_sync state', async () => {
    const mockSupabase = createMockSupabaseService({
      initialMustChange: true,
      initialPendingSync: false,
      failProfileUpdate: true,
    })

    const studentService = new StudentService(mockSupabase)

    const user = {
      userId: 'user-001',
      email: 'user@kannur.edu',
      role: 'student',
      department_id: 'dept-1',
      campus_id: 'campus-1',
      must_change_password: true,
    }

    const result = await studentService.changePassword('old-password', 'NewPass1234!', user)

    assert.equal(result.success, false)
    assert.equal(result.code, 'SYNC_FAILED')
    assert.equal(result.canRetrySync, true)
    // Server-trusted pending flag was set
    assert.equal(mockSupabase._userRecord.app_metadata.pending_profile_sync, true)
  })
})
