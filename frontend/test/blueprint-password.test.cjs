const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
function load(name) {
  const filename=path.resolve(__dirname,'../src/core',name+'.ts'),module={exports:{}}
  const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(source,{module,exports:module.exports,Error,require:id=>id.startsWith('.')?load(path.relative(path.resolve(__dirname,'../src/core'),path.resolve(path.dirname(filename),id))):require(id)})
  return module.exports
}
test('blueprint pickers group own department first and sort each group without mutating input',()=>{
  const {groupBlueprintCourses}=load('blueprint-options')
  const rows=[{id:'a',course_code:'AOTHER',is_own_dept:false},{id:'z',course_code:'ZOWN',is_own_dept:true},{id:'b',course_code:'BOWN',is_own_dept:true}]
  const groups=groupBlueprintCourses(rows)
  assert.equal(groups.map(g=>g.label).join(','),'Own department,Other departments')
  assert.equal(groups[0].courses.map(r=>r.course_code).join(','),'BOWN,ZOWN')
  assert.equal(groups[1].courses[0].id,'a');assert.equal(rows[0].id,'a')
  assert.equal(groupBlueprintCourses([]).length,0)
  assert.equal(groupBlueprintCourses([rows[0]])[0].label,'Other departments')
  assert.equal(groupBlueprintCourses([rows[1]])[0].label,'Own department')
})
test('global basket categories prioritize MDC/AEC/VAC/SEC, exclude DSC/DSE, and retain all other categories',()=>{
  const categories=load('blueprint-options').GLOBAL_BASKET_CATEGORIES
  assert.equal(categories.slice(0,4).join(','),'MDC,AEC,VAC,SEC')
  assert.equal(categories.includes('DSC'),false);assert.equal(categories.includes('DSE'),false)
  const allowed=require('@fyimp/contracts').HOD_COURSE_CATEGORIES.filter(c=>!['DSC','DSE'].includes(c))
  assert.equal([...categories].sort().join(','),[...allowed].sort().join(','))
  assert.equal(new Set(categories).size,categories.length)
})
test('change password errors show explanations instead of HTTP labels, with field attribution',()=>{
  const {passwordChangeError}=load('validation/passwordChangeErrors')
  const current=passwordChangeError({error:'Bad Request',message:'Current password is incorrect'},400)
  assert.equal(current.message,'Current password is incorrect');assert.equal(current.field,'current_password')
  for(const code of ['PASSWORD_UNCHANGED','PASSWORD_TOO_WEAK','NEW_PASSWORD_REJECTED']) {
    const result=passwordChangeError({code,message:'Choose a different password'},400)
    assert.equal(result.field,'new_password');assert.equal(result.message,'Choose a different password')
  }
  assert.match(passwordChangeError(null,429).message,/Wait a few minutes/)
  assert.match(passwordChangeError(null,401).message,/Sign in again/)
  assert.match(passwordChangeError(null,503).message,/temporarily unavailable/)
  assert.match(passwordChangeError({message:'internal provider details'},500).message,/Unable to update/)
  assert.equal(passwordChangeError(null,502).field,undefined)
})
