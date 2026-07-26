/**
 * Bindings that `wrangler types` cannot see.
 *
 * Secrets are set with `wrangler secret put` rather than declared in wrangler.jsonc, so
 * they never appear in the generated `worker-configuration.d.ts`. Declaring them here
 * merges them into the same global `Env` interface.
 */
interface Env {
  /**
   * HMAC key for the signed /print/logbook URLs the nightly PDF is rendered from.
   *
   * Set with: wrangler secret put LOGBOOK_PDF_SIGNING_SECRET
   */
  LOGBOOK_PDF_SIGNING_SECRET: string;
}
