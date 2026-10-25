const quote = value => '"' + value.replaceAll('"', '""') + '"'
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"

// Input is pg_catalog metadata only. No account or business rows are exported.
function renderBaseline(catalog) {
  if (catalog.types?.length || catalog.sequences?.length) throw new Error('Review exporter support before adding custom types or sequences')
  const sql = [
    '-- Application schema snapshot, 2026-10-22. Restore into a fresh Supabase database as postgres.',
    '-- Historical migrations through 20261020135038 are already represented; do not replay them.',
    '-- This contains schema and migration receipts only. Account/business backups are separate.',
    'BEGIN;', 'SET LOCAL check_function_bodies = false;',
    'CREATE SCHEMA IF NOT EXISTS extensions;',
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
    'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
  ]
  for (const table of catalog.tables) {
    sql.push(`CREATE TABLE public.${quote(table.name)} (\n${table.columns.map(column => {
      const generated = column.generated ? ` GENERATED ALWAYS AS (${column.default}) STORED` : ''
      if (column.identity) throw new Error('Identity export requires explicit sequence handling')
      return `  ${quote(column.name)} ${column.type}${generated}${column.notnull ? ' NOT NULL' : ''}`
    }).join(',\n')}\n);`)
  }
  for (const fn of catalog.functions) sql.push(fn.definition.trim().replace(/;?$/, ';'))
  for (const table of catalog.tables) for (const column of table.columns) {
    if (column.default && !column.generated) sql.push(`ALTER TABLE public.${quote(table.name)} ALTER COLUMN ${quote(column.name)} SET DEFAULT ${column.default};`)
  }
  for (const constraint of catalog.constraints.filter(c => ['p', 'u'].includes(c.type))) {
    sql.push(`ALTER TABLE public.${quote(constraint.table)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition};`)
  }
  for (const index of catalog.indexes) sql.push(index.definition + ';')
  for (const constraint of catalog.constraints.filter(c => !['p', 'u'].includes(c.type))) {
    sql.push(`ALTER TABLE public.${quote(constraint.table)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition};`)
  }
  for (const view of catalog.views) sql.push(`CREATE VIEW public.${quote(view.name)} WITH (security_invoker=true) AS\n${view.definition.trim().replace(/;?$/, ';')}`)
  for (const trigger of catalog.triggers) sql.push(trigger + ';')
  for (const table of catalog.tables) if (table.rls) sql.push(`ALTER TABLE public.${quote(table.name)} ENABLE ROW LEVEL SECURITY;`)
  for (const policy of catalog.policies) {
    const commands = { '*': 'ALL', r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' }
    sql.push(`CREATE POLICY ${quote(policy.name)} ON public.${quote(policy.table)} AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${commands[policy.command]} TO ${policy.roles.map(quote).join(', ')}${policy.using ? ` USING (${policy.using})` : ''}${policy.check ? ` WITH CHECK (${policy.check})` : ''};`)
  }
  for (const receipt of catalog.receipts) sql.push(`INSERT INTO public.schema_migrations (version,name) VALUES (${literal(receipt.version)},${literal(receipt.name)});`)
  sql.push(
    'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;',
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;',
    'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;',
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;',
    'GRANT USAGE ON SCHEMA public TO service_role;',
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;',
    'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;',
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;',
    "NOTIFY pgrst, 'reload schema';", 'COMMIT;', '',
  )
  return sql.join('\n\n')
}
module.exports = { renderBaseline }
if (require.main === module) {
  const fs = require('node:fs')
  process.stdout.write(renderBaseline(JSON.parse(fs.readFileSync(0, 'utf8'))))
}
