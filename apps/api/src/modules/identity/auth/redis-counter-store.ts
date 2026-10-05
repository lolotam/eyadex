import type { Redis } from "ioredis";

import type { CounterHit, CounterStore } from "./rate-limiter.ts";

// INCR and the window start in one atomic script: no request can land between them and leave a key
// without an expiry. A key that somehow lost its TTL gets a fresh window instead of living forever.
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** عدّادات الـ rate limit في Redis، بسكربت Lua ذرّي واحد لكل زيادة. */
export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: Redis) {}

  /**
   * بيزوّد العدّاد ويبدأ نافذته لو جديد، في خطوة ذرّية.
   *
   * @param key مفتاح العدّاد
   * @param windowMs طول النافذة
   * @returns العدد والوقت الباقي
   */
  async increment(key: string, windowMs: number): Promise<CounterHit> {
    const [count, ttlMs] = (await this.redis.eval(SCRIPT, 1, key, String(windowMs))) as [
      number,
      number,
    ];
    return { count, ttlMs };
  }
}
