// Registered via `node --import ./src/register-ts.mjs` (see package.json `worker`).
// Installs the local `.js` -> `.ts` resolve hook for type-stripped execution.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
