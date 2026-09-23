import { defaultConnectors, runOnce } from "./pipeline.js";

const once = process.argv.includes("--once");
const results = await runOnce(defaultConnectors());
console.log(JSON.stringify({ at: new Date().toISOString(), once, results }, null, 2));
