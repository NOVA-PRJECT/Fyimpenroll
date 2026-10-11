const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net')
const {spawnSync}=require('node:child_process')
async function main() {
  if(!process.env.POSTGRES_BIN)throw Error('Set POSTGRES_BIN to a PostgreSQL bin directory. No production database is used.')
  const bin=path.resolve(process.env.POSTGRES_BIN),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fyimp-pg-test-')),data=path.join(dir,'data')
  const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,PRODUCTION_SQL_TEST_URL:`postgres://fyimp_test@127.0.0.1:${port}/fyimp_test`}
  function run(name,args) {
    const exe=name==='node'?process.execPath:path.join(bin,name+(process.platform==='win32'?'.exe':''))
    const result=spawnSync(exe,args,{env,stdio:'inherit',windowsHide:true,timeout:180000})
    if(result.error||result.status!==0)throw result.error||Error(`${name} exited ${result.status}`)
  }
  let started=false
  try {
    run('initdb',['-D',data,'-U','fyimp_test','-A','trust','--no-locale','--encoding=UTF8'])
    run('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);started=true
    run('createdb',['-h','127.0.0.1','-p',String(port),'-U','fyimp_test','fyimp_test'])
    run('node',['--test','backend/test/production-timetable-transactions.test.js'])
  } finally {
    if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop'])
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
