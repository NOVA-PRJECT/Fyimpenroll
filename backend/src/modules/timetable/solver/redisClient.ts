import { Redis } from '@upstash/redis';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      // In local dev without Redis, mock minimal set/get interface
      return {
        async get(key: string) {
          return null;
        },
        async set(key: string, value: any, opts?: any) {
          return 'OK';
        },
      } as unknown as Redis;
    }
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}
