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
  tag: string | null
}

export type SemesterBlueprint = {
  id: string
  department_id: string
  semester: Semester
  min_credits: number
  max_credits: number
  slot_1_rule: SlotRule | null
  slot_1_target: string | null
  slot_1_name: string | null
  slot_2_rule: SlotRule | null
  slot_2_target: string | null
  slot_2_name: string | null
  slot_3_rule: SlotRule | null
  slot_3_target: string | null
  slot_3_name: string | null
  slot_4_rule: SlotRule | null
  slot_4_target: string | null
  slot_4_name: string | null
  slot_5_rule: SlotRule | null
  slot_5_target: string | null
  slot_5_name: string | null
  slot_6_rule: SlotRule | null
  slot_6_target: string | null
  slot_6_name: string | null
  pathways: Pathway[] | null
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