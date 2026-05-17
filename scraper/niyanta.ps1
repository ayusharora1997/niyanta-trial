<#
.SYNOPSIS
    Niyanta Vendor Discovery CLI
.DESCRIPTION
    Manage the IndiaMART scraper backend from PowerShell.
    Commands: start, stop, status, scrape, scrape-multi, watch, runs, vendors, markdown, logs, help
.EXAMPLE
    .\niyanta.ps1 start
    .\niyanta.ps1 scrape "https://dir.indiamart.com/search.mp?ss=tshirts..." "360GSM Bengaluru"
    .\niyanta.ps1 scrape-multi "https://dir.indiamart.com/search.mp?ss=shirting+fabric..." "Shirting BLR"
    .\niyanta.ps1 runs
    .\niyanta.ps1 vendors sr-xxxxxxxx
    .\niyanta.ps1 markdown sr-xxxxxxxx
#>

param(
    [Parameter(Position=0)] [string]$Command = "help",
    [Parameter(Position=1)] [string]$Arg1,
    [Parameter(Position=2)] [string]$Arg2
)

$API     = "http://localhost:4000"
$DIR     = $PSScriptRoot
$LOGFILE = Join-Path $DIR "server.log"
$PIDFILE = Join-Path $DIR ".server.pid"

# ── Colour helpers ────────────────────────────────────────────────────────────
function cGreen  { param($t) Write-Host $t -ForegroundColor Green    -NoNewline }
function cYellow { param($t) Write-Host $t -ForegroundColor Yellow   -NoNewline }
function cRed    { param($t) Write-Host $t -ForegroundColor Red      -NoNewline }
function cCyan   { param($t) Write-Host $t -ForegroundColor Cyan     -NoNewline }
function cGrey   { param($t) Write-Host $t -ForegroundColor DarkGray -NoNewline }
function cWhite  { param($t) Write-Host $t -ForegroundColor White    -NoNewline }
function Ln      { Write-Host "" }

function StatusColor($s) {
    switch ($s) {
        "completed"          { "Green"  }
        "error"              { "Red"    }
        "running"            { "Yellow" }
        "scraping_search"    { "Yellow" }
        "enriching_profiles" { "Yellow" }
        "saving"             { "Yellow" }
        "pending"            { "DarkGray" }
        default              { "White"  }
    }
}

function StatusLabel($s) {
    switch ($s) {
        "completed"          { "[OK]    completed"         }
        "error"              { "[ERR]   error"             }
        "running"            { "[...]   running"           }
        "scraping_search"    { "[SRCH]  scraping search"   }
        "enriching_profiles" { "[ENRCH] enriching profiles"}
        "saving"             { "[SAVE]  saving"            }
        "pending"            { "[WAIT]  pending"           }
        default              { "[ ]     $s"                }
    }
}

# ── API helpers ───────────────────────────────────────────────────────────────
function Invoke-Api($method, $path, $body = $null) {
    $uri = "$API$path"
    try {
        if ($body) {
            $json = $body | ConvertTo-Json -Depth 5
            return Invoke-RestMethod -Method $method -Uri $uri `
                   -ContentType "application/json" -Body $json
        }
        return Invoke-RestMethod -Method $method -Uri $uri
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "  API error $code : $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Assert-Server {
    try {
        $null = Invoke-RestMethod "$API/health" -TimeoutSec 3
        return $true
    } catch {
        Write-Host "  Server is not running. Start it with:  .\niyanta.ps1 start" -ForegroundColor Red
        return $false
    }
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

function Cmd-Start {
    try {
        $null = Invoke-RestMethod "$API/health" -TimeoutSec 2
        Write-Host "  Server already running at $API" -ForegroundColor Green
        return
    } catch {}

    $ERRFILE = Join-Path $DIR "server.err.log"
    Push-Location $DIR
    $proc = Start-Process node -ArgumentList "server.js" `
            -RedirectStandardOutput $LOGFILE `
            -RedirectStandardError  $ERRFILE `
            -WindowStyle Hidden -PassThru
    $proc.Id | Out-File $PIDFILE -Encoding utf8
    Pop-Location

    Start-Sleep 3
    try {
        $null = Invoke-RestMethod "$API/health" -TimeoutSec 3
        Write-Host "  [OK] Server started  PID $($proc.Id)  -->  $API" -ForegroundColor Green
        Write-Host "       Logs: $LOGFILE" -ForegroundColor DarkGray
    } catch {
        Write-Host "  [ERR] Server failed to start. Check: $LOGFILE" -ForegroundColor Red
    }
}

function Cmd-Stop {
    if (Test-Path $PIDFILE) {
        $savedPid = Get-Content $PIDFILE -Raw
        try {
            Stop-Process -Id $savedPid -Force -ErrorAction Stop
            Remove-Item $PIDFILE -Force
            Write-Host "  Server stopped (PID $savedPid)." -ForegroundColor Yellow
            return
        } catch {
            Remove-Item $PIDFILE -Force -ErrorAction SilentlyContinue
        }
    }

    $conn = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force
        Write-Host "  Server stopped." -ForegroundColor Yellow
    } else {
        Write-Host "  No server found on port 4000." -ForegroundColor DarkGray
    }
}

function Cmd-Status {
    try {
        $h = Invoke-RestMethod "$API/health" -TimeoutSec 3
        $ts = try { Get-Date $h.ts -Format "HH:mm:ss" } catch { $h.ts }
        Write-Host "  Server ONLINE  -->  $API  [$ts]" -ForegroundColor Green
    } catch {
        Write-Host "  Server OFFLINE" -ForegroundColor Red
    }

    Ln

    $runs = Invoke-Api GET "/api/runs"
    if (-not $runs) { return }

    Write-Host "  Recent runs:" -ForegroundColor White
    $runs | Select-Object -First 5 | ForEach-Object {
        $name = if ($_.search_name) { $_.search_name } else { $_.search_id }
        $dt   = try { Get-Date $_.created_at -Format "dd-MMM HH:mm" } catch { "?" }
        $col  = StatusColor $_.status
        $lbl  = StatusLabel $_.status
        Write-Host ("    {0,-32} {1,-16} vendors:{2,-4} {3}" -f `
            $name, $dt, $_.vendors_found, $_.search_id) -ForegroundColor $col
        Write-Host "    $lbl" -ForegroundColor $col
        Ln
    }
}

function Cmd-Scrape($url, $name) {
    if (-not $url) {
        Write-Host "  Usage: .\niyanta.ps1 scrape URL [name]" -ForegroundColor Red
        return
    }
    if (-not (Assert-Server)) { return }

    # Extract keyword from ss= param
    $kw = ""
    if ($url -match "[?&]ss=([^&]+)") {
        Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
        $kw = [System.Web.HttpUtility]::UrlDecode($Matches[1])
        $kw = $kw -replace '\+', ' '
    }

    if (-not $name) { $name = if ($kw) { $kw } else { "Scrape $(Get-Date -Format 'yyyyMMdd-HHmm')" } }

    Write-Host "  Starting scrape: $name" -ForegroundColor Cyan
    Write-Host "  URL: $url" -ForegroundColor DarkGray
    Ln

    $body = @{ url=$url; searchName=$name; keyword=$kw; platform="indiamart"; country="India" }
    $res  = Invoke-Api POST "/api/scrape" $body
    if (-not $res) { return }

    Write-Host "  Job created --> searchId: $($res.searchId)" -ForegroundColor Green
    Ln
    Write-Host "  Watching progress (Ctrl+C to detach, job keeps running in background)..." -ForegroundColor Yellow
    Ln

    Cmd-Watch $res.searchId
}

function Cmd-Watch($searchId) {
    if (-not $searchId) {
        Write-Host "  Usage: .\niyanta.ps1 watch SEARCH_ID" -ForegroundColor Red
        return
    }
    if (-not (Assert-Server)) { return }

    $lastLogCount = 0
    $spin = @('|', '/', '-', '\')
    $si   = 0

    while ($true) {
        $data = Invoke-Api GET "/api/runs/$searchId"
        if (-not $data) { Start-Sleep 3; continue }

        $run  = $data.run
        $live = $data._live
        $stat = if ($live)  { $live.status }
                elseif ($run) { $run.status }
                else          { "pending" }

        # Print new log lines
        if ($live -and $live.log) {
            $logArr = @($live.log)
            if ($logArr.Count -gt $lastLogCount) {
                $newLines = $logArr[$lastLogCount..($logArr.Count - 1)]
                foreach ($l in $newLines) {
                    $ts = try { (Get-Date "1970-01-01 00:00:00").AddMilliseconds($l.ts).ToLocalTime().ToString("HH:mm:ss") } catch { "?" }
                    Write-Host "  [$ts] $($l.msg)" -ForegroundColor DarkGray
                }
                $lastLogCount = $logArr.Count
            }
        }

        # Progress bar
        if ($live -and $live.total -gt 0) {
            $pct    = [math]::Round($live.progress / $live.total * 100)
            $filled = [math]::Round($pct / 5)
            $bar    = ("#" * $filled).PadRight(20, ".")
            $s      = $spin[$si % 4]; $si++
            Write-Host "`r  $s [$bar] $($live.progress)/$($live.total) $stat        " -NoNewline
        } else {
            $s = $spin[$si % 4]; $si++
            Write-Host "`r  $s $stat              " -NoNewline
        }

        if ($stat -eq "completed") {
            Write-Host "`r  [DONE]                                              " -ForegroundColor Green
            Ln
            Write-Host "  Completed!" -ForegroundColor Green
            if ($run) {
                Write-Host "    Vendors found:    $($run.vendors_found)"    -ForegroundColor White
                Write-Host "    Vendors inserted: $($run.vendors_inserted)" -ForegroundColor White
                Write-Host "    Duration:         $($run.duration_seconds)s" -ForegroundColor White
            }
            Ln
            Write-Host "  View vendors:   .\niyanta.ps1 vendors $searchId" -ForegroundColor Cyan
            Write-Host "  Get markdown:   .\niyanta.ps1 markdown $searchId" -ForegroundColor Cyan
            Ln
            break
        }

        if ($stat -eq "error") {
            Write-Host "`r  [ERROR]                                             " -ForegroundColor Red
            Ln
            $errMsg = if ($live -and $live.error) { $live.error }
                      elseif ($run -and $run.error_message) { $run.error_message }
                      else { "unknown error" }
            Write-Host "  Job failed: $errMsg" -ForegroundColor Red
            Ln
            break
        }

        Start-Sleep 3
    }
}

function Cmd-Runs {
    param([int]$n = 10)
    if (-not (Assert-Server)) { return }

    $runs = Invoke-Api GET "/api/runs"
    if (-not $runs) { return }

    $runs = @($runs) | Select-Object -First $n

    Ln
    Write-Host ("  {0,-4} {1,-30} {2,-22} {3,-22} {4,-6} {5}" -f `
        "Num", "Name", "search_id", "Status", "Vnds", "Date") -ForegroundColor Cyan
    Write-Host ("  " + ("-" * 100))

    $i = 1
    foreach ($r in $runs) {
        $name = if ($r.search_name) { $r.search_name } else { "(no name)" }
        if ($name.Length -gt 28) { $name = $name.Substring(0, 27) + "~" }
        $dt  = try { Get-Date $r.created_at -Format "dd-MMM-yy HH:mm" } catch { "?" }
        $col = StatusColor $r.status
        $lbl = StatusLabel $r.status
        Write-Host ("  {0,-4} {1,-30} {2,-22} {3,-22} {4,-6} {5}" -f `
            $i, $name, $r.search_id, $lbl, $r.vendors_found, $dt) -ForegroundColor $col
        $i++
    }
    Ln
}

function Cmd-Vendors($searchId) {
    if (-not $searchId) {
        Write-Host "  Usage: .\niyanta.ps1 vendors SEARCH_ID" -ForegroundColor Red
        return
    }
    if (-not (Assert-Server)) { return }

    $data = Invoke-Api GET "/api/runs/$searchId"
    if (-not $data) { return }

    $vendors = @($data.vendors)
    $run     = $data.run

    if ($vendors.Count -eq 0) {
        Write-Host "  No vendors found yet for $searchId" -ForegroundColor Yellow
        return
    }

    $runName = if ($run -and $run.search_name) { $run.search_name } else { $searchId }
    Ln
    Write-Host "  $runName  ($($vendors.Count) vendors)" -ForegroundColor White
    Write-Host ("  " + ("-" * 120))
    Write-Host ("  {0,-4} {1,-35} {2,-20} {3,-22} {4,-7} {5,-20} {6}" -f `
        "Num", "Company", "City", "Director", "Rating", "GSTIN", "Price") -ForegroundColor Cyan
    Write-Host ("  " + ("-" * 120))

    $i = 1
    foreach ($v in $vendors) {
        $city  = "$($v.city), $($v.state)" -replace ", $", ""
        $price = if ($v.price_range_inr_low) { "Rs.$($v.price_range_inr_low)/$($v.price_unit)" } else { "--" }
        $gstin = if ($v.gstin) { $v.gstin } else { "--" }
        $dir   = if ($v.primary_contact_name) { $v.primary_contact_name } else { "--" }
        $rat   = if ($v.indiamart_rating)  { "$($v.indiamart_rating) stars" } else { "--" }
        $col   = if ($v.indiamart_rating -ge 4.5) { "Green" }
                 elseif ($v.indiamart_rating -ge 4.0) { "Cyan" }
                 else { "White" }

        Write-Host ("  {0,-4} {1,-35} {2,-20} {3,-22} {4,-7} {5,-20} {6}" -f `
            $i, $v.company_name, $city, $dir, $rat, $gstin, $price) -ForegroundColor $col
        $i++
    }
    Ln
    Write-Host "  Tip: .\niyanta.ps1 markdown $searchId  --> download full enriched report" -ForegroundColor Cyan
    Ln
}

function Cmd-Markdown($searchId) {
    if (-not $searchId) {
        Write-Host "  Usage: .\niyanta.ps1 markdown SEARCH_ID" -ForegroundColor Red
        return
    }
    if (-not (Assert-Server)) { return }

    $data   = Invoke-Api GET "/api/runs/$searchId"
    $sname  = if ($data -and $data.run -and $data.run.search_name) {
        ($data.run.search_name -replace '[^\w ]', '') -replace '\s+', '-'
    } else { $searchId }

    $outFile = Join-Path $DIR "$sname.md"

    try {
        $md = Invoke-RestMethod "$API/api/runs/$searchId/markdown"
        [System.IO.File]::WriteAllText($outFile, $md, [System.Text.Encoding]::UTF8)
        $lines = ($md -split "`n").Count
        $kb    = [math]::Round($md.Length / 1024, 1)
        Write-Host "  Saved: $outFile  ($lines lines, $kb KB)" -ForegroundColor Green
    } catch {
        Write-Host "  Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Cmd-Filters($url) {
    if (-not $url) {
        Write-Host "  Usage: .\niyanta.ps1 filters URL" -ForegroundColor Red
        Write-Host "  Shows which filter groups were discovered on the page without running a scrape." -ForegroundColor DarkGray
        return
    }
    if (-not (Assert-Server)) { return }

    Write-Host "  Discovering filters... (launches a browser, takes ~15s)" -ForegroundColor Cyan
    Ln
    Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
    $encoded = [System.Web.HttpUtility]::UrlEncode($url)
    $data = Invoke-Api GET "/api/filters?url=$encoded"
    if (-not $data) { return }

    if ($data.groups -eq 0) {
        Write-Host "  No attribute filters found on this page." -ForegroundColor Yellow
        Write-Host "  The page may not have loaded filters, or all groups were in the skip list." -ForegroundColor DarkGray
        return
    }

    Write-Host "  Found $($data.groups) filter groups  ($($data.totalValues) total values)" -ForegroundColor Green
    Ln
    foreach ($group in $data.filters.PSObject.Properties) {
        Write-Host "  $($group.Name)" -ForegroundColor Cyan
        foreach ($val in $group.Value) {
            Write-Host "    - $val" -ForegroundColor White
        }
        Ln
    }
}

function Cmd-ScrapeMulti($url, $name) {
    if (-not $url) {
        Write-Host "  Usage: .\niyanta.ps1 scrape-multi URL [name]" -ForegroundColor Red
        Write-Host "  Discovers all attribute filters on the page and scrapes each filter URL" -ForegroundColor DarkGray
        Write-Host "  (single-filter + 2-filter combos) to maximise unique vendor coverage." -ForegroundColor DarkGray
        return
    }
    if (-not (Assert-Server)) { return }

    # Extract keyword from ss= param
    $kw = ""
    if ($url -match "[?&]ss=([^&]+)") {
        Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
        $kw = [System.Web.HttpUtility]::UrlDecode($Matches[1])
        $kw = $kw -replace '\+', ' '
    }

    if (-not $name) { $name = if ($kw) { $kw } else { "MultiScrape $(Get-Date -Format 'yyyyMMdd-HHmm')" } }

    Write-Host "  Starting multi-filter scrape: $name" -ForegroundColor Cyan
    Write-Host "  URL: $url" -ForegroundColor DarkGray
    Write-Host "  (Will discover filters, then scrape single-filter + 2-filter combo URLs)" -ForegroundColor DarkGray
    Ln

    $body = @{ url=$url; searchName=$name; keyword=$kw; platform="indiamart"; country="India"; combineDepth=2 }
    $res  = Invoke-Api POST "/api/scrape/multi" $body
    if (-not $res) { return }

    Write-Host "  Job created --> searchId: $($res.searchId)" -ForegroundColor Green
    Ln
    Write-Host "  Watching progress (Ctrl+C to detach, job keeps running in background)..." -ForegroundColor Yellow
    Ln

    Cmd-Watch $res.searchId
}

function Cmd-Logs {
    $ERRFILE = Join-Path $DIR "server.err.log"
    if (-not (Test-Path $LOGFILE) -and -not (Test-Path $ERRFILE)) {
        Write-Host "  No log file yet. Start the server first." -ForegroundColor DarkGray
        return
    }
    Write-Host "  Tailing server logs (Ctrl+C to stop)" -ForegroundColor DarkGray
    Ln
    # Merge both log files into one stream
    if (Test-Path $ERRFILE) {
        Get-Content $LOGFILE, $ERRFILE -Tail 30 -Wait
    } else {
        Get-Content $LOGFILE -Tail 50 -Wait
    }
}

function Cmd-Help {
    Ln
    Write-Host "  +======================================================+" -ForegroundColor Cyan
    Write-Host "  |    Niyanta Vendor Discovery  --  PowerShell CLI      |" -ForegroundColor Cyan
    Write-Host "  +======================================================+" -ForegroundColor Cyan
    Ln
    Write-Host "  USAGE:  .\niyanta.ps1 COMMAND [args]" -ForegroundColor White
    Ln
    Write-Host "  -- Server --" -ForegroundColor DarkGray
    Write-Host "  start                    Start API server in background (port 4000)" -ForegroundColor Green
    Write-Host "  stop                     Stop the API server" -ForegroundColor Yellow
    Write-Host "  status                   Server health + last 5 runs" -ForegroundColor Cyan
    Write-Host "  logs                     Tail live server log (Ctrl+C to stop)" -ForegroundColor Cyan
    Ln
    Write-Host "  -- Scraping --" -ForegroundColor DarkGray
    Write-Host "  filters      URL          Inspect what filter groups exist on a page (debug)" -ForegroundColor Cyan
    Write-Host "  scrape       URL [name]  Single-URL scrape (~10 vendors) + live progress" -ForegroundColor Green
    Write-Host "  scrape-multi URL [name]  Filter-multiplied scrape -- iterates all attribute" -ForegroundColor Green
    Write-Host "                           filters (singles + 2-combos) for max vendor coverage" -ForegroundColor DarkGray
    Write-Host "  watch  SEARCH_ID         Attach to a running or recent job" -ForegroundColor Cyan
    Ln
    Write-Host "  -- Results --" -ForegroundColor DarkGray
    Write-Host "  runs [n]                 List last n runs (default 10)" -ForegroundColor Cyan
    Write-Host "  vendors SEARCH_ID        Print vendor table for a run" -ForegroundColor Cyan
    Write-Host "  markdown SEARCH_ID       Save enriched .md report to file" -ForegroundColor Green
    Ln
    Write-Host "  -- Examples --" -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 start' -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 scrape "https://dir.indiamart.com/search.mp?ss=hoodies+bengaluru" "Hoodies BLR"' -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 scrape-multi "https://dir.indiamart.com/search.mp?ss=shirting+fabric" "Shirting BLR"' -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 runs' -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 vendors sr-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' -ForegroundColor DarkGray
    Write-Host '  .\niyanta.ps1 markdown sr-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' -ForegroundColor DarkGray
    Ln
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
switch ($Command.ToLower()) {
    "start"    { Cmd-Start }
    "stop"     { Cmd-Stop }
    "status"   { Cmd-Status }
    "filters"       { Cmd-Filters $Arg1 }
    "scrape"        { Cmd-Scrape $Arg1 $Arg2 }
    "scrape-multi"  { Cmd-ScrapeMulti $Arg1 $Arg2 }
    "watch"    { Cmd-Watch $Arg1 }
    "runs"     { Cmd-Runs ([int]($Arg1 -replace '\D', '10')) }
    "vendors"  { Cmd-Vendors $Arg1 }
    "markdown" { Cmd-Markdown $Arg1 }
    "logs"     { Cmd-Logs }
    "help"     { Cmd-Help }
    default    { Write-Host "  Unknown command: $Command" -ForegroundColor Red; Ln; Cmd-Help }
}
