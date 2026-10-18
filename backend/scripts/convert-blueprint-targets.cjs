#!/usr/bin/env node
// Produces reviewable, transactional SQL; never writes to the database itself.
const fs = require('node:fs')
const path = require('node:path')
const { HOD_COURSE_CATEGORIES } = require('@fyimp/contracts')
const categories = new Set(HOD_COURSE_CATEGORIES)
const normalizeCode = value => String(value || '').trim().toUpperCase().replace(/^KU([1-9])(DSC|MDC|AEC|VAC|SEC|DSS|DSE)/, 'KU0$1$2')

function legacyMatches(course, slot, blueprint) {
  if (course.semester !== blueprint.semester) return false
  const target = String(slot.target || '').trim()
  if (slot.rule === 'POOL_RESTRICTED') return course.department_id === blueprint.department_id && (course.tag || '').trim() === target
  // Reproduce both the old SQL filter and the subsequent eligibility helper.
  const queryMatches = course.tag === target || (!target.includes('-') && course.course_code === target)
  const helperMatches = (course.tag || '').trim().toUpperCase() === target.toUpperCase() || normalizeCode(course.course_code) === normalizeCode(target)
  return queryMatches && helperMatches && !(target.toUpperCase().includes('MDC') && course.department_id === blueprint.department_id)
}

function convertSnapshot(snapshot, mappings = {}) {
  const report = { changes: [], unresolved: [], converted_blueprints: 0 }
  const converted = structuredClone(snapshot.blueprints)
  const convert = (slot, blueprint, key) => {
    if (!['GLOBAL_BASKET', 'POOL_RESTRICTED'].includes(slot.rule)) return slot
    const before = snapshot.courses.filter(course => legacyMatches(course, slot, blueprint))
    let target = 'POOLED'
    if (slot.rule === 'GLOBAL_BASKET') {
      const oldCategory = String(slot.target || '').trim().toUpperCase()
      const inferred = [...new Set(before.map(course => course.category))]
      target = mappings[key] || (categories.has(oldCategory) ? oldCategory : inferred.length === 1 ? inferred[0] : '')
      if (!categories.has(target)) {
        report.unresolved.push({ key, blueprint_id: blueprint.id, previous_target: slot.target, categories: inferred, reason: before.length ? 'Explicit category mapping required' : 'No matching courses; explicit category mapping required' })
        return slot
      }
    }
    const after = snapshot.courses.filter(course => course.semester === blueprint.semester && (
      slot.rule === 'POOL_RESTRICTED'
        ? course.category === 'DSE' && course.department_id === blueprint.department_id
        : course.category === target && (target !== 'MDC' || course.department_id !== blueprint.department_id)
    ))
    const beforeIds = new Set(before.map(c => c.id)), afterIds = new Set(after.map(c => c.id))
    report.changes.push({ key, blueprint_id: blueprint.id, rule: slot.rule, previous_target: slot.target, target,
      previous_count: before.length, new_count: after.length,
      added_course_ids: after.filter(c => !beforeIds.has(c.id)).map(c => c.id),
      removed_course_ids: before.filter(c => !afterIds.has(c.id)).map(c => c.id),
      removed_non_dse_course_ids: slot.rule === 'POOL_RESTRICTED' ? before.filter(c => c.category !== 'DSE').map(c => c.id) : [],
    })
    return { ...slot, target }
  }
  converted.forEach(blueprint => {
    const original = structuredClone(blueprint)
    if (Array.isArray(blueprint.pathways) && blueprint.pathways.length) {
      blueprint.pathways = blueprint.pathways.map((pw, index) => ({ ...pw,
        slots: (pw.slots || []).map((slot, i) => convert(slot, blueprint, `${blueprint.id}:pathway:${pw.id || index}:${i + 1}`)),
      }))
      for (let i = 1; i <= 8; i++) {
        const field = `slot_${i}_target`, rule = blueprint[`slot_${i}_rule`]
        if (!(field in blueprint) || !['GLOBAL_BASKET', 'POOL_RESTRICTED'].includes(rule)) continue
        const first = blueprint.pathways[0].slots[i - 1]
        if (first?.rule === rule) blueprint[field] = first.target
        else blueprint[field] = convert({ rule, target: blueprint[field] }, blueprint, `${blueprint.id}:flat:${i}`).target
      }
    } else {
      // Flat-only records remain flat-only; this conversion does not invent pathway IDs.
      for (let i = 1; i <= 8; i++) {
        const field = `slot_${i}_target`
        if (field in blueprint) blueprint[field] = convert({ rule: blueprint[`slot_${i}_rule`], target: blueprint[field] }, blueprint, `${blueprint.id}:flat:${i}`).target
      }
    }
    if (JSON.stringify(original) !== JSON.stringify(blueprint)) report.converted_blueprints++
  })
  return { blueprints: converted, report }
}

const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const guardFields = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['created_at', 'updated_at'].includes(key)))
function guard(body) {
  let delimiter = '$conversion_guard$'
  while (body.includes(delimiter)) delimiter = delimiter.replace(/\$$/, '_x$')
  return `DO ${delimiter} BEGIN ${body} END; ${delimiter};`
}

function transactionSql(before, after, courses) {
  const sql = ['BEGIN;', "SET LOCAL lock_timeout = '10s';", 'LOCK TABLE public.semester_blueprints IN SHARE ROW EXCLUSIVE MODE;']
  if (courses) {
    sql.push('LOCK TABLE public.courses IN SHARE MODE;')
    const sorted = [...courses].sort((a, b) => a.id.localeCompare(b.id))
    sql.push(guard(`IF (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id), '[]'::jsonb) FROM (SELECT id, course_code, department_id, semester, category, tag FROM public.courses) c) IS DISTINCT FROM ${json(sorted)} THEN RAISE EXCEPTION 'Course catalogue changed; regenerate the conversion report'; END IF;`))
  }
  for (let i = 0; i < before.length; i++) {
    const previous = before[i], next = after[i]
    if (JSON.stringify(previous) === JSON.stringify(next)) continue
    const assignments = Object.keys(next).filter(key => key === 'pathways' || /^slot_[1-8]_target$/.test(key))
      .filter(key => JSON.stringify(next[key]) !== JSON.stringify(previous[key]))
      .map(key => `${key} = ${next[key] == null ? 'NULL' : key === 'pathways' ? json(next[key]) : quote(next[key])}`)
    sql.push(guard(`IF NOT EXISTS (SELECT 1 FROM public.semester_blueprints b WHERE b.id = ${quote(previous.id)}::uuid AND (to_jsonb(b) - 'created_at' - 'updated_at') = ${json(guardFields(previous))}) THEN RAISE EXCEPTION 'Blueprint changed; regenerate conversion for ${previous.id.replaceAll("'", "''")}'; END IF;`))
    sql.push(`UPDATE public.semester_blueprints SET ${assignments.join(', ')} WHERE id = ${quote(previous.id)}::uuid;`)
    sql.push(guard(`IF NOT EXISTS (SELECT 1 FROM public.semester_blueprints b WHERE b.id = ${quote(next.id)}::uuid AND (to_jsonb(b) - 'created_at' - 'updated_at') = ${json(guardFields(next))}) THEN RAISE EXCEPTION 'Blueprint conversion did not persist'; END IF;`))
  }
  sql.push('COMMIT;', '')
  return sql.join('\n')
}

async function readLiveSnapshot() {
  const { createClient } = require('@supabase/supabase-js')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  async function all(table, columns) {
    const rows = []
    for (let from = 0; ; ) {
      const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
      if (error) throw Error(`Unable to snapshot ${table}: ${error.message}`)
      if (!data.length) return rows
      rows.push(...data)
      from += data.length
    }
  }
  const [blueprints, courses] = await Promise.all([all('semester_blueprints', '*'), all('courses', 'id, course_code, department_id, semester, category, tag')])
  return { captured_at: new Date().toISOString(), blueprints, courses }
}

async function main() {
  const args = process.argv.slice(2), value = flag => {
    const result = args[args.indexOf(flag) + 1]
    if (!result || result.startsWith('--')) throw Error(`Missing value for ${flag}`)
    return result
  }
  if (!args.includes('--out') || args.includes('--snapshot') === args.includes('--live')) {
    throw Error('Usage: node convert-blueprint-targets.cjs (--snapshot file.json | --live) --out NEW_DIRECTORY [--mapping file.json]')
  }
  const out = path.resolve(value('--out'))
  // Never overwrite a prior report or its rollback snapshot.
  if (fs.existsSync(out)) throw Error('Output directory already exists; choose a fresh directory')
  const snapshot = args.includes('--live') ? await readLiveSnapshot() : JSON.parse(fs.readFileSync(value('--snapshot'), 'utf8'))
  if (!Array.isArray(snapshot.blueprints) || !Array.isArray(snapshot.courses)) throw Error('Snapshot requires blueprints and courses arrays')
  const mappings = args.includes('--mapping') ? JSON.parse(fs.readFileSync(value('--mapping'), 'utf8')) : {}
  const { blueprints, report } = convertSnapshot(snapshot, mappings)
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snapshot, null, 2))
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  if (!report.unresolved.length) {
    fs.writeFileSync(path.join(out, 'apply.sql'), transactionSql(snapshot.blueprints, blueprints, snapshot.courses))
    fs.writeFileSync(path.join(out, 'rollback.sql'), transactionSql(blueprints, snapshot.blueprints))
  }
  console.log(JSON.stringify({ output: out, blueprints: snapshot.blueprints.length, converted: report.converted_blueprints, unresolved: report.unresolved.length, database_writes: false }))
  if (report.unresolved.length) process.exitCode = 2
}

module.exports = { convertSnapshot, legacyMatches, transactionSql }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
