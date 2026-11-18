/** Written by `scripts/csp-hashes.mjs` in `npm run build:cloudflare` (git-ignored); `wrangler` bundles it into the Worker. */
declare module '*csp-hashes.generated.json' {
  const generated: { scriptHashes: string[] }
  export default generated
}
