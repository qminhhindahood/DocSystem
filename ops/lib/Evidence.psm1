function Resolve-EvidencePath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  $repository = [IO.Path]::GetFullPath($RepositoryRoot)
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $repository '.artifacts/releases'))
  $candidate = if ([IO.Path]::IsPathRooted($Path)) {
    [IO.Path]::GetFullPath($Path)
  } else {
    [IO.Path]::GetFullPath((Join-Path $repository $Path))
  }

  $relativeToAllowed = [IO.Path]::GetRelativePath($allowedRoot, $candidate)
  if ([IO.Path]::IsPathRooted($relativeToAllowed) -or
      $relativeToAllowed -eq '..' -or
      $relativeToAllowed.StartsWith("..$([IO.Path]::DirectorySeparatorChar)",
        [StringComparison]::Ordinal)) {
    throw 'Evidence path is outside .artifacts/releases'
  }

  $relativeToRepository = [IO.Path]::GetRelativePath($repository, $candidate)
  $cursor = $repository
  foreach ($segment in $relativeToRepository.Split(
      [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
      [StringSplitOptions]::RemoveEmptyEntries)) {
    $cursor = Join-Path $cursor $segment
    if ((Test-Path -LiteralPath $cursor) -and
        ((Get-Item -LiteralPath $cursor -Force).Attributes -band
          [IO.FileAttributes]::ReparsePoint)) {
      throw 'Evidence path contains a reparse point'
    }
  }

  return $candidate
}

function Get-EvidenceSha256 {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$LiteralPath)
  return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertTo-CanonicalEvidenceValue {
  param([AllowNull()]$Value)

  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $ordered = [ordered]@{}
    foreach ($key in @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
      $ordered[$key] = ConvertTo-CanonicalEvidenceValue $Value[$key]
    }
    return $ordered
  }
  if ($Value -is [pscustomobject]) {
    $ordered = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties.Name | Sort-Object)) {
      $ordered[$property] = ConvertTo-CanonicalEvidenceValue $Value.$property
    }
    return $ordered
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    return @($Value | ForEach-Object { ConvertTo-CanonicalEvidenceValue $_ })
  }
  return $Value
}

function Write-EvidenceJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$LiteralPath,
    [Parameter(Mandatory)][Collections.IDictionary]$Value
  )

  $repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $safePath = Resolve-EvidencePath $LiteralPath $repositoryRoot
  $parent = Split-Path $safePath -Parent
  New-Item -ItemType Directory -Force $parent | Out-Null
  $canonical = ConvertTo-CanonicalEvidenceValue $Value
  $json = ($canonical | ConvertTo-Json -Depth 50 -Compress) + "`n"
  [IO.File]::WriteAllText($safePath, $json, [Text.UTF8Encoding]::new($false))
}

function Assert-EvidenceContainsNoSecrets {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Directory)

  $patterns = @(
    [regex]::new('postgres(?:ql)?://', 'IgnoreCase,CultureInvariant'),
    [regex]::new('Bearer\s+\S+', 'IgnoreCase,CultureInvariant'),
    [regex]::new('(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{12,}', 'CultureInvariant'),
    [regex]::new('AIza[0-9A-Za-z_-]{20,}', 'CultureInvariant'),
    [regex]::new('-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', 'CultureInvariant')
  )
  $textExtensions = @('.json','.jsonl','.txt','.log','.md','.csv','.xml','.yml','.yaml')
  foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse |
      Where-Object { $_.Extension.ToLowerInvariant() -in $textExtensions }) {
    $reader = [IO.StreamReader]::new($file.FullName, [Text.UTF8Encoding]::new($false), $true)
    try {
      while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ($patterns.Where({ $_.IsMatch($line) }, 'First').Count -gt 0) {
          throw "Evidence contains secret-shaped material: $($file.FullName)"
        }
      }
    } finally {
      $reader.Dispose()
    }
  }
}

function Test-EvidenceFresh {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][datetime]$ObservedAt,
    [Parameter(Mandatory)][datetime]$ValidUntil,
    [Parameter(Mandatory)][datetime]$Now
  )
  return $ObservedAt.Kind -eq [DateTimeKind]::Utc -and
    $ValidUntil.Kind -eq [DateTimeKind]::Utc -and
    $Now.Kind -eq [DateTimeKind]::Utc -and
    $ObservedAt -le $Now -and $Now -lt $ValidUntil
}

Export-ModuleMember -Function Resolve-EvidencePath, Get-EvidenceSha256,
  Write-EvidenceJson, Assert-EvidenceContainsNoSecrets, Test-EvidenceFresh
