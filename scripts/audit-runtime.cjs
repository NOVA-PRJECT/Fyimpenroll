// npm's workspace audit can include shared lock entries that npm ls marks as
// extraneous (for example, another workspace's build tools). Gate the installed
// runtime dependency graph; report the excluded findings explicitly.
const {spawnSync}=require('node:child_process')
const path=require('node:path'),fs=require('node:fs')
const workspace=process.argv[2]
if(!['backend','frontend'].includes(workspace))throw Error('Select backend or frontend')
function npm(args) {
  const result=spawnSync(`npm ${args}`,{encoding:'utf8',shell:true,maxBuffer:32*1024*1024,windowsHide:true})
  if(result.error)throw result.error
  try{return JSON.parse(result.stdout)}catch{throw Error('npm did not return a valid dependency report: '+result.stderr)}
}
const graph=npm(`ls --omit=dev --all --long --json --workspace=${workspace}`)
const problems=(graph.problems||[]).filter(problem=>!problem.startsWith('extraneous:'))
if(problems.length)throw Error('Runtime dependency graph is invalid: '+problems.join('; '))
const runtime=new Set(),root=fs.realpathSync(process.cwd())
function visit(node) {
  if(node.extraneous)return
  if(node.path) {
    const resolved=fs.realpathSync(node.path)
    if(resolved!==root && !resolved.startsWith(root+path.sep))throw Error('Runtime dependency resolved outside the deployment artifact')
    runtime.add(path.relative(root,resolved).split(path.sep).join('/'))
  }
  for(const dependency of Object.values(node.dependencies||{}))visit(dependency)
}
visit(graph)
const audit=npm(`audit --omit=dev --json --workspace=${workspace}`)
if(audit.error || !audit.vulnerabilities)throw Error('Security advisory query failed')
const findings=[],excluded=[]
for(const [name,finding] of Object.entries(audit.vulnerabilities)) {
  const affected=(finding.nodes||[]).filter(node=>runtime.has(node.replaceAll('\\','/')))
  if(affected.length)findings.push({name,severity:finding.severity,paths:affected})
  else excluded.push(name)
}
console.log(JSON.stringify({workspace,runtimePackages:runtime.size,runtimeFindings:findings,excludedNonRuntimeFindings:excluded},null,2))
if(findings.some(finding=>['moderate','high','critical'].includes(finding.severity)))process.exitCode=1
