# Supabase function security findings

The supplied advisor report has 11 mutable-search-path findings (10 function
names, including two allocation overloads), 10 execution-permission findings
covering five older backend RPC variants, and one Auth configuration finding.

The backend uses service-role RPC calls with worker fencing tokens. Restricting
those newer signatures did not revoke the default permissions on every older
signature. The new repair enumerates all existing public overloads of the
reported function names, pins `pg_catalog, public, pg_temp`, and restricts the
allocation/timetable workers and promotion RPC to `service_role`. It retains
function bodies, signatures, security modes, owners, trigger attachments and
academic records. The duplicate-slot check helper retains its existing execution
permissions because it is stateless and used in a table constraint.

The repair also removes schema CREATE from browser roles so that the public
schema remains trusted. USAGE and table permissions remain unchanged. Functions
are not dropped, and no job or timetable is restarted or replaced. Absent legacy
variants are skipped. The operation is transactional, repeatable and has a
five-second lock timeout; a lock timeout means retry the entire file after the
blocking operation finishes, rather than recovering or cancelling a job.

Run the whole `APPLY_SECURITY_ADVISOR_REPAIR.sql` file in Supabase SQL Editor as
the database administrator. This is a new repair, not a request to rerun the
older repair bundle. It cannot be applied using the configured API service key.
For every result row with `backend_only = true`, expect:

| Column | Expected |
| --- | --- |
| `anon_can_execute` | `false` |
| `authenticated_can_execute` | `false` |
| `backend_can_execute` | `true` |
| `function_settings` | Includes `search_path=pg_catalog, public, pg_temp` |

Refresh Security Advisor after applying the file. The 21 function findings should
clear; existing application workflows continue through the authenticated backend.
The agent has not applied this SQL to production or invoked production mutation
RPCs to test access.

Leaked-password protection is an Auth dashboard setting, not a SQL function fix.
Enable it in the project's password security settings if available on the current
plan. Supabase documents this feature as available on Pro and above; no upgrade
or purchase is authorized here. This warning may therefore remain on a Free plan.

Sources: [Supabase function permissions](https://supabase.com/docs/guides/database/functions),
[PostgreSQL safe function search paths](https://www.postgresql.org/docs/16/sql-createfunction.html),
[Supabase password security](https://supabase.com/docs/guides/auth/password-security).
