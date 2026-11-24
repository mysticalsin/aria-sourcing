/* Run work after the HTTP response, so Odoo's webhook call (1 s timeout) gets
   its answer at once. A module of its own so tests can run the task inline. */

import { after } from "next/server";

export function afterResponse(task: () => Promise<unknown>): void {
  after(task);
}
