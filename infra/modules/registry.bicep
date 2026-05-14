// Azure Container Registry (Basic SKU — ~$5/mo, first 10 GB included).
// Admin user stays disabled; CD authenticates via workload identity federation
// + RBAC. The Container App's system-assigned managed identity gets AcrPull at
// deploy time so it can resolve image references.

@description('Region for the registry.')
param location string

@description('Short app name.')
param appName string

@description('Suffix appended to globally-scoped resource names.')
param nameSuffix string

@description('Tags applied to every resource.')
param tags object

// ACR names: 5-50 chars, alphanumeric only, globally unique.
var registryName = take(toLower('${appName}acr${nameSuffix}'), 50)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    anonymousPullEnabled: false
    dataEndpointEnabled: false
    networkRuleBypassOptions: 'AzureServices'
    zoneRedundancy: 'Disabled'
  }
}

output id string = acr.id
output name string = acr.name
output loginServer string = acr.properties.loginServer
