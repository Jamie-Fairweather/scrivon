export const DEFAULT_DIAGRAM = `graph TB

subgraph apis[APIs]
salesApi[Sales API]
readApi[Read API]
end

subgraph frontend[Front-end]
Client
DNS
CDN
lb[Load Balancer]
web[Web Server] 
end

subgraph storage[Storage]
dbPrimary[SQL Write Primary] -.- dbReplica[SQL Read Replicas]
store[Object Store]
end

Client --> DNS & CDN & lb
CDN --> store
lb --> web --> salesApi & readApi
service[Sales Rank Service]

service --> dbPrimary & store
salesApi --> dbPrimary & store
readApi --> dbReplica & store & memoryCache[Memory Cache]
`
