import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Env } from '../lib/types';

// Create a Drizzle client bound to this request's D1 instance.
// On Workers, bindings live on env (per request), never at module top level.
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type DB = ReturnType<typeof getDb>;
export { schema };
