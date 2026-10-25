import { CourseCategory, SlotRule } from '../constants/courseCategories'
import { Semester } from '../constants/semesters'

export type Course = {
  id: string
  course_code: string
  title: string
  department_id: string
  semester: Semester
  credits: number
  category: CourseCategory
}

export type SemesterBlueprint = {
  id: string
  department_id: string
  semester: Semester
  min_credits: number
  max_credits: number
  pathways: Pathway[]
}

// ── Pathway types ───────────────────────────────────────────

export type PathwaySlot = {
  rule: string
  target: string
  name: string
}

export type Pathway = {
  id: string
  name: string
  slots: PathwaySlot[]
}

export type PathwaySummary = {
  id: string
  name: string
}

export type BlueprintSlot = {
  slot: number
  rule: SlotRule | string
  name: string
  course?: Course & { department_name?: string }
  options?: (Course & { department_name?: string })[]
}

export type BlueprintResponse = {
  window_status: 'OPEN' | 'CLOSED'
  deadline: string
  min_credits: number
  max_credits: number
  slots?: BlueprintSlot[]
  pathways?: PathwaySummary[]
  pathway_id?: string
}