'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  UserCheck,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Edit2,
  Plus,
  Search,
  Sparkles,
  UserPlus,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  X,
  AlertCircle,
  Check,
} from 'lucide-react'
import styles from './hod-dashboard.module.css'

interface Teacher {
  id: string
  full_name: string
  email: string
  role: string
}

interface CourseAssignment {
  assignment_id: string
  teacher_id: string
  teacher_name: string
  teacher_email: string
  assigned_at: string
}

interface StagedAssignment {
  courseId: string
  courseCode: string
  courseTitle: string
  teacherId: string
  teacherName: string
  teacherEmail?: string
}

interface Course {
  id: string
  course_code: string
  title: string
  credits: number
  category: string
  semester: number
  assignments: CourseAssignment[]
  is_assigned: boolean
}

// ── Custom Node Components for React Flow ──
function TeacherNode({ data }: { data: { teacher: Teacher; assignmentCount: number } }) {
  return (
    <div
      style={{
        background: "var(--portal-surface,#ffffff)",
        border: "1.5px solid var(--portal-info-border,#002147)",
        borderRadius: '10px',
        padding: '10px 14px',
        minWidth: '220px',
        boxShadow: '0 4px 12px rgba(0, 33, 71, 0.08)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: "var(--portal-info-bg,#e6f0fa)",
            color: "var(--portal-brand-text,#002147)",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '13px',
          }}
        >
          {data.teacher.full_name.charAt(0)}
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: "var(--portal-brand-text,#002147)", whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {data.teacher.full_name}
          </div>
          <div style={{ fontSize: '11px', color: "var(--portal-muted,#666)", whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {data.teacher.email}
          </div>
        </div>
      </div>
      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', background: "var(--portal-info-bg,#f0f4f8)", padding: '2px 6px', borderRadius: '4px', color: "var(--portal-muted,#444)" }}>
          {data.teacher.role}
        </span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: data.assignmentCount > 0 ? "var(--portal-success-text,#16a34a)" : "var(--portal-subtle,#9ca3af)" }}>
          {data.assignmentCount} {data.assignmentCount === 1 ? 'Course' : 'Courses'}
        </span>
      </div>
      {/* Target handle on right for connecting to courses */}
      <Handle
        type="source"
        position={Position.Right}
        id="teacher-source"
        style={{
          background: "var(--portal-primary,#002147)",
          width: '10px',
          height: '10px',
          border: "2px solid var(--portal-border,#fff)",
        }}
      />
    </div>
  )
}

function CourseNode({
  data,
}: {
  data: {
    course: Course
    stagedAssignment?: StagedAssignment
    onCancelStaged?: (courseId: string) => void
    onReassign: (assignment: CourseAssignment) => void
    onRemove: (assignment: CourseAssignment, course: Course) => void
  }
}) {
  const isAssigned = data.course.is_assigned
  const hasStaged = !!data.stagedAssignment

  return (
    <div
      style={{
        background: "var(--portal-surface,#ffffff)",
        border: hasStaged
          ? "2px solid var(--portal-warning-border,#E0A92C)"
          : isAssigned
          ? "1.5px solid var(--portal-info-border,#0284c7)"
          : "2px dashed var(--portal-warning-border,#f59e0b)",
        borderRadius: '10px',
        padding: '10px 14px',
        minWidth: '240px',
        boxShadow: hasStaged
          ? '0 4px 14px rgba(224, 169, 44, 0.25)'
          : isAssigned
          ? '0 4px 12px rgba(2, 132, 199, 0.08)'
          : '0 4px 12px rgba(245, 158, 11, 0.12)',
        position: 'relative',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="course-target"
        style={{
          background: hasStaged ? '#E0A92C' : isAssigned ? '#0284c7' : '#f59e0b',
          width: '10px',
          height: '10px',
          border: "2px solid var(--portal-border,#fff)",
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            background: hasStaged ? "var(--portal-warning-bg,#fef3c7)" : isAssigned ? "var(--portal-info-bg,#e0f2fe)" : "var(--portal-warning-bg,#fef3c7)",
            color: hasStaged ? "var(--portal-warning-text,#92400e)" : isAssigned ? "var(--portal-info-text,#0369a1)" : "var(--portal-warning-text,#b45309)",
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          {data.course.course_code}
        </span>
        <span style={{ fontSize: '10px', color: "var(--portal-muted,#64748b)" }}>
          Sem {data.course.semester} • {data.course.credits} Cr
        </span>
      </div>

      <div style={{ fontWeight: 600, fontSize: '12px', color: "var(--portal-brand-text,#1e293b)", marginTop: '4px', lineHeight: '1.3' }}>
        {data.course.title}
      </div>

      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Existing active assignments */}
        {data.course.assignments.map((a) => (
          <div
            key={a.assignment_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: "var(--portal-info-bg,#f8fafc)",
              border: "1px solid var(--portal-strong-border,#e2e8f0)",
              borderRadius: '6px',
              padding: '3px 6px',
              fontSize: '11px',
            }}
          >
            <span style={{ fontWeight: 500, color: "var(--portal-brand-text,#0f172a)", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>
              {a.teacher_name}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  data.onReassign(a)
                }}
                title="Reassign to another teacher"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: "var(--portal-info-text,#0284c7)",
                  padding: '2px',
                }}
              >
                <Edit2 size={11} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  data.onRemove(a, data.course)
                }}
                title="Remove assignment"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: "var(--portal-danger-text,#ef4444)",
                  padding: '2px',
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}

        {/* Staged pending assignment */}
        {data.stagedAssignment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: "var(--portal-warning-bg,#fffbeb)",
              border: "1.5px solid var(--portal-warning-border,#E0A92C)",
              borderRadius: '6px',
              padding: '3px 6px',
              fontSize: '11px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E0A92C', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: "var(--portal-warning-text,#92400e)", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                {data.stagedAssignment.teacherName}
              </span>
              <span style={{ fontSize: '9px', background: "var(--portal-warning-bg,#fde68a)", color: "var(--portal-warning-text,#78350f)", padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>
                PENDING
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                data.onCancelStaged?.(data.course.id)
              }}
              title="Discard staged assignment"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: "var(--portal-warning-text,#b45309)", padding: '2px' }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Unassigned placeholder */}
        {data.course.assignments.length === 0 && !data.stagedAssignment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: "var(--portal-warning-text,#d97706)",
              fontWeight: 500,
            }}
          >
            <AlertTriangle size={12} />
            <span>Drop teacher here to assign</span>
          </div>
        )}
      </div>
    </div>
  )
}

const nodeTypes = {
  teacherNode: TeacherNode,
  courseNode: CourseNode,
}

export default function TeacherAssignmentTab({
  onDirtyChange,
}: {
  onDirtyChange?: (isDirty: boolean) => void
} = {}) {
  const [loading, setLoading] = useState(true)
  const [faculty, setFaculty] = useState<Teacher[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [semesterFilter, setSemesterFilter] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isMobileView, setIsMobileView] = useState(false)

  // Staged assignments awaiting batch save
  const [stagedAssignments, setStagedAssignments] = useState<Map<string, StagedAssignment>>(new Map())
  const [savingBatch, setSavingBatch] = useState(false)

  const isDirty = stagedAssignments.size > 0

  // Sync dirty state to parent HOD tab manager
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Prevent accidental browser reload / window close when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Reassignment Modal State
  const [reassignTarget, setReassignTarget] = useState<CourseAssignment | null>(null)
  const [reassignTeacherId, setReassignTeacherId] = useState('')
  const [reassigning, setReassigning] = useState(false)

  // Remove Assignment Modal State
  const [removeTarget, setRemoveTarget] = useState<{
    assignment_id: string
    course_code: string
    course_title: string
    teacher_name: string
  } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeModalError, setRemoveModalError] = useState('')

  // Manual Add Modal State (for list view)
  const [assignCourseTarget, setAssignCourseTarget] = useState<Course | null>(null)
  const [assignTeacherId, setAssignTeacherId] = useState('')

  // Add Teacher Modal State
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false)
  const [newTeacherName, setNewTeacherName] = useState('')
  const [newTeacherEmail, setNewTeacherEmail] = useState('')
  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*'
    let pwd = ''
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return pwd
  }

  const [newTeacherPassword, setNewTeacherPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [teacherModalError, setTeacherModalError] = useState('')
  const [addingTeacher, setAddingTeacher] = useState(false)

  // Manage Teachers Modal State
  const [showManageTeachersModal, setShowManageTeachersModal] = useState(false)
  const [deletingTeacherId, setDeletingTeacherId] = useState<string | null>(null)

  // Eligible faculty (strictly excluding HOD)
  const eligibleFaculty = useMemo(() => {
    return (faculty || []).filter(
      (f) => f.role === 'teacher' || f.role === 'teaching_staff'
    )
  }, [faculty])

  // React Flow State
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Detect viewport width for >= 1024px canvas vs < 1024px list
  useEffect(() => {
    function checkWidth() {
      setIsMobileView(window.innerWidth < 1024)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // ── Fetch Courses and Faculty Data ──
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/assignments/courses')
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to load assignment data.')
        setLoading(false)
        return
      }
      setCourses(data.courses || [])
      setFaculty(data.faculty || [])
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error fetching assignments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
    fetchData()
  }, [fetchData])

  // Filtered courses
  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      const matchSem = semesterFilter === 'all' || c.semester === semesterFilter
      const matchQuery =
        searchQuery.trim() === '' ||
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.course_code.toLowerCase().includes(searchQuery.toLowerCase())
      return matchSem && matchQuery
    })
  }, [courses, semesterFilter, searchQuery])

  // ── Handle Discarding a Single Staged Assignment ──
  const handleCancelStaged = useCallback((courseId: string) => {
    setStagedAssignments((prev) => {
      const next = new Map(prev)
      next.delete(courseId)
      return next
    })
  }, [])

  // ── Handle Discarding All Staged Assignments ──
  const handleDiscardAllStaged = useCallback(() => {
    if (stagedAssignments.size === 0) return
    if (confirm(`Discard all ${stagedAssignments.size} pending assignment changes?`)) {
      setStagedAssignments(new Map())
    }
  }, [stagedAssignments.size])

  // ── Handle Saving All Staged Assignments in a Single Batch Request ──
  const handleSaveAllStaged = useCallback(async () => {
    if (stagedAssignments.size === 0) return
    setSavingBatch(true)
    setError('')
    try {
      const payload = {
        assignments: Array.from(stagedAssignments.values()).map((s) => ({
          teacher_id: s.teacherId,
          course_id: s.courseId,
        })),
      }

      const res = await fetch('/api/assignments/batch-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to save batch assignments.')
        return
      }

      setSuccess(`Successfully saved ${stagedAssignments.size} assignment(s)!`)
      setTimeout(() => setSuccess(''), 4000)
      setStagedAssignments(new Map())
      await fetchData()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error saving assignments.')
    } finally {
      setSavingBatch(false)
    }
  }, [stagedAssignments, fetchData])

  // ── Compute React Flow Nodes and Edges ──
  useEffect(() => {
    if (isMobileView) return

    // Calculate teacher assignment count (including staged assignments)
    const teacherCountMap = new Map<string, number>()
    for (const c of courses) {
      for (const a of c.assignments) {
        teacherCountMap.set(a.teacher_id, (teacherCountMap.get(a.teacher_id) || 0) + 1)
      }
    }
    for (const s of stagedAssignments.values()) {
      teacherCountMap.set(s.teacherId, (teacherCountMap.get(s.teacherId) || 0) + 1)
    }

    // Filter faculty matching search query if relevant (strictly excluding HOD)
    const matchingFaculty = eligibleFaculty.filter(
      (f) =>
        searchQuery.trim() === '' ||
        f.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.email.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    // Place Teacher nodes on the Left (X: 50)
    matchingFaculty.forEach((teacher, idx) => {
      newNodes.push({
        id: `teacher-${teacher.id}`,
        type: 'teacherNode',
        position: { x: 50, y: 50 + idx * 110 },
        data: {
          teacher,
          assignmentCount: teacherCountMap.get(teacher.id) || 0,
        },
      })
    })

    // Place Course nodes on the Right (X: 520)
    filteredCourses.forEach((course, idx) => {
      const staged = stagedAssignments.get(course.id)

      newNodes.push({
        id: `course-${course.id}`,
        type: 'courseNode',
        position: { x: 520, y: 50 + idx * 130 },
        data: {
          course,
          stagedAssignment: staged,
          onCancelStaged: handleCancelStaged,
          onReassign: (a: CourseAssignment) => {
            setReassignTarget(a)
            setReassignTeacherId('')
          },
          onRemove: (a: CourseAssignment, c: Course) => {
            setRemoveTarget({
              assignment_id: a.assignment_id,
              course_code: c.course_code,
              course_title: c.title,
              teacher_name: a.teacher_name,
            })
            setRemoveModalError('')
          },
        },
      })

      // Add edges for active assignments
      course.assignments.forEach((assignment) => {
        newEdges.push({
          id: `edge-${assignment.assignment_id}`,
          source: `teacher-${assignment.teacher_id}`,
          target: `course-${course.id}`,
          sourceHandle: 'teacher-source',
          targetHandle: 'course-target',
          animated: true,
          style: { stroke: "var(--portal-info-text,#0284c7)", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#0284c7',
          },
        })
      })

      // Add dashed edge for staged pending assignment
      if (staged) {
        newEdges.push({
          id: `edge-staged-${course.id}`,
          source: `teacher-${staged.teacherId}`,
          target: `course-${course.id}`,
          sourceHandle: 'teacher-source',
          targetHandle: 'course-target',
          animated: true,
          style: { stroke: '#E0A92C', strokeWidth: 2.5, strokeDasharray: '5,5' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#E0A92C',
          },
        })
      }
    })

    setNodes(newNodes)
    setEdges(newEdges)
  }, [eligibleFaculty, courses, filteredCourses, isMobileView, searchQuery, stagedAssignments, handleCancelStaged, setNodes, setEdges])

  // ── Handle Connection Drag on Canvas (Stages locally) ──
  const onConnect = useCallback(
    (params: Connection) => {
      const sourceId = params.source
      const targetId = params.target

      if (!sourceId?.startsWith('teacher-') || !targetId?.startsWith('course-')) {
        setError('Please drag from a Teacher node to a Course node.')
        return
      }

      const teacherId = sourceId.replace('teacher-', '')
      const courseId = targetId.replace('course-', '')

      const teacher = faculty.find((f) => f.id === teacherId)
      const course = courses.find((c) => c.id === courseId)

      if (!teacher || !course) return

      setStagedAssignments((prev) => {
        const next = new Map(prev)
        next.set(courseId, {
          teacherId,
          teacherName: teacher.full_name,
          teacherEmail: teacher.email,
          courseId,
          courseCode: course.course_code,
          courseTitle: course.title,
        })
        return next
      })
      setError('')
    },
    [faculty, courses]
  )

  // ── Handle Mid-Semester Reassignment ──
  async function handleConfirmReassign() {
    if (!reassignTarget || !reassignTeacherId) return
    setReassigning(true)
    setError('')
    try {
      const res = await fetch(`/api/assignments/${reassignTarget.assignment_id}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: reassignTeacherId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to reassign teacher.')
        return
      }
      setSuccess('Course successfully reassigned to new teacher!')
      setTimeout(() => setSuccess(''), 3000)
      setReassignTarget(null)
      await fetchData()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error.')
    } finally {
      setReassigning(false)
    }
  }

  // ── Handle Confirm Removing an Assignment ──
  async function handleConfirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveModalError('')
    setError('')
    try {
      const res = await fetch(`/api/assignments/${removeTarget.assignment_id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        setRemoveModalError(data.message || 'Failed to remove assignment.')
        return
      }
      setSuccess(`Successfully removed ${removeTarget.teacher_name} from ${removeTarget.course_code}.`)
      setTimeout(() => setSuccess(''), 4000)
      setRemoveTarget(null)
      await fetchData()
    } catch (err: unknown) {
      setRemoveModalError((err instanceof Error ? err.message : '') || 'Network error removing assignment.')
    } finally {
      setRemoving(false)
    }
  }

  // ── Handle Manual Assignment (List View) — Stages locally ──
  function handleConfirmAssign() {
    if (!assignCourseTarget || !assignTeacherId) return
    const teacher = faculty.find((f) => f.id === assignTeacherId)
    if (!teacher) return

    setStagedAssignments((prev) => {
      const next = new Map(prev)
      next.set(assignCourseTarget.id, {
        teacherId: teacher.id,
        teacherName: teacher.full_name,
        teacherEmail: teacher.email,
        courseId: assignCourseTarget.id,
        courseCode: assignCourseTarget.course_code,
        courseTitle: assignCourseTarget.title,
      })
      return next
    })

    setAssignCourseTarget(null)
    setAssignTeacherId('')
  }

  // ── Handle Add New Teacher to Department ──
  async function handleCreateTeacher(e: React.FormEvent) {
    e.preventDefault()
    if (!newTeacherName.trim() || !newTeacherEmail.trim() || !newTeacherPassword.trim()) {
      setTeacherModalError('Please fill in all required fields.')
      return
    }
    if (newTeacherPassword.length < 8) {
      setTeacherModalError('Password must be at least 8 characters long.')
      return
    }
    setAddingTeacher(true)
    setTeacherModalError('')
    try {
      const res = await fetch('/api/hod/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: newTeacherName.trim(),
          email: newTeacherEmail.trim().toLowerCase(),
          password: newTeacherPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTeacherModalError(data.message || 'Failed to create teacher.')
        return
      }
      setSuccess(`Teacher "${newTeacherName}" added successfully!`)
      setTimeout(() => setSuccess(''), 4000)
      setShowAddTeacherModal(false)
      setNewTeacherName('')
      setNewTeacherEmail('')
      setNewTeacherPassword('')
      setShowPassword(false)
      setTeacherModalError('')
      await fetchData()
    } catch (err: unknown) {
      setTeacherModalError((err instanceof Error ? err.message : '') || 'Network error creating teacher.')
    } finally {
      setAddingTeacher(false)
    }
  }

  // ── Handle Remove Teacher from Department ──
  async function handleDeleteTeacher(teacherId: string, teacherName: string) {
    if (!confirm(`Are you sure you want to remove "${teacherName}"? Any active course assignments for this teacher will also be removed.`)) {
      return
    }
    setDeletingTeacherId(teacherId)
    setError('')
    try {
      const res = await fetch(`/api/hod/teachers/${teacherId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to remove teacher.')
        return
      }
      setSuccess(`Teacher "${teacherName}" removed successfully.`)
      setTimeout(() => setSuccess(''), 4000)
      await fetchData()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error removing teacher.')
    } finally {
      setDeletingTeacherId(null)
    }
  }

  // Statistics
  const totalCourses = courses.length
  const assignedCourses = courses.filter((c) => c.is_assigned).length
  const unassignedCourses = totalCourses - assignedCourses

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* ── Top Bar with Stats & Filter ── */}
      <div
        style={{
          background: "var(--portal-surface,#ffffff)",
          borderRadius: '12px',
          padding: '1.25rem',
          border: "1px solid var(--portal-strong-border,#e2e8f0)",
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: "var(--portal-brand-text,#002147)", margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#c9a227" /> Faculty Course Assignment
          </h2>
          <p style={{ fontSize: '0.8rem', color: "var(--portal-muted,#64748b)", margin: '4px 0 0' }}>
            Assign faculty to department courses. Connect teachers to courses on canvas or list view.
          </p>
        </div>

        {/* Stats Pill Strip */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: "var(--portal-info-bg,#f8fafc)",
              border: "1px solid var(--portal-strong-border,#e2e8f0)",
              fontSize: '12px',
            }}
          >
            <span style={{ color: "var(--portal-muted,#64748b)" }}>Total Courses: </span>
            <strong style={{ color: "var(--portal-brand-text,#0f172a)" }}>{totalCourses}</strong>
          </div>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: "var(--portal-success-bg,#f0fdf4)",
              border: "1px solid var(--portal-success-border,#bbf7d0)",
              fontSize: '12px',
            }}
          >
            <span style={{ color: "var(--portal-success-text,#15803d)" }}>Assigned: </span>
            <strong style={{ color: "var(--portal-success-text,#166534)" }}>{assignedCourses}</strong>
          </div>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: unassignedCourses > 0 ? "var(--portal-warning-bg,#fffbeb)" : "var(--portal-info-bg,#f8fafc)",
              border: unassignedCourses > 0 ? "1px solid var(--portal-warning-border,#fde68a)" : "1px solid var(--portal-strong-border,#e2e8f0)",
              fontSize: '12px',
            }}
          >
            <span style={{ color: unassignedCourses > 0 ? "var(--portal-warning-text,#b45309)" : "var(--portal-muted,#64748b)" }}>Unassigned: </span>
            <strong style={{ color: unassignedCourses > 0 ? "var(--portal-warning-text,#b45309)" : "var(--portal-brand-text,#0f172a)" }}>{unassignedCourses}</strong>
          </div>
        </div>
      </div>

      {/* ── Filters and Search ── */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '10px' }} />
            <input
              type="text"
              placeholder="Search faculty or course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '8px 12px 8px 34px',
                borderRadius: '8px',
                border: "1px solid var(--portal-strong-border,#cbd5e1)",
                fontSize: '13px',
                minWidth: '240px',
                outline: 'none',
              }}
            />
          </div>

          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              fontSize: '13px',
              background: "var(--portal-surface,#fff)",
              outline: 'none',
            }}
          >
            <option value="all">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>

          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              background: "var(--portal-surface,#fff)",
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: "var(--portal-info-text,#475569)",
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={() => {
              setTeacherModalError('')
              setShowAddTeacherModal(true)
            }}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              background: "var(--portal-primary,#002147)",
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              boxShadow: '0 2px 4px rgba(0,33,71,0.2)',
            }}
          >
            <Plus size={15} /> Add Teacher
          </button>

          <button
            onClick={() => setShowManageTeachersModal(true)}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              background: "var(--portal-surface,#ffffff)",
              color: "var(--portal-brand-text,#002147)",
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
            }}
          >
            <UserCheck size={15} /> Department Teachers ({eligibleFaculty.length})
          </button>
        </div>

        {/* Canvas / List view toggle hint on desktop */}
        <div style={{ fontSize: '12px', color: "var(--portal-muted,#64748b)" }}>
          {isMobileView ? (
            <span>📱 Showing Touch List View</span>
          ) : (
            <span>🖥️ Canvas View (Drag node handle to assign)</span>
          )}
        </div>
      </div>

      {/* ── Banners ── */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: "var(--portal-danger-bg,#fee2e2)",
            border: "1px solid var(--portal-danger-border,#f87171)",
            color: "var(--portal-danger-text,#b91c1c)",
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: "var(--portal-success-bg,#dcfce7)",
            border: "1px solid var(--portal-success-border,#86efac)",
            color: "var(--portal-success-text,#15803d)",
            fontSize: '13px',
          }}
        >
          {success}
        </div>
      )}

      {/* ── Main View: Interactive Node Canvas (>= 1024px) ── */}
      {!isMobileView ? (
        <div
          style={{
            height: '650px',
            width: '100%',
            background: "var(--portal-info-bg,#f8fafc)",
            border: "1.5px solid var(--portal-strong-border,#e2e8f0)",
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              zIndex: 10,
              background: "var(--portal-glass,rgba(255, 255, 255, 0.92))",
              backdropFilter: 'blur(4px)',
              padding: '6px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#e2e8f0)",
              fontSize: '11px',
              color: "var(--portal-info-text,#475569)",
            }}
          >
            <strong>Tip:</strong> Drag from right handle of <b>Teacher</b> to left handle of <b>Course</b>.
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background gap={16} size={1} color="#cbd5e1" />
            <Controls />
          </ReactFlow>
        </div>
      ) : (
        /* ── Fallback View: Touch-Friendly Card List (< 1024px) ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {filteredCourses.map((course) => {
            const staged = stagedAssignments.get(course.id)
            const hasStaged = !!staged

            return (
              <div
                key={course.id}
                style={{
                  background: "var(--portal-surface,#ffffff)",
                  borderRadius: '12px',
                  border: hasStaged
                    ? "2px solid var(--portal-warning-border,#E0A92C)"
                    : course.is_assigned
                    ? "1.5px solid var(--portal-strong-border,#e2e8f0)"
                    : "2px dashed var(--portal-warning-border,#f59e0b)",
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  boxShadow: hasStaged
                    ? '0 4px 14px rgba(224, 169, 44, 0.25)'
                    : '0 2px 6px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: hasStaged ? "var(--portal-warning-bg,#fef3c7)" : course.is_assigned ? "var(--portal-info-bg,#e0f2fe)" : "var(--portal-warning-bg,#fef3c7)",
                      color: hasStaged ? "var(--portal-warning-text,#92400e)" : course.is_assigned ? "var(--portal-info-text,#0369a1)" : "var(--portal-warning-text,#b45309)",
                    }}
                  >
                    {course.course_code}
                  </span>
                  <span style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>
                    Sem {course.semester} • {course.credits} Credits
                  </span>
                </div>

                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: "var(--portal-brand-text,#0f172a)", margin: 0 }}>{course.title}</h4>
                  <p style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)", margin: '2px 0 0' }}>Category: {course.category}</p>
                </div>

                {/* Assigned Teachers List */}
                <div style={{ borderTop: "1px solid var(--portal-strong-border,#f1f5f9)", paddingTop: '0.5rem' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: "var(--portal-info-text,#475569)", marginBottom: '4px' }}>
                    Assigned Faculty:
                  </div>
                  {course.assignments.length === 0 && !hasStaged ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        color: "var(--portal-warning-text,#d97706)",
                        padding: '4px 0',
                      }}
                    >
                      <AlertTriangle size={14} />
                      <span>No faculty assigned yet</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {course.assignments.map((a) => (
                        <div
                          key={a.assignment_id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: "var(--portal-info-bg,#f8fafc)",
                            border: "1px solid var(--portal-strong-border,#e2e8f0)",
                            borderRadius: '8px',
                            padding: '6px 10px',
                          }}
                        >
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: "var(--portal-brand-text,#0f172a)" }}>{a.teacher_name}</div>
                            <div style={{ fontSize: '10px', color: "var(--portal-muted,#64748b)" }}>{a.teacher_email}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              onClick={() => {
                                setReassignTarget(a)
                                setReassignTeacherId('')
                              }}
                              title="Reassign"
                              style={{
                                background: "var(--portal-info-bg,#e0f2fe)",
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                color: "var(--portal-info-text,#0284c7)",
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Edit2 size={12} /> Reassign
                            </button>
                            <button
                              onClick={() => {
                                setRemoveTarget({
                                  assignment_id: a.assignment_id,
                                  course_code: course.course_code,
                                  course_title: course.title,
                                  teacher_name: a.teacher_name,
                                })
                                setRemoveModalError('')
                              }}
                              title="Remove"
                              style={{
                                background: "var(--portal-danger-bg,#fee2e2)",
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                color: "var(--portal-danger-text,#dc2626)",
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Trash2 size={12} /> Remove
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Staged pending assignment */}
                      {staged && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: "var(--portal-warning-bg,#fffbeb)",
                            border: "1.5px solid var(--portal-warning-border,#E0A92C)",
                            borderRadius: '8px',
                            padding: '6px 10px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E0A92C', flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: "var(--portal-warning-text,#92400e)" }}>
                                {staged.teacherName}
                              </div>
                              <div style={{ fontSize: '10px', color: "var(--portal-warning-text,#b45309)", fontWeight: 700 }}>
                                PENDING SAVE
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCancelStaged(course.id)}
                            title="Discard staged assignment"
                            style={{
                              background: "var(--portal-warning-bg,#fef3c7)",
                              border: "1px solid var(--portal-warning-border,#fde68a)",
                              borderRadius: '6px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              color: "var(--portal-warning-text,#b45309)",
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <X size={12} /> Discard
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Assign Faculty Button */}
                <button
                  onClick={() => {
                    setAssignCourseTarget(course)
                  setAssignTeacherId('')
                }}
                style={{
                  marginTop: 'auto',
                  background: "var(--portal-info-bg,#f0f4f8)",
                  border: "1px dashed var(--portal-info-border,#002147)",
                  borderRadius: '8px',
                  padding: '8px',
                  color: "var(--portal-brand-text,#002147)",
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Plus size={14} /> Assign Faculty Member
              </button>
            </div>
          )
        })}
        </div>
      )}

      {/* ── Mid-Semester Reassignment Modal ── */}
      {reassignTarget && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '28rem' }}>
            <h3 className={styles.modalTitle}>Mid-Semester Faculty Reassignment</h3>
            <p className={styles.modalSubtitle}>
              Reassigning an existing assignment row updates the teacher for subsequent period attendance marking.
            </p>

            <div style={{ background: "var(--portal-info-bg,#f8fafc)", padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', border: "1px solid var(--portal-strong-border,#e2e8f0)" }}>
              <div style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>Currently Assigned To:</div>
              <strong style={{ fontSize: '13px', color: "var(--portal-brand-text,#0f172a)" }}>{reassignTarget.teacher_name}</strong>
              <div style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>{reassignTarget.teacher_email}</div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Select New Teacher *</label>
              <select
                className={styles.input}
                value={reassignTeacherId}
                onChange={(e) => setReassignTeacherId(e.target.value)}
              >
                <option value="">— Select Replacement Faculty —</option>
                {eligibleFaculty
                  .filter((f) => f.id !== reassignTarget.teacher_id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.full_name} ({f.email})
                    </option>
                  ))}
              </select>
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setReassignTarget(null)}
                disabled={reassigning}
              >
                Cancel
              </button>
              <button
                className={styles.modalConfirmBtn}
                onClick={handleConfirmReassign}
                disabled={!reassignTeacherId || reassigning}
              >
                {reassigning ? 'Reassigning...' : 'Confirm Reassignment →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Assignment Confirmation Modal ── */}
      {removeTarget && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '26rem' }}>
            <h3 className={styles.modalTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: "var(--portal-danger-text,#c0392b)" }}>
              <Trash2 size={20} /> Remove Faculty from Course
            </h3>
            <p className={styles.modalSubtitle} style={{ margin: '0.5rem 0 1rem' }}>
              Are you sure you want to remove <strong>{removeTarget.teacher_name}</strong> from teaching{' '}
              <strong>{removeTarget.course_code} ({removeTarget.course_title})</strong>?
            </p>

            <div style={{ background: "var(--portal-danger-bg,#fef2f2)", padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', border: "1px solid var(--portal-danger-border,#fecaca)", fontSize: '12px', color: "var(--portal-danger-text,#991b1b)" }}>
              ⚠️ The course will become unassigned until another faculty member is assigned.
            </div>

            {removeModalError && (
              <div style={{ padding: '8px 12px', background: "var(--portal-danger-bg,#fee2e2)", border: "1px solid var(--portal-danger-border,#f87171)", borderRadius: '6px', color: "var(--portal-danger-text,#b91c1c)", fontSize: '12px', marginBottom: '1rem' }}>
                {removeModalError}
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => {
                  setRemoveTarget(null)
                  setRemoveModalError('')
                }}
                disabled={removing}
              >
                Cancel
              </button>
              <button
                className={styles.modalDeleteBtn}
                onClick={handleConfirmRemove}
                disabled={removing}
              >
                {removing ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Faculty Member Modal (List View) ── */}
      {assignCourseTarget && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Assign Faculty to Course</h3>
            <p className={styles.modalSubtitle}>
              Assign faculty member to <strong>{assignCourseTarget.course_code}: {assignCourseTarget.title}</strong>
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Select Faculty Member *</label>
              <select
                className={styles.input}
                value={assignTeacherId}
                onChange={(e) => setAssignTeacherId(e.target.value)}
              >
                <option value="">— Choose Faculty Member —</option>
                {eligibleFaculty.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.full_name} ({f.email})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setAssignCourseTarget(null)}
              >
                Cancel
              </button>
              <button
                className={styles.modalConfirmBtn}
                onClick={handleConfirmAssign}
                disabled={!assignTeacherId}
              >
                Stage Assignment →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Teacher Modal ── */}
      {showAddTeacherModal && (
        <div
          className={styles.teacherModalOverlay}
          onClick={() => {
            if (!addingTeacher) {
              setShowAddTeacherModal(false)
              setTeacherModalError('')
            }
          }}
        >
          <div
            className={styles.teacherModalCard}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={styles.teacherModalHeader}>
              <div className={styles.teacherModalHeaderLeft}>
                <div className={styles.teacherModalIconPill}>
                  <UserPlus size={20} />
                </div>
                <div className={styles.teacherModalTitleGroup}>
                  <h3 className={styles.teacherModalTitle}>Add Course Teacher</h3>
                  <p className={styles.teacherModalSubtitle}>
                    Create an individual faculty account to assign department courses and manage attendance.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={styles.teacherModalCloseBtn}
                title="Close"
                onClick={() => {
                  setShowAddTeacherModal(false)
                  setTeacherModalError('')
                }}
                disabled={addingTeacher}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body & Form */}
            <form onSubmit={handleCreateTeacher} style={{ display: 'contents' }}>
              <div className={styles.teacherModalBody}>
                {teacherModalError && (
                  <div className={styles.inModalError}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{teacherModalError}</span>
                  </div>
                )}

                <div className={styles.field}>
                  <label className={styles.label}>Full Name *</label>
                  <div className={styles.inputWithIconWrapper}>
                    <span className={styles.inputLeadingIcon}>
                      <User size={16} />
                    </span>
                    <input
                      type="text"
                      className={styles.inputWithIcon}
                      placeholder="e.g. Dr. Jane Smith"
                      value={newTeacherName}
                      onChange={(e) => setNewTeacherName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Email Address *</label>
                  <div className={styles.inputWithIconWrapper}>
                    <span className={styles.inputLeadingIcon}>
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      className={styles.inputWithIcon}
                      placeholder="e.g. janesmith@university.edu"
                      value={newTeacherEmail}
                      onChange={(e) => setNewTeacherEmail(e.target.value)}
                      required
                    />
                  </div>
                  <span className={styles.fieldHint}>
                    The teacher will use this email address to log in to the portal.
                  </span>
                </div>

                <div className={styles.field}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className={styles.label}>Initial Password *</label>
                    <button
                      type="button"
                      onClick={() => setNewTeacherPassword(generateSecurePassword())}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: "var(--portal-info-text,#0284c7)",
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Generate Strong Password
                    </button>
                  </div>
                  <div className={styles.inputWithIconWrapper}>
                    <span className={styles.inputLeadingIcon}>
                      <Lock size={16} />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className={styles.inputWithIcon}
                      value={newTeacherPassword}
                      onChange={(e) => setNewTeacherPassword(e.target.value)}
                      placeholder="Enter minimum 8 characters"
                      required
                    />
                    <button
                      type="button"
                      className={styles.passwordToggleBtn}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className={styles.fieldHint}>
                    Minimum 8 characters. The teacher can update their password upon first sign-in.
                  </span>
                </div>
              </div>

              {/* Modal Footer */}
              <div className={styles.teacherModalFooter}>
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => {
                    setShowAddTeacherModal(false)
                    setTeacherModalError('')
                  }}
                  disabled={addingTeacher}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.modalConfirmBtn}
                  disabled={addingTeacher || !newTeacherName.trim() || !newTeacherEmail.trim() || !newTeacherPassword.trim()}
                >
                  {addingTeacher ? 'Creating Account...' : 'Create Teacher →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Manage Department Teachers Modal ── */}
      {showManageTeachersModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 className={styles.modalTitle} style={{ margin: 0 }}>Department Faculty Roster</h3>
              <button
                type="button"
                onClick={() => {
                  setShowManageTeachersModal(false)
                  setShowAddTeacherModal(true)
                }}
                style={{
                  background: "var(--portal-primary,#002147)",
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Plus size={13} /> Add New
              </button>
            </div>
            <p className={styles.modalSubtitle}>
              Active teachers in your department who can be assigned to courses. HOD is excluded from course assignment.
            </p>

            {error && (
              <div style={{ padding: '8px 12px', background: "var(--portal-danger-bg,#fee2e2)", border: "1px solid var(--portal-danger-border,#f87171)", borderRadius: '6px', color: "var(--portal-danger-text,#b91c1c)", fontSize: '12px', margin: '0.5rem 0' }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ padding: '8px 12px', background: "var(--portal-success-bg,#dcfce7)", border: "1px solid var(--portal-success-border,#86efac)", borderRadius: '6px', color: "var(--portal-success-text,#166534)", fontSize: '12px', margin: '0.5rem 0' }}>
                {success}
              </div>
            )}

            <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', margin: '1rem 0' }}>
              {eligibleFaculty.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: "var(--portal-muted,#64748b)", fontSize: '13px' }}>
                  No teachers found in your department. Click &quot;+ Add Teacher&quot; to add your first faculty member.
                </div>
              ) : (
                eligibleFaculty.map((t) => {
                  const assignedCount = courses.reduce(
                    (sum, c) => sum + c.assignments.filter((a) => a.teacher_id === t.id).length,
                    0
                  )
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: "var(--portal-info-bg,#f8fafc)",
                        border: "1px solid var(--portal-strong-border,#e2e8f0)",
                        borderRadius: '8px',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: "var(--portal-brand-text,#0f172a)" }}>{t.full_name}</div>
                        <div style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>{t.email}</div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: t.role === 'teacher' ? "var(--portal-info-bg,#e0f2fe)" : "var(--portal-info-bg,#f1f5f9)",
                              color: t.role === 'teacher' ? "var(--portal-info-text,#0369a1)" : "var(--portal-info-text,#475569)",
                              fontWeight: 600,
                            }}
                          >
                            {t.role === 'teacher' ? 'Course Teacher' : 'Teaching Staff'}
                          </span>
                          <span style={{ fontSize: '10px', color: assignedCount > 0 ? "var(--portal-success-text,#16a34a)" : "var(--portal-info-text,#94a3b8)" }}>
                            {assignedCount} {assignedCount === 1 ? 'course' : 'courses'} assigned
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteTeacher(t.id, t.full_name)}
                        disabled={deletingTeacherId === t.id}
                        title="Remove teacher from department"
                        style={{
                          background: "var(--portal-danger-bg,#fef2f2)",
                          border: "1px solid var(--portal-danger-border,#fecaca)",
                          color: "var(--portal-danger-text,#dc2626)",
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Trash2 size={13} />
                        {deletingTeacherId === t.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowManageTeachersModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky Action Bar for Staged Assignments ── */}
      {stagedAssignments.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: "var(--portal-primary,#0f172a)",
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '14px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            zIndex: 1000,
            border: "1.5px solid var(--portal-info-border,#334155)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#E0A92C',
                boxShadow: '0 0 8px #E0A92C',
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {stagedAssignments.size} {stagedAssignments.size === 1 ? 'assignment' : 'assignments'} pending save
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleDiscardAllStaged}
              disabled={savingBatch}
              style={{
                background: 'transparent',
                border: "1px solid var(--portal-info-border,#475569)",
                color: "var(--portal-info-text,#cbd5e1)",
                padding: '7px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Discard Changes
            </button>
            <button
              onClick={handleSaveAllStaged}
              disabled={savingBatch}
              style={{
                background: '#E0A92C',
                border: 'none',
                color: "var(--portal-brand-text,#002147)",
                padding: '7px 18px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: savingBatch ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(224, 169, 44, 0.4)',
              }}
            >
              {savingBatch ? (
                <>Saving Changes...</>
              ) : (
                <>
                  <Check size={14} /> Save All Assignments
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
