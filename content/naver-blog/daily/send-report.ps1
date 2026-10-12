param(
    [Parameter(Mandatory = $true)][string]$Subject,
    [Parameter(Mandatory = $true)][string]$HtmlFile,
    [string[]]$Attachments = @(),
    [string]$To = "jsh@aincustoms.com"
)
# Sends the daily card-news report through the local Outlook profile (jsh@aincustoms.com).
$ErrorActionPreference = "Stop"
$ol = New-Object -ComObject Outlook.Application
$mail = $ol.CreateItem(0)
$mail.To = $To
$mail.Subject = $Subject
$mail.HTMLBody = [System.IO.File]::ReadAllText($HtmlFile, [System.Text.Encoding]::UTF8)
foreach ($a in $Attachments) {
    if ($a -and (Test-Path $a)) { [void]$mail.Attachments.Add((Resolve-Path $a).Path) }
}
$mail.Send()
Write-Output "SENT: $Subject"
