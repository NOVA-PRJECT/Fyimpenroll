// Read-only application export. Auth and Storage require a separate recovery backup.
const fs=require('node:fs');const path=require('node:path');const {createClient}=require('@supabase/supabase-js')
const {snapshot}=require('./lifecycle-snapshot.cjs')
async function main(){
 const [output,stage='before']=process.argv.slice(2)
 if(!output)throw new Error('Supply a new ignored backup filename and before|after stage')
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const first=await snapshot(db,stage),second=await snapshot(db,stage)
 if(JSON.stringify(first.fingerprints)!==JSON.stringify(second.fingerprints))throw new Error('Writes detected; pause writes and repeat the export')
 const backup={...first,exported_at:new Date().toISOString()};const file=path.resolve(output)
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(backup,null,2)+'\n',{flag:'wx',mode:0o600})
 if(JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8')))!==JSON.stringify(backup))throw new Error('Backup read-back mismatch')
 console.log(`Verified ${stage} export of ${Object.keys(first.tables).length} application tables. Auth and Storage are separate.`)
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
