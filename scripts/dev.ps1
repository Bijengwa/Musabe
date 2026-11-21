param([switch]$Restart)

$ports = @(4310, 5190)
$project = Split-Path -Parent $PSScriptRoot

foreach ($port in $ports) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
    $command = $process.CommandLine
    $isMusabe = $command -match 'Musabe|vite|backend\\src\\server.js'
    if ($Restart -and $isMusabe) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    } elseif ($isMusabe) {
      Write-Host ("Port {0} is already occupied by Musabe PID {1}. Run npm run dev:restart or stop it manually." -f $port, $listener.OwningProcess)
      exit 2
    } else {
      throw "Port $port is used by another application. Musabe cannot use it until that process is stopped or its configured port is changed."
    }
  }
}

Set-Location $project
& npm.cmd run dev:raw
