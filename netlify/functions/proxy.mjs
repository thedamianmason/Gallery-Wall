// ─────────────────────────────────────────────────────────────
// proxy.mjs — Netlify Function: DeviantArt CORS helper.
//
// Hosted on Netlify because DeviantArt's API returns 500 to authenticated
// requests coming from Cloudflare Worker IPs (the first approach tried).
// DeviantArt sends no CORS headers on either its token
// endpoint or its API, so a browser SPA can't read those responses directly.
// This function re-emits them with CORS headers:
//
//   POST {site}/token            → forwards to /oauth2/token (PKCE exchange +
//                                   refresh). Body is the form params.
//   GET  {site}/api/v1/oauth2/.. → forwards to the same path on
//                                   www.deviantart.com, passing the caller's
//                                   Authorization: Bearer header along.
//
// Not an open proxy: the Origin must be allow-listed, /token only accepts POST
// + the authorization_code/refresh_token grants, and the API path is pinned to
// /api/v1/oauth2/ GET only.
//
// Client-credentials fallback: when an API GET arrives with no Authorization
// header (a signed-out visitor), the function mints and caches a server-side
// client-credentials ("app") token and uses it, so public sources (Daily
// Deviations, tags, public galleries/collections) work without anyone signing
// in. This needs DA_CLIENT_ID + DA_CLIENT_SECRET set in the Netlify env; until
// they are, signed-out API calls go out anonymously and DeviantArt rejects
// them (the app then prompts sign-in). The secret never leaves the server and
// is never exposed to the browser — the SPA is still a public PKCE client for
// the per-user flow.
// ─────────────────────────────────────────────────────────────

const DA_ORIGIN = "https://www.deviantart.com";
const TOKEN_URL = DA_ORIGIN + "/oauth2/token";
const API_PREFIX = "/api/v1/oauth2/";
const ALLOWED_GRANTS = new Set(["authorization_code", "refresh_token"]);

// Origins allowed to call this helper. SET the ALLOWED_ORIGINS env var
// (comma-separated) in your Netlify dashboard to your own site's URL, e.g.
//   ALLOWED_ORIGINS = https://your-site.netlify.app,http://localhost:8000
// The localhost entry below keeps local testing working out of the box; add
// your deployed origin via the env var (or replace this default).
const DEFAULT_ORIGINS = "http://localhost:8000";

// A browser-like UA never hurts with DeviantArt's WAF (Node's fetch sends none
// by default).
const FWD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export default async (request) => {
  const url = new URL(request.url);
  const allowed = parseOrigins(process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS);

  // Same-origin requests (the app and this function share a Netlify origin)
  // send no Origin header on GETs, so a missing Origin is allowed. A *present*
  // Origin that isn't allow-listed is a cross-origin caller we reject.
  const origin = request.headers.get("Origin");
  const hasOrigin = !!origin;
  const allowOrigin = hasOrigin && originAllowed(origin, allowed) ? origin : null;
  const blocked = hasOrigin && !allowOrigin;

  // ---- CORS preflight ----
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: blocked ? 403 : 204,
      headers: corsHeaders(allowOrigin),
    });
  }

  if (blocked) {
    return json({ error: "origin_not_allowed" }, 403, null);
  }

  // ---- route ----
  if (request.method === "POST" && url.pathname === "/token") {
    return handleToken(request, allowOrigin);
  }
  if (request.method === "GET" && url.pathname.startsWith(API_PREFIX)) {
    return handleApi(request, url, allowOrigin);
  }

  return json({ error: "not_found" }, 404, allowOrigin);
};

// Bind these URL paths directly to the function (no netlify.toml redirects).
export const config = { path: ["/token", "/api/v1/oauth2/*"] };

// ---- token exchange / refresh ----

async function handleToken(request, allowOrigin) {
  let form;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return json({ error: "invalid_request", error_description: "Malformed body." }, 400, allowOrigin);
  }

  if (!ALLOWED_GRANTS.has(form.get("grant_type"))) {
    return json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are proxied." },
      400,
      allowOrigin,
    );
  }

  let upstream;
  try {
    upstream = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { ...FWD_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    return json({ error: "upstream_unreachable", error_description: "Could not reach DeviantArt." }, 502, allowOrigin);
  }

  return relay(upstream, allowOrigin);
}

// ---- API read proxy ----

async function handleApi(request, url, allowOrigin) {
  // Path is pinned to /api/v1/oauth2/... so this can't reach arbitrary hosts.
  const target = DA_ORIGIN + url.pathname + url.search;

  const headers = { ...FWD_HEADERS };
  const auth = request.headers.get("Authorization");
  if (auth) {
    // Signed-in caller: forward their personal bearer token untouched.
    headers["Authorization"] = auth;
  } else {
    // Signed-out caller: fall back to the server-side app token so public
    // endpoints still work. If the secret isn't configured this is null and the
    // request goes out anonymously (DeviantArt will then reject it).
    const appToken = await getAppToken();
    if (appToken) headers["Authorization"] = `Bearer ${appToken}`;
  }

  let upstream;
  try {
    upstream = await fetch(target, { method: "GET", headers });
  } catch {
    return json({ error: "upstream_unreachable", error_description: "Could not reach DeviantArt." }, 502, allowOrigin);
  }

  return relay(upstream, allowOrigin);
}

// ---- server-side client-credentials ("app") token ----
// Cached in module scope so a warm function container reuses it until it nears
// expiry. Cold starts simply re-mint. Used only for signed-out callers.

let appTokenCache = { token: null, exp: 0 };

async function getAppToken() {
  const id = process.env.DA_CLIENT_ID;
  const secret = process.env.DA_CLIENT_SECRET;
  if (!id || !secret) return null; // not configured — stay anonymous

  const now = Date.now();
  if (appTokenCache.token && now < appTokenCache.exp - 30000) return appTokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { ...FWD_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) return null;

  appTokenCache = {
    token: data.access_token,
    exp: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return appTokenCache.token;
}

// ---- helpers ----

async function relay(upstream, allowOrigin) {
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(allowOrigin) },
  });
}

function parseOrigins(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin, allowed) {
  if (allowed.length === 0) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}

function corsHeaders(allowOrigin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) h["Access-Control-Allow-Origin"] = allowOrigin;
  return h;
}

function json(obj, status, allowOrigin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(allowOrigin) },
  });
}
