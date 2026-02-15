import { createClient, type RedisClientType } from 'redis'

let redisClientPromise: Promise<RedisClientType> | null = null

async function connectRedis() {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured')
  }

  const client = createClient({ url: redisUrl })

  client.on('error', (error) => {
    console.error('Redis client error', error)
  })

  await client.connect()
  return client
}

export async function getRedisClient() {
  if (!redisClientPromise) {
    redisClientPromise = connectRedis()
  }

  return redisClientPromise
}
