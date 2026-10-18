[CmdletBinding()]
param([switch]$CheckPrerequisites)

# Backup only. This script never restores, cleans up, or modifies database rows.
# It follows the official Supabase CLI roles/schema/data export procedure.
$ErrorActionPreference = 'Stop'
$projectRef = 'lhnjlwtdphugjaluzrsp'
$cliCommand = Get-Command supabase -ErrorAction SilentlyContinue
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$readiness = [ordered]@{
    supabase_cli_available = [bool]$cliCommand
    docker_available = [bool]$dockerCommand
    database_url_in_environment = [bool]$env:SUPABASE_DB_URL
    database_password_is_not_the_service_api_key = $true
}
if ($CheckPrerequisites) {
    $readiness | ConvertTo-Json
    return
}
if (-not $cliCommand -or -not $dockerCommand) {
    throw 'Install Supabase CLI and Docker Desktop, start Docker, then run this script again. See MANUAL_BACKUP.md.'
}

function Invoke-CapturedCommand {
    param([string]$Executable, [string[]]$CommandArguments, [string]$FailureMessage)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = (& $Executable @CommandArguments 2>&1 | Out-String)
        $nativeCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($nativeCode -ne 0) {
        # Native errors may contain the connection URL. Never echo them.
        throw $FailureMessage
    }
    return $captured
}

$null = Invoke-CapturedCommand $cliCommand.Source @('--help') 'Supabase CLI is unavailable.'
$dumpHelp = Invoke-CapturedCommand $cliCommand.Source @('db', 'dump', '--help') 'Cannot discover the installed dump command.'
foreach ($flag in @('--db-url', '--file', '--role-only', '--data-only', '--use-copy', '--exclude')) {
    if (-not $dumpHelp.Contains($flag)) { throw 'The installed CLI does not support the documented backup flags. Update it before continuing.' }
}
$null = Invoke-CapturedCommand $dockerCommand.Source @('info') 'Docker is not running or is inaccessible.'

$connectionString = $env:SUPABASE_DB_URL
if (-not $connectionString) {
    $secureConnection = Read-Host 'Paste the full Session pooler database URI with its database password (input hidden)' -AsSecureString
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConnection)
    try { $connectionString = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }
}
try {
    $databaseUri = [Uri]$connectionString
    if ($databaseUri.Scheme -notin @('postgres', 'postgresql')) { throw 'Invalid URI' }
    $userAndPassword = $databaseUri.UserInfo -split ':', 2
    if ($userAndPassword.Count -ne 2 -or [string]::IsNullOrWhiteSpace($userAndPassword[1])) { throw 'Missing database password' }
    $databaseUser = [Uri]::UnescapeDataString($userAndPassword[0])
    $directProject = $databaseUri.Host -eq "db.$projectRef.supabase.co" -and $databaseUser -in @('postgres', "postgres.$projectRef")
    $sessionPooler = $databaseUri.Host.EndsWith('.pooler.supabase.com') -and $databaseUser -eq "postgres.$projectRef"
    if (-not ($directProject -or $sessionPooler) -or $databaseUri.Port -ne 5432 -or $databaseUri.AbsolutePath -ne '/postgres') { throw 'Unexpected project or connection mode' }
    if ($connectionString.Contains('[YOUR-PASSWORD]') -or $connectionString.Contains('[password]')) { throw 'Replace the placeholder locally' }
} catch {
    $connectionString = $null
    throw 'Use the actual Connect > Session pooler URI for project lhnjlwtdphugjaluzrsp, port 5432, database postgres, with a URL-encoded database password. Do not use the transaction pooler or API service key.'
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$backupParent = Join-Path $repoRoot 'scratch/mangat-replica-2026-10-18/manual-backups'
$backupPath = Join-Path $backupParent ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
$null = New-Item -ItemType Directory -Path $backupPath
$rolesFile = Join-Path $backupPath 'roles.sql'
$schemaFile = Join-Path $backupPath 'schema.sql'
$dataFile = Join-Path $backupPath 'data.sql'

try {
    Write-Host 'Exporting roles...'
    $null = Invoke-CapturedCommand $cliCommand.Source @('db', 'dump', '--db-url', $connectionString, '--file', $rolesFile, '--role-only') 'Roles export failed. No cleanup was performed.'
    Write-Host 'Exporting schema...'
    $null = Invoke-CapturedCommand $cliCommand.Source @('db', 'dump', '--db-url', $connectionString, '--file', $schemaFile) 'Schema export failed. No cleanup was performed.'
    Write-Host 'Exporting data, including Auth...'
    $null = Invoke-CapturedCommand $cliCommand.Source @('db', 'dump', '--db-url', $connectionString, '--file', $dataFile, '--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes') 'Data export failed. No cleanup was performed.'

    foreach ($dumpFile in @($rolesFile, $schemaFile, $dataFile)) {
        if (-not (Test-Path -LiteralPath $dumpFile) -or (Get-Item -LiteralPath $dumpFile).Length -eq 0) {
            throw 'An expected dump file is missing or empty. Backup remains unverified.'
        }
    }
    foreach ($table in @('auth.users', 'auth.identities', 'public.students', 'public.faculty', 'public.courses', 'public.timetable_entries')) {
        $parts = $table.Split('.')
        $pattern = '(?m)^COPY\s+"?' + [Regex]::Escape($parts[0]) + '"?\."?' + [Regex]::Escape($parts[1]) + '"?\s*\('
        if (-not (Select-String -LiteralPath $dataFile -Pattern $pattern -Quiet)) {
            throw "Required COPY section is missing: $table. Backup remains unverified."
        }
    }
    $hashes = [ordered]@{}
    foreach ($dumpFile in @($rolesFile, $schemaFile, $dataFile)) {
        $hashes[[IO.Path]::GetFileName($dumpFile)] = [ordered]@{
            bytes = (Get-Item -LiteralPath $dumpFile).Length
            sha256 = (Get-FileHash -LiteralPath $dumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $report = [ordered]@{
        status = 'DUMP_CREATED_INTEGRITY_CHECKED_RESTORE_NOT_TESTED'
        project_ref = $projectRef
        completed_at = [DateTime]::UtcNow.ToString('o')
        files = $hashes
        includes_auth_users_and_identities = $true
        storage_objects_exported = $false
        restore_test_performed = $false
        cleanup_authorized = $false
        production_rows_modified = $false
        note = 'Three separate dumps follow the official procedure. Avoid schema changes during export. Verify a restore in a separate disposable Supabase project before declaring recovery proven. Keep files private; Auth password hashes are included.'
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupPath 'BACKUP_REPORT.json') -Encoding UTF8
    Write-Host "Backup files created in: $backupPath"
    Write-Host 'Required next: verify restoration separately. This script did not authorize or perform cleanup.'
} finally {
    $connectionString = $null
    $databaseUri = $null
    $userAndPassword = $null
}

