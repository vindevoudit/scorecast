// Container Apps Job that runs `npm run db:migrate` as a one-shot.
//
// Chunk 4 CD calls `az containerapp job start --image <sha>` before rolling
// the main app, so migrations always apply BEFORE the new revision starts
// serving traffic. The job is provisioned here once (no traffic, no cost
// when idle) so CD just changes the image tag at run time.

@description('Region for the job.')
param location string

@description('Short app name.')
param appName string

@description('Tags applied to every resource.')
param tags object

@description('Image tag. Use "placeholder" on first deploy; CD updates to a Git SHA.')
param imageTag string

@description('Container Apps environment to run the job in.')
param containerAppsEnvId string

@description('ACR login server.')
param acrLoginServer string

@description('ACR resource name.')
param acrName string

@description('Key Vault name (for the database-url secret reference).')
param keyVaultName string

var jobName = '${appName}-migrate'

// Same placeholder shortcut as app.bicep — first deploy uses a no-op image so
// the resource provisions; CD overrides the image at execution time.
var imageRef = imageTag == 'placeholder'
  ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  : '${acrLoginServer}/scorecast:${imageTag}'

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
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 1
      manualTriggerConfig: {
        replicaCompletionCount: 1
        parallelism: 1
      }
      // Registries/secrets always populated regardless of imageTag — same
      // reasoning as in app.bicep. Earlier ternaries here cleared the
      // config on every Bicep reapply with default imageTag, which silently
      // broke CD: `az containerapp job update --image` had no registry
      // auth, and any successful image update produced a Job with no
      // DATABASE_URL env (Sequelize blew up at startup).
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/database-url'
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: imageRef
          // Override the entrypoint to run migrations instead of the server.
          // The placeholder helloworld image ignores this command since it
          // has its own ENTRYPOINT; for the real ScoreCast image, this
          // is what actually runs the migrations.
          command: [
            'npm'
            'run'
            'db:migrate'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
}

// ----------------------------------------------------------------------------
// RBAC: same AcrPull + Secrets User the main app has.
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

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
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
