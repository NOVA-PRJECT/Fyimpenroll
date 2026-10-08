import { NextRequest, NextResponse } from 'next/server'
import { DASHBOARD_ROLE_MAP, ROLE_DASHBOARD_MAP, SHARED_DASHBOARD_ROUTES } from '@/core/security/routeConfig'
import { Role, ROLES } from '@/core/constants/roles'

type ProfileCheck =
  | { kind: 'authorized'; role: Role; mustChangePassword?: boolean }
  | { kind: 'restricted'; role: Role; mustChangePassword: true }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }

async function resolveRoleFromBackend(token: string): Promise<ProfileCheck> {
  const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')

  try {
    const response = await fetch(`${backendUrl}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (response.status === 401) {
      return { kind: 'unauthorized' }
    }

    if (response.status === 403) {
      const payload = await response.json().catch(() => ({}))
      if (payload?.must_change_password) {
        return {
          kind: 'restricted',
          role: (payload.role as Role) || 'student',
          mustChangePassword: true,
        }
      }
      return { kind: 'unauthorized' }
    }

    if (!response.ok) {
      return { kind: 'unavailable' }
    }

    const payload = await response.json()
    const validRoles = Object.values(ROLES) as string[]
    if (!validRoles.includes(payload?.role)) {
      return { kind: 'unauthorized' }
    }

    if (payload.must_change_password) {
      return { kind: 'restricted', role: payload.role as Role, mustChangePassword: true }
    }

    return { kind: 'authorized', role: payload.role as Role, mustChangePassword: false }
  } catch {
    return { kind: 'unavailable' }
  }
}

async function tryRefreshSession(
  request: NextRequest,
): Promise<{ token: string; refreshToken?: string; role: Role; mustChangePassword: boolean } | null> {
  const refreshToken = request.cookies.get('refresh_token')?.value
  if (!refreshToken) return null

  const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')
  try {
    const res = await fetch(`${backendUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.token) return null
    return {
      token: data.token,
      refreshToken: data.refreshToken,
      role: data.role as Role,
      mustChangePassword: !!data.must_change_password,
    }
  } catch {
    return null
  }
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.delete('auth_token')
  response.cookies.delete('refresh_token')
  response.cookies.delete('user_role')
  return response
}

function attachAuthCookies(response: NextResponse, token: string, refreshToken?: string) {
  response.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  })
  if (refreshToken) {
    response.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
  }
  return response
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isLoginRoute = pathname.startsWith('/login')
  const isDashboardRoute = pathname.startsWith('/dashboard')
  const isConsentRoute = pathname.startsWith('/consent')
  const isHomeRoute = pathname === '/'
  const isApiRoute = pathname.startsWith('/api')

  // API requests are authorized by the NestJS AuthGuard and never by this UI middleware.
  if (isApiRoute) return NextResponse.next()

  const isPasswordResetRoute = pathname.startsWith('/reset-password')
  const isStudentChangePasswordRoute = pathname === '/dashboard/student/change-password'

  const needsRole = isDashboardRoute || isConsentRoute || isLoginRoute || isHomeRoute
  if (!needsRole && !isPasswordResetRoute) return NextResponse.next()

  let token = request.cookies.get('auth_token')?.value
  let profile: ProfileCheck = token ? await resolveRoleFromBackend(token) : { kind: 'unauthorized' }
  let refreshedTokens: { token: string; refreshToken?: string } | null = null

  // F11: If access token is missing or unauthorized, try refreshing with refresh_token cookie
  if (profile.kind === 'unauthorized') {
    const refreshed = await tryRefreshSession(request)
    if (refreshed) {
      token = refreshed.token
      refreshedTokens = { token: refreshed.token, refreshToken: refreshed.refreshToken }
      profile = refreshed.mustChangePassword
        ? { kind: 'restricted', role: refreshed.role, mustChangePassword: true }
        : { kind: 'authorized', role: refreshed.role, mustChangePassword: false }
    }
  }

  // Handle unavailable backend
  if (profile.kind === 'unavailable') {
    if (isDashboardRoute || isConsentRoute) {
      return NextResponse.json(
        { message: 'Authentication service is temporarily unavailable. Please retry.' },
        { status: 503 },
      )
    }
    return NextResponse.next()
  }

  // Handle unauthorized (no valid session and refresh failed)
  if (profile.kind === 'unauthorized') {
    if (isDashboardRoute || isConsentRoute) {
      const response = NextResponse.redirect(new URL('/login', request.url))
      return clearAuthCookies(response)
    }
    return clearAuthCookies(NextResponse.next())
  }

  // Handle restricted session (must_change_password: true) (F07)
  if (profile.kind === 'restricted') {
    const isAllowedRestrictedPage =
      isStudentChangePasswordRoute ||
      isPasswordResetRoute ||
      isConsentRoute ||
      isLoginRoute ||
      pathname.startsWith('/auth/logout')

    if (!isAllowedRestrictedPage && isDashboardRoute) {
      const dest = profile.role === 'student'
        ? '/dashboard/student/change-password'
        : '/reset-password/confirm'
      const response = NextResponse.redirect(new URL(dest, request.url))
      if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
      return response
    }

    const response = NextResponse.next()
    if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
    return response
  }

  // User is authorized
  const role = profile.role

  if (isLoginRoute || isHomeRoute) {
    const response = NextResponse.redirect(new URL(ROLE_DASHBOARD_MAP[role] || '/login', request.url))
    if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
    return response
  }

  if (isDashboardRoute) {
    // F57: Check shared routes first (e.g. credit ledger)
    const matchedSharedRoute = Object.keys(SHARED_DASHBOARD_ROUTES)
      .sort((a, b) => b.length - a.length)
      .find((route) => pathname === route || pathname.startsWith(route + '/'))

    if (matchedSharedRoute) {
      const allowedRoles = SHARED_DASHBOARD_ROUTES[matchedSharedRoute]
      if (allowedRoles.includes(role)) {
        const response = NextResponse.next()
        if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
        return response
      } else {
        // Denied role (e.g. teaching_staff on credit ledger)
        const response = NextResponse.redirect(new URL(ROLE_DASHBOARD_MAP[role] || '/login', request.url))
        if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
        return response
      }
    }

    // Role-exclusive dashboard routes
    const matchedRoute = Object.keys(DASHBOARD_ROLE_MAP)
      .sort((a, b) => b.length - a.length)
      .find((route) => pathname === route || pathname.startsWith(route + '/'))

    if (!matchedRoute) {
      const response = NextResponse.redirect(new URL('/login', request.url))
      return clearAuthCookies(response)
    }

    const requiredRole = DASHBOARD_ROLE_MAP[matchedRoute]
    if (role !== requiredRole) {
      const response = NextResponse.redirect(new URL(ROLE_DASHBOARD_MAP[role] || '/login', request.url))
      if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
      return response
    }
  }

  const response = NextResponse.next()
  if (refreshedTokens) attachAuthCookies(response, refreshedTokens.token, refreshedTokens.refreshToken)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
