const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const moduleResult={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/core/bulk-upload-result.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{module:moduleResult,exports:moduleResult.exports,Error})
const {bulkUploadResult}=moduleResult.exports
const row=(status,n)=>({row:n,email:`fixture${n}@example.invalid`,status,issues:status==='error'?['Email already registered']:undefined})
for(const [name,statuses,created,errors] of [
  ['all-success',['success','success'],2,0],['mixed',['success','error','success'],2,1],['all-failed',['error'],0,1],['empty',[],0,0],
])test(`bulk upload ${name}: both counts are numeric, including zero and legacy responses`,()=>{
  const result=bulkUploadResult({success:true,results:statuses.map((s,i)=>row(s,i+1))})
  assert.equal(result.inserted_count,created);assert.equal(result.error_count,errors)
  assert.equal(result.results.length,created+errors)
})
test('row outcomes override stale or inconsistent server totals',()=>{
  const result=bulkUploadResult({inserted_count:50,error_count:0,results:[row('error',1)]})
  assert.equal(result.inserted_count,0);assert.equal(result.error_count,1)
  assert.equal(result.results[0].issues[0],'Email already registered')
})
test('an incomplete response is not silently reported as a zero-success upload',()=>{
  for(const result of [null,{}, {results:null},{results:[null]},{results:[{status:'unknown'}]}]) {
    assert.throws(()=>bulkUploadResult(result),/Refresh the student list before retrying/)
  }
})
test('actual result cards render zero and nonzero totals with row errors',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
  const module={exports:{}}
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/dashboard/hod/BulkUploadResults.tsx'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
  }).outputText
  vm.runInNewContext(source,{module,exports:module.exports,require:id=>id.endsWith('.css')?{__esModule:true,default:new Proxy({},{get:(_,key)=>key})}:require(id)})
  for(const statuses of [['error'],['success'],['success','error']]) {
    const result=bulkUploadResult({results:statuses.map((status,i)=>row(status,i+1))})
    const html=renderToStaticMarkup(React.createElement(module.exports.default,{result}))
    assert.match(html,new RegExp(`<p class="resultValue">${result.inserted_count}</p><p class="resultLabel">Created</p>`))
    assert.match(html,new RegExp(`<p class="resultValue">${result.error_count}</p><p class="resultLabel">Errors</p>`))
    assert.doesNotMatch(html,/undefined|NaN/)
    if(result.error_count)assert.match(html,/Email already registered/)
  }
})
