// ─────────────────────────────────────────────────────────────
// api.js — thin client for the DeviantArt endpoints this app uses.
// All calls require a bearer token from auth.js.
// ─────────────────────────────────────────────────────────────

// Routed through our helper, not deviantart.com directly: the API endpoints
// send no CORS headers, so the browser can't read their responses cross-origin.
// The helper forwards each GET (Authorization header included) to the matching
// https://www.deviantart.com/api/v1/oauth2/... URL and returns it with CORS.
const API_BASE = CONFIG.PROXY_BASE.replace(/\/+$/, "") + "/api/v1/oauth2";

async function apiGet(path, params = {}) {
  // May be null when signed out. That's fine for public endpoints: we send no
  // Authorization header and the proxy fills in its server-side app token.
  // Personal endpoints are gated client-side before they ever reach here.
  const token = await getValidAccessToken();

  const url = new URL(API_BASE + path);
  // Always ask DeviantArt to *include* mature results. Whether they're actually
  // shown is decided client-side by the "Allow mature content" toggle (see
  // buildOrder). Without this flag the browse/search endpoints silently omit
  // mature pieces server-side — which is why mature art never appeared for tag/
  // daily/watch/homepage sources even with the toggle on, while a user's own
  // gallery (which includes mature by default) did.
  if (params.mature_content === undefined) params.mature_content = true;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const data = await res.json();

  if (!res.ok || data.error) {
    if (data.error === "invalid_token" || res.status === 401) throw new AuthRequiredError();
    throw new Error(data.error_description || `DeviantArt API error (${res.status})`);
  }
  return data;
}

class AuthRequiredError extends Error {
  constructor() {
    super("Your DeviantArt session has expired. Please sign in again.");
    this.name = "AuthRequiredError";
  }
}

// ---- The signed-in user's identity (for the "signed in as …" label) ----------------------------------------------------
// Note: /user/whoami may require the "user" OAuth scope; callers should treat a
// failure here as "username unknown" rather than an error.

async function fetchWhoami() {
  return apiGet("/user/whoami");
}

// ---- Browse by tag (category-style browsing) ----------------------------------------------------

async function fetchByTag(tag, offset = 0, limit = 24) {
  return apiGet("/browse/tags", { tag, offset, limit });
}

// ---- A user's full gallery ("All" view) ----------------------------------------------------

async function fetchUserGalleryAll(username, offset = 0, limit = 24) {
  return apiGet("/gallery/all", { username, offset, limit, mode: "newest" });
}

// ---- A user's named gallery folders, and a specific folder's contents ----------------------------------------------------

async function fetchGalleryFolders(username, offset = 0, limit = 24) {
  return apiGet("/gallery/folders", { username, offset, limit });
}

async function fetchGalleryFolder(folderId, username, offset = 0, limit = 24) {
  return apiGet(`/gallery/${folderId}`, { username, offset, limit, mode: "newest" });
}

// ---- A user's favourites / collections ----------------------------------------------------

async function fetchCollectionFolders(username, offset = 0, limit = 24) {
  return apiGet("/collections/folders", { username, offset, limit });
}

async function fetchCollectionFolder(folderId, username, offset = 0, limit = 24) {
  return apiGet(`/collections/${folderId}`, { username, offset, limit });
}

// ---- Curated/feed sources ----------------------------------------------------

// One calendar day's picks. No pagination — DeviantArt returns the whole day's
// set directly. `date` is optional (YYYY-MM-DD); omitted means "today".
async function fetchDailyDeviations(date = null) {
  return apiGet("/browse/dailydeviations", date ? { date } : {});
}

// Requires the signed-in person's own Authorization Code session — this is
// their personal watch feed, not something a generic client-credentials
// token can see.
async function fetchDeviantsYouWatch(offset = 0, limit = 24) {
  return apiGet("/browse/deviantsyouwatch", { offset, limit });
}

async function fetchHomepage(offset = 0, limit = 24) {
  return apiGet("/browse/home", { offset, limit });
}

// ---- Per-deviation extras (tags, view counts, medium/category) — not included in list responses ----------------------------------------------------

async function fetchDeviationMetadata(deviationId) {
  const token = await getValidAccessToken(); // null when signed out — proxy uses the app token

  const url = new URL(API_BASE + "/deviation/metadata");
  url.searchParams.set("deviationids[0]", deviationId);
  url.searchParams.set("ext_stats", "true");
  url.searchParams.set("ext_submission", "true");

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const data = await res.json();

  if (!res.ok || data.error) {
    if (data.error === "invalid_token" || res.status === 401) throw new AuthRequiredError();
    throw new Error(data.error_description || `DeviantArt API error (${res.status})`);
  }
  return data.metadata && data.metadata[0] ? data.metadata[0] : null;
}

// ---- Normalize a deviation object from any of the above into what the slideshow needs ----------------------------------------------------

function normalizeDeviation(d, collectionOwner = null) {
  const image =
    d.content?.src ||
    (d.thumbs && d.thumbs.length ? d.thumbs[d.thumbs.length - 1].src : null);

  // Premium Deviations / Premium Galleries (tier or subscription locked). When
  // the signed-in account doesn't have access, DeviantArt only serves a blurred
  // teaser, so these get dropped from the rotation (see buildOrder).
  const premium = d.premium_folder_data;
  const isLocked = !!(premium && premium.has_access === false);

  return {
    id: d.deviationid,
    title: d.title || "Untitled",
    artist: d.author?.username || "Unknown artist",
    // Only meaningful when browsing a collection (favourites) folder, where
    // the person who favourited it differs from the artist who made it.
    collectionOwner,
    url: d.url,
    imageSrc: image,
    isMature: !!d.is_mature,
    isLocked,
    // DeviantArt flags AI work via is_ai_generated on the deviation (and, on
    // some responses, nested under tier/premium-folder data). Best-effort: if
    // the flag isn't present we can't know, so it isn't filtered.
    isAiGenerated: !!(d.is_ai_generated || d.ai_generated),
    publishedTime: d.published_time || null, // unix seconds, as a string
    favourites: d.stats?.favourites ?? null,
    comments: d.stats?.comments ?? null,
  };
}
