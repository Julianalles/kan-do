const encoder = new TextEncoder()

export const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Compares two secrets without leaking the position of the first difference (both are hashed first). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i)
  return diff === 0
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return safeEqual(expected, challenge)
}
