/* The server switch for the whole Odoo integration (docs/odoo.md).
   Off unless ODOO_ENABLED=true: every /api/integrations/odoo/* route and the
   Odoo webhook answer 404 with ODOO_DISABLED_CODE, and the UI hides Odoo
   (Settings > Odoo, the campaign bar, the candidate action, the job import).
   Read at request time, so a restart with the new value is enough.
   No server imports: the client reads ODOO_DISABLED_CODE from here. */

export const ODOO_DISABLED_CODE = "odoo_disabled";

export function odooEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ODOO_ENABLED === "true";
}
