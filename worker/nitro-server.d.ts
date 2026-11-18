/** Nitro's `cloudflare_module` entry (`.output/server/index.mjs`), mapped to `#nitro-server` by `alias` in `wrangler.jsonc`. */
declare module '#nitro-server' {
  const nitro: {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
  }
  export default nitro
}
