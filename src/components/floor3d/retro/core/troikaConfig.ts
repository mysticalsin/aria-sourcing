/**
 * Run troika text layout on the main thread instead of a Web Worker.
 *
 * drei's <Text> (used for agent nameplates) defaults to spawning a worker from
 * a `blob:` URL. The app's Content-Security-Policy is `script-src 'self'
 * 'unsafe-inline' 'unsafe-eval'` with no `worker-src`, so the blob worker is
 * blocked and the console fills with CSP violations. Main-thread layout sidesteps
 * the worker entirely without loosening the CSP. The import is a one-time
 * side effect; pulling it into the scene module guarantees it runs before any
 * <Text> mounts.
 */
import { configureTextBuilder } from "troika-three-text";

configureTextBuilder({ useWorker: false });
