<#
.SYNOPSIS
  Adds drawio-svg-cache to an installed draw.io Desktop on Windows, or removes it again.

.DESCRIPTION
  Current draw.io Desktop no longer loads external plugins, so the script is put inside the application
  archive (resources\app.asar): one <script> line is added to index.html and drawio-svg-cache.js is copied next to it.
  The original archive is kept as app.asar.svgcache.bak. Updating draw.io replaces the archive - run this again afterwards.

  Needs Node.js (npx downloads @electron/asar). Run PowerShell as Administrator if draw.io is installed in Program Files.

.EXAMPLE
  .\patch-desktop.ps1
  .\patch-desktop.ps1 -Restore
  .\patch-desktop.ps1 -AppDir "D:\Apps\draw.io"
#>
param(
  [string]$AppDir,
  [switch]$Restore
)
$ErrorActionPreference = 'Stop'
$marker = 'js/drawio-svg-cache.js'

if (-not $AppDir) {
  $AppDir = @("$env:ProgramFiles\draw.io", "$env:LOCALAPPDATA\Programs\draw.io") |
    Where-Object { Test-Path (Join-Path $_ 'resources\app.asar') } | Select-Object -First 1
  if (-not $AppDir) { throw 'draw.io Desktop not found. Pass the install folder: -AppDir "C:\path\to\draw.io"' }
}
$asar = Join-Path $AppDir 'resources\app.asar'
$bak  = "$asar.svgcache.bak"
if (-not (Test-Path $asar)) { throw "Not found: $asar" }
if (Get-Process -Name 'draw.io' -ErrorAction SilentlyContinue) { throw 'draw.io is running. Close it and run the script again.' }

if ($Restore) {
  if (-not (Test-Path $bak)) { throw "No backup found ($bak) - nothing to restore." }
  Copy-Item $bak $asar -Force
  Remove-Item $bak -Force
  Write-Host "Restored the original $asar"
  exit 0
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js is required (npx not found). Install it from https://nodejs.org and run again.' }
$script = Join-Path $PSScriptRoot 'drawio-svg-cache.user.js'
if (-not (Test-Path $script)) { throw "Not found next to this script: $script" }

$tmp = Join-Path $env:TEMP ('drawio-svg-cache-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $app = Join-Path $tmp 'app'
  & npx --yes '@electron/asar@4.3.1' extract $asar $app
  if ($LASTEXITCODE -ne 0) { throw 'asar extract failed' }

  $web   = Join-Path $app 'drawio\src\main\webapp'
  $index = Join-Path $web 'index.html'
  if (-not (Test-Path $index)) { throw "Unexpected archive layout: $index is missing. This draw.io version is not supported." }

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $html = [System.IO.File]::ReadAllText($index, $utf8)
  $already = $html.Contains($marker)
  if (-not $already) {
    $pos = $html.LastIndexOf('</body>', [System.StringComparison]::OrdinalIgnoreCase)
    if ($pos -lt 0) { throw 'index.html has no </body> - this draw.io version is not supported.' }
    $html = $html.Insert($pos, "<script src=`"$marker`"></script>`r`n")
    [System.IO.File]::WriteAllText($index, $html, $utf8)
  }
  Copy-Item $script (Join-Path $web 'js\drawio-svg-cache.js') -Force

  $out = Join-Path $tmp 'app.asar'
  & npx --yes '@electron/asar@4.3.1' pack $app $out
  if ($LASTEXITCODE -ne 0) { throw 'asar pack failed' }

  # Keep a backup of the untouched archive. If the installed one is already patched, the existing backup stays.
  if (-not $already) { Copy-Item $asar $bak -Force }
  Copy-Item $out $asar -Force
  if ($already) { Write-Host "Updated the script inside $asar" } else { Write-Host "Patched $asar (original saved as $bak)" }
  Write-Host 'Start draw.io. To undo: .\patch-desktop.ps1 -Restore'
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
