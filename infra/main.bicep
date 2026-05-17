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

@description('Password for the ml_pipeline service-account admin user. Required on every reapply (same pattern as pgAdminPassword). Stored in Key Vault as ml-pipeline-password and consumed by the ML Container Apps Job.')
@secure()
@minLength(8)
param mlPipelinePassword string

@description('Public URL of the running ScoreCast app, used by the ML pipeline to log in and PUT probabilities. Defaults to https://{customDomain} when customDomain is set, else falls back to the Container App FQDN at runtime via the env wired in app.bicep.')
param mlApiBaseUrl string = empty(customDomain) ? '' : 'https://${customDomain}'

@description('Image tag for the scorecast-ml image. Default "placeholder" for the very first deploy. Subsequent reapplies should pass the live tag to avoid clobbering the running ml-job image to the helloworld bootstrap. Discoverable via: az containerapp job show --name scorecast-ml-job --resource-group scorecast-prod --query "properties.template.containers[0].image"')
param mlImageTag string = 'placeholder'

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

// scorecast-ml weekly probability pipeline. Uses its OWN imageTag param
// because the ML image is built + pushed by a separate workflow
// (.github/workflows/ml-deploy.yml) against a different ACR repo
// (`scorecast-ml`). Default 'placeholder' for first deploy; on subsequent
// reapplies the operator passes the live ML image tag so Bicep doesn't
// clobber the running ml-job image back to the helloworld bootstrap.
module mlJob 'modules/ml-job.bicep' = {
  name: 'mlJob'
  params: {
    location: location
    appName: appName
    tags: tags
    imageTag: mlImageTag
    containerAppsEnvId: app.outputs.environmentId
    acrLoginServer: registry.outputs.loginServer
    acrName: registry.outputs.name
    keyVaultName: secrets.outputs.keyVaultName
    mlPipelinePassword: mlPipelinePassword
    // Fall back to the Container App FQDN when customDomain isn't set —
    // first-deploy / pre-DNS-cutover scenarios.
    apiBaseUrl: !empty(mlApiBaseUrl) ? mlApiBaseUrl : 'https://${app.outputs.containerAppFqdn}'
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
output mlJobName string = mlJob.outputs.jobName
output mlImageRepoName string = mlJob.outputs.imageRepoName
output postgresServerName string = db.outputs.serverName
output dnsZoneName string = dns.?outputs.zoneName ?? ''
output dnsNameServers array = dns.?outputs.nameServers ?? []
