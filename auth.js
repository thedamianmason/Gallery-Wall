// ─────────────────────────────────────────────────────────────
// auth.js — OAuth 2.1 Authorization Code + PKCE, public client.
// No client_secret anywhere in this file, by design.
// ─────────────────────────────────────────────────────────────

const AUTH_BASE = "https://www.deviantart.com/oauth2/authorize";
// Token exchange + refresh go through our own helper, not DeviantArt directly:
// DeviantArt's /oauth2/token replies 200 but blocks the cross-origin read, so
// the browser never sees the JSON. The helper forwards the request server-side
// and returns it with CORS headers. See netlify/functions/proxy.mjs.
const TOKEN_URL = CONFIG.PROXY_BASE.replace(/\/+$/, "") + "/token";
const STORAGE_KEY = "da_slideshow_tokens";

// ---- PKCE helpers ----------------------------------------------------

function randomVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- Token storage ----------------------------------------------------

function saveTokens(tokenResponse) {
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    // store an absolute expiry so we don't need to track "issued at" separately
    expires_at: Date.now() + tokenResponse.expires_in * 1000,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return record;
}

function loadTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearTokens() {
  localStorage.removeItem(STORAGE_KEY);
}

// ---- Step 1: kick off login ----------------------------------------------------

async function beginLogin() {
  const verifier = randomVerifier();
  const challenge = await sha256Base64Url(verifier);
  const state = randomVerifier(16);

  // code_verifier and state must survive the redirect round-trip
  sessionStorage.setItem("da_pkce_verifier", verifier);
  sessionStorage.setItem("da_oauth_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: CONFIG.SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${AUTH_BASE}?${params.toString()}`;
}

// ---- Step 2: callback.html calls this after redirect back ----------------------------------------------------

async function completeLogin(code, state) {
  const expectedState = sessionStorage.getItem("da_oauth_state");
  const verifier = sessionStorage.getItem("da_pkce_verifier");

  if (!verifier || state !== expectedState) {
    throw new Error("Login could not be verified (state mismatch). Please try again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    code,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || "Could not complete login.");
  }

  sessionStorage.removeItem("da_pkce_verifier");
  sessionStorage.removeItem("da_oauth_state");

  return saveTokens(data);
}

// ---- Step 3: refresh when expired ----------------------------------------------------

async function refreshTokens(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CONFIG.CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || "Session expired. Please sign in again.");
  }

  return saveTokens(data);
}

// ---- Public: always returns a valid access token, or null if login is needed ----------------------------------------------------

async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens) return null;

  const stillValid = Date.now() < tokens.expires_at - 60_000; // 1 min buffer
  if (stillValid) return tokens.access_token;

  if (!tokens.refresh_token) {
    clearTokens();
    return null;
  }

  try {
    tokens = await refreshTokens(tokens.refresh_token);
    return tokens.access_token;
  } catch {
    clearTokens();
    return null;
  }
}

function logout() {
  clearTokens();
}
