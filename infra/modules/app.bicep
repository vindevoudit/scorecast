// Container Apps environment + the main ScoreCast Container App.
//
// Scale: min=0, max=3. Scale-to-zero saves ~$15/mo at idle (3-5s cold start
// on the first request after idle). Bump min=1 in app.bicep if the cold start
// becomes user-visible.
//
// Auth to ACR is via the app's system-assigned managed identity + AcrPull role
// granted in this module.
//
// Secrets reference Key Vault entries via keyVaultUrl; the managed identity
// also gets `Key Vault Secrets User` so it can resolve them at start.

@description('Region for the environment + app.')
param location string

@description('Short app name.')
param appName string

@description('Suffix appended to globally-scoped resource names.')
param nameSuffix string

@description('Tags applied to every resource.')
param tags object

@description('Image tag. Use "placeholder" on first deploy; CD updates to a Git SHA.')
param imageTag string

@description('Log Analytics workspace resource id (workspace destination for Container Apps logs).')
param logAnalyticsId string

@description('Log Analytics workspace customer id.')
param logAnalyticsCustomerId string

@description('Application Insights connection string. App reads it at runtime via env var.')
param appInsightsConnectionString string

@description('ACR login server (e.g. scorecastacrXYZ.azurecr.io).')
param acrLoginServer string

@description('ACR resource name (used to grant AcrPull on the registry).')
param acrName string

@description('Key Vault name (used to grant Secrets User on the vault and reference secrets).')
param keyVaultName string

@description('Custom domain to bind. Empty until Chunk 4.')
param customDomain string

var environmentName = '${appName}-env-${nameSuffix}'
var containerAppName = '${appName}-app'

// Public URL used by CORS_ORIGINS + PUBLIC_APP_URL. Defaults to the Container
// Apps environment's HTTPS hostname when no custom domain is bound (Chunk 3),
// and switches to https://<customDomain> once Chunk 4 adds the apex domain.
var defaultPublicUrl = 'https://${containerAppName}.${environment.properties.defaultDomain}'
var publicAppUrl = empty(customDomain) ? defaultPublicUrl : 'https://${customDomain}'

// Use a placeholder MCR image on the first deploy so the Container App
// resource provisions successfully without a built scorecast image in ACR yet.
// Chunk 4 updates this to the real ACR image via `az containerapp update`.
var imageRef = imageTag == 'placeholder'
  ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  : '${acrLoginServer}/scorecast:${imageTag}'

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: last(split(logAnalyticsId, '/'))
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: imageTag == 'placeholder' ? [] : [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      secrets: imageTag == 'placeholder' ? [] : [
        {
          name: 'jwt-secret'
          keyVaultUrl: 'https://${keyVaultName}${az.environment().suffixes.keyvaultDns}/secrets/jwt-secret'
          identity: 'system'
        }
        {
          name: 'database-url'
          keyVaultUrl: 'https://${keyVaultName}${az.environment().suffixes.keyvaultDns}/secrets/database-url'
          identity: 'system'
        }
        {
          name: 'resend-api-key'
          keyVaultUrl: 'https://${keyVaultName}${az.environment().suffixes.keyvaultDns}/secrets/resend-api-key'
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: imageRef
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          // Env vars only get attached once we're past the placeholder image
          // (which doesn't know how to consume them). publicAppUrl falls back
          // to the Azure-issued FQDN when no custom domain is bound.
          env: imageTag == 'placeholder' ? [] : [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'PUBLIC_APP_URL', value: publicAppUrl }
            { name: 'CORS_ORIGINS', value: publicAppUrl }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'RESEND_API_KEY', secretRef: 'resend-api-key' }
            { name: 'MIGRATE_ON_BOOT', value: 'false' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/healthz'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// ----------------------------------------------------------------------------
// RBAC: grant the Container App's managed identity AcrPull on the registry
// and Key Vault Secrets User on the vault.
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
  name: guid(acr.id, containerApp.id, 'acrpull')
  properties: {
    roleDefinitionId: acrPullRole.id
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, containerApp.id, 'kvsecretsuser')
  properties: {
    roleDefinitionId: kvSecretsUserRole.id
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output environmentId string = environment.id
output environmentName string = environment.name
output containerAppName string = containerApp.name
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppPrincipalId string = containerApp.identity.principalId
