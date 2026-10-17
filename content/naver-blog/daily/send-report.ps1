param(
    [Parameter(Mandatory = $true)][string]$Subject,
    [Parameter(Mandatory = $true)][string]$HtmlFile,
    [string[]]$Attachments = @(),
    [string[]]$InlineImages = @(),
    [string]$InlineFile = "",
    [string]$To = "jsh@aincustoms.com"
)
# Sends the daily card-news report through the local Outlook profile (jsh@aincustoms.com).
# -Attachments  : normal attachments (shown in the attachment list).
# -InlineImages : "cid=path" items, e.g. "cover-09=C:\...\cards\09\card-01.png". Each is attached,
#                 given that Content-ID and hidden from the attachment list, so the HTML body can
#                 show it with <img src="cid:cover-09">.
# -InlineFile   : text file with one "cid=path" per line (build-report.mjs writes report.inline.txt).
$ErrorActionPreference = "Stop"
# Through `powershell -File`, a list like a,b,c arrives as ONE string "a,b,c". Split it back:
# inline specs at a comma followed by "<cid>=", attachments at a comma followed by a drive path.
$InlineImages = @($InlineImages | ForEach-Object { $_ -split ',(?=[A-Za-z0-9_.-]+=)' } | Where-Object { $_ })
$Attachments = @($Attachments | ForEach-Object { $_ -split ',(?=[A-Za-z]:[\\/])' } | Where-Object { $_ })
if ($InlineFile) {
    $InlineImages += @([System.IO.File]::ReadAllLines($InlineFile, [System.Text.Encoding]::UTF8) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
$PR_ATTACH_CONTENT_ID = "http://schemas.microsoft.com/mapi/proptag/0x3712001F"
$PR_ATTACH_MIME_TAG   = "http://schemas.microsoft.com/mapi/proptag/0x370E001F"
$PR_ATTACHMENT_HIDDEN = "http://schemas.microsoft.com/mapi/proptag/0x7FFE000B"

$ol = New-Object -ComObject Outlook.Application
$mail = $ol.CreateItem(0)
$mail.To = $To
$mail.Subject = $Subject
foreach ($a in $Attachments) {
    if ($a -and (Test-Path $a)) { [void]$mail.Attachments.Add((Resolve-Path $a).Path) }
}
$inlineCount = 0
foreach ($spec in $InlineImages) {
    if (-not $spec) { continue }
    $eq = $spec.IndexOf("=")
    if ($eq -lt 1) { throw "InlineImages item must be 'cid=path': $spec" }
    $cid = $spec.Substring(0, $eq).Trim()
    $file = $spec.Substring($eq + 1).Trim()
    if (-not (Test-Path $file)) { throw "Inline image not found: $file" }
    $full = (Resolve-Path $file).Path
    $att = $mail.Attachments.Add($full, 1, 0, [System.IO.Path]::GetFileName($full))   # 1 = olByValue
    $mime = switch ([System.IO.Path]::GetExtension($full).ToLower()) {
        ".png" { "image/png" } ".jpg" { "image/jpeg" } ".jpeg" { "image/jpeg" } ".gif" { "image/gif" } default { "application/octet-stream" }
    }
    $att.PropertyAccessor.SetProperty($PR_ATTACH_MIME_TAG, $mime)
    $att.PropertyAccessor.SetProperty($PR_ATTACH_CONTENT_ID, $cid)
    $att.PropertyAccessor.SetProperty($PR_ATTACHMENT_HIDDEN, $true)
    $inlineCount++
}
# Body last, so Outlook keeps the cid: references bound to the attachments above.
$mail.HTMLBody = [System.IO.File]::ReadAllText($HtmlFile, [System.Text.Encoding]::UTF8)
$mail.Send()
Write-Output "SENT: $Subject (inline images: $inlineCount)"
