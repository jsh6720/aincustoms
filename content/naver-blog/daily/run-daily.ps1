# Daily 07:00 card-news run (Windows Task Scheduler). Runs Claude Code headless with DAILY_RUN.md,
# logs to daily/logs, and mails jsh@aincustoms.com if the run itself fails.
$ErrorActionPreference = "Continue"
$Repo = "C:\Users\jsh\orca\workspaces\homepage_aincustoms\블로그-기능-추가"
$Daily = Join-Path $Repo "content\naver-blog\daily"
$Logs = Join-Path $Daily "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null
$Stamp = Get-Date -Format "yyyy-MM-dd"
$Log = Join-Path $Logs "$Stamp.log"
$env:PLAYWRIGHT_DIR = "C:\Users\jsh\AppData\Local\aincustoms-cardnews\pw"

Set-Location $Repo
$Prompt = [System.IO.File]::ReadAllText((Join-Path $Daily "DAILY_RUN.md"), [System.Text.Encoding]::UTF8)
$Prompt = "오늘 날짜: $Stamp (Asia/Seoul). 아래 지침대로 오늘의 카드뉴스 작업을 수행하라.`n`n" + $Prompt

"=== START $(Get-Date -Format s)" | Out-File -FilePath $Log -Encoding utf8 -Append
# Decode claude.exe output as UTF-8 and log as UTF-8 (5.1's *>> writes UTF-16 and mangles Korean).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Pass the prompt on stdin: 5.1 does not escape embedded double quotes in native-command arguments,
# which truncated the prompt. $OutputEncoding (default ASCII) sets the encoding of piped stdin.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Prompt | & "C:\Users\jsh\.local\bin\claude.exe" -p --model opus --permission-mode bypassPermissions 2>&1 |
    Out-File -FilePath $Log -Encoding utf8 -Append
$Code = $LASTEXITCODE
"=== END $(Get-Date -Format s) exit=$Code" | Out-File -FilePath $Log -Encoding utf8 -Append

# Safety net: if Claude did not mail a report today, send a failure notice with the log tail.
$Sent = Join-Path $Daily "out\$Stamp\REPORT_SENT"
if (-not (Test-Path $Sent)) {
    $Tail = (Get-Content $Log -Tail 40 -Encoding utf8) -join "<br>"
    $Html = Join-Path $Logs "$Stamp-failure.html"
    "<p>오늘($Stamp) 카드뉴스 자동 작업이 보고 메일을 보내지 못하고 끝났습니다 (exit=$Code).</p><p>로그: $Log</p><pre style='font-size:12px'>$Tail</pre>" |
        Out-File -FilePath $Html -Encoding utf8
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Daily "send-report.ps1") `
        -Subject "[Ain 관세 인사이트] $Stamp 자동 작업 실패 알림" -HtmlFile $Html 2>&1 |
        Out-File -FilePath $Log -Encoding utf8 -Append
}
