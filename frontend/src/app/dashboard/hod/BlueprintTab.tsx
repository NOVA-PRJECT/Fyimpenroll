'use client'

import LoadingState, { LoadingIndicator } from '@/components/LoadingState'

import { BookOpen as UiBookOpen, Check as UiCheck, Info as UiInfo, Pencil as UiPencil, Trash2 as UiTrash2, TriangleAlert as UiTriangleAlert, X as UiX } from 'lucide-react'

import { useState, useEffect, useEffectEvent } from 'react'
import { HOD_COURSE_CATEGORIES } from '@fyimp/contracts'
import { GripVertical, ChevronDown } from 'lucide-react'
import styles from './hod-dashboard.module.css'

const RULES = [
  { value: '', label: '— Empty slot —' },
  { value: 'FIXED', label: 'FIXED — Specific DSC/DSE course from own campus' },
  { value: 'AEC_ELECT', label: 'AEC ELECT — AEC course from all campuses' },
  { value: 'DEPT_RESTRICTED', label: 'DEPT_RESTRICTED — From specific dept (DSC/DSE)' },
  { value: 'EXCLUDE_DEPT', label: 'EXCLUDE_DEPT — Exclude specific dept (DSC/DSE)' },
  { value: 'POOL_RESTRICTED', label: 'POOL_RESTRICTED — Own department DSE courses' },
  { value: 'GLOBAL_BASKET', label: 'GLOBAL_BASKET — Courses by category across campuses' },
]

interface SlotData {
  rule: string
  target: string
  name: string
}

interface PathwayData {
  id?: string
  name: string
  slots: SlotData[]
}

interface CatalogueCourse { is_own_campus?: boolean; is_own_dept?: boolean; department_name?: string; theory_hours_per_week: number; practical_hours_per_week: number; prerequisite_course_ids?: string[]; id: string; course_code: string; title: string; credits: number; category: string; semester: number; seat_limit: number; theory_hours: number; practical_hours: number; department_id: string; prerequisites?: string[]; departments?: { name: string; code: string } }
export default function BlueprintTab({ view = 'blueprint' }: { view?: 'blueprint' | 'courses' }) {
  const [semester, setSemester] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [minCredits, setMinCredits] = useState<number | ''>(0)
  const [maxCredits, setMaxCredits] = useState<number | ''>(0)

  // Pathway state
  const [pathways, setPathways] = useState<PathwayData[]>([
    { name: 'Default', slots: [{ rule: '', target: '', name: '' }] }
  ])
  const [editingPathwayIndex, setEditingPathwayIndex] = useState<number | null>(null)

  // Drag-and-drop reordering state for slots
  const [draggedSlotIdx, setDraggedSlotIdx] = useState<number | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<{ index: number; position: 'above' | 'below' } | null>(null)
  const [canDragSlotIdx, setCanDragSlotIdx] = useState<number | null>(null)

  // New state variables for pickers
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([])
  const [fixedSearch, setFixedSearch] = useState<Record<string, string>>({})
  const [fixedOpen, setFixedOpen] = useState<Record<string, boolean>>({})

  // Courses state
  const [courses, setCourses] = useState<CatalogueCourse[]>([])
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [editCourse, setEditCourse] = useState<CatalogueCourse | null>(null)
  const [deleteCourse, setDeleteCourse] = useState<CatalogueCourse | null>(null)
  const [courseCode, setCourseCode] = useState('')
  const [courseTitle, setCourseTitle] = useState('')
  const [courseCredits, setCourseCredits] = useState<number | '' | null>(null)
  const [courseTheoryHours, setCourseTheoryHours] = useState<number | '' | null>(null)
  const [coursePracticalHours, setCoursePracticalHours] = useState<number | '' | null>(null)
  const [courseCategory, setCourseCategory] = useState<string | null>(null)
  const [courseSeatLimit, setCourseSeatLimit] = useState<number | ''>(60)
  const [coursePrereqs, setCoursePrereqs] = useState<string[]>([])

  // Prerequisite Rule Engine state (Only DEPARTMENT and COMPLETED_COURSE)
  interface PrerequisiteRuleItem {
    id?: string
    course_id?: string
    rule: 'COMPLETED_COURSE' | 'DEPARTMENT'
    target: string
  }
  const [courseRules, setCourseRules] = useState<PrerequisiteRuleItem[]>([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [newRuleType, setNewRuleType] = useState<'COMPLETED_COURSE' | 'DEPARTMENT'>('DEPARTMENT')
  const [newRuleTarget, setNewRuleTarget] = useState('')

  // Prior courses selector for COMPLETED_COURSE
  const [priorCourses, setPriorCourses] = useState<CatalogueCourse[]>([])
  const [loadingPriorCourses, setLoadingPriorCourses] = useState(false)
  const [priorCourseSemesterFilter, setPriorCourseSemesterFilter] = useState<number | null>(null)
  const [priorCourseSearch, setPriorCourseSearch] = useState('')
  const [priorCourseOpen, setPriorCourseOpen] = useState(false)

  const [savingCourse, setSavingCourse] = useState(false)
  const [deletingCourse, setDeletingCourse] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)

  // Baseline snapshot for tracking dirty/unsaved changes
  interface BlueprintSnapshot {
    minCredits: number | ''
    maxCredits: number | ''
    pathways: PathwayData[]
  }
  const [initialSnapshot, setInitialSnapshot] = useState<BlueprintSnapshot | null>(null)

  // Auto-scroll window while dragging slot near viewport edges
  useEffect(() => {
    if (draggedSlotIdx === null) return

    function handleDragOver(e: DragEvent) {
      const scrollMargin = 140
      const scrollSpeed = 18

      if (e.clientY < scrollMargin) {
        const intensity = Math.max(0.2, (scrollMargin - e.clientY) / scrollMargin)
        window.scrollBy({ top: -scrollSpeed * intensity, behavior: 'auto' })
      } else if (window.innerHeight - e.clientY < scrollMargin) {
        const intensity = Math.max(0.2, (scrollMargin - (window.innerHeight - e.clientY)) / scrollMargin)
        window.scrollBy({ top: scrollSpeed * intensity, behavior: 'auto' })
      }
    }

    window.addEventListener('dragover', handleDragOver)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
    }
  }, [draggedSlotIdx])

  const hasChanges = (() => {
    if (!initialSnapshot) return false
    if (minCredits !== initialSnapshot.minCredits) return true
    if (maxCredits !== initialSnapshot.maxCredits) return true

    const cleanPws = (pws: PathwayData[]) =>
      pws.map(p => ({
        name: (p.name || '').trim(),
        slots: p.slots.map(s => ({
          rule: s.rule || '',
          target: (s.target || '').trim(),
          name: (s.name || '').trim(),
        })),
      }))

    return JSON.stringify(cleanPws(pathways)) !== JSON.stringify(cleanPws(initialSnapshot.pathways))
  })()

  function getBasketCourses(slot: SlotData, pathway?: PathwayData) {
    const fixedTargets = new Set((pathway?.slots || [])
      .filter(item => ['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'].includes(item.rule))
      .map(item => item.target))
    return courses.filter(course => course.semester === semester && !fixedTargets.has(course.course_code) && (
      slot.rule === 'POOL_RESTRICTED'
        ? course.category === 'DSE' && course.is_own_dept === true
        : course.category === slot.target && (slot.target !== 'MDC' || course.is_own_dept === false)
    ))
  }

  // Helper to determine credit ranges for each slot
  function getSlotCreditRange(slot: SlotData, pathway: PathwayData): { min: number; max: number } {
    if (!slot.rule) return { min: 0, max: 0 }

    if (slot.rule === 'FIXED' || slot.rule === 'AEC_ELECT' || slot.rule === 'CAMPUS_FIXED') {
      const course = courses.find(c => c.course_code === slot.target)
      const cr = course ? course.credits : 0
      return { min: cr, max: cr }
    }

    // Check if we have any matching courses in our department as a proxy
    let matchingCourses: CatalogueCourse[] = []
    if (slot.rule === 'POOL_RESTRICTED') {
      matchingCourses = getBasketCourses(slot, pathway)
    } else if (slot.rule === 'GLOBAL_BASKET') {
      matchingCourses = getBasketCourses(slot, pathway)
    } else if (slot.rule === 'DEPT_RESTRICTED' || slot.rule === 'EXCLUDE_DEPT') {
      matchingCourses = courses.filter(c => ['DSC', 'DSE'].includes(c.category))
    }

    if (matchingCourses.length > 0) {
      const credits = matchingCourses.map(c => c.credits)
      return { min: Math.min(...credits), max: Math.max(...credits) }
    }

    if (slot.rule === 'GLOBAL_BASKET' || slot.rule === 'POOL_RESTRICTED') return { min: 0, max: 0 }

    return { min: 4, max: 4 }
  }

  // Calculate live bounds across all pathways
  function getPathwayCreditRange(pw: PathwayData): { min: number; max: number } {
    let totalMin = 0
    let totalMax = 0
    pw.slots.forEach(s => {
      const { min, max } = getSlotCreditRange(s, pw)
      totalMin += min
      totalMax += max
    })
    return { min: totalMin, max: totalMax }
  }

  // Overall credit bounds (worst-case across all pathways)
  let overallMin = Infinity
  let overallMax = 0
  pathways.forEach(pw => {
    const { min, max } = getPathwayCreditRange(pw)
    if (min < overallMin) overallMin = min
    if (max > overallMax) overallMax = max
  })
  if (overallMin === Infinity) overallMin = 0

  const isImpossible = maxCredits !== '' && pathways.some(pw => {
    const { min } = getPathwayCreditRange(pw)
    return min > Number(maxCredits)
  })

  let warningMessage = ''
  if (isImpossible) {
    const badPathway = pathways.find(pw => {
      const { min } = getPathwayCreditRange(pw)
      return min > Number(maxCredits)
    })
    if (badPathway) {
      const { min } = getPathwayCreditRange(badPathway)
      warningMessage = `Pathway "${badPathway.name}" has a minimum of ${min} credits, exceeding your configured maximum of ${maxCredits}. Students on this pathway will not be able to submit.`
    }
  }

  // Fetch initial data once with the current loader.
  const loadInitialBlueprint = useEffectEvent(() => {
    fetchBlueprint(1)
    fetchDepartmentsList()
  })
  useEffect(() => { loadInitialBlueprint() }, [])

  async function fetchDepartmentsList() {
    try {
      const res = await fetch('/api/hod/departments')
      const data = await res.json().catch(() => [])
      if (res.ok && Array.isArray(data)) {
        setDepartments(data)
      }
    } catch (err) {
      console.error('Failed to fetch departments:', err)
    }
  }

  async function loadPriorCourses(maxSem: number) {
    if (maxSem <= 1) {
      setPriorCourses([])
      return
    }
    setLoadingPriorCourses(true)
    try {
      const res = await fetch(`/api/hod/courses?max_semester=${maxSem}`)
      const data = await res.json().catch(() => [])
      if (res.ok && Array.isArray(data)) {
        setPriorCourses(data)
      } else {
        setPriorCourses([])
      }
    } catch (err) {
      console.error('Failed to fetch prior courses:', err)
      setPriorCourses([])
    } finally {
      setLoadingPriorCourses(false)
    }
  }

  // Load prior courses when Add/Edit Course modal opens
  useEffect(() => {
    if (showAddCourse || editCourse) {
      const targetSem = editCourse?.semester ?? semester

      // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
      loadPriorCourses(targetSem)
      setPriorCourseSemesterFilter(null)
      setPriorCourseSearch('')
      setPriorCourseOpen(false)
    }
  }, [showAddCourse, editCourse, semester])

  async function fetchBlueprint(sem: number = semester) {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch(`/api/hod/blueprint?semester=${sem}`)
      let data: { id?: string; error?: string; message?: string; [key: `slot_${number}_rule`]: SlotData["rule"]; [key: `slot_${number}_target`]: string; [key: `slot_${number}_name`]: string; min_credits?: number; max_credits?: number; pathways?: PathwayData[] } | null = null
      try {
        const text = await res.text()
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }

      if (!res.ok) {
        setError(data?.error ?? data?.message ?? `Failed to fetch blueprint (${res.status})`)
        setLoading(false)
        return
      }

      if (data && (data.id || (data.pathways && data.pathways.length > 0) || data.min_credits !== undefined)) {
        const nextMin = data.min_credits ?? 0
        const nextMax = data.max_credits ?? 0
        setMinCredits(nextMin)
        setMaxCredits(nextMax)

        let loadedPathways: PathwayData[] = []
        // Read from pathways JSONB if available, else create default pathway from flat columns
        if (data.pathways && Array.isArray(data.pathways) && data.pathways.length > 0) {
          loadedPathways = data.pathways.map((p: PathwayData) => ({
            id: p.id,
            name: p.name,
            slots: (p.slots || []).map((s: SlotData) => ({
              rule: s.rule ?? '',
              target: s.rule === 'POOL_RESTRICTED' ? 'POOLED' : s.target ?? '',
              name: s.name ?? '',
            }))
          }))
        } else {
          // Legacy: build single pathway from flat columns
          const flatSlots: SlotData[] = []
          for (let i = 1; i <= 8; i++) {
            const rule = data[`slot_${i}_rule`] ?? ''
            const target = rule === 'POOL_RESTRICTED' ? 'POOLED' : data[`slot_${i}_target`] ?? ''
            const name = data[`slot_${i}_name`] ?? ''
            if (rule) {
              flatSlots.push({ rule, target, name })
            }
          }
          if (flatSlots.length === 0) {
            flatSlots.push({ rule: '', target: '', name: '' })
          }
          loadedPathways = [{ name: 'Default', slots: flatSlots }]
        }
        setPathways(loadedPathways)
        setInitialSnapshot({
          minCredits: nextMin,
          maxCredits: nextMax,
          pathways: JSON.parse(JSON.stringify(loadedPathways)),
        })
        setEditingPathwayIndex(null)
      } else {
        // No blueprint yet — reset to empty default
        setMinCredits(0)
        setMaxCredits(0)
        const emptyPathways = [{ name: 'Default', slots: [{ rule: '', target: '', name: '' }] }]
        setPathways(emptyPathways)
        setInitialSnapshot({
          minCredits: 0,
          maxCredits: 0,
          pathways: JSON.parse(JSON.stringify(emptyPathways)),
        })
        setEditingPathwayIndex(null)
      }

      await fetchCourses(sem)
    } catch (err: unknown) {
      console.error('Failed to fetch blueprint:', err)
      setError((err instanceof Error ? err.message : '') || 'Network error fetching blueprint')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCourses(sem: number = semester) {
    setLoadingCourses(true)
    try {
      const url = view === 'courses'
        ? `/api/hod/courses?semester=${sem}&own=true`
        : `/api/hod/courses?semester=${sem}&scope=global`
      const res = await fetch(url)
      const data = await res.json().catch(() => [])
      if (res.ok && Array.isArray(data)) setCourses(data)
    } catch (err) {
      console.error('Failed to fetch courses:', err)
    } finally {
      setLoadingCourses(false)
    }
  }

  function updateSlot(pathwayIdx: number, slotIdx: number, field: keyof SlotData, value: string) {
    setPathways(prev => prev.map((pw, pi) =>
      pi === pathwayIdx
        ? {
            ...pw,
            slots: pw.slots.map((s, si) =>
              si === slotIdx ? { ...s, [field]: value } : s
            )
          }
        : pw
    ))
  }

  function addSlotToPathway(pathwayIdx: number) {
    setPathways(prev => prev.map((pw, pi) =>
      pi === pathwayIdx
        ? { ...pw, slots: [...pw.slots, { rule: '', target: '', name: '' }] }
        : pw
    ))
  }

  function removeSlotFromPathway(pathwayIdx: number, slotIdx: number) {
    setPathways(prev => prev.map((pw, pi) =>
      pi === pathwayIdx
        ? { ...pw, slots: pw.slots.filter((_, si) => si !== slotIdx) }
        : pw
    ))
  }

  function reorderSlots(pathwayIdx: number, sourceIdx: number, targetIdx: number, position: 'above' | 'below' = 'above') {
    if (sourceIdx === targetIdx && position === 'above') return
    setPathways(prev => prev.map((pw, pi) => {
      if (pi !== pathwayIdx) return pw
      const updatedSlots = [...pw.slots]
      const [movedItem] = updatedSlots.splice(sourceIdx, 1)
      let insertIdx = position === 'above' ? targetIdx : targetIdx + 1
      if (sourceIdx < targetIdx) {
        insertIdx = position === 'above' ? targetIdx - 1 : targetIdx
      }
      updatedSlots.splice(insertIdx, 0, movedItem)
      return { ...pw, slots: updatedSlots }
    }))
    setFixedOpen({})
  }

  function addPathway() {
    setPathways(prev => [...prev, { name: '', slots: [{ rule: '', target: '', name: '' }] }])
    setEditingPathwayIndex(pathways.length)
  }

  function removePathway(idx: number) {
    setPathways(prev => prev.filter((_, i) => i !== idx))
    setEditingPathwayIndex(null)
  }

  function updatePathwayName(idx: number, name: string) {
    setPathways(prev => prev.map((pw, i) => i === idx ? { ...pw, name } : pw))
  }

  async function handleSaveBlueprint() {
    if (minCredits === '' || maxCredits === '') {
      setError('Min and Max credits are required')
      return
    }

    // Validate all pathways have names
    for (const pw of pathways) {
      if (!pw.name.trim()) {
        setError('All pathways must have a name')
        return
      }
      // Filter out empty slots before validation
      const validSlots = pw.slots.filter(s => s.rule)
      if (validSlots.length === 0) {
        setError(`Pathway "${pw.name}" must have at least one configured slot`)
        return
      }
      for (const s of validSlots) {
        if (s.rule === 'GLOBAL_BASKET' && !(HOD_COURSE_CATEGORIES as readonly string[]).includes(s.target)) {
          setError(`Select a category for ${s.name || 'the global basket'}`)
          return
        }
        if (!s.target.trim()) {
          setError(`All slots in pathway "${pw.name}" must have a target`)
          return
        }
        if (!s.name.trim()) {
          setError(`All slots in pathway "${pw.name}" must have a name`)
          return
        }
      }
    }

    setSaving(true)
    setError('')
    setSuccess('')

    // Build pathways payload: only send non-empty slots, preserve ids and explicit slot ordering
    const pathwaysPayload = pathways.map(pw => ({
      ...(pw.id ? { id: pw.id } : {}),
      name: pw.name,
      slots: pw.slots
        .filter(s => s.rule && s.target.trim() && s.name.trim())
        .map((s, idx) => ({
          ...s,
          slot: idx + 1,
        })),
    }))

    const res = await fetch('/api/hod/blueprint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ semester, min_credits: minCredits, max_credits: maxCredits, pathways: pathwaysPayload }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) { setError(data.error ?? 'Failed to save blueprint') }
    else {
      setSuccess(data.message)
      setTimeout(() => setSuccess(''), 1000)
      // Refetch to get server-generated IDs
      fetchBlueprint(semester)
    }
    setSaving(false)
  }

  async function loadCourseRules(courseId: string) {
    setLoadingRules(true)
    try {
      const res = await fetch(`/api/allocation/config/prerequisites/${courseId}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.rules) {
        setCourseRules(data.rules)
        const deptRule = data.rules.find((r: {rule: string; target: string}) => r.rule === 'DEPARTMENT')
        if (deptRule) {
          setNewRuleTarget(deptRule.target)
        }
      } else {
        setCourseRules([])
      }
    } catch {
      setCourseRules([])
    } finally {
      setLoadingRules(false)
    }
  }

  async function handleAddRule() {
    const trimmed = newRuleTarget.trim()
    if (!trimmed) {
      setError(newRuleType === 'DEPARTMENT' ? 'Please select at least one department' : 'Please specify or select a prerequisite course')
      return
    }
    setError('')

    if (editCourse?.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${editCourse.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: newRuleType, target: trimmed }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.rule) {
          const existsIdx = courseRules.findIndex(r => r.id === data.rule.id || (r.rule === 'DEPARTMENT' && data.rule.rule === 'DEPARTMENT'))
          if (existsIdx >= 0) {
            const updated = [...courseRules]
            updated[existsIdx] = data.rule
            setCourseRules(updated)
          } else {
            setCourseRules([...courseRules, data.rule])
          }
          if (newRuleType !== 'DEPARTMENT') {
            setNewRuleTarget('')
          }
        } else {
          setError(data.error || data.message || 'Failed to add prerequisite rule')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to add prerequisite rule')
      }
    } else {
      if (newRuleType === 'DEPARTMENT') {
        const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
        if (existsIdx >= 0) {
          const updated = [...courseRules]
          updated[existsIdx] = { rule: 'DEPARTMENT', target: trimmed }
          setCourseRules(updated)
        } else {
          setCourseRules([...courseRules, { rule: 'DEPARTMENT', target: trimmed }])
        }
      } else {
        const exists = courseRules.some(
          (r) => r.rule === newRuleType && r.target.toUpperCase() === trimmed.toUpperCase(),
        )
        if (exists) {
          setError('This prerequisite course is already added')
          return
        }
        setCourseRules([...courseRules, { rule: newRuleType, target: trimmed }])
        setNewRuleTarget('')
      }
    }
  }

  async function handleDeleteRule(rule: PrerequisiteRuleItem, idx: number) {
    setError('')
    if (rule.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${rule.id}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          setCourseRules(courseRules.filter((r) => r.id !== rule.id))
          if (rule.rule === 'DEPARTMENT') {
            setNewRuleTarget('')
          }
        } else {
          const data = await res.json().catch(() => ({}))
          setError(data.error || data.message || 'Failed to delete prerequisite rule')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to delete prerequisite rule')
      }
    } else {
      setCourseRules(courseRules.filter((_, i) => i !== idx))
      if (rule.rule === 'DEPARTMENT') {
        setNewRuleTarget('')
      }
    }
  }

  async function updateDepartmentCodes(newCodes: string[]) {
    setError('')
    const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
    const newTarget = newCodes.filter(Boolean).join(',')

    if (!newTarget) {
      if (deptRule) {
        handleDeleteRule(deptRule, courseRules.indexOf(deptRule))
      }
      return
    }

    if (editCourse?.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${editCourse.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: 'DEPARTMENT', target: newTarget }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.rule) {
          const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
          if (existsIdx >= 0) {
            const updated = [...courseRules]
            updated[existsIdx] = data.rule
            setCourseRules(updated)
          } else {
            setCourseRules([...courseRules, data.rule])
          }
        } else {
          setError(data.error || data.message || 'Failed to update department constraint')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to update department constraint')
      }
    } else {
      const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
      if (existsIdx >= 0) {
        const updated = [...courseRules]
        updated[existsIdx] = { rule: 'DEPARTMENT', target: newTarget }
        setCourseRules(updated)
      } else {
        setCourseRules([...courseRules, { rule: 'DEPARTMENT', target: newTarget }])
      }
    }
  }

  function handleDepartmentToggle(deptCode: string, isChecked: boolean) {
    const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
    const currentCodes = deptRule?.target ? deptRule.target.split(',').map(c => c.trim()).filter(Boolean) : []
    const newCodes = isChecked
      ? (currentCodes.includes(deptCode) ? currentCodes : [...currentCodes, deptCode])
      : currentCodes.filter(c => c !== deptCode)
    updateDepartmentCodes(newCodes)
  }

  async function handleSaveCourse() {
    if (!courseCode.trim()) { setError('Course code is required'); return }
    if (!courseTitle.trim()) { setError('Course title is required'); return }
    if (courseCredits === null || courseCredits === '') { setError('Credits are required'); return }
    if (!courseCategory) { setError('Category is required'); return }

    setSavingCourse(true)
    setError('')

    const finalTheory = courseTheoryHours !== null && courseTheoryHours !== '' ? Number(courseTheoryHours) : Number(courseCredits ?? 0)
    const finalPractical = coursePracticalHours !== null && coursePracticalHours !== '' ? Number(coursePracticalHours) : 0

    const isEdit = !!editCourse
    const bodyPayload: Record<string, unknown> = {
      course_code: courseCode.trim().toUpperCase(),
      title: courseTitle.trim(),
      credits: courseCredits,
      theory_hours_per_week: finalTheory,
      practical_hours_per_week: finalPractical,
      category: courseCategory,
      seat_limit: courseSeatLimit !== '' ? Number(courseSeatLimit) : 60,
      prerequisite_course_ids: coursePrereqs,
    }
    if (isEdit) {
      bodyPayload.id = editCourse.id
    } else {
      bodyPayload.semester = semester
    }

    const res = await fetch('/api/hod/courses', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) { setError(data.message || data.error || 'Failed to save course') }
    else {
      // If newly created course had staged rules, persist them
      if (!isEdit && data.id && courseRules.length > 0) {
        for (const rule of courseRules) {
          try {
            await fetch(`/api/allocation/config/prerequisites/${data.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rule: rule.rule, target: rule.target }),
            })
          } catch {
            // best effort
          }
        }
      }
      setSuccess(data.message)
      setTimeout(() => setSuccess(''), 1000)
      setShowAddCourse(false)
      setEditCourse(null)
      setCourseCode(''); setCourseTitle(''); setCourseCredits(null); setCourseTheoryHours(null); setCoursePracticalHours(null); setCourseCategory(null)
      setCourseSeatLimit(60); setCoursePrereqs([]); setCourseRules([]); setNewRuleTarget('')
      setNewRuleType('DEPARTMENT'); setPriorCourseOpen(false); setPriorCourseSearch(''); setPriorCourseSemesterFilter(null)
      fetchCourses()
    }
    setSavingCourse(false)
  }

  async function handleDeleteCourse() {
    if (!deleteCourse) return
    setDeletingCourse(true)
    const res = await fetch('/api/hod/courses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: deleteCourse.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error ?? 'Failed to delete course') }
    else {
      setSuccess(data.message)
      setTimeout(() => setSuccess(''), 1000)
      setDeleteCourse(null)
      fetchCourses()
    }
    setDeletingCourse(false)
  }

  // Render a slot editor for a pathway
  function renderSlotEditor(pathwayIdx: number, slotIdx: number, slot: SlotData) {
    const fixedKey = `${pathwayIdx}-${slotIdx}`
    const isDragging = draggedSlotIdx === slotIdx
    const isDropAbove = dragOverSlot?.index === slotIdx && dragOverSlot.position === 'above' && draggedSlotIdx !== slotIdx
    const isDropBelow = dragOverSlot?.index === slotIdx && dragOverSlot.position === 'below' && draggedSlotIdx !== slotIdx

    return (
      <div
        key={slotIdx}
        className={`${styles.slotEditorCard} ${isDragging ? styles.slotCardDragging : ''} ${isDropAbove ? styles.slotDropIndicatorAbove : ''} ${isDropBelow ? styles.slotDropIndicatorBelow : ''}`}
        draggable={canDragSlotIdx === slotIdx}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(slotIdx))
          e.dataTransfer.effectAllowed = 'move'
          setDraggedSlotIdx(slotIdx)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (draggedSlotIdx !== null && draggedSlotIdx !== slotIdx) {
            const rect = e.currentTarget.getBoundingClientRect()
            const isAbove = (e.clientY - rect.top) < (rect.height / 2)
            const pos = isAbove ? 'above' : 'below'
            if (!dragOverSlot || dragOverSlot.index !== slotIdx || dragOverSlot.position !== pos) {
              setDragOverSlot({ index: slotIdx, position: pos })
            }
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            if (dragOverSlot?.index === slotIdx) {
              setDragOverSlot(null)
            }
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          if (draggedSlotIdx !== null && draggedSlotIdx !== slotIdx) {
            const pos = dragOverSlot?.index === slotIdx ? dragOverSlot.position : 'above'
            reorderSlots(pathwayIdx, draggedSlotIdx, slotIdx, pos)
          }
          setDraggedSlotIdx(null)
          setDragOverSlot(null)
          setCanDragSlotIdx(null)
        }}
        onDragEnd={() => {
          setDraggedSlotIdx(null)
          setDragOverSlot(null)
          setCanDragSlotIdx(null)
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {pathways[pathwayIdx].slots.length > 1 && (
              <div
                className={styles.slotDragHandle}
                title="Drag to reorder paper slot"
                onMouseEnter={() => setCanDragSlotIdx(slotIdx)}
                onMouseLeave={() => setCanDragSlotIdx(null)}
              >
                <GripVertical size={16} />
              </div>
            )}
            <p className={styles.slotEditorTitle}>Paper {slotIdx + 1}</p>
          </div>
          {pathways[pathwayIdx].slots.length > 1 && (
            <button
              type="button"
              onClick={() => removeSlotFromPathway(pathwayIdx, slotIdx)}
              className={styles.slotRemoveBtn}
            >
              Remove
            </button>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label className={styles.label}>Paper Name</label>
            <input type="text" className={styles.input}
              placeholder="e.g. Major 1, MDC, Elective"
              value={slot.name}
              onChange={e => updateSlot(pathwayIdx, slotIdx, 'name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Rule</label>
            <select className={styles.input} value={slot.rule}
              onChange={e => {
                const newRule = e.target.value
                let newTarget = ''
                if (newRule === 'POOL_RESTRICTED') {
                  newTarget = 'POOLED'
                }
                updateSlot(pathwayIdx, slotIdx, 'rule', newRule)
                updateSlot(pathwayIdx, slotIdx, 'target', newTarget)
              }}>
              {RULES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {slot.rule && (
            <div className={styles.field} style={{ position: 'relative' }}>
              <label className={styles.label}>
                Target {(slot.rule === 'FIXED' || slot.rule === 'AEC_ELECT' || slot.rule === 'CAMPUS_FIXED') ? '(Course Code)' :
                  slot.rule === 'DEPT_RESTRICTED' || slot.rule === 'EXCLUDE_DEPT' ? '(Departments)' :
                    slot.rule === 'GLOBAL_BASKET' ? '(Category)' : '(Automatic)'}
              </label>
              {slot.rule === 'DEPT_RESTRICTED' || slot.rule === 'EXCLUDE_DEPT' ? (
                <div className={styles.checkboxGroup} style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  border: "1px solid var(--portal-border,#dde1e7)",
                  borderRadius: '0.4rem',
                  background: "var(--portal-surface,#ffffff)",
                  maxHeight: '120px',
                  overflowY: 'auto'
                }}>
                  {departments.map(d => {
                    const selectedCodes = slot.target ? slot.target.split(',').map(c => c.trim()) : [];
                    const isChecked = selectedCodes.includes(d.code);
                    return (
                      <label key={d.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.5rem',
                        border: "1px solid var(--portal-strong-border,#f0f2f5)",
                        borderRadius: '3px',
                        background: isChecked ? "var(--portal-info-bg,#e6f0fa)" : "var(--portal-surface-soft,#fafafa)"
                      }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            let newCodes;
                            if (e.target.checked) {
                              newCodes = [...selectedCodes, d.code];
                            } else {
                              newCodes = selectedCodes.filter(c => c !== d.code);
                            }
                            updateSlot(pathwayIdx, slotIdx, 'target', newCodes.join(','));
                          }}
                        />
                        {d.name} ({d.code})
                      </label>
                    );
                  })}
                </div>
              ) : (slot.rule === 'FIXED' || slot.rule === 'AEC_ELECT' || slot.rule === 'CAMPUS_FIXED') ? (
                <div style={{ position: 'relative' }}>
                  <input type="text" className={styles.input}
                    placeholder="Search & select course..."
                    value={
                      fixedOpen[fixedKey]
                        ? (fixedSearch[fixedKey] ?? '')
                        : (() => {
                            const course = courses.find(c => c.course_code === slot.target)
                            return course ? `${course.course_code} — ${course.title}` : slot.target
                          })()
                    }
                    onFocus={() => {
                      setFixedOpen(prev => ({ ...prev, [fixedKey]: true }))
                      setFixedSearch(prev => ({ ...prev, [fixedKey]: '' }))
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setFixedOpen(prev => ({ ...prev, [fixedKey]: false }))
                      }, 150)
                    }}
                    onChange={e => {
                      const val = e.target.value
                      setFixedSearch(prev => ({ ...prev, [fixedKey]: val }))
                    }} />
                  {fixedOpen[fixedKey] && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: "var(--portal-surface,#ffffff)",
                      border: "1px solid var(--portal-border,#dde1e7)",
                      borderRadius: '0.4rem',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      zIndex: 200,
                    }}>
                      {courses.length === 0 ? (
                        <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: "var(--portal-subtle,#9ba1ab)" }}>
                          No courses found for Semester {semester}. Add courses first.
                        </div>
                      ) : (() => {
                        const searchStr = (fixedSearch[fixedKey] ?? '').toLowerCase()
                        const filtered = courses.filter(c => {
                          const matchesText = c.course_code.toLowerCase().includes(searchStr) ||
                            c.title.toLowerCase().includes(searchStr) ||
                            (c.category && c.category.toLowerCase().includes(searchStr))

                          if (!matchesText) return false

                          // AEC_ELECT: show AEC courses from all campuses
                          if (slot.rule === 'AEC_ELECT') {
                            return c.category === 'AEC'
                          }

                          // FIXED: show ONLY DSC/DSE courses from own campus departments
                          if (slot.rule === 'FIXED') {
                            return ['DSC', 'DSE'].includes(c.category) && c.is_own_campus !== false
                          }

                          return true
                        })
                        if (filtered.length === 0) {
                          return (
                            <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: "var(--portal-subtle,#9ba1ab)" }}>
                              No matching courses found
                            </div>
                          )
                        }
                        return filtered.map(c => (
                          <div key={c.id}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                              updateSlot(pathwayIdx, slotIdx, 'target', c.course_code)
                              setFixedOpen(prev => ({ ...prev, [fixedKey]: false }))
                            }}
                            style={{
                              padding: '0.55rem 0.75rem',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              borderBottom: "1px solid var(--portal-strong-border,#f0f2f5)",
                              color: "var(--portal-brand-text,#002147)",
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.15rem'
                            }}
                            className={styles.comboboxItem}>
                            <div>
                              <strong style={{ fontFamily: 'monospace' }}>{c.course_code}</strong> — {c.title}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: "var(--portal-muted,#6b7280)" }}>
                              <span style={{ fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>{c.category}</span>
                              {c.department_name ? ` • ${c.department_name}` : ''}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                </div>
              ) : slot.rule === 'GLOBAL_BASKET' ? (
                <select className={styles.input} value={slot.target}
                  onChange={e => updateSlot(pathwayIdx, slotIdx, 'target', e.target.value)}>
                  <option value="">— Select Category —</option>
                  {slot.target && !(HOD_COURSE_CATEGORIES as readonly string[]).includes(slot.target) && (
                    <option value={slot.target} disabled>Choose a category (previous target: {slot.target})</option>
                  )}
                  {HOD_COURSE_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              ) : (
                <>
                  <input className={styles.input} value="POOLED" readOnly />
                  <small>DSE courses from the student’s department and semester.</small>
                </>
              )}
              {(slot.rule === 'GLOBAL_BASKET' || slot.rule === 'POOL_RESTRICTED') && slot.target && !loadingCourses && getBasketCourses(slot, pathways[pathwayIdx]).length === 0 && (
                <p role="status" style={{ color: 'var(--portal-danger-text,#dc2626)', fontSize: '0.75rem' }}>
                  No matching courses for this pool in Semester {semester}. Add courses or choose another category.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.blueprintContainer}>
      {success && (
        <div className={styles.successModalOverlay} onClick={() => setSuccess('')}>
          <div className={styles.successModalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.successModalIcon}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
            <p className={styles.successModalText}>{success}</p>
            <button className={styles.successModalClose} onClick={() => setSuccess('')} aria-label="Close"><UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></button>
          </div>
        </div>
      )}

      {/* Semester Selector */}
      <div className={styles.semesterRow}>
        <span className={styles.semesterLabel}><b>Blueprint For Semester :</b></span>
        <select className={styles.semesterSelect} value={semester}
          onChange={e => {
            const nextSem = Number(e.target.value)
            setSemester(nextSem)
            fetchBlueprint(nextSem)
          }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
            <option key={s} value={s}>Semester {s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingState layout="form" message={`Loading semester ${semester} data…`} />
      ) : (
        <>
          {/* ── BLUEPRINT EDITOR ── */}
          {view === 'blueprint' && (
            <>

              {/* Credits */}
              <div className={styles.creditsRow}>
                <div className={styles.creditField}>
                  <label className={styles.label}>Min Credits</label>
                  <input type="number" className={styles.input}
                    value={minCredits}
                    onChange={e => {
                      const val = e.target.value
                      setMinCredits(val === '' ? '' : Number(val))
                    }} />
                </div>
                <div className={styles.creditField}>
                  <label className={styles.label}>Max Credits</label>
                  <input type="number" className={styles.input}
                    value={maxCredits}
                    onChange={e => {
                      const val = e.target.value
                      setMaxCredits(val === '' ? '' : Number(val))
                    }} />
                </div>
              </div>

              {/* Credit Feasibility Indicator */}
              <div style={{
                background: "var(--portal-surface,#ffffff)",
                border: "1.5px solid var(--portal-border,#dde1e7)",
                borderRadius: '0.45rem',
                padding: '0.85rem 1rem',
                marginBottom: '1.5rem',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: "var(--portal-muted,#44474e)", fontWeight: 600 }}>
                    Overall Credit Bounds (across all pathways):
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>
                    {overallMin} — {overallMax} credits
                  </span>
                </div>
                {isImpossible && (
                  <div style={{
                    marginTop: '0.6rem',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: "var(--portal-danger-bg,#fee2e2)",
                    border: "1px solid var(--portal-danger-border,#fca5a5)",
                    borderRadius: '0.35rem',
                    color: "var(--portal-danger-text,#dc2626)",
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}>
                    <UiTriangleAlert size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /> <b>Configuration Error:</b> {warningMessage}
                  </div>
                )}
                {!isImpossible && maxCredits !== '' && (
                  <div style={{
                    marginTop: '0.6rem',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: "var(--portal-info-bg,#eff6ff)",
                    border: "1px solid var(--portal-info-border,#bfdbfe)",
                    borderRadius: '0.35rem',
                    color: "var(--portal-info-text,#1d4ed8)",
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}>
                    <UiInfo size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /> <b>Info:</b> The current configured slots require a minimum of {overallMin} credits, which fits below your maximum limit of {maxCredits} credits.
                  </div>
                )}
              </div>

              {/* ── PATHWAY MANAGER ── */}
              {editingPathwayIndex === null ? (
                // Pathway list view
                <>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '1rem'
                  }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>
                      Pathways ({pathways.length})
                    </p>
                    <button
                      type="button"
                      onClick={addPathway}
                      style={{
                        background: "var(--portal-primary,#002147)", color: '#fff', border: 'none', borderRadius: '0.4rem',
                        padding: '0.45rem 1rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      + Add Pathway
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {pathways.map((pw, idx) => {
                      const { min, max } = getPathwayCreditRange(pw)
                      const validSlots = pw.slots.filter(s => s.rule)
                      return (
                        <div key={idx} style={{
                          background: "var(--portal-surface,#ffffff)",
                          border: "1.5px solid var(--portal-border,#dde1e7)",
                          borderRadius: '0.45rem',
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
                        }}>
                          <div>
                            <p style={{ fontSize: '0.85rem', fontWeight: 700, color: "var(--portal-brand-text,#002147)", marginBottom: '0.2rem' }}>
                              {pw.name || <span style={{ color: "var(--portal-subtle,#9ba1ab)", fontStyle: 'italic' }}>Untitled Pathway</span>}
                            </p>
                            <p style={{ fontSize: '0.72rem', color: "var(--portal-muted,#6b7280)" }}>
                              {validSlots.length} slot{validSlots.length !== 1 ? 's' : ''} • {min}–{max} credits
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={() => setEditingPathwayIndex(idx)}
                              style={{
                                background: "var(--portal-info-bg,#e6f0fa)", color: "var(--portal-brand-text,#002147)", border: "1px solid var(--portal-info-border,#bfdbfe)",
                                borderRadius: '0.35rem', padding: '0.35rem 0.75rem',
                                fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removePathway(idx)}
                              disabled={pathways.length <= 1}
                              style={{
                                background: pathways.length <= 1 ? "var(--portal-surface-soft,#f3f4f6)" : "var(--portal-danger-bg,#fee2e2)",
                                color: pathways.length <= 1 ? "var(--portal-subtle,#9ba1ab)" : "var(--portal-danger-text,#dc2626)",
                                border: `1px solid ${pathways.length <= 1 ? "var(--portal-border,#e5e7eb)" : "var(--portal-danger-border,#fca5a5)"}`,
                                borderRadius: '0.35rem', padding: '0.35rem 0.75rem',
                                fontSize: '0.72rem', fontWeight: 600,
                                cursor: pathways.length <= 1 ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                // Pathway editor view
                <>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '1rem',
                  }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>
                      Editing Pathway
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditingPathwayIndex(null)}
                      style={{
                        background: "var(--portal-info-bg,#e6f0fa)", color: "var(--portal-brand-text,#002147)", border: "1px solid var(--portal-info-border,#bfdbfe)",
                        borderRadius: '0.4rem', padding: '0.45rem 1rem',
                        fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      ← Back to Pathways
                    </button>
                  </div>

                  <div style={{
                    background: "var(--portal-surface,#ffffff)", border: "1.5px solid var(--portal-border,#dde1e7)", borderRadius: '0.45rem',
                    padding: '1rem', marginBottom: '1rem',
                  }}>
                    <label className={styles.label}>Pathway Name</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. Research Track, Industry Track"
                      value={pathways[editingPathwayIndex].name}
                      onChange={e => updatePathwayName(editingPathwayIndex, e.target.value)}
                    />
                  </div>

                  {/* Per-pathway credit range */}
                  {(() => {
                    const { min, max } = getPathwayCreditRange(pathways[editingPathwayIndex])
                    return (
                      <div style={{
                        background: "var(--portal-info-bg,#f8fafc)", border: "1px solid var(--portal-strong-border,#e2e8f0)", borderRadius: '0.35rem',
                        padding: '0.5rem 0.75rem', marginBottom: '1rem',
                        fontSize: '0.75rem', color: "var(--portal-muted,#44474e)",
                      }}>
                        Pathway credit range: <b>{min} — {max}</b>
                      </div>
                    )
                  })()}

                  <div className={styles.slotsEditorContainer}>
                    {pathways[editingPathwayIndex].slots.map((slot, slotIdx) =>
                      renderSlotEditor(editingPathwayIndex, slotIdx, slot)
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => addSlotToPathway(editingPathwayIndex)}
                    disabled={pathways[editingPathwayIndex].slots.length >= 10}
                    style={{
                      background: "var(--portal-surface,#ffffff)", color: "var(--portal-brand-text,#002147)", border: "1.5px dashed var(--portal-info-border,#bfdbfe)",
                      borderRadius: '0.4rem', padding: '0.6rem 1rem', width: '100%',
                      fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      marginTop: '0.75rem', marginBottom: '1.5rem',
                    }}
                  >
                    + Add Paper Slot
                  </button>
                </>
              )}

              {error && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{error}</div>}

              {hasChanges && (
                <div style={{
                  position: 'sticky',
                  bottom: 0,
                  background: "var(--portal-canvas,#f0f2f5)",
                  padding: '1rem 0',
                  borderTop: "1.5px solid var(--portal-border,#dde1e7)",
                  zIndex: 10,
                  display: 'flex',
                  gap: '0.75rem',
                  marginTop: '1.5rem',
                }}>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    style={{ flex: 1, background: "var(--portal-surface,#ffffff)", color: "var(--portal-muted,#44474e)", border: "1.5px solid var(--portal-border,#dde1e7)" }}
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    style={{ flex: 1 }}
                    onClick={() => {
                      if (minCredits === '' || maxCredits === '') {
                        setError('Min and Max credits are required')
                        return
                      }
                      setShowSaveConfirm(true)
                    }}
                    disabled={saving}
                  >
                    {saving ? <LoadingIndicator message="Saving…" /> : 'Save Blueprint →'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── COURSES ── */}
          {view === 'courses' && (
            <>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionTitle}>Courses — Semester {semester}</p>
                <button className={styles.addBtn} onClick={() => {
                  setCourseCode('')
                  setCourseTitle('')
                  setCourseCredits(null)
                  setCourseTheoryHours(null)
                  setCoursePracticalHours(null)
                  setCourseCategory(null)
                  setCourseSeatLimit(60)
                  setCoursePrereqs([])
                  setCourseRules([])
                  setNewRuleTarget('')
                  setEditCourse(null)
                  setShowAddCourse(true)
                  setError('')
                  setSuccess('')
                }}>+ Add Course</button>
              </div>

              <div className={styles.tableWrapper}>
                {loadingCourses ? (
                  <LoadingState layout="cards" message="Loading courses…" />
                ) : courses.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}><UiBookOpen size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                    <p className={styles.emptyTitle}>No courses yet</p>
                    <p className={styles.emptySubtitle}>Add courses for Semester {semester}.</p>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead className={styles.tableHead}>
                      <tr>
                        <th>Code</th>
                        <th>Title</th>
                        <th>Cr</th>
                        <th>Seats</th>
                        <th>Theory Hrs</th>
                        <th>Practical Hrs</th>
                        <th>Cat</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(view === 'courses' ? courses.filter(c => c.is_own_dept !== false) : courses).map(course => (
                        <tr key={course.id} className={styles.tableRow}>
                          <td style={{ fontSize: '0.68rem', fontFamily: 'monospace' }}>{course.course_code}</td>
                          <td style={{ fontSize: '0.78rem' }}>{course.title}</td>
                          <td>{course.credits}</td>
                          <td><strong>{course.seat_limit ?? 60}</strong></td>
                          <td>{course.theory_hours_per_week ?? course.credits}</td>
                          <td>{course.practical_hours_per_week ?? 0}</td>
                          <td><span className={styles.codeBadge}>{course.category}</span></td>
                          <td>
                            <div className={styles.actionBtns}>
                              <button
                                className={styles.editBtn}
                                title="Edit Course"
                                aria-label="Edit Course"
                                onClick={() => {
                                  setEditCourse(course)
                                  setCourseCode(course.course_code)
                                  setCourseTitle(course.title)
                                  setCourseCredits(course.credits)
                                  setCourseTheoryHours(course.theory_hours_per_week ?? course.credits)
                                  setCoursePracticalHours(course.practical_hours_per_week ?? 0)
                                  setCourseCategory(course.category)
                                  setCourseSeatLimit(course.seat_limit ?? 60)
                                  setCoursePrereqs(course.prerequisite_course_ids ?? [])
                                  loadCourseRules(course.id)
                                  setError(''); setSuccess('')
                                }}
                              >
                                <UiPencil size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                              </button>
                              <button
                                className={styles.deleteBtn}
                                title="Delete Course"
                                aria-label="Delete Course"
                                onClick={() => {
                                  setDeleteCourse(course); setError(''); setSuccess('')
                                }}
                              >
                                <UiTrash2 size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}

      {view === 'courses' && (
        <>
          {/* Add/Edit Course Modal */}
          {(showAddCourse || editCourse) && (
            <div className={styles.modalOverlay}>
              <div className={styles.courseModalDialog}>
                {/* Sticky Header */}
                <div className={styles.courseModalHeader}>
                  <h3 className={styles.modalTitle}>{editCourse ? 'Edit Course' : 'Add Course'}</h3>
                  <button
                    type="button"
                    className={styles.courseModalCloseBtn}
                    onClick={() => {
                      setShowAddCourse(false)
                      setEditCourse(null)
                      setCourseCode('')
                      setCourseTitle('')
                      setCourseCredits(null)
                      setCourseTheoryHours(null)
                      setCoursePracticalHours(null)
                      setCourseCategory(null)
                      setCourseSeatLimit(60)
                      setCoursePrereqs([])
                      setCourseRules([])
                      setNewRuleTarget('')
                      setError('')
                    }}
                    title="Close"
                    aria-label="Close"
                  >
                    <UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                  </button>
                </div>

                {/* Scrollable Body with 2-Column Responsive Layout */}
                <div className={styles.courseModalBody}>
                  <div className={styles.courseModalGrid}>
                    {/* Left Column: Course Details */}
                    <div className={styles.courseModalCol}>
                      <div className={styles.courseModalSectionTitle}>
                        <span>Course Details</span>
                      </div>

                      <div className={styles.field}>
                        <label className={styles.label}>Course Code</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="e.g. KU01DSCMAT101"
                          value={courseCode}
                          onChange={e => setCourseCode(e.target.value.toUpperCase())}
                        />
                      </div>

                      <div className={styles.field}>
                        <label className={styles.label}>Title</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="e.g. Differential Calculus"
                          value={courseTitle}
                          onChange={e => setCourseTitle(e.target.value)}
                        />
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Credits</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={1}
                            max={10}
                            value={courseCredits ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseCredits(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Seat Limit</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={1}
                            max={500}
                            placeholder="e.g. 60"
                            value={courseSeatLimit ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseSeatLimit(val === '' ? '' : Number(val))
                            }}
                          />
                        </div>
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Category</label>
                          <select
                            className={styles.input}
                            value={courseCategory ?? ''}
                            onChange={e => setCourseCategory(e.target.value || null)}
                          >
                            <option value="">— Select Category —</option>
                            {HOD_COURSE_CATEGORIES.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Theory Hours / Wk</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={0}
                            max={20}
                            placeholder={courseCredits ? `${courseCredits} (Default)` : 'e.g. 3'}
                            value={courseTheoryHours ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseTheoryHours(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Practical Hours / Wk</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={0}
                            max={20}
                            placeholder="e.g. 2"
                            value={coursePracticalHours ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCoursePracticalHours(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Constraints & Eligibility (Hard Constraints) */}
                    <div className={styles.courseModalRightCol}>
                      <div className={styles.courseModalSectionTitle}>
                        <span>Constraints &amp; Eligibility</span>
                        <span style={{ fontSize: '0.7rem', color: "var(--portal-brand-text,#002147)", fontWeight: 600, background: "var(--portal-info-bg,#e0f2fe)", padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                          Hard Eligibility
                        </span>
                      </div>

                      <div style={{ fontSize: '0.74rem', color: "var(--portal-muted,#64748b)", lineHeight: 1.45 }}>
                        Define hard eligibility constraints for this course. Students who do not meet these constraints cannot register for this paper.
                      </div>

                      {/* Active Constraints List (Light University Theme) */}
                      <div style={{
                        background: "var(--portal-info-bg,#f8fafc)",
                        border: "1.5px solid var(--portal-strong-border,#e2e8f0)",
                        borderRadius: '8px',
                        padding: '0.65rem',
                        minHeight: '110px',
                        maxHeight: '190px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem'
                      }}>
                        {loadingRules ? (
                          <LoadingState layout="list" rows={2} compact message="Loading constraints…" />
                        ) : courseRules.length === 0 ? (
                          <div style={{
                            fontSize: '0.75rem',
                            color: "var(--portal-muted,#64748b)",
                            fontStyle: 'italic',
                            padding: '1rem',
                            textAlign: 'center',
                            lineHeight: 1.5
                          }}>
                            No constraints configured.<br />
                            <span style={{ fontSize: '0.7rem', color: "var(--portal-info-text,#94a3b8)" }}>
                              All eligible students matching the blueprint can register.
                            </span>
                          </div>
                        ) : (
                          courseRules.map((rule, idx) => {
                            if (rule.rule === 'DEPARTMENT') {
                              const codes = rule.target.split(',').map(c => c.trim()).filter(Boolean)
                              return (
                                <div key={rule.id ?? `rule-${idx}`} className={styles.constraintCardLight}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, paddingRight: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: '3px',
                                        background: "var(--portal-info-bg,#e0f2fe)",
                                        color: "var(--portal-info-text,#0369a1)",
                                        letterSpacing: '0.04em'
                                      }}>
                                        Department Match
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: "var(--portal-info-text,#475569)", fontWeight: 500 }}>
                                        ({codes.length} department{codes.length === 1 ? '' : 's'} allowed)
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                      {codes.map(c => {
                                        const dept = departments.find(d => d.code === c)
                                        return (
                                          <span
                                            key={c}
                                            style={{
                                              fontSize: '0.7rem',
                                              fontWeight: 600,
                                              background: "var(--portal-info-bg,#f1f5f9)",
                                              color: "var(--portal-brand-text,#0f172a)",
                                              padding: '0.1rem 0.4rem',
                                              borderRadius: '3px',
                                              border: "1px solid var(--portal-strong-border,#cbd5e1)"
                                            }}
                                            title={dept ? dept.name : c}
                                          >
                                            {c}
                                          </span>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(rule, idx)}
                                    style={{
                                      background: "var(--portal-danger-bg,#fee2e2)",
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.5rem',
                                      flexShrink: 0
                                    }}
                                    title="Remove department constraint"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            } else {
                              const match = courses.find(c => c.course_code === rule.target) || priorCourses.find(c => c.course_code === rule.target)
                              return (
                                <div key={rule.id ?? `rule-${idx}`} className={styles.constraintCardLight}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, paddingRight: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: '3px',
                                        background: "var(--portal-purple-bg,#f3e8ff)",
                                        color: "var(--portal-purple-text,#7e22ce)",
                                        letterSpacing: '0.04em'
                                      }}>
                                        Completed Course
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.76rem', color: "var(--portal-brand-text,#1e293b)", fontWeight: 600 }}>
                                      {rule.target} {match ? `— ${match.title} (Sem ${match.semester})` : ''}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(rule, idx)}
                                    style={{
                                      background: "var(--portal-danger-bg,#fee2e2)",
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.5rem',
                                      flexShrink: 0
                                    }}
                                    title="Remove course prerequisite"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            }
                          })
                        )}
                      </div>

                      {/* Constraint Configuration Panel (Light University Theme) */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        background: "var(--portal-surface,#ffffff)",
                        padding: '0.85rem',
                        borderRadius: '8px',
                        border: "1.5px solid var(--portal-border,#dde1e7)"
                      }}>
                        {/* Rule Type Tabs */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: "1.5px solid var(--portal-strong-border,#f1f5f9)",
                          paddingBottom: '0.6rem'
                        }}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setNewRuleType('DEPARTMENT')
                                setPriorCourseOpen(false)
                              }}
                              style={{
                                background: newRuleType === 'DEPARTMENT' ? "var(--portal-primary,#002147)" : "var(--portal-info-bg,#f1f5f9)",
                                color: newRuleType === 'DEPARTMENT' ? '#ffffff' : "var(--portal-info-text,#475569)",
                                border: 'none',
                                borderRadius: '5px',
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Department Match
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNewRuleType('COMPLETED_COURSE')
                                setPriorCourseOpen(false)
                              }}
                              style={{
                                background: newRuleType === 'COMPLETED_COURSE' ? "var(--portal-primary,#002147)" : "var(--portal-info-bg,#f1f5f9)",
                                color: newRuleType === 'COMPLETED_COURSE' ? '#ffffff' : "var(--portal-info-text,#475569)",
                                border: 'none',
                                borderRadius: '5px',
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Completed Course Prerequisite
                            </button>
                          </div>
                        </div>

                        {/* DEPARTMENT Constraint View */}
                        {newRuleType === 'DEPARTMENT' && (() => {
                          const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
                          const selectedDeptCodes = deptRule?.target ? deptRule.target.split(',').map(c => c.trim()).filter(Boolean) : []
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ fontSize: '0.74rem', fontWeight: 600, color: "var(--portal-info-text,#334155)" }}>
                                  Select Allowed Departments ({selectedDeptCodes.length} selected):
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => updateDepartmentCodes(departments.map(d => d.code))}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: "var(--portal-info-text,#0284c7)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      padding: 0
                                    }}
                                  >
                                    Select All
                                  </button>
                                  <span style={{ color: "var(--portal-info-text,#cbd5e1)", fontSize: '0.7rem' }}>•</span>
                                  <button
                                    type="button"
                                    onClick={() => updateDepartmentCodes([])}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      padding: 0
                                    }}
                                  >
                                    Clear All
                                  </button>
                                </div>
                              </div>

                              <div className={styles.constraintDeptGrid}>
                                {departments.map(d => {
                                  const isChecked = selectedDeptCodes.includes(d.code)
                                  return (
                                    <label
                                      key={d.id}
                                      className={`${styles.constraintDeptLabel} ${isChecked ? styles.constraintDeptLabelActive : ''}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => handleDepartmentToggle(d.code, e.target.checked)}
                                      />
                                      <span>{d.code}</span>
                                      <span style={{ color: "var(--portal-muted,#64748b)", fontSize: '0.7rem' }}>({d.name})</span>
                                    </label>
                                  )
                                })}
                              </div>

                              <div style={{ fontSize: '0.7rem', color: "var(--portal-muted,#64748b)", lineHeight: 1.4 }}>
                                Tip: Matches Blueprint slot rules (`DEPT_RESTRICTED`). Only students in selected departments can register. If none selected, the rule is removed and all departments can register.
                              </div>
                            </div>
                          )
                        })()}

                        {/* COMPLETED_COURSE Constraint View */}
                        {newRuleType === 'COMPLETED_COURSE' && (() => {
                          const activeCourseSem = editCourse?.semester ?? semester
                          if (activeCourseSem <= 1) {
                            return (
                              <div style={{
                                padding: '0.85rem',
                                background: "var(--portal-info-bg,#f8fafc)",
                                border: "1px solid var(--portal-strong-border,#e2e8f0)",
                                borderRadius: '6px',
                                color: "var(--portal-muted,#64748b)",
                                fontSize: '0.76rem',
                                lineHeight: 1.45,
                                textAlign: 'center'
                              }}>
                                Semester 1 courses cannot have completed course prerequisites because there are no prior semesters.
                              </div>
                            )
                          }

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                              <label style={{ fontSize: '0.74rem', fontWeight: 600, color: "var(--portal-info-text,#334155)" }}>
                                Select Prerequisite Course (Prior Semesters Only):
                              </label>

                              {/* Custom Dropdown Trigger */}
                              <div className={styles.priorCourseDropdownWrapper}>
                                <button
                                  type="button"
                                  className={styles.priorCourseTrigger}
                                  onClick={() => setPriorCourseOpen(prev => !prev)}
                                >
                                  <span>
                                    {newRuleTarget ? (
                                      (() => {
                                        const match = priorCourses.find(c => c.course_code === newRuleTarget)
                                        return match
                                          ? `${match.course_code} — ${match.title} (Sem ${match.semester})`
                                          : newRuleTarget
                                      })()
                                    ) : (
                                      <span style={{ color: "var(--portal-info-text,#94a3b8)" }}>-- Select Prior Course --</span>
                                    )}
                                  </span>
                                  <ChevronDown size={16} style={{ color: "var(--portal-muted,#64748b)", transform: priorCourseOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
                                </button>

                                {priorCourseOpen && (
                                  <div className={styles.priorCourseMenu}>
                                    {/* Semester Filter Pills */}
                                    <div className={styles.priorCourseSemFilterRow}>
                                      <button
                                        type="button"
                                        className={`${styles.priorCourseSemPill} ${priorCourseSemesterFilter === null ? styles.priorCourseSemPillActive : ''}`}
                                        onClick={() => setPriorCourseSemesterFilter(null)}
                                      >
                                        All Prior
                                      </button>
                                      {Array.from({ length: Math.max(0, activeCourseSem - 1) }, (_, i) => i + 1).map(semNum => (
                                        <button
                                          key={semNum}
                                          type="button"
                                          className={`${styles.priorCourseSemPill} ${priorCourseSemesterFilter === semNum ? styles.priorCourseSemPillActive : ''}`}
                                          onClick={() => setPriorCourseSemesterFilter(semNum)}
                                        >
                                          Sem {semNum}
                                        </button>
                                      ))}
                                    </div>

                                    {/* Search Input inside Dropdown */}
                                    <input
                                      type="text"
                                      className={styles.priorCourseSearchInput}
                                      placeholder="Filter by course code or title..."
                                      value={priorCourseSearch}
                                      onChange={(e) => setPriorCourseSearch(e.target.value)}
                                      autoFocus
                                    />

                                    {/* Courses List */}
                                    <div className={styles.priorCourseList}>
                                      {loadingPriorCourses ? (
                                        <LoadingState layout="list" rows={2} compact message="Loading prior courses…" />
                                      ) : (
                                        (() => {
                                          const filtered = priorCourses.filter(c => {
                                            if (editCourse?.id && c.id === editCourse.id) return false
                                            if (c.semester >= activeCourseSem) return false
                                            if (priorCourseSemesterFilter !== null && c.semester !== priorCourseSemesterFilter) return false
                                            if (priorCourseSearch.trim()) {
                                              const q = priorCourseSearch.trim().toLowerCase()
                                              const matchCode = c.course_code?.toLowerCase().includes(q)
                                              const matchTitle = c.title?.toLowerCase().includes(q)
                                              if (!matchCode && !matchTitle) return false
                                            }
                                            return true
                                          })

                                          if (filtered.length === 0) {
                                            return (
                                              <div style={{ padding: '0.6rem', textAlign: 'center', fontSize: '0.75rem', color: "var(--portal-info-text,#94a3b8)", fontStyle: 'italic' }}>
                                                No prior courses found
                                              </div>
                                            )
                                          }

                                          return filtered.map(c => {
                                            const isAlreadyAdded = courseRules.some(r => r.rule === 'COMPLETED_COURSE' && r.target === c.course_code)
                                            const isSelected = newRuleTarget === c.course_code

                                            return (
                                              <div
                                                key={c.id}
                                                className={styles.priorCourseOption}
                                                style={{
                                                  opacity: isAlreadyAdded ? 0.6 : 1,
                                                  background: isSelected ? "var(--portal-info-bg,#e0f2fe)" : undefined,
                                                }}
                                                onClick={() => {
                                                  setNewRuleTarget(c.course_code)
                                                  setPriorCourseOpen(false)
                                                }}
                                              >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                  <span style={{ fontWeight: 600, color: "var(--portal-brand-text,#002147)" }}>
                                                    {c.course_code} — {c.title}
                                                  </span>
                                                  {isAlreadyAdded && (
                                                    <span style={{ fontSize: '0.68rem', color: "var(--portal-info-text,#0284c7)", fontWeight: 600 }}>
                                                      (Already Added)
                                                    </span>
                                                  )}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: "var(--portal-muted,#64748b)" }}>
                                                  Semester {c.semester} • {c.credits} Credits • {c.category || 'General'}
                                                </div>
                                              </div>
                                            )
                                          })
                                        })()
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                                <input
                                  type="text"
                                  placeholder="Or enter course code manually"
                                  className={styles.input}
                                  style={{ margin: 0, fontSize: '0.75rem', padding: '0.45rem 0.6rem', flex: 1, textTransform: 'uppercase' }}
                                  value={newRuleTarget}
                                  onChange={(e) => setNewRuleTarget(e.target.value.toUpperCase())}
                                />
                                <button
                                  type="button"
                                  onClick={handleAddRule}
                                  disabled={!newRuleTarget.trim()}
                                  style={{
                                    background: !newRuleTarget.trim() ? "var(--portal-info-bg,#94a3b8)" : "var(--portal-primary,#002147)",
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.45rem 0.85rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: !newRuleTarget.trim() ? 'not-allowed' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    whiteSpace: 'nowrap',
                                    transition: 'background 0.15s ease'
                                  }}
                                >
                                  + Add Prerequisite
                                </button>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sticky Footer */}
                <div className={styles.courseModalFooter}>
                  {error && (
                    <div className={styles.errorBanner} style={{ margin: 0, flex: 1, padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
                      {error}
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.modalCancelBtn}
                    style={{ maxWidth: '140px' }}
                    onClick={() => {
                      setShowAddCourse(false)
                      setEditCourse(null)
                      setCourseCode('')
                      setCourseTitle('')
                      setCourseCredits(null)
                      setCourseTheoryHours(null)
                      setCoursePracticalHours(null)
                      setCourseCategory(null)
                      setCourseSeatLimit(60)
                      setCoursePrereqs([])
                      setCourseRules([])
                      setNewRuleTarget('')
                      setError('')
                    }}
                    disabled={savingCourse}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.modalConfirmBtn}
                    style={{ maxWidth: '180px' }}
                    onClick={handleSaveCourse}
                    disabled={savingCourse}
                  >
                    {savingCourse ? <LoadingIndicator message="Saving…" /> : editCourse ? 'Save Changes →' : 'Add Course →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Course Confirmation */}
          {deleteCourse && (
            <div className={styles.modalOverlay}>
              <div className={styles.modal}>
                <h3 className={styles.modalTitle}>Delete Course</h3>
                <p className={styles.modalSubtitle}>
                  Are you sure you want to delete <strong>{deleteCourse.title}</strong>?
                </p>
                {error && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{error}</div>}
                <div className={styles.modalActions}>
                  <button className={styles.modalCancelBtn} onClick={() => { setDeleteCourse(null); setError('') }} disabled={deletingCourse}>Cancel</button>
                  <button className={styles.modalDeleteBtn} onClick={handleDeleteCourse} disabled={deletingCourse}>
                    {deletingCourse ? <LoadingIndicator message="Deleting…" /> : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Discard Changes Confirmation */}
      {showCancelConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Discard Changes</h3>
            <p className={styles.modalSubtitle}>
              Are you sure you want to discard all edits?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowCancelConfirm(false)}>
                No, Keep Editing
              </button>
              <button className={styles.modalConfirmBtn} onClick={() => {
                setShowCancelConfirm(false)
                if (initialSnapshot) {
                  setMinCredits(initialSnapshot.minCredits)
                  setMaxCredits(initialSnapshot.maxCredits)
                  setPathways(JSON.parse(JSON.stringify(initialSnapshot.pathways)))
                }
                setError('')
              }}>
                Yes, Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Blueprint Confirmation */}
      {showSaveConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Save Blueprint</h3>
            <p className={styles.modalSubtitle}>
              Are you sure you want to save this blueprint? This will update the paper rules and credit requirements for Semester {semester}.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowSaveConfirm(false)}>
                Cancel
              </button>
              <button className={styles.modalConfirmBtn} onClick={() => {
                setShowSaveConfirm(false)
                handleSaveBlueprint()
              }}>
                Yes, Save Blueprint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
