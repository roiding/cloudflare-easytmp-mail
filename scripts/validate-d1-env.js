import { validateDatabaseId } from './lib/env.js';

export function requireProductionD1DatabaseId(actionName = 'Production deployment') {
  try {
    return validateDatabaseId(process.env.CLOUDFLARE_D1_DATABASE_ID, actionName);
  } catch {
    console.error(`
================================================================================
[DEPLOYMENT BLOCKED] ${actionName} cannot proceed with missing or placeholder D1 database ID.

A real Cloudflare D1 Database ID (UUID) is strictly required to prevent deploying
placeholder bindings to production.

Please provide the database ID via the environment variable:
  export CLOUDFLARE_D1_DATABASE_ID="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"

You can create or inspect your production D1 database with:
  npx wrangler d1 create easytmp-mail
  npx wrangler d1 info easytmp-mail
================================================================================
`);
    process.exit(1);
  }
}
