# ConversionImageContext.Tests.ps1 — container context safety for the conversion image.
#
# The conversion service builds from the REPO ROOT context (docker-compose.yml:
# context: ., dockerfile: conversion-service/Dockerfile). Without a root
# .dockerignore, COPY conversion-service/ bakes the virtualenv, the runtime
# work directory, caches, tests, and local files into the image. These
# contracts lock the remediation (comprehensive review, 2026-08-28): a root
# .dockerignore keeps runtime work, virtual environments, caches, test
# outputs, local env files, and repo metadata out of the context, and the
# Dockerfile copies only the Python source, runtime requirements, and shared
# typography required at runtime.

Describe 'Conversion image context safety' {
  BeforeAll {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $dockerignorePath = Join-Path $root '.dockerignore'
    $dockerfilePath = Join-Path $root 'conversion-service/Dockerfile'
  }

  It 'ships a root .dockerignore for the repo-root conversion build context' {
    Test-Path -LiteralPath $dockerignorePath | Should -BeTrue
  }

  It 'excludes runtime work, virtual environments, caches, env files, and repo metadata' {
    $rules = Get-Content -LiteralPath $dockerignorePath -Raw
    foreach ($fragment in @(
        'conversion-service/work',
        '.venv',
        'node_modules',
        '__pycache__',
        '.pytest_cache',
        '.env',
        '.git'
      )) {
      $rules | Should -Match ([regex]::Escape($fragment)) -Because "'$fragment' must never enter an image build context"
    }
  }

  It 'never copies the whole service tree into the conversion image' {
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    $dockerfile | Should -Not -Match '(?m)^COPY conversion-service/\s' -Because 'a catch-all COPY drags .venv, work/, tests, and caches into the image'
  }

  It 'copies only runtime inputs: requirements, top-level modules, runtime packages, shared typography' {
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    $dockerfile | Should -Match '(?m)^COPY conversion-service/requirements\.txt\s'
    $dockerfile | Should -Match '(?m)^COPY conversion-service/\*\.py\s'
    foreach ($package in @('assembly', 'ingest', 'render', 'rules', 'schema', 'structuring', 'triage', 'vision')) {
      $dockerfile | Should -Match "(?m)^COPY conversion-service/$package/ " -Because "runtime package '$package' must be copied explicitly"
    }
    $dockerfile | Should -Match '(?m)^COPY shared/ '
  }

  It 'keeps non-runtime trees out of the conversion image copies' {
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    foreach ($nonRuntime in @('tests', 'eval', 'scripts', 'requirements-dev')) {
      $dockerfile | Should -Not -Match "(?m)^COPY conversion-service/$nonRuntime" -Because "'$nonRuntime' is not needed at runtime"
    }
  }
}
