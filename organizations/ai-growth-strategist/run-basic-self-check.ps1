$ErrorActionPreference = 'Stop'
$organizationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $organizationRoot '..\..')
$tests = @(
  (Join-Path $organizationRoot 'tests\growth_basic_pipeline.test.mjs'),
  (Join-Path $organizationRoot 'tests\growth_basic_run_manager.test.mjs'),
  (Join-Path $organizationRoot 'tests\organization_quality_profile.test.mjs'),
  (Join-Path $organizationRoot 'tests\candidate_cli.test.mjs')
  (Join-Path $projectRoot 'tests\control_center_organization_router_test.mjs')
)

Push-Location $projectRoot
try {
  node --test $tests
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  & (Join-Path $projectRoot 'scripts\project_self_check.bat') --no-pause
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
