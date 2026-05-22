// ============================================================================
// ScoreCast — Azure infrastructure (Bicep)
//
// Provisions everything ScoreCast needs to run on Azure:
//   - Log Analytics workspace + Application Insights
//   - Azure Container Registry (Basic)
//   - Key Vault (RBAC mode)
//   - Postgres Flexible Server (B1ms, public + firewall — simplest viable
//     prod setup at this scale; revisit with VNet integration if security
//     posture demands it)
//   - Azure DNS zone (used by Chunk 4 for custom domain + managed TLS)
//   - Container Apps environment + main Container App + migration Job
//
// Deferred per the Tier 9 cost-reduction plan:
//   - Azure Cache for Redis (Tier 10.4 will re-introduce a managed cache)
//   - VNet integration (would cost ~$60/mo for the Container Apps env upgrade)
// ============================================================================

targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short app name. Used as a prefix for resource names.')
@minLength(3)
@maxLength(20)
param appName string = 'scorecast'

@description('Container image tag to deploy. Use "placeholder" for the first apply; Chunk 4 CD updates this to a real Git SHA.')
param imageTag string = 'placeholder'

@description('Postgres admin password. Pass via --parameters at deploy time; never commit. Stored in Key Vault for the app to read.')
@secure()
@minLength(16)
param pgAdminPassword string

@description('Custom domain to bind to the Container App. Leave empty until Chunk 4 (domain + TLS).')
param customDomain string = ''

@description('Resource id of the Azure-managed certificate to bind to customDomain. Discover with `az containerapp env certificate list`. Leave empty when customDomain is empty.')
param customDomainCertId string = ''

@description('Provision an Azure DNS zone for customDomain. Default false because DNS is managed in Cloudflare today. Flip to true only if migrating DNS to Azure.')
param useAzureDns bool = false

// Tier 17 dropped mlPipelinePassword / mlApiBaseUrl / mlImageTag params
// — the Python ML pipeline + its Container Apps Job were retired and
// inference moved to in-process JS (services/PredictionService.js +
// lib/ml/). Reapply param count went from 7 → 5: pgAdminPassword,
// customDomain, customDomainCertId, vapidPublicKey, imageTag.

@description('VAPID public key for Web Push. Generate with `npx web-push generate-vapid-keys`. Leave empty until Web Push goes live — PushService gracefully no-ops without it. The matching private key MUST be seeded into Key Vault as `vapid-private-key` BEFORE the first Bicep reapply that wires push (same pattern as jwt-secret / resend-api-key / football-data-api-key).')
param vapidPublicKey string = ''

@description('Push provider abuse-report URL. mailto: works; defaults to the project owner.')
param vapidSubject string = 'mailto:vindevoudit@gmail.com'

// Stable suffix derived from the resource group id so naming is idempotent
// across deployments but globally unique across Azure.
var nameSuffix = toLower(uniqueString(resourceGroup().id))

var tags = {
  env: 'prod'
  app: appName
  managedBy: 'bicep'
}

// ============================================================================
// Modules
// ============================================================================

module logs 'modules/logs.bicep' = {
  name: 'logs'
  params: {
    location: location
    appName: appName
    nameSuffix: nameSuffix
    tags: tags
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    appName: appName
    nameSuffix: nameSuffix
    tags: tags
  }
}

module secrets 'modules/secrets.bicep' = {
  name: 'secrets'
  params: {
    location: location
    appName: appName
    nameSuffix: nameSuffix
    tags: tags
  }
}

module db 'modules/db.bicep' = {
  name: 'db'
  params: {
    location: location
    appName: appName
    nameSuffix: nameSuffix
    tags: tags
    keyVaultName: secrets.outputs.keyVaultName
    pgAdminPassword: pgAdminPassword
  }
}

module dns 'modules/dns.bicep' = if (useAzureDns && !empty(customDomain)) {
  name: 'dns'
  params: {
    customDomain: customDomain
    tags: tags
  }
}

module app 'modules/app.bicep' = {
  name: 'app'
  params: {
    location: location
    appName: appName
    nameSuffix: nameSuffix
    tags: tags
    imageTag: imageTag
    logAnalyticsId: logs.outputs.workspaceId
    logAnalyticsCustomerId: logs.outputs.workspaceCustomerId
    appInsightsConnectionString: logs.outputs.appInsightsConnectionString
    acrLoginServer: registry.outputs.loginServer
    acrName: registry.outputs.name
    keyVaultName: secrets.outputs.keyVaultName
    customDomain: customDomain
    customDomainCertId: customDomainCertId
    vapidPublicKey: vapidPublicKey
    vapidSubject: vapidSubject
  }
}

module migrateJob 'modules/migrate-job.bicep' = {
  name: 'migrateJob'
  params: {
    location: location
    appName: appName
    tags: tags
    imageTag: imageTag
    containerAppsEnvId: app.outputs.environmentId
    acrLoginServer: registry.outputs.loginServer
    acrName: registry.outputs.name
    keyVaultName: secrets.outputs.keyVaultName
  }
}

// ============================================================================
// Outputs — handy for CD pipelines + manual inspection
// ============================================================================

output resourceGroupName string = resourceGroup().name
output acrLoginServer string = registry.outputs.loginServer
output acrName string = registry.outputs.name
output keyVaultName string = secrets.outputs.keyVaultName
output containerAppName string = app.outputs.containerAppName
output containerAppFqdn string = app.outputs.containerAppFqdn
output migrateJobName string = migrateJob.outputs.jobName
output postgresServerName string = db.outputs.serverName
output dnsZoneName string = dns.?outputs.zoneName ?? ''
output dnsNameServers array = dns.?outputs.nameServers ?? []
