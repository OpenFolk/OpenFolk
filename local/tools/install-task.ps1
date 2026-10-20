<#
.SYNOPSIS
    Starts the openfolk backend at system start, without a Windows sign-in, so a machine woken via Wake-on-LAN
    registers with the relay by itself and its bots are reachable.

.DESCRIPTION
    Creates the task "openfolk local": trigger at system start (30 s delay),
    logon type S4U ("whether the user is signed in or not", without a stored password), normal rights. The task
    calls this script with -Run: it starts the backend (node runs the TypeScript itself, without npm) and, after every exit, again
    30 seconds later.

    The machine name for the relay comes from COMPUTERNAME (e.g. "workstation"), can be overridden with
    MACHINE_NAME in the .env. The Claude CLI in the backend uses the login from %USERPROFILE%\.claude (Claude subscription).

    Log: local\data\local.log (moved to local.log.1 from 2 MB).

    Requirements (-Install checks them itself):
    - npm install has run in the project, Node 22.18 or newer, .env with RELAY_URL and AGENT_TOKEN
    - Claude Code signed in once with the subscription (claude, /login)
    - Create it in a PowerShell as Administrator (S4U needs elevated rights)

.EXAMPLE
    .\install-task.ps1             # status
    .\install-task.ps1 -Install    # as Administrator
    .\install-task.ps1 -Start      # start the task now (runs as at system start)
    .\install-task.ps1 -Stop
    .\install-task.ps1 -Restart    # stop the backend from outside and start it again (if it runs in the task: as Administrator)
    npm run restart -w local       # deploy after changes without admin rights: the backend restarts itself
                                   # as soon as no bot is working (see local/src/restart.ts)
    .\install-task.ps1 -Remove     # as Administrator
    .\install-task.ps1 -Run        # loop, only meant for the task
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Remove,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
$TaskName = 'openfolk local'
$Task = $TaskName
$Project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Local = Join-Path $Project 'local'
$LogDir = Join-Path $Local 'data'
$Log = Join-Path $LogDir 'local.log'
$RetrySeconds = 30

function Write-BotLog([string]$Text) {
    Add-Content -Path $Log -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Text) -Encoding utf8
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $std = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $std) { return $std }
    return $null
}

# Backend processes of this project (in session 0 their command line is not readable without admin rights)
function Get-BotProcess {
    # The backend writes its PID to local\data\backend.pid. Only a node.exe with that id counts, and only if it started
    # before the file was written: after a crash Windows may give the id to another program. Every other node.exe in
    # session 0, whose command line a non-admin cannot read, is left alone.
    $found = @()
    $pidFile = Join-Path $LogDir 'backend.pid'
    if (Test-Path $pidFile) {
        $id = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$id)) {
            $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
            if ($p -and $p.Name -eq 'node.exe' -and $p.CreationDate -le (Get-Item $pidFile).LastWriteTime.AddSeconds(5)) { $found += $p }
        }
    }
    # A backend started in a terminal (npm start) shows its command line
    $found += @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like '*openfolk*' -and $_.CommandLine -like '*index.ts*' -and $_.ProcessId -notin @($found.ProcessId) })
    $found
}

if ($Install) {
    if (-not (Test-Admin)) { throw 'Creating the task needs a PowerShell as Administrator (logon type S4U).' }
    $node = Get-Node
    if (-not $node) { throw 'node.exe not found (install Node 22).' }
    if (-not (Test-Path (Join-Path $Project 'node_modules'))) { throw "node_modules is missing: run 'npm install' in $Project first." }
    if (-not (Test-Path (Join-Path $Project '.env'))) { throw "$Project\.env is missing (template .env.sample)." }
    if (-not (Test-Path (Join-Path $env:USERPROFILE '.claude'))) { throw 'Claude Code is not signed in for this user yet (start claude once, /login).' }
    New-Item -ItemType Directory -Force $LogDir | Out-Null

    $psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Run' -f $PSCommandPath
    $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $psArgs -WorkingDirectory $Local
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT30S'
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 `
        -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description "openfolk backend ($Project) at system start, see local\tools\install-task.ps1" -Force | Out-Null
    Write-Output "Task '$TaskName' created (at system start, without sign-in). Test without a reboot: .\install-task.ps1 -Start"
    return
}

if ($Run) {
    New-Item -ItemType Directory -Force $LogDir | Out-Null
    $node = Get-Node
    while ($true) {
        try {
            if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 2MB) { Move-Item $Log "$Log.1" -Force }
            Write-BotLog "Start backend on $env:COMPUTERNAME ($node)"
            # cmd /c only for the redirect into the log; input from NUL so nothing waits for a question
            $cmdArgs = '/c ""{0}" src\index.ts < NUL >> "{1}" 2>&1"' -f $node, $Log
            $p = Start-Process -FilePath "$env:WINDIR\System32\cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $Local `
                -WindowStyle Hidden -Wait -PassThru
            # Requested restart (npm run restart, local/src/restart.ts): start again right away instead of after 30 s.
            # neustart.schnell is the marker of older backend versions.
            $wait = $RetrySeconds
            foreach ($name in @('restart.fast', 'neustart.schnell')) {
                $fast = Join-Path $LogDir $name
                if (Test-Path $fast) { Remove-Item $fast -Force; $wait = 2 }
            }
            Write-BotLog ("Exit with code {0}; next start in {1} s" -f $p.ExitCode, $wait)
        } catch {
            $wait = $RetrySeconds
            try { Write-BotLog "Error in the loop: $($_.Exception.Message)" } catch { }
        }
        Start-Sleep -Seconds $wait
    }
}

if ($Remove) {
    if (-not (Test-Admin)) { throw 'Removing needs a PowerShell as Administrator.' }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Task '$TaskName' removed."
    }
    return
}

if ($Start) { Start-ScheduledTask -TaskName $Task; Start-Sleep -Seconds 5 }
if ($Stop) {
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    # Stop-ScheduledTask only ends the loop, not node.exe; that runs in session 0 (needs admin).
    foreach ($p in Get-BotProcess) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }
        catch { Write-Warning "PID $($p.ProcessId) not stopped ($($_.Exception.Message)); run -Stop as Administrator." }
    }
}

if ($Restart) {
    # Loops from -Run (task or started hidden) first, otherwise they start node again right away
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -like '*install-task.ps1*-Run*' -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($p in Get-BotProcess) {
        # also stop the wrappers of a backend started in a terminal (npm run local)
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -in @('cmd.exe', 'node.exe') -and $parent.CommandLine -notlike '*index.ts*') {
            Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
    if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
        Start-ScheduledTask -TaskName $Task
    } else {
        $psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Run' -f $PSCommandPath
        Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $psArgs -WorkingDirectory $Local -WindowStyle Hidden
    }
    # Wait until the new backend is connected to the relay ("relay: verbunden" is the log line of older versions)
    $until = (Get-Date).AddSeconds(30)
    $from = if (Test-Path $Log) { (Get-Item $Log).Length } else { 0 }
    do {
        Start-Sleep -Seconds 1
        $fresh = if (Test-Path $Log) { $fs = [IO.File]::Open($Log, 'Open', 'Read', 'ReadWrite'); try { $fs.Seek([Math]::Min($from, $fs.Length), 'Begin') | Out-Null; (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() } } else { '' }
    } until ($fresh -match 'relay: (connected|verbunden)' -or (Get-Date) -gt $until)
    Write-Output $(if ($fresh -match 'relay: (connected|verbunden)') { 'Backend restarted and connected to the relay.' } else { 'Backend started, but not connected to the relay after 30 s (check the log).' })
}

# Status
$taskInfo = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
if ($taskInfo) {
    $info = $taskInfo | Get-ScheduledTaskInfo
    # put the triggers together first: "-join" inside the "-f" list would join all arguments
    $trigger = (@($taskInfo.Triggers) | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task|Trigger', '' }) -join ','
    Write-Output ("Task:      '{5}' {0} ({1}, {2}), last run {3}, result {4}" -f $taskInfo.State, $taskInfo.Principal.LogonType, $trigger, $info.LastRunTime, $info.LastTaskResult, $Task)
} else {
    Write-Output "Task:      not created"
}
$procs = @(Get-BotProcess)
Write-Output ("Backend:   {0}" -f $(if ($procs) { "running (PID $($procs.ProcessId -join ', '))" } else { 'not running' }))
if (Test-Path $Log) { Write-Output "Log (last lines):"; Get-Content $Log -Tail 5 -Encoding utf8 }
