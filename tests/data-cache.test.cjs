const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
require('reflect-metadata')
const { QueryClient } = require('@tanstack/react-query')
const { dataReadDomains, dataChangeDomains } = require('@fyimp/contracts')
const { DataCacheService } = require('../backend/dist/core/cache/data-cache.service')
const { databaseFetch } = require('../backend/dist/core/cache/database-fetch')
const { readContext } = require('../backend/dist/core/cache/read-context')
const { fetchAllPaginated, fetchByIdChunks } = require('../backend/dist/core/database/pagination.util')
const { FacultyService } = require('../backend/dist/modules/faculty/faculty.service')
const { DataCacheInterceptor } = require('../backend/dist/core/cache/data-cache.interceptor')
const { lastValueFrom, of } = require('rxjs')
const { PeriodAttendanceService } = require('../backend/dist/modules/period-attendance/period-attendance.service')

function sourceModule(source) {
  const filename = path.resolve(source)
  const m = new Module(filename, module)
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename))
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
  return m.exports
}
const frontendCache = () => sourceModule('frontend/src/core/data-cache.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('browser reads once per key, combines consumers, and refreshes only matching domains', async () => {
  global.window = Object.assign(new EventTarget(), { location: { origin: 'https://portal.test' } })
  const cache = frontendCache(), counts = new Map()
  const network = async (url, init) => { counts.set(url, (counts.get(url) || 0) + 1); return Response.json({ url, fresh: new Headers(init?.headers).get('X-Refresh-Data') }) }
  const read = url => cache.cachedDataFetch(url, undefined, network)
  await Promise.all([read('/api/hod/students?semester=1'), read('/api/hod/students?semester=1')])
  await read('/api/hod/students?semester=1'); assert.equal(counts.get('/api/hod/students?semester=1'), 1)
  await read('/api/hod/students?semester=2'); assert.equal(counts.get('/api/hod/students?semester=2'), 1)
  await read('/api/hod/courses?semester=1')
  await cache.invalidateData(['attendance'])
  await read('/api/hod/courses?semester=1'); assert.equal(counts.get('/api/hod/courses?semester=1'), 1)
  await cache.refreshDatasets(['/api/hod/students?semester=1'], async () => {})
  const fresh = await (await read('/api/hod/students?semester=1')).json()
  assert.equal(fresh.fresh, '1'); assert.equal(counts.get('/api/hod/students?semester=1'), 2)
  await read('/api/hod/students?semester=2'); await read('/api/hod/courses?semester=1')
  assert.equal(counts.get('/api/hod/students?semester=2'),1,'another loaded filter remains cached')
  assert.equal(counts.get('/api/hod/courses?semester=1'),1,'another section remains cached')
  assert.equal(counts.size,3,'no unopened sections were fetched')
  cache.clearDataCache(); await read('/api/hod/students?semester=1')
  assert.equal(counts.get('/api/hod/students?semester=1'), 3)
  cache.clearDataCache(); delete global.window
})

test('browser refresh fences old responses and preserves previous data on a failed refresh', async () => {
  global.window = Object.assign(new EventTarget(), { location: { origin: 'https://portal.test' } })
  const cache = frontendCache(); let version = 1, fail = false
  const network = async () => fail ? Response.json({ message: 'outage' }, { status: 503 }) : Response.json({ version })
  const read = () => cache.cachedDataFetch('/api/hod/courses?semester=1', undefined, network)
  await read(); version = 2
  await cache.refreshDatasets(['/api/hod/courses?semester=1'], async () => {}); await read()
  fail = true; await cache.refreshDatasets(['/api/hod/courses?semester=1'], async () => {}); assert.equal((await read()).status, 503)
  const previous = cache.dataClient.getQueryCache().findAll()[0].state.data
  assert.equal(JSON.parse(previous.body).version, 2)
  cache.clearDataCache()
  const gate = deferred()
  const old = cache.cachedDataFetch('/api/hod/courses?semester=1', undefined, async () => { await gate.promise; return Response.json({ version: 0 }) }).catch(() => {})
  await tick(); await cache.refreshDatasets(['/api/hod/courses?semester=1'], async () => {}); fail = false; version = 3; await read()
  gate.resolve(); await old
  assert.equal((await (await read()).json()).version, 3)
  cache.clearDataCache(); delete global.window
})

test('explicit Refresh of a missing dataset forces that URL without fetching any other section', async () => {
  global.window = Object.assign(new EventTarget(), { location: { origin: 'https://portal.test' } })
  const cache = frontendCache(), calls = []
  const network = async (url, init) => { calls.push([url, new Headers(init?.headers).get('X-Refresh-Data')]); return Response.json({ ok: true }) }
  await cache.refreshDatasets(['/api/hod/students?semester=9'], () => cache.cachedDataFetch('/api/hod/students?semester=9', undefined, network))
  assert.deepEqual(calls, [['/api/hod/students?semester=9', '1']])
  assert.equal(cache.dataClient.getQueryCache().findAll().length,1)
  cache.clearDataCache(); delete global.window
})

test('an aborted consumer does not cancel another consumer of the same dataset', async () => {
  global.window = Object.assign(new EventTarget(), { location: { origin: 'https://portal.test' } })
  const cache = frontendCache(), gate = deferred(), controller = new AbortController(); let reads = 0
  const network = async () => { reads++; await gate.promise; return Response.json({ ok: true }) }
  const first = cache.cachedDataFetch('/api/director/settings', { signal: controller.signal }, network).catch(e => e.name)
  const second = cache.cachedDataFetch('/api/director/settings', undefined, network)
  controller.abort(); assert.equal(await first, 'AbortError'); gate.resolve()
  assert.equal((await second).ok, true); assert.equal(reads, 1)
  cache.clearDataCache(); delete global.window
})

// A deterministic Redis command model exercises outage/race behavior without a live service.
// Browser and SQL tests below execute the real cache client and aggregation SQL separately.
class RedisModel {
  strings = new Map(); hashes = new Map(); lru = new Map(); fail = false
  check() { if (this.fail) throw Error('redis unavailable') }
  hash(key) { if (!this.hashes.has(key)) this.hashes.set(key, new Map()); return this.hashes.get(key) }
  async set(key, value, options) { this.check(); if (!options?.nx || !this.strings.has(key)) this.strings.set(key, value); return 'OK' }
  async get(key) { this.check(); return this.strings.get(key) ?? null }
  async del(...keys) { this.check(); for (const key of keys) { this.strings.delete(key); this.hashes.delete(key); this.lru.delete(key) } }
  async hmget(key, ...tags) { this.check(); return Object.fromEntries(tags.map(tag => [tag, this.hash(key).get(tag) ?? null])) }
  async eval(script, keys, args) {
    this.check()
    if (script.includes('local old=')) {
      const old=this.strings.get(keys[0]);this.strings.set(keys[0],args[1]);
      if(old) await this.del(...['entries','versions','lru','sizes','bytes'].map(s=>args[0]+':'+old+':'+s));
      return 1;
    }
    if (script.includes('HINCRBY')) { for (const tag of args) this.hash(keys[0]).set(tag, String(Number(this.hash(keys[0]).get(tag) || 0) + 1)); return 1 }
    const read = script.includes('return entry.payload'), versions = read ? null : JSON.parse(args[1])
    if (read) {
      if (this.strings.get(keys[3]) !== args[2]) return null
      const raw = this.hash(keys[0]).get(args[0]); if (!raw) return null
      const entry = JSON.parse(raw)
      if (Object.entries(entry.versions).some(([tag, value]) => String(this.hash(keys[1]).get(tag) || 0) !== value)) return null
      return entry.payload
    }
    if (this.strings.get(keys[5]) !== args[4] || Object.entries(versions).some(([tag,value]) => String(this.hash(keys[1]).get(tag)||0) !== value)) return 0
    this.hash(keys[0]).set(args[0], args[2]); return 1
  }
}
function serverCache(redis = new RedisModel()) { const cache = new DataCacheService({ get: () => undefined }); cache.redis = redis; return cache }

test('server results are scoped, shared, invalidated by dependency, and reject stale publication', async () => {
  const cache = serverCache(); let loads = 0
  const load = async () => ({ number: ++loads })
  assert.deepEqual(await Promise.all([cache.get('actor:a', ['people'], load), cache.get('actor:a', ['people'], load)]), [{number:1},{number:1}])
  await cache.get('actor:b', ['people'], load); assert.equal(loads, 2)
  await cache.invalidate(['attendance']); await cache.get('actor:a', ['people'], load); assert.equal(loads, 2)
  const gate = deferred(); await cache.invalidate(['people'])
  const old = cache.get('actor:a', ['people'], async () => { await gate.promise; return { number: 0 } })
  await tick(); await cache.invalidate(['people']); await cache.get('actor:a', ['people'], load)
  gate.resolve(); await old
  assert.equal((await cache.get('actor:a', ['people'], load)).number, 3)
})

test('Redis invalidation outage never retries a write and recovery excludes old cached values', async () => {
  const redis = new RedisModel(), cache = serverCache(redis); let loads = 0
  const load = async () => ++loads
  await cache.get('scope', ['catalogue'], load)
  redis.fail = true; await cache.invalidate(['catalogue'])
  assert.equal(await cache.get('scope', ['catalogue'], load), 2)
  redis.fail = false; assert.equal(await cache.get('scope', ['catalogue'], load), 3)
  assert.equal(await cache.get('scope', ['catalogue'], load), 3)
})

test('database dependencies deduplicate within a request, force reads, and invalidate worker writes', async () => {
  const calls = []; const invalidations = []
  const cache = { get: async (_k,_tags,load,force) => { calls.push(force ? 'fresh' : 'cached'); return load() }, invalidate: async tags => invalidations.push(tags) }
  let reads = 0
  const network = databaseFetch(async () => { reads++; return Response.json([{ id: 'one' }]) }, cache)
  await readContext.run({ scope: 'actor', force: true, cacheReferences: true, pending: new Map() }, async () => {
    await network('https://db.test/rest/v1/courses?select=id'); await network('https://db.test/rest/v1/courses?select=id')
    assert.equal(reads, 1); assert.deepEqual(calls, ['fresh'])
    await network('https://db.test/rest/v1/rpc/run_current_term_operation', { method: 'POST', body: JSON.stringify({ p_operation: 'apply_course_allocation' }) })
    await network('https://db.test/rest/v1/courses?select=id'); assert.equal(reads, 3)
  })
  assert.ok(invalidations[0].includes('enrollment'))
})

test('pagination uses proven bounds but continues past capped short pages', async () => {
  let calls = 0
  const data = Array.from({length: 121},(_,id)=>({id}))
  const factory = async (from,to) => { calls++; return { data: data.slice(from, Math.min(to+1,from+50)), error: null } }
  assert.equal((await fetchAllPaginated(factory)).length, 121); assert.equal(calls, 4)
  calls=0
  assert.equal((await fetchAllPaginated(async(from,to)=>{calls++;return {data:data.slice(from,to+1),count:121,error:null}})).length,121)
  assert.equal(calls,1)
  calls=0
  const rows=await fetchByIdChunks(data.map(r=>String(r.id)), ids=>{ let start=0,end=999;return {
    range(a,b){start=a;end=b;return this},then(resolve){calls++;return Promise.resolve({data:ids.slice(start,end+1),error:null}).then(resolve)},
  }},true)
  assert.equal(rows.length,121);assert.equal(calls,2)
})

test('dependency registry keeps attendance changes away from catalogue reads and scopes exports out', () => {
  assert.equal(dataReadDomains('/api/hod/courses').some(d=>dataChangeDomains('/api/attendance/period/submit').includes(d)),false)
  assert.deepEqual(dataReadDomains('/api/export/registrations'),[])
  assert.deepEqual(dataReadDomains('/api/auth/session'),[])
})

test('faculty counts use one batch for many courses', async () => {
  let counts=0, tableReads=0
  const courses=Array.from({length:60},(_,i)=>({id:String(i),department_id:'dept',semester:1}))
  const db={from(table){tableReads++;let from=0;const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(start){from=start;return q},
    single(){return Promise.resolve({data:table==='faculty'?{full_name:'Teacher'}:{academic_year:'2026-27'}})},
    then(resolve){return Promise.resolve({data:from?[]:table==='departments'?[{id:'dept'}]:courses}).then(resolve)}};return q},
    async rpc(name,args){assert.equal(name,'display_enrollment_counts');counts++;return {data:Object.fromEntries(args.p_deliveries.map(d=>[d.key,7]))}}}
  const result=await new FacultyService({admin:db}).getCourses({role:'teaching_staff',userId:'user',campus_id:'campus'})
  assert.equal(result.courses.length,60);assert.equal(result.courses[0].enrolled_count,7);assert.equal(counts,1)
  assert.ok(tableReads<10)
})

test('six teacher periods require one status batch rather than four reads per period', async () => {
  let queries=0,batches=0
  const entries=Array.from({length:6},(_,i)=>({id:'slot'+i,course_id:'course'+i,campus_id:'host',teacher_id:'teacher',academic_year:'2026-27',semester:1,
    courses:{course_code:'C'+i,title:'Course '+i,semester:1},time_slots:{day_of_week:1,period_number:i+1,start_time:'09:30',end_time:'10:30'}}))
  const db={from(table){let from=0;const q={select(){return q},eq(){return q},or(){return q},order(){return q},range(a){from=a;return q},
    maybeSingle(){queries++;return Promise.resolve({data:{id:'teacher',full_name:'Teacher'}})},
    then(resolve){queries++;return Promise.resolve({data:table==='current_teacher_course_assignments'?entries.map(e=>({course_id:e.course_id,courses:e.courses})):from?[]:entries}).then(resolve)}};return q},
    async rpc(name,args){assert.equal(name,'display_period_status');batches++;assert.equal(args.p_slots.length,6);return {data:Object.fromEntries(args.p_slots.map(s=>[s.id,{total_enrolled:20,present:18,absent:2,is_marked:true,revision:3,revision_token:'three'}]))}}}
  const result=await new PeriodAttendanceService({admin:db},{}).getTeacherSchedule({userId:'teacher',role:'teacher',campus_id:'home',term_version:0},'2026-10-26')
  assert.equal(result.periods.length,6);assert.equal(result.periods[0].total_enrolled,20);assert.equal(result.periods[0].revision,3)
  assert.equal(batches,1);assert.equal(queries,4)
})

test('server response cache separates role, campus and term and force refresh preserves API shape', async () => {
  const cache=serverCache(),interceptor=new DataCacheInterceptor(cache);let loads=0
  const user={userId:'actor',role:'hod',campus_id:'campus',department_id:'dept',term_version:0}
  const req={user,method:'GET',url:'/api/hod/students?semester=1',headers:{}}
  const responseHeaders={};const res={setHeader:(k,v)=>responseHeaders[k]=v}
  const context={switchToHttp:()=>({getRequest:()=>req,getResponse:()=>res})}
  const call=()=>lastValueFrom(interceptor.intercept(context,{handle:()=>of({students:[++loads]})}))
  assert.deepEqual(await call(),{students:[1]});await call();assert.equal(loads,1)
  user.term_version=1;await call();assert.equal(loads,2)
  user.campus_id='other';await call();assert.equal(loads,3)
  req.headers['x-refresh-data']='1';assert.deepEqual(await call(),{students:[4]})
  assert.ok(responseHeaders['X-Data-Updated-At'])
})

test('cached presentation follows deadline and IST checkpoint boundaries without requests', () => {
  const {projectReadData}=require('@fyimp/contracts')
  const morning={date:'2026-10-28',current_time_ist:'09:00:00',active_session:'morning',can_sign_in:false,unavailable_reason:'This session is already recorded.',static_unavailable_reason:null,
    campus:{midday_split:'13:00:00',day_end:'18:00:00'},morning:{state:'completed',signed_in_at:'2026-10-28T03:30:00Z'},evening:{state:'pending',signed_in_at:null}}
  const afternoon=projectReadData('/api/attendance/campus/status/me',morning,Date.parse('2026-10-28T13:01:00+05:30'))
  assert.equal(afternoon.active_session,'evening');assert.equal(afternoon.can_sign_in,true)
  const closed=projectReadData('/api/attendance/campus/status/me',morning,Date.parse('2026-10-28T18:01:00+05:30'))
  assert.equal(closed.can_sign_in,false);assert.equal(closed.evening.state,'absent')
  const nextDay=projectReadData('/api/attendance/campus/status/me',morning,Date.parse('2026-10-29T09:00:00+05:30'))
  assert.equal(nextDay.can_sign_in,false);assert.match(nextDay.unavailable_reason,/Refresh/)
  const value=projectReadData('/api/student/dashboard-summary',{registrationWindow:{isOpen:true,deadline:'2026-10-28T10:00:00Z'}},Date.parse('2026-10-28T10:00:00Z'))
  assert.equal(value.registrationWindow.isOpen,false)
})

test('mobile invalidation covers attendance lists and course details without reloading unrelated courses', () => {
  const { mobileQueryDomains } = sourceModule('mobile/src/lib/data-refresh.ts')
  const attendance = dataChangeDomains('/api/attendance/period/submit')
  const enrollment = dataChangeDomains('/api/registrations/update-slot')
  const affected = (key, changed) => mobileQueryDomains(key).some(domain => changed.includes(domain))
  assert.equal(affected(['student','attendance-list','actor',1],attendance),true)
  assert.equal(affected(['student','course-detail','actor','course',1],enrollment),true)
  assert.equal(affected(['student','courses','actor',1],attendance),false)
})

test('verified campus settings are reused only for covered same-campus display projections', async () => {
  let reads=0
  const network=databaseFetch(async()=>{reads++;return Response.json({academic_year:'database'})})
  await readContext.run({scope:'actor',force:false,pending:new Map(),verifiedCampusSettings:{campus_id:'home',academic_year:'verified'}},async()=>{
    const options={headers:{accept:'application/vnd.pgrst.object+json'}}
    const read=campus=>network('https://db.test/rest/v1/campus_settings?select=academic_year&campus_id=eq.'+campus,options)
    assert.deepEqual(await (await read('home')).json(),{academic_year:'verified'});assert.equal(reads,0)
    assert.deepEqual(await (await read('other')).json(),{academic_year:'database'});assert.equal(reads,1)
    await network('https://db.test/rest/v1/campus_settings?select=missing&campus_id=eq.home',options);assert.equal(reads,2)
  })
})

test('manual publication loads inputs once and retains revision and publication conflict checks', async () => {
  const { ManualTimetableService } = require('../backend/dist/modules/timetable/manual-timetable.service')
  const service = new ManualTimetableService({}); let loads=0
  const loaded={context:{published:false,revision:'current'},manual:{},entries:[]}
  service.load=async()=>{loads++;return loaded}
  await assert.rejects(service.publish({revision:'old'},{}),/inputs changed/)
  assert.equal(loads,1)
  loaded.context.published=true
  await assert.rejects(service.publish({revision:'current'},{}),/Published timetables/)
  assert.equal(loads,2)
})

test('job stream authorizes once, reads Redis progress and closes on completion without database polling', async () => {
  const { EventEmitter } = require('node:events')
  const redisModule = require('../backend/dist/modules/timetable/solver/redisClient')
  const { TimetableService } = require('../backend/dist/modules/timetable/timetable.service')
  const original=redisModule.getRedisClient, env={url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN}
  let databaseReads=0,redisReads=0; const keys=[],chunks=[]
  const service=new TimetableService({}, {}, {})
  service.getJobStatus=async()=>{databaseReads++;return {jobId:'job',status:'running'}}
  const response=new EventEmitter(), finished=deferred()
  Object.assign(response,{setHeader(){},flushHeaders(){},write(value){chunks.push(value)},end(value){if(value)chunks.push(value);finished.resolve()}})
  try {
    process.env.UPSTASH_REDIS_REST_URL='https://fixture.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='fixture'
    redisModule.getRedisClient=()=>({async get(key){keys.push(key);return {jobId:'job',status:++redisReads===1?'running':'completed',progress:redisReads===1?40:100}}})
    const user={role:'campus_director',campus_id:'campus',term_version:2}
    await assert.rejects(service.progress('2026-27',1,'other-job',user,{},response),/outside/)
    databaseReads=0
    await service.progress('2026-27',1,'job',user,{},response)
    await finished.promise
    assert.equal(databaseReads,1);assert.equal(redisReads,2)
    assert.deepEqual([...new Set(keys)],['fyimp:timetable:progress:campus:2:job'])
    assert.match(chunks.join(''),/completed/)
  } finally {
    response.emit('close');redisModule.getRedisClient=original
    for(const [key,value] of [['UPSTASH_REDIS_REST_URL',env.url],['UPSTASH_REDIS_REST_TOKEN',env.token]]) value===undefined?delete process.env[key]:process.env[key]=value
  }
})
