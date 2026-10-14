# One-off search visibility check (Task Scheduler). Runs Claude Code headless with SEARCH_CHECK.md.
$Repo = "C:\Users\jsh\orca\workspaces\homepage_aincustoms\블로그-기능-추가"
$Log = Join-Path $Repo "content\naver-blog\daily\logs\search-check-$(Get-Date -Format 'yyyy-MM-dd').log"
Set-Location $Repo
$Prompt = "오늘 날짜: $(Get-Date -Format 'yyyy-MM-dd'). 아래 지침대로 수행하라.`n`n" + [System.IO.File]::ReadAllText((Join-Path $Repo "content\naver-blog\daily\SEARCH_CHECK.md"), [System.Text.Encoding]::UTF8)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
& "C:\Users\jsh\.local\bin\claude.exe" -p $Prompt --model sonnet --permission-mode bypassPermissions 2>&1 | Out-File -FilePath $Log -Encoding utf8 -Append
