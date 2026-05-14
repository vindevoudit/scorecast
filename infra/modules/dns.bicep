// Azure DNS zone for the custom domain.
//
// Created only when main.bicep is given a non-empty `customDomain` param;
// the empty default for Chunk 3 means no zone is created. Chunk 4 sets the
// domain, deploys, and the zone gets the A/CNAME/TXT records for Container
// Apps custom-domain binding + managed certificate validation.

@description('Apex domain (e.g. scorecast.app). NS records of the registrar must point at this zone for Bicep-managed DNS.')
param customDomain string

@description('Tags applied to every resource.')
param tags object

resource zone 'Microsoft.Network/dnsZones@2018-05-01' = {
  name: customDomain
  // DNS zones are global; Bicep requires a location string but only 'global' is valid.
  location: 'global'
  tags: tags
  properties: {
    zoneType: 'Public'
  }
}

output zoneName string = zone.name
output nameServers array = zone.properties.nameServers
