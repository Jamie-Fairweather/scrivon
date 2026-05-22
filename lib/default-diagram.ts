export const DEFAULT_DIAGRAM = `graph TD

subgraph apis
salesApi
readApi
end

subgraph frontend
Client
DNS
CDN
lb
web
end

subgraph storage
dbPrimary[SQL Write Primary] -.- dbReplica[SQL Read Replicas]
store[Object Store]
end

Client --> DNS & CDN & lb[Load Balancer]
CDN --> store
lb --> web[Web Server] --> salesApi[Sales API] & readApi[Read API]
service[Sales Rank Service]

service --> dbPrimary & store
salesApi --> dbPrimary & store
readApi --> dbReplica & store & memoryCache[Memory Cache]
`
