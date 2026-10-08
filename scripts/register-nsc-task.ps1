# Registers the daily NSC update as a Windows scheduled task for the current user (no admin needed).
# Runs every day at 08:00; if the PC was off, it runs as soon as it's on and online.
# Remove with: Unregister-ScheduledTask -TaskName 'travel-map NSC update' -Confirm:$false
$script = Join-Path $PSScriptRoot 'update-nsc-local.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 08:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'travel-map NSC update' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Refreshes data/nsc-warnings.json from gov.il and pushes it to GitHub (travel-map)' -Force
