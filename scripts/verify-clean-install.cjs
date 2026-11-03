const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),target=path.join(root,'scratch','review-ci')
fs.mkdirSync(target,{recursive:true})
if(!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep))throw new Error('Clean-install target escaped workspace')
const modules=path.join(target,'node_modules')
if(fs.existsSync(modules)&&!fs.realpathSync(modules).startsWith(fs.realpathSync(target)+path.sep))throw new Error('Unexpected node_modules link outside clean-install target')
for(const name of ['package.json','package-lock.json','backend/package.json','frontend/package.json','mobile/package.json','contracts/package.json',
  'contracts/index.cjs','contracts/index.d.ts','contracts/validation.cjs','contracts/validation.d.ts',
  'vendor/decode-uri-component/package.json','vendor/decode-uri-component/index.cjs','scripts/apply-security-patches.cjs']){
  const destination=path.join(target,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,name),destination)
}
const args=['ci','--no-audit','--no-fund',...(!process.argv.includes('--online')?['--offline']:[])]
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:target,stdio:'inherit',shell:process.platform==='win32'})
if(result.error)throw result.error
process.exitCode=typeof result.status==='number'?result.status:1
