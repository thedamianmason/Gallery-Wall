// ─────────────────────────────────────────────────────────────
// EDIT THIS FILE when you register your app or move hosts.
// Nothing else in the project needs to change. See README.md → Setup.
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // Your DeviantArt app's Client ID.
  // Register one at https://www.deviantart.com/developers/register
  // (Client type: "Public"). The Client ID is not a secret — it's fine to
  // commit it. Paste yours below, replacing the placeholder.
  CLIENT_ID: "YOUR_DEVIANTART_CLIENT_ID",

  // Must exactly match a Redirect URI registered for your app.
  // Leave this as-is; it auto-builds from wherever the app is hosted, as
  // long as callback.html sits next to index.html. This must compute the
  // SAME value regardless of which page (index.html or callback.html)
  // loads this file, since both load it and both need the redirect_uri
  // to match exactly for DeviantArt to accept the token exchange.
  //
  // Whatever this resolves to (e.g. https://your-site.netlify.app/callback.html)
  // must be added under "OAuth2 Redirect URI Whitelist" in your DeviantArt app.
  REDIRECT_URI: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "callback.html",

  // Space-separated OAuth scopes (a single string — NOT an array, which would
  // be comma-joined and rejected). "browse" covers public tag/gallery/collection
  // browsing; "user" enables the signed-in identity (/user/whoami, the
  // "signed in as …" label) and the personal "Deviants you watch" feed.
  SCOPES: "browse user",

  // Base URL of YOUR deployed CORS helper (see netlify/functions/proxy.mjs). It
  // does two jobs, because DeviantArt sends no CORS headers on either its token
  // endpoint OR its API endpoints, so the browser can't read those responses
  // directly:
  //   1. token exchange / refresh  → POST {PROXY_BASE}/token
  //   2. CORS proxy for API reads  → GET  {PROXY_BASE}/api/v1/oauth2/...
  // Only the authorize *redirect* still goes to deviantart.com directly (it's a
  // top-level navigation, not a fetch, so CORS doesn't apply there).
  //
  // If you deploy the whole project to one Netlify site (recommended), this is
  // simply that site's URL — the functions live on the same origin. Replace the
  // placeholder with your Netlify site URL (trailing slash optional).
  PROXY_BASE: "https://YOUR-SITE.netlify.app",
};
