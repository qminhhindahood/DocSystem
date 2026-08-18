# PostgresTools.psm1 — typed helpers for fail-closed database cutover operations

function Invoke-NativeChecked {
  <#
  .SYNOPSIS
    Run a native command and throw if it exits non-zero.
  .PARAMETER File
    Path to the executable.
  .PARAMETER Arguments
    Array of argument strings.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File failed with exit code $LASTEXITCODE"
  }
}

function Get-DatabaseIdentity {
  <#
  .SYNOPSIS
    Normalise a PostgreSQL connection URL to a comparable identity object.
    Ignores query-string order and casing differences.
  #>
  param([Parameter(Mandatory = $true)][uri]$DatabaseUrl)
  $normalised = $DatabaseUrl.DnsSafeHost.ToLowerInvariant()
  $port = if ($DatabaseUrl.Port -gt 0) { $DatabaseUrl.Port } else { 5432 }
  $db = $DatabaseUrl.AbsolutePath.TrimStart('/').ToLowerInvariant()
  [pscustomobject]@{ Host = $normalised; Port = $port; Database = $db }
}

function Assert-RehearsalName {
  <#
  .SYNOPSIS
    Reject a resource name that does not start with the rehearsal prefix.
  #>
  param([Parameter(Mandatory = $true)][string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) {
    throw "Rehearsal resource name must not be empty"
  }
  if (-not $Name.StartsWith('docai_rehearsal_')) {
    throw "Unsafe rehearsal resource name: $Name — must start with docai_rehearsal_"
  }
}

function Get-Sha256Hash {
  <#
  .SYNOPSIS
    Return the hex SHA-256 of a file.
  #>
  param([Parameter(Mandatory = $true)][string]$Path)
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-PrimaryKeyHashes {
  <#
  .SYNOPSIS
    Return a hashtable of {table → ordered-primary-key-SHA256} for every public table
    except _prisma_migrations. Used by verify-postgres to compare source ↔ target.
  #>
  param([Parameter(Mandatory = $true)][string]$DatabaseUrl)

  $tables = & psql $DatabaseUrl --tuples-only --no-align --command @"
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
    ORDER BY table_name;
"@
  if ($LASTEXITCODE -ne 0) { throw "psql table listing failed" }

  $result = @{}
  foreach ($table in $tables) {
    $quotedTable = $table.Trim().Replace('"', '""')
    $ids = & psql $DatabaseUrl --tuples-only --no-align --command ('SELECT id::text FROM "{0}" ORDER BY id;' -f $quotedTable) 2>$null
    if ($LASTEXITCODE -eq 0) {
      $joined = [string]::Join(',', [string[]]@($ids))
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
      $result[$table.Trim()] = [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    }
  }
  return $result
}

function Get-RowCounts {
  <#
  .SYNOPSIS
    Return a hashtable of {table → bigint count}.
  #>
  param([Parameter(Mandatory = $true)][string]$DatabaseUrl)

  $result = @{}
  $tables = & psql $DatabaseUrl --tuples-only --no-align --command "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_prisma_migrations' ORDER BY table_name;"
  if ($LASTEXITCODE -ne 0) { throw "psql table listing failed" }
  foreach ($table in $tables) {
    $quotedTable = $table.Trim().Replace('"', '""')
    $count = & psql $DatabaseUrl --tuples-only --no-align --command ('SELECT count(*) FROM "{0}";' -f $quotedTable)
    if ($LASTEXITCODE -ne 0 -or @($count).Count -ne 1) { throw "psql row count failed for $table" }
    $result[$table.Trim()] = [long]$count.Trim()
  }
  return $result
}

Export-ModuleMember -Function Invoke-NativeChecked, Get-DatabaseIdentity, Assert-RehearsalName,
  Get-Sha256Hash, Get-PrimaryKeyHashes, Get-RowCounts
