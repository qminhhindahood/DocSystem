# test-conversion-image.ps1 — container contract for the conversion image.
#
# Fails when the image ships build-time content: /app/work must be empty,
# /app/.venv must not exist, and the test/eval/scripts trees, Python caches,
# and dev requirements must never be copied in (comprehensive review
# remediation, 2026-08-28). Run after building the image:
#
#   docker build -f conversion-service/Dockerfile -t standalone/conversion:latest .
#   ./ops/test-conversion-image.ps1 [-Image standalone/conversion:latest]

param(
  [string]$Image = 'standalone/conversion:latest'
)

$ErrorActionPreference = 'Stop'

$probe = @'
import os, sys

failures = []

work = "/app/work"
if not os.path.isdir(work):
    failures.append("/app/work missing (runtime work dir must exist)")
else:
    leftovers = sorted(os.listdir(work))
    if leftovers:
        failures.append("/app/work contains build-time files: " + repr(leftovers))

if os.path.exists("/app/.venv"):
    failures.append("/app/.venv present (virtualenv baked into the image)")

for banned in ("/app/tests", "/app/eval", "/app/scripts", "/app/requirements-dev.txt"):
    if os.path.exists(banned):
        failures.append(banned + " present (non-runtime content shipped)")

pycache = []
for root, dirs, _files in os.walk("/app"):
    if "__pycache__" in dirs:
        pycache.append(os.path.join(root, "__pycache__"))
if pycache:
    failures.append("__pycache__ shipped: " + repr(pycache[:5]))

# Runtime inputs must be present.
for required in ("/app/main.py", "/app/worker.py", "/app/pipeline.py", "/shared/decree30-typography.json"):
    if not os.path.exists(required):
        failures.append("required runtime input missing: " + required)

if failures:
    print("IMAGE CONTENT: FAIL")
    for failure in failures:
        print("  -", failure)
    sys.exit(1)
print("IMAGE CONTENT: PASS — no work files, no .venv, no caches, no local files")
'@

$probeFile = Join-Path ([System.IO.Path]::GetTempPath()) ("conversion-image-probe-" + [guid]::NewGuid().ToString('N') + ".py")
Set-Content -LiteralPath $probeFile -Value $probe -Encoding utf8
try {
  docker run --rm --entrypoint python -v "${probeFile}:/probe.py:ro" $Image /probe.py
  if ($LASTEXITCODE -ne 0) { throw "Conversion image content contract failed for $Image" }
} finally {
  Remove-Item -LiteralPath $probeFile -ErrorAction SilentlyContinue
}

Write-Output 'Conversion image content contract passed.'
