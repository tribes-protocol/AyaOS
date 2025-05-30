/* eslint-disable @typescript-eslint/no-non-null-assertion */
// oauth.ts
import crypto from 'crypto'
import express, { RequestHandler } from 'express'
import open from 'open'
import { URL, URLSearchParams } from 'url'

/** ─── CONFIG ───────────────────────────────────────────────────────────── */
const CLIENT_ID = process.env.TWITTER_CLIENT_ID! // from your Developer Portal
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET! // for Confidential Apps
const REDIRECT_URI = 'http://localhost:3001/callback'
const PORT = 3001

/** ─── PKCE HELPERS ─────────────────────────────────────────────────────── */
function base64URLEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function sha256(buf: Buffer): Buffer {
  return crypto.createHash('sha256').update(buf).digest()
}

/** ─── GENERATE PKCE & STATE ────────────────────────────────────────────── */
const codeVerifier = base64URLEncode(crypto.randomBytes(32))
const codeChallenge = base64URLEncode(sha256(Buffer.from(codeVerifier)))
const state = base64URLEncode(crypto.randomBytes(16))

/** ─── BUILD AUTHORIZE URL ──────────────────────────────────────────────── */
const authUrl = new URL('https://x.com/i/oauth2/authorize')
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('client_id', CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set(
  'scope',
  'tweet.read tweet.write users.read offline.access' // offline.access ⇒ refresh token :contentReference[oaicite:0]{index=0}
)
authUrl.searchParams.set('state', state)
authUrl.searchParams.set('code_challenge', codeChallenge)
authUrl.searchParams.set('code_challenge_method', 'S256')

console.log('\n1) Open this URL to authorize:\n')
console.log(authUrl.toString(), '\n')
void open(authUrl.toString()) // auto-opens in your default browser

/** ─── START CALLBACK SERVER ───────────────────────────────────────────── */
const app = express()

const callbackHandler: RequestHandler = async (req, res) => {
  const { code, state: returnedState } = req.query
  if (typeof code !== 'string' || returnedState !== state) {
    res.status(400).send('❌ Invalid code or state')
    return
  }

  try {
    // 2) Exchange code for tokens
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Confidential clients must use Basic auth :contentReference[oaicite:1]{index=1}
        Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier
      })
    })

    const tokens = await tokenRes.json()
    if (!tokenRes.ok) throw tokens

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope,
      token_type: tokenType
    } = tokens

    res.send('<h1>✅ Authentication successful</h1><p>You can close this window.</p>')
    console.log('\n🎉 Tokens received:')
    console.log('  • Access Token :', accessToken)
    console.log('  • Refresh Token:', refreshToken)
    console.log('  • Expires In   :', expiresIn, 'seconds (≈2 hours by default)') // :contentReference[oaicite:2]{index=2}
    console.log('  • Scope        :', scope)
    console.log('  • Token Type   :', tokenType, '\n')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error fetching tokens:', err)
    res.status(500).send('Error during token exchange')
  }
}

app.get('/callback', callbackHandler)

app.listen(PORT, () => {
  console.log(`\n2) Waiting for OAuth callback on http://localhost:${PORT}/callback …\n`)
})
