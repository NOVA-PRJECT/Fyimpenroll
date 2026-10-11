const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'implementation-handoffs/production-audit')
const names=[
 '20261010040000_followup_plan08_recoverable_graduation_and_retention.sql',
 '20261010050000_followup_plan08_durable_graduation_recovery.sql',
 '20261010060000_followup_plan09_registration_snapshots.sql',
 '20261010070000_followup_plan10_attendance_rpc_privileges.sql',
 '20261010080000_production_timetable_transactions.sql',
 '20261010090000_production_attendance_summary.sql',
 '20261010100000_production_allocation_fencing_and_clocks.sql',
]
let sql=fs.readFileSync(path.join(dir,'sql-preflight.sql'),'utf8')
const inventory=[]
for(const [i,name] of names.entries()){
 const original=fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8')
 const body=original.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
 const version=name.slice(0,-4),delimiter='$migration_'+i+'$'
 if(body.includes(delimiter))throw Error('SQL delimiter collision')
 sql+=`\nDO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='${version}') THEN
  EXECUTE ${delimiter}
${body}
${delimiter};
 END IF;
END $apply$;
`
 inventory.push({file:name,sha256:crypto.createHash('sha256').update(original).digest('hex')})
}
sql+="\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\nSELECT public.production_readiness() AS readiness;\nSELECT version,name FROM public.schema_migrations WHERE version LIKE '20261010%' ORDER BY version;\n"
fs.writeFileSync(path.join(dir,'APPLY_PENDING_WEB_REPAIRS.sql'),sql)
fs.writeFileSync(path.join(dir,'SQL_BUNDLE_MANIFEST.json'),JSON.stringify(inventory,null,2)+'\n')
console.log('Prepared '+names.length+' forward repairs in one guarded transaction.')
