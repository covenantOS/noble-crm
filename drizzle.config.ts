import { defineConfig } from 'drizzle-kit';

// Generation only needs the dialect. Migrations are APPLIED with wrangler:
//   wrangler d1 migrations apply westchase-fieldservice --local
//   wrangler d1 migrations apply westchase-fieldservice --remote
export default defineConfig({
  out: './migrations',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
});
