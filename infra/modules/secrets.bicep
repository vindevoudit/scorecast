// Key Vault (Standard tier, RBAC mode).
//
// The Container App's system-assigned managed identity will be granted
// `Key Vault Secrets User` so the app can resolve secret references in its
// `secrets` block at runtime. Provisioning the secret VALUES themselves is
// done by other modules (db.bicep stores the postgres connection) or
// post-deploy by a human (jwt-secret, resend-api-key etc).

@description('Region for the vault.')
param location string

@description('Short app name.')
param appName string

@description('Suffix appended to globally-scoped resource names.')
param nameSuffix string

@description('Tags applied to every resource.')
param tags object

// Key Vault names: 3-24 chars, alphanumeric + hyphens, globally unique.
var keyVaultName = take('${appName}-kv-${nameSuffix}', 24)

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

output id string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
