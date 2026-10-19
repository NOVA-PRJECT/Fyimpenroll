const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
function load(name, extras = {}) {
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/core', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { module, exports: module.exports, AbortController, Error, ...extras })
  return module.exports
}
function harness() {
  const pending = [], states = []
  const catalogue = load('semester-catalogue').createSemesterCatalogue((semester, signal) => new Promise((resolve, reject) => pending.push({ semester, signal, resolve, reject })), state => states.push(state))
  return { catalogue, pending, states, get current() { return states.at(-1) } }
}
const row = (semester, code = 'C') => ({ semester, course_code: code, id: code })
test('3 → 4: delayed success, failure and finally from old requests cannot replace the selected semester', async () => {
  for (const fail of [false, true]) {
    const h = harness(), a = h.catalogue.select(3), b = h.catalogue.select(4)
    assert.equal(h.pending[0].signal.aborted, true)
    assert.equal(h.current.semester, 4); assert.equal(h.current.rows, undefined)
    h.pending[1].resolve([row(4)]); await b
    if (fail) h.pending[0].reject(new Error('old error')); else h.pending[0].resolve([row(3)])
    await a
    assert.equal(h.current.semester, 4); assert.equal(h.current.rows[0].semester, 4)
    assert.equal(h.current.error, ''); assert.equal(h.current.loading, false)
  }
})
test('3 → 4 → 3 uses request identity, not just matching semesters', async () => {
  const h = harness(), a = h.catalogue.select(3), b = h.catalogue.select(4), c = h.catalogue.select(3)
  h.pending[2].resolve([row(3, 'LATEST')]); await c
  h.pending[0].resolve([row(3, 'OLD')]); h.pending[1].resolve([row(4)]); await Promise.all([a,b])
  assert.equal(h.current.rows[0].course_code, 'LATEST')
})
test('visited semesters show their sorted cache immediately, revalidate, and retain it on failure', async () => {
  const h = harness(), a = h.catalogue.select(3)
  h.pending[0].resolve([row(3,'Z'),row(3,'A')]); await a
  const b = h.catalogue.select(4); h.pending[1].resolve([]); await b
  const c = h.catalogue.select(3)
  assert.equal(h.current.rows.map(r=>r.course_code).join(','), 'A,Z'); assert.equal(h.current.loading,true)
  h.pending[2].reject(new Error('offline')); await c
  assert.equal(h.current.rows.length, 2); assert.equal(h.current.error, 'offline')
})
test('mutation invalidation reloads the current filter and clears all visited semester caches', async () => {
  const h = harness(), a = h.catalogue.select(3)
  h.pending[0].resolve([row(3)]); await a
  const b = h.catalogue.select(4), c = h.catalogue.invalidate()
  h.pending[1].resolve([row(4,'OLD')]); await b
  assert.equal(h.current.rows, undefined); assert.equal(h.current.loading, true)
  h.pending[2].resolve([row(4,'MOVED')]); await c
  const d = h.catalogue.select(3); assert.equal(h.current.rows, undefined)
  h.pending[3].resolve([]); await d
  assert.equal(h.current.rows.length,0)
})
test('unmount cancellation suppresses results; wrong-semester payloads show an error rather than wrong rows', async () => {
  const h = harness(), a = h.catalogue.select(3)
  h.catalogue.cancel(); const count = h.states.length
  h.pending[0].resolve([row(3)]); await a; assert.equal(h.states.length, count)
  const b = h.catalogue.select(4); h.pending[1].resolve([row(3)]); await b
  assert.equal(h.current.rows, undefined); assert.match(h.current.error,/different semester/)
})
test('disposing prevents a completed mutation from restarting requests after unmount; Strict Mode can remount',async()=>{
  const h=harness(), a=h.catalogue.start(3)
  h.catalogue.dispose()
  await h.catalogue.invalidate()
  assert.equal(h.pending.length,1)
  h.pending[0].resolve([row(3)]);await a
  const b=h.catalogue.start(4)
  h.pending[1].resolve([row(4)]);await b
  assert.equal(h.current.semester,4);assert.equal(h.current.rows[0].semester,4)
})
test('readable API errors prefer validation details and messages, with safe action-specific fallbacks', async () => {
  const { apiErrorMessage } = load('api-error')
  assert.equal(apiErrorMessage({error:'Bad Request',message:'Department code is required'},'fallback',400),'Department code is required')
  assert.match(apiErrorMessage({details:{fieldErrors:{campus_id:['Choose a campus'],email:['Invalid email']}}},'fallback',400),/campus id: Choose a campus; email: Invalid email/)
  assert.equal(apiErrorMessage({error:'Conflict',message:'Code IT already exists'},'fallback',409),'Code IT already exists')
  assert.equal(apiErrorMessage({message:'SQL details'},'Unable to save',500),'Unable to save')
  assert.match(apiErrorMessage(null,'fallback',401),/Sign in again/)
  assert.equal(apiErrorMessage({error:'Bad Request'},'Choose a valid value',400),'Choose a valid value')
})
test('admin requests report network, non-JSON and HTTP failures without returning successful data', async () => {
  for (const fetch of [async()=>{throw Error('network')}, async()=>new Response('<html>',{status:502}), async()=>Response.json({error:'Conflict',message:'Code already used'},{status:409})]) {
    const {adminRequest}=load('api-error',{fetch})
    await assert.rejects(adminRequest('/api/admin/departments','Unable to save'),/Unable to save|Code already used/)
  }
})
