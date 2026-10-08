# Daily NSC refresh from this PC: gov.il blocks GitHub's servers, so the GitHub Action can't do it.
# Runs from a Windows scheduled task (see register-nsc-task.ps1); log: %LOCALAPPDATA%\travel-map-nsc.log
$repo = Split-Path $PSScriptRoot
$log = Join-Path $env:LOCALAPPDATA 'travel-map-nsc.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" | Add-Content -Encoding utf8 $log }
function Run-Git { git.exe -C $repo @args 2>&1 | Out-Null; if ($LASTEXITCODE) { throw "git $args failed" } }
$env:GIT_TERMINAL_PROMPT = '0'
# use Git's curl, as when the script is run from Git Bash (gov.il answers 403 to Windows' built-in curl)
$dir = (Get-Item (Get-Command git.exe).Source).Directory
while ($dir -and -not (Test-Path "$($dir.FullName)\mingw64\bin\curl.exe")) { $dir = $dir.Parent }
if ($dir) { $env:PATH = "$($dir.FullName)\mingw64\bin;$env:PATH" }

try {
  if ((git.exe -C $repo branch --show-current) -ne 'main') { Log 'skipped: repo is not on main'; exit 0 }
  Run-Git pull --rebase --autostash --quiet
  Push-Location $repo
  node scripts/update-nsc.mjs 2>&1 | ForEach-Object { Log "  $_" }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code) { throw "update-nsc.mjs exited with $code" }
  git.exe -C $repo diff --quiet -- data/nsc-warnings.json   # exit 1 = changed
  if (-not $LASTEXITCODE) { Log 'no change'; exit 0 }
  # commit only this file, whatever else is staged or edited
  Run-Git commit --quiet -m 'Update NSC warnings' -- data/nsc-warnings.json
  Run-Git push --quiet
  Log 'pushed'
} catch {
  Log "FAILED: $_"
  exit 1
}
