import { Semester } from '../constants/semesters'

export type Student = {
  id: string
  full_name: string
  department_id: string
  campus_id: string
  current_semester: Semester
  cap_application_number: string
  academic_year_joined: string
}

export type AdmissionsMaster = {
  id: string
  cap_application_number: string
  date_of_birth: string
  full_name: string
  email: string
  department_id: string
  campus_id: string
  academic_year: string
  is_claimed: boolean
}

export type StudentRegistration = {
  id: string
  student_id: string
  semester: Semester
  academic_year: string
  slot_1_course_id: string
  slot_2_course_id: string
  slot_3_course_id: string
  slot_4_course_id: string
  slot_5_course_id: string
  slot_6_course_id: string
  slot_7_course_id?: string | null
  slot_8_course_id?: string | null
  total_credits: number
  submitted_at: string
}