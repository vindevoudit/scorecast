// Container Apps Job that runs the scorecast-ml probability pipeline on a
// weekly schedule.
//
// Trigger: `Schedule` — fires Thursdays 02:30 UTC. Predicts probabilities
// for the next 7 days of fixtures and writes them via PUT /api/admin/games/:id.
// Picks the natural pre-gameweek slot (PL fixtures cluster Friday–Sunday) and
// avoids overlapping with the Node app's daily fixture sync at 03:00 UTC.
//
// The image lives in a separate ACR repository (`scorecast-ml`) so the Node
// CD pipeline (.github/workflows/deploy.yml) never collides with it.
// .github/workflows/ml-deploy.yml owns the build + push when ml/** changes.
//
// Manual ad-hoc runs are supported even on a Schedule-triggered job:
//   az containerapp job start --name scorecast-ml-job --resource-group scorecast-prod

@description('Region for the job.')
param location string

@description('Short app name.')
param appName string

@description('Tags applied to every resource.')
param tags object

@description('Image tag for the ML image. Use "placeholder" on first deploy; CD updates to a Git SHA.')
param imageTag string

@description('Container Apps environment to run the job in.')
param containerAppsEnvId string

@description('ACR login server.')
param acrLoginServer string

@description('ACR resource name.')
param acrName string

@description('Key Vault name (for secret references).')
param keyVaultName string

@description('Password for the ml_pipeline service-account admin user. Stored in Key Vault as ml-pipeline-password. Must be passed on every reapply — mirrors pgAdminPassword.')
@secure()
@minLength(8)
param mlPipelinePassword string

@description('Public URL of the running ScoreCast app (no trailing slash). e.g. https://bantryx.com — the writer logs in here and PUTs probabilities.')
param apiBaseUrl string

@description('Cron expression for the scheduled run (UTC). Default: Thursdays 02:30 — pre-gameweek slot, before the Node app\'s 03:00 UTC fixture sync.')
param cronExpression string = '30 2 * * 4'

var jobName = '${appName}-ml-job'
var imageRepoName = 'scorecast-ml'

// Same placeholder shortcut as migrate-job.bicep — first deploy uses a no-op
// helloworld image so the resource provisions; CD overrides it at run time.
var imageRef = imageTag == 'placeholder'
  ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  : '${acrLoginServer}/${imageRepoName}:${imageTag}'

// ----------------------------------------------------------------------------
// Key Vault secret: ml-pipeline-password
//
// Provisioned here so the Job can resolve `secretRef: 'ml-pipeline-password'`
// against the KV. Reapply rotates the value, so `mlPipelinePassword` is a
// required param on every Bicep run (just like pgAdminPassword).
// ----------------------------------------------------------------------------

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource mlPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'ml-pipeline-password'
  properties: {
    value: mlPipelinePassword
  }
}

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppsEnvId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      // Predict-and-write usually completes in <60s. 30-min upper bound is
      // generous headroom for cold starts + slow API responses.
      replicaTimeout: 1800
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: imageTag == 'placeholder' ? [] : [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      secrets: imageTag == 'placeholder' ? [] : [
        {
          name: 'database-url'
          keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/database-url'
          identity: 'system'
        }
        {
          name: 'ml-pipeline-password'
          keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/ml-pipeline-password'
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ml'
          image: imageRef
          // CMD baked in the Dockerfile (`python -m scorecast_ml predict-and-write
          // --league PL --horizon-days 7`) runs by default.
          resources: {
            // XGBoost inference + the form/Elo rebuild on ~12k matches needs
            // very little — 0.5 vCPU / 1 GiB is the smallest workload profile
            // slice and comfortable headroom.
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: imageTag == 'placeholder' ? [] : [
            { name: 'SCORECAST_ML_USERNAME', value: 'ml_pipeline' }
            { name: 'SCORECAST_ML_PASSWORD', secretRef: 'ml-pipeline-password' }
            { name: 'SCORECAST_API_BASE_URL', value: apiBaseUrl }
            { name: 'SCORECAST_DB_URL', secretRef: 'database-url' }
            // JSON logs so Log Analytics queries can extract structured fields
            // (matches pino's output shape from the Node app).
            { name: 'SCORECAST_LOG_FORMAT', value: 'json' }
          ]
        }
      ]
    }
  }
}

// ----------------------------------------------------------------------------
// RBAC: AcrPull + Key Vault Secrets User — same pair the main app and
// migrate-job both carry.
// ----------------------------------------------------------------------------

resource acrPullRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, job.id, 'acrpull')
  properties: {
    roleDefinitionId: acrPullRole.id
    principalId: job.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, job.id, 'kvsecretsuser')
  properties: {
    roleDefinitionId: kvSecretsUserRole.id
    principalId: job.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output jobName string = job.name
output jobId string = job.id
output imageRepoName string = imageRepoName
