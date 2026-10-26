const fs=require('node:fs');const {createClient}=require('@supabase/supabase-js');const {snapshot,compare}=require('./lifecycle-snapshot.cjs')
async function main(){
 if(!process.argv[2])throw new Error('Supply the before-lifecycle backup filename')
 const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 compare(before,await snapshot(db,'after'))
 const {data,error}=await db.rpc('production_readiness')
 if(error||data?.ready!==true)throw new Error('Lifecycle database is not ready')
 console.log('Retained records match the pre-release export; lifecycle readiness passed.')
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
