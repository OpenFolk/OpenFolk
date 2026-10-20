<#
.SYNOPSIS
    Runs the desktop app's backend at system start, without a Windows sign-in, so a machine woken for a routine
    reports to the relay by itself. The desktop app calls it (tray menu, "Run without signing in").

.DESCRIPTION
    -Install (as Administrator, the app asks through UAC): creates the task for -User, trigger at system start (30 s
    delay), logon type S4U with normal rights, and starts it. The task calls this script with -Run.
    -Remove (as Administrator): stops the task and its backend and removes it.
    -Run: the loop of the task. Starts the backend of the app (its Electron as Node, ELECTRON_RUN_AS_NODE) with the
    profile's .env and data folder, and after every exit again; after a requested restart (restart.fast) at once.

    The script lies in the app's installation folder, which only administrators can change; the app never runs a
    script from the profile with elevated rights.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Remove,
    [switch]$Run,
    [string]$Exe,
    [string]$Root,
    [string]$UserData,
    [string]$User,
    [string]$TaskName,
    [string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$Data = Join-Path $UserData 'data'
$Log = Join-Path $Data 'local.log'
$RetrySeconds = 30

function Write-Result([bool]$Ok, [string]$Message) {
    if ($ResultFile) { @{ ok = $Ok; message = $Message } | ConvertTo-Json -Compress | Set-Content -Path $ResultFile -Encoding utf8 }
}

function Stop-Backend {
    # The backend writes its PID to data\backend.pid; only that process counts, and only if it started before the file
    # was written (after a crash Windows may give the id to another program)
    $pidFile = Join-Path $Data 'backend.pid'
    if (-not (Test-Path $pidFile)) { return }
    $id = 0
    if (-not [int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$id)) { return }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    if ($p -and $p.CreationDate -le (Get-Item $pidFile).LastWriteTime.AddSeconds(5)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

if ($Install) {
    try {
        foreach ($v in @($Exe, $Root, $UserData, $User, $TaskName)) { if (-not $v) { throw 'Missing parameter.' } }
        $psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Run -Exe "{1}" -Root "{2}" -UserData "{3}"' -f $PSCommandPath, $Exe, $Root, $UserData
        $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $psArgs -WorkingDirectory $Root
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $trigger.Delay = 'PT30S'
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 `
            -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
            -Description 'OpenFolk backend of the desktop app at system start, without sign-in (desktop\task.ps1)' -Force | Out-Null
        Start-ScheduledTask -TaskName $TaskName
        Write-Result $true ''
    } catch {
        Write-Result $false $_.Exception.Message
        exit 1
    }
    return
}

if ($Remove) {
    try {
        if ($TaskName -and (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
            # Ending the task ends its loop; the backend it started runs on, in session 0
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            Stop-Backend
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        }
        Write-Result $true ''
    } catch {
        Write-Result $false $_.Exception.Message
        exit 1
    }
    return
}

if ($Run) {
    New-Item -ItemType Directory -Force $Data | Out-Null
    # The settings come from the profile's .env, as in the app (desktop\backend.js), not from the user's environment
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:OPENFOLK_ENV_FILE = Join-Path $UserData '.env'
    $env:DATA_DIR = $Data
    $env:OPEN_BROWSER = '0'
    $env:RELAY_LISTEN = ''
    Remove-Item Env:RELAY_URL -ErrorAction SilentlyContinue
    while ($true) {
        try {
            if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 10MB) { Move-Item $Log "$Log.1" -Force }
            Add-Content -Path $Log -Value ("`n{0:o} Start backend (task, without sign-in)" -f (Get-Date)) -Encoding utf8
            # cmd /c only for the redirect into the log; input from NUL so nothing waits for a question
            $cmdArgs = '/c ""{0}" "{1}" < NUL >> "{2}" 2>&1"' -f $Exe, (Join-Path $Root 'local\src\index.ts'), $Log
            $p = Start-Process -FilePath "$env:WINDIR\System32\cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $Root -WindowStyle Hidden -Wait -PassThru
            $wait = $RetrySeconds
            $fast = Join-Path $Data 'restart.fast'
            if (Test-Path $fast) { Remove-Item $fast -Force; $wait = 2 }
            Add-Content -Path $Log -Value ("{0:o} Exit with code {1}; next start in {2} s" -f (Get-Date), $p.ExitCode, $wait) -Encoding utf8
        } catch {
            $wait = $RetrySeconds
            try { Add-Content -Path $Log -Value "Error in the loop: $($_.Exception.Message)" -Encoding utf8 } catch { }
        }
        Start-Sleep -Seconds $wait
    }
}
