const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite')
const {uuid_ossp}=require('@electric-sql/pglite/contrib/uuid_ossp');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto')
const {keys,removed,compare}=require('./lifecycle-snapshot.cjs')
async function main(){
 if(!process.argv[2])throw new Error('Supply the before-lifecycle application backup filename')
 const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const db=new PGlite({extensions:{'uuid-ossp':uuid_ossp,pgcrypto}})
 try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
 await db.exec(fs.readFileSync('supabase/baseline/schema.sql','utf8'))
 for(const n of fs.readdirSync('supabase/migrations').sort().filter(n=>n>'20261020135038\uffff'))await db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'))
 await db.exec("SET session_replication_role='replica'")
 // Synthetic Auth identities only; this rehearsal cannot restore passwords or prove hosted Auth behaviour.
 for(const id of new Set(JSON.stringify(before.tables).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)||[]))await db.query('INSERT INTO auth.users(id) VALUES($1) ON CONFLICT DO NOTHING',[id])
 for(const table of Object.keys(keys)){
  if(!before.tables[table])throw new Error(`Missing before table ${table}`)
  await db.exec(`DELETE FROM public.${table}`)
  const columns=(await db.query("SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER'",[table])).rows
  const types=new Map(columns.map(c=>[c.column_name,c.udt_name]))
  for(const row of before.tables[table]){
   const fields=Object.keys(row).filter(k=>types.has(k));if(fields.some(k=>!/^[a-z_0-9]+$/.test(k)))throw new Error('Invalid column')
   await db.query(`INSERT INTO public.${table}(${fields.map(k=>'"'+k+'"').join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,fields.map(k=>row[k]!==null&&['json','jsonb'].includes(types.get(k))?JSON.stringify(row[k]):row[k]))
  }
 }
 await db.exec("SET session_replication_role='origin'")
 await db.exec(fs.readFileSync('supabase/changes/semester_lifecycle.sql','utf8'))
 const after={tables:{}}
 for(const [table,order] of Object.entries(keys).filter(([t])=>!removed.includes(t)))after.tables[table]=(await db.query(`SELECT * FROM public.${table} ORDER BY ${order.join(',')}`)).rows
 compare(before,after)
 if((await db.query('SELECT public.production_readiness() AS r')).rows[0].r.ready!==true)throw new Error('Readiness failed')
 console.log('Isolated lifecycle rehearsal passed; every retained application record is unchanged.')
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
