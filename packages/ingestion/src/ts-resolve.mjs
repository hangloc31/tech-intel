// ESM resolve hook: maps TS-style `./x.js` specifiers to `./x.ts` sources.
// tsconfig uses NodeNext, which mandates `.js` specifiers, but Node's
// type-stripping resolver does not rewrite them — so `./x.js` fails at
// runtime even though `./x.ts` exists. This hook retries failed `.js`
// resolutions as `.ts`. Stdlib only, dev/worker runtime only.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (typeof specifier === "string" && specifier.endsWith(".js")) {
      try {
        return await next(specifier.slice(0, -3) + ".ts", context);
      } catch {
        // fall through to the original error below
      }
    }
    throw err;
  }
}
