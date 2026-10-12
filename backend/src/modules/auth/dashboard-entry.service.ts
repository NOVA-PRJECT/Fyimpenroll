import { Injectable } from '@nestjs/common'
import { AuthUser } from '../../core/auth/types'
import { AuthService, ROLE_DASHBOARD_MAP } from './auth.service'
import { StudentService } from '../student/student.service'
import { DirectorService } from '../director/director.service'
import { FacultyService } from '../faculty/faculty.service'

@Injectable()
export class DashboardEntryService {
  constructor(private readonly auth: AuthService, private readonly student: StudentService,
    private readonly director: DirectorService, private readonly faculty: FacultyService) {}

  async load(user: AuthUser, path?: string) {
    if (!path || path !== ROLE_DASHBOARD_MAP[user.role] || user.must_change_password || !user.consent?.accepted) return undefined
    let endpoint: string
    let data: unknown
    try {
      if (user.role === 'student') {
        endpoint = '/api/student/dashboard-summary'; data = await this.student.getDashboardSummary(user)
      } else if (user.role === 'campus_director') {
        endpoint = '/api/director/settings'; data = await this.director.getSettings(user)
      } else if (user.role === 'teacher' || user.role === 'teaching_staff') {
        endpoint = '/api/faculty/courses'; data = await this.faculty.getCourses(user)
      } else {
        endpoint = '/api/auth/profile'; data = await this.auth.getProfile(user)
      }
      return { path, endpoint, data }
    } catch {
      // Preserve the page's normal authenticated request and retry on data failure.
      return undefined
    }
  }
}
