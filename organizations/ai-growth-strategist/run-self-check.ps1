$ErrorActionPreference = 'Stop'
$organizationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $organizationRoot '..\..')
$tests = Get-ChildItem -LiteralPath (Join-Path $organizationRoot 'tests') -Filter '*.test.mjs' |
  Sort-Object Name |
  ForEach-Object { $_.FullName }

Push-Location $projectRoot
try {
  node --test $tests
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $env:PYTHONUTF8 = '1'
  $validator = 'C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py'
  foreach ($skill in @(
    'growth-opportunity-analysis',
    'competitive-benchmark-analysis',
    'content-customer-growth'
  )) {
    python $validator (Join-Path $organizationRoot "skills\$skill")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  node (Join-Path $organizationRoot 'scripts\organization_self_check.mjs')
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
