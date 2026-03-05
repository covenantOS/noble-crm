# Add Bloo + Resend webhook secrets to Vercel (Production).
# Run once after: vercel login
# Set secrets in env or create .env.vercel.webhooks (gitignored) with:
#   BLOO_WEBHOOK_SECRET=whsec_...
#   RESEND_WEBHOOK_SECRET=whsec_...

$ErrorActionPreference = 'Stop'
$vars = @('BLOO_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET')

# Optional: load from .env.vercel.webhooks if present
$envFile = Join-Path (Get-Location) '.env.vercel.webhooks'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_0-9]+)\s*=\s*(.+)\s*$') {
            $val = ($matches[2].Trim() -replace '[\r\n]+', '')
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $val, 'Process')
        }
    }
}

foreach ($name in $vars) {
    $val = [System.Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not $val) { Write-Warning "Skipping $name (not set). Set it or add to .env.vercel.webhooks"; continue }
    $val | vercel env add $name production 2>&1
    Write-Host "Added $name to Vercel production."
}
Write-Host "Done. Redeploy with: vercel --prod"
