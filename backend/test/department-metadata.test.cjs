const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { AdminService } = require('../src/modules/admin/admin.service')
const { HodService } = require('../src/modules/hod/hod.service')
const { AdminController } = require('../src/modules/admin/admin.controller')
const { PGlite } = require('@electric-sql/pglite')
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261019133029_normalize_department_metadata.sql'), 'utf8')
const user = { userId:'admin',role:'superadmin' }, logger = { log:async()=>{} }
test('department endpoint validates campus/department IDs and normalizes code before calling the service',async()=>{
  let received
  const controller=new AdminController({createDepartment:async(...args)=>{received=args},updateDepartment:async(...args)=>{received=args}})
  const id='00000000-0000-4000-8000-000000000001'
  await controller.createDepartment({name:' Physics ',code:' phy ',campus_id:id},user)
  assert.deepEqual(received,['Physics','PHY',id,user])
  await controller.updateDepartment({id,name:' Physics ',code:' phy '},user)
  assert.deepEqual(received,[id,'Physics','PHY',user])
  await assert.rejects(controller.createDepartment({name:'Physics',code:'PHY',campus_id:'invalid'},user),e=>e.getStatus()===400&&/valid campus/.test(e.message))
  await assert.rejects(controller.updateDepartment({id:'invalid',name:'Physics',code:'PHY'},user),e=>e.getStatus()===400&&/Refresh/.test(e.message))
})
function harness(writeError) {
  const rows=[{id:'dept',name:'Information Technology',code:'IT',campus_id:'campus'}]
  const from=table=>{
    let op, value, filters=[]
    const q={
      select(){return q},order(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},
      insert(v){op='insert';value=v;return q},update(v){op='update';value=v;return q},
      async execute(){
        const data=(table==='campuses'?[{id:'campus'}]:rows).filter(r=>filters.every(f=>f(r)))
        if(op && writeError)return {error:writeError,data:null}
        if(op==='insert'){ const r={id:'new',...value};rows.push(r);return {data:[r],error:null} }
        if(op==='update')data.forEach(r=>Object.assign(r,value))
        return {data,error:null}
      },
      then(a,b){return q.execute().then(a,b)},async maybeSingle(){const r=await q.execute();return {...r,data:r.data?.[0]??null}},single(){return q.maybeSingle()},
    };return q
  }
  return {rows,service:new AdminService({admin:{from}},logger,logger)}
}
test('department API normalizes create/edit, excludes self and rejects global name/code collisions',async()=>{
  const {service,rows}=harness()
  await service.updateDepartment('dept',' Information Technology ',' it ',user)
  assert.equal(rows[0].code,'IT');assert.equal(rows[0].name,'Information Technology')
  await assert.rejects(service.createDepartment('Other',' it ','campus',user),e=>e.getStatus()===409&&/code/.test(e.message))
  await assert.rejects(service.createDepartment(' information technology ','NEW','campus',user),e=>e.getStatus()===409&&/named/.test(e.message))
  await service.createDepartment(' Physics ',' phy ','campus',user)
  assert.equal(rows[1].code,'PHY');assert.equal(rows[1].name,'Physics')
  await assert.rejects(service.updateDepartment('new','Other','IT',user),e=>e.getStatus()===409)
  await assert.rejects(service.updateDepartment('new','information technology','NEW',user),e=>e.getStatus()===409)
})
test('department API returns useful errors for missing campuses/records and concurrent database conflicts',async()=>{
  await assert.rejects(harness().service.createDepartment('Other','OTHER','missing',user),e=>e.getStatus()===400&&/campus/.test(e.message))
  await assert.rejects(harness().service.updateDepartment('missing','Other','OTHER',user),e=>e.getStatus()===404)
  for(const field of ['name','code']) {
    const {service}=harness({code:'23505',message:`violates departments_${field}_normalized_key`})
    await assert.rejects(service.createDepartment('Other','OTHER','campus',user),e=>e.getStatus()===409&&/already/.test(e.message))
    await assert.rejects(service.updateDepartment('dept','Other','OTHER',user),e=>e.getStatus()===409&&/already/.test(e.message))
  }
})
test('both HOD catalogue query branches order by course_code then id',async()=>{
  for(const own of [true,false]) {
    const orders=[]
    const admin={from(table){const q={select(){return q},eq(){return q},or(){return q},order(column){if(table==='courses')orders.push(column);return q},then(a,b){return Promise.resolve({data:[],error:null}).then(a,b)}};return q}}
    await new HodService({admin},logger,logger).getCourses(4,{department_id:'dept',campus_id:'campus'},own)
    assert.deepEqual(orders,['course_code','id'])
  }
})
const setup = `CREATE TABLE campuses(id uuid PRIMARY KEY); CREATE TABLE departments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE NOT NULL,code text UNIQUE NOT NULL,campus_id uuid REFERENCES campuses(id));
INSERT INTO campuses VALUES ('00000000-0000-4000-8000-000000000001');`
test('database normalization protects direct and concurrent writes while preserving campus sharing and IDs',async()=>{
  const db=new PGlite()
  try {
    await db.exec(setup)
    await db.exec(`INSERT INTO departments(name,code,campus_id) VALUES('Information Technology','IT','00000000-0000-4000-8000-000000000001')`)
    const before=(await db.query('SELECT id,campus_id FROM departments')).rows[0]
    await db.transaction(tx=>tx.exec(migration))
    assert.deepEqual((await db.query('SELECT id,campus_id FROM departments')).rows[0],before)
    await db.exec(`INSERT INTO departments(name,code,campus_id) VALUES(' Physics ',' phy ','00000000-0000-4000-8000-000000000001')`)
    assert.deepEqual((await db.query(`SELECT name,code FROM departments WHERE code='PHY'`)).rows[0],{name:'Physics',code:'PHY'})
    for(const [name,code] of [['Other',' it '],[' information technology ','OTHER']]) {
      await assert.rejects(db.query('INSERT INTO departments(name,code) VALUES($1,$2)',[name,code]),e=>e.code==='23505')
    }
    await db.exec(`UPDATE departments SET code=' it ',name=' Information Technology ' WHERE code='IT'`)
    await assert.rejects(db.exec(`UPDATE departments SET name='information technology' WHERE code='PHY'`),e=>e.code==='23505')
    await assert.rejects(db.exec(`INSERT INTO departments(name,code) VALUES(' ','EMPTY')`),e=>e.code==='23514')
    const parallel=await Promise.allSettled([db.exec(`INSERT INTO departments(name,code) VALUES('First','NEW')`),db.exec(`INSERT INTO departments(name,code) VALUES('Second',' new ')`)])
    assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(parallel.find(r=>r.status==='rejected').reason.code,'23505')
  } finally {await db.close()}
})
test('migration stops on normalized collisions or unreviewed code changes',async()=>{
  for(const insert of ["('One','IT'),('Two','it')","('One',' it ')","('Name','A'),(' name ','B')"]) {
    const db=new PGlite()
    try {
      await db.exec(setup+`INSERT INTO departments(name,code) VALUES ${insert};`)
      const before=(await db.query('SELECT * FROM departments ORDER BY id')).rows
      await assert.rejects(db.transaction(tx=>tx.exec(migration)),/collide|reference migration/)
      assert.deepEqual((await db.query('SELECT * FROM departments ORDER BY id')).rows,before)
    } finally {await db.close()}
  }
})
