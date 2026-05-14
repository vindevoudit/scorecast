// Postgres Flexible Server (B1ms — 1 vCPU, 2 GB RAM, ~$13/mo).
//
// Public network access is ENABLED with a firewall rule allowing Azure
// services. This is the cost-pragmatic choice at this scale; VNet integration
// would require a workload-profile Container Apps environment (~$60/mo
// overhead). Revisit if security posture demands network isolation.
//
// Connection string is written directly into Key Vault as `database-url` so
// the app can reference it as a Container App secret without touching plaintext.

@description('Region for the server.')
param location string

@description('Short app name.')
param appName string

@description('Suffix appended to globally-scoped resource names.')
param nameSuffix string

@description('Tags applied to every resource.')
param tags object

@description('Name of the Key Vault to write the connection string into.')
param keyVaultName string

@description('Postgres admin password. Stored in Key Vault, never echoed.')
@secure()
param pgAdminPassword string

var serverName = take('${appName}-pg-${nameSuffix}', 63)
var adminUsername = 'scorecast_admin'
var databaseName = 'scorecast'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: adminUsername
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

// Allow Azure-internal services (Container Apps + portal) to connect.
// 0.0.0.0/0.0.0.0 is the magic range that means "Azure services".
resource fwAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Default application database.
resource appDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Existing Key Vault reference for secret writes.
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource pgConnSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgres://${adminUsername}:${pgAdminPassword}@${server.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}

resource pgAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'postgres-admin-password'
  properties: {
    value: pgAdminPassword
  }
}

output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = databaseName
