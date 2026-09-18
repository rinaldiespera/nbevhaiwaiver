$base = "http://localhost:3000"
$sep = "|||HTTP_STATUS:"
function Run-Curl([string[]]$CurlArgs) {
  $out = curl.exe -sS -w "$sep%{http_code}$sep" @CurlArgs 2>&1
  if ($out -match "$sep([0-9]{3})$sep") {
    $status = $Matches[1]
    $body = ($out -replace [regex]::Escape("$sep$status$sep"), [string]::Empty)
    return [pscustomobject]@{ Status = [int]$status; Body = $body }
  }
  return [pscustomobject]@{ Status = -1; Body = $out }
}

Write-Host '=== T1: GET /api/waiver-types (no auth, ADMIN_API_AUTH_REQUIRED=false) ==='
$r1 = Run-Curl @("$base/api/waiver-types")
$rows = $r1.Body | ConvertFrom-Json
Write-Host "  HTTP=$($r1.Status) count=$($rows.Count)"
foreach ($r in $rows) {
  Write-Host "  name=$($r.name)  slug=$($r.slug)  signedRel=$($r.signedQrRelativeUrl)  signedFull=$($r.signedQrFullUrl)"
}

Write-Host "`n=== T2: GET /api/waiver-types with intentionally-wrong Bearer (auth off => still 200) ==="
$r2 = Run-Curl @("-H", "Authorization: Bearer definitely-not-a-valid-token", "$base/api/waiver-types")
Write-Host "  HTTP=$($r2.Status)"

Write-Host "`n=== T3: GET /waiver/basketball-court NO ?h=, WAIVER_HASH_REQUIRED=false => transition mode ==="
$r3 = Run-Curl @("$base/waiver/basketball-court")
Write-Host "  HTTP=$($r3.Status)  banner:Unsecured-access-enabled=$($r3.Body -match 'Unsecured access enabled')"

Write-Host "`n=== T4: GET /waiver/sports-facilities?h=CORRECT from server ==="
$sf = $rows | Where-Object { $_.slug -eq 'sports-facilities' } | Select-Object -First 1
$rel4 = $sf.signedQrRelativeUrl
Write-Host "  rel=$rel4"
$r4 = Run-Curl @("$base$rel4")
Write-Host "  HTTP=$($r4.Status)  has-signing-form=$($r4.Body -match 'I have read and accept')  no-bypass-banner=$($r4.Body -notmatch 'Unsecured access enabled')  name-matches=$($r4.Body -match [regex]::Escape($sf.name))"

Write-Host "`n=== T5: Mangled 1-char ?h= => mismatch reason page ==="
$sigLastChar = $rel4.Substring($rel4.Length - 1, 1)
$alts = "0123456789abcdef".ToCharArray() | Where-Object { $_ -ne $sigLastChar }
$alt = $alts[(Get-Random -Maximum $alts.Length)]
$badRel = $rel4.Substring(0, $rel4.Length - 1) + [string]$alt
Write-Host "  badRel=$badRel"
$r5 = Run-Curl @("$base$badRel")
Write-Host "  HTTP=$($r5.Status)  mismatch-reason-page=$($r5.Body -match 'security code does not match')"

Write-Host "`n=== T6: Bad-format ?h= (2 chars only) => bad-format page ==="
$r6 = Run-Curl @("$base/waiver/sports-facilities?h=zz")
Write-Host "  HTTP=$($r6.Status)  bad-format-page=$($r6.Body -match 'malformed')"

Write-Host "`n=== T7: POST /api/sign missing accessHash => 403 forbidden ==="
$sig1x1Base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
$sfId = $sf.id
$missingH = @{ waiverTypeId=$sfId; signerName='Smoke Test No Hash'; signatureDataUrl="data:image/png;base64,$sig1x1Base64" } | ConvertTo-Json -Compress
$r7 = Run-Curl @("-X","POST","-H","Content-Type: application/json","-d",$missingH,"$base/api/sign")
Write-Host "  HTTP=$($r7.Status)  body=$($r7.Body)"

Write-Host "`n=== T8: POST /api/sign WITH correct accessHash => success OR duplicate OR 400 (still <403, meaning passed hash gate) ==="
$correctHash = $rel4 -replace '^.*\?h=',''
$withH = @{ waiverTypeId=$sfId; signerName='Smoke Test With Hash'; signatureDataUrl="data:image/png;base64,$sig1x1Base64"; accessHash=$correctHash } | ConvertTo-Json -Compress
$r8 = Run-Curl @("-X","POST","-H","Content-Type: application/json","-d",$withH,"$base/api/sign")
Write-Host "  HTTP=$($r8.Status)  body=$($r8.Body)"

Write-Host "`n=== T9: POST /api/sign WITH WRONG cross-waiver accessHash => 403 mismatch ==="
$bb = $rows | Where-Object { $_.slug -eq 'basketball-court' } | Select-Object -First 1
$wrongHash = $bb.signedQrRelativeUrl -replace '^.*\?h=',''
$bodyWrong = @{ waiverTypeId=$sfId; signerName='Smoke Test Wrong Hash'; signatureDataUrl="data:image/png;base64,$sig1x1Base64"; accessHash=$wrongHash } | ConvertTo-Json -Compress
$r9 = Run-Curl @("-X","POST","-H","Content-Type: application/json","-d",$bodyWrong,"$base/api/sign")
Write-Host "  HTTP=$($r9.Status)  body=$($r9.Body)"

Write-Host "`n=== T10: GET /waiver/sports-facilities NO ?h= MISSING reason page (override env via temp container = skip, but confirm POST sign without h = 403) ==="
Write-Host "  T7 above = $($r7.Status) (expect 403 missing reason)"
