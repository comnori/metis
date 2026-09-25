param([string]$File, [string]$Ready, [string]$Release)
$ErrorActionPreference = 'Stop'
$handle = [System.IO.File]::Open($File, 'Open', 'ReadWrite', 'None')
try {
    [System.IO.File]::WriteAllText($Ready, 'locked')
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $Release) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
} finally {
    $handle.Dispose()
}
