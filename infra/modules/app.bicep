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

@description('Resource id of the Azure-managed cert bound to customDomain. Empty when customDomain is empty. Discover via `az containerapp env certificate list`.')
param customDomainCertId string = ''

@description('VAPID public key for Web Push. Generate locally with `npx web-push generate-vapid-keys`; this half is safe to put in source/params (sent to every browser at /api/push/vapid-public-key). Leave empty until Web Push goes live — PushService gracefully no-ops without it.')
param vapidPublicKey string = ''

@description('mailto:/https: URL the push provider uses for abuse reports. No secret value.')
param vapidSubject string = 'mailto:vindevoudit@gmail.com'

var environmentName = '${appName}-env-${nameSuffix}'
var containerAppName = '${appName}-app'

// Public URL used by CORS_ORIGINS + PUBLIC_APP_URL. Defaults to the Container
// Apps environment's HTTPS hostname when no custom domain is bound (Chunk 3),
// and switches to https://<customDomain> once Chunk 4 adds the apex domain.
var defaultPublicUrl = 'https://${containerAppName}.${environment.properties.defaultDomain}'
var publicAppUrl = empty(customDomain) ? defaultPublicUrl : 'https://${customDomain}'

// Outbound email sender. When customDomain is bound AND verified at Resend
// (see https://resend.com/domains), use noreply@<custom-domain>; otherwise
// fall back to Resend's shared sandbox sender which only delivers to the
// Resend account holder's own email.
var emailFrom = empty(customDomain) ? 'Bantryx <onboarding@resend.dev>' : 'Bantryx <noreply@${customDomain}>'

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
        customDomains: empty(customDomain) ? [] : [
          {
            name: customDomain
            bindingType: 'SniEnabled'
            certificateId: customDomainCertId
          }
        ]
      }
      // Registries/secrets/env are ALWAYS populated, regardless of imageTag.
      // The placeholder image branch only changes which IMAGE the container
      // runs — it doesn't (and shouldn't) clear the config that the real
      // image will need once CD swaps it in. Earlier ternaries here cleared
      // these fields on every Bicep reapply with default imageTag, which
      // silently broke CD's `az containerapp update --image` (no registry
      // auth) AND any new revision spun up afterwards (no env / secrets).
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      secrets: [
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
        // Tier 4b — football-data.org v4 API key for fixture sync + live
        // scores. Seeded into Key Vault by hand (the value is plan-tier
        // sensitive and shouldn't be templated). Without this, the cron
        // jobs in lib/jobs/ silently no-op and admin manual syncs return
        // 503 with `football_api_unconfigured`.
        {
          name: 'football-data-api-key'
          keyVaultUrl: 'https://${keyVaultName}${az.environment().suffixes.keyvaultDns}/secrets/football-data-api-key'
          identity: 'system'
        }
        // PWA Chunk 4 — VAPID private key for Web Push. Seed the KV entry
        // BEFORE the first Bicep reapply that picks this up (same pattern as
        // jwt-secret / resend-api-key / football-data-api-key — see CLAUDE.md
        // "always-populated registries/secrets/env" note). Without the KV
        // value present, the deploy fails on the secretRef. Without the env
        // value populated at runtime, PushService.init() logs a warn and
        // every sendToUser call no-ops — push routes return 503 cleanly.
        {
          name: 'vapid-private-key'
          keyVaultUrl: 'https://${keyVaultName}${az.environment().suffixes.keyvaultDns}/secrets/vapid-private-key'
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
          // Env vars always populated. The helloworld placeholder image
          // simply ignores them; the real ScoreCast image needs them present
          // in the resource config so any new revision spun up by CD picks
          // them up. publicAppUrl falls back to the Azure-issued FQDN when
          // no custom domain is bound.
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'PUBLIC_APP_URL', value: publicAppUrl }
            { name: 'CORS_ORIGINS', value: publicAppUrl }
            { name: 'EMAIL_FROM', value: emailFrom }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'RESEND_API_KEY', secretRef: 'resend-api-key' }
            { name: 'FOOTBALL_DATA_API_KEY', secretRef: 'football-data-api-key' }
            { name: 'VAPID_PUBLIC_KEY', value: vapidPublicKey }
            { name: 'VAPID_PRIVATE_KEY', secretRef: 'vapid-private-key' }
            { name: 'VAPID_SUBJECT', value: vapidSubject }
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
              // Tier 20 Chunk 7 — readiness pings DB via /readyz so the
              // ACA load balancer pulls the replica out of rotation
              // when the DB is unreachable (vs. the prior /healthz
              // check which only verified the process was up).
              // Liveness stays on /healthz so transient DB outages
              // don't trigger container restarts.
              type: 'Readiness'
              httpGet: {
                path: '/readyz'
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
