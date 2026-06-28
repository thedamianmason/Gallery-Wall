# Gallery Wall — a museum-style DeviantArt slideshow

Turn any screen into a quiet, fullscreen gallery wall. Gallery Wall pulls
artwork from [DeviantArt](https://www.deviantart.com) and shows it as a
slow, museum-style slideshow — each piece framed on a dark stage with a
wall label (title, artist, medium, tags) and an optional scan-to-view QR
code so visitors at an unattended display can jump straight to the original.

It's a single-page web app: **vanilla HTML/CSS/JS, no build step, no
framework**, plus one tiny serverless function that acts as a CORS helper for
DeviantArt's API. It installs as a PWA and runs full-screen on a phone, tablet,
TV browser, kiosk, or digital picture frame.

> **Want the easy button?** Pre-built, signed apps for **Google Play, the
> Apple App Store, Microsoft Store, Samsung, and Steam** are available — no
> setup, automatic updates, and they support development of this project. This
> repository is the **do-it-yourself** version for people who'd rather host it
> themselves. Both run the same app.

---

## Features

- **Sources:** a tag/topic, Daily Deviations (single day or a date range),
  Deviants You Watch, the DeviantArt homepage feed, any user's full gallery, a
  gallery folder, a collection (favourites) folder, or *your* favourites.
- **Signed-out public browsing** (optional) — with a server-side app token,
  visitors can view Daily Deviations / tags / public galleries without logging
  in. Personal feeds still require sign-in.
- **Museum wall label** with title, artist, medium, tags — collapses mid-slide
  to give the art room, and can be hidden entirely.
- **Scan-to-view QR code** generated locally (no third-party service) so an
  unattended display can hand viewers the link to the piece on screen.
- **Filters:** skip mature content (default), hide AI-generated art, and skip
  premium/locked pieces that would only show a blurred teaser.
- **Controls:** play/pause, prev/next, shuffle, adjustable seconds-per-slide,
  tap-to-pause, swipe on touch, keyboard shortcuts, double-tap fullscreen.
- **Share** the current piece to a dozen networks or the device share sheet.
- **Installable PWA**, offline-tolerant shell, light/serif or sans title font.
- **Accessibility:** built to WCAG 2.2 (AA throughout, AAA where practical) —
  semantic HTML, focus management, a focus-trapped settings dialog, visible
  high-contrast focus rings, 44px touch targets, reduced-motion support, and a
  polite live region announcing each slide.

---

## How it works

```
Browser (this static site)
   │
   │  1. Sign-in: top-level redirect to deviantart.com  (OAuth 2.1 + PKCE,
   │     public client — no secret in the browser)
   │
   │  2. Token exchange + every API read go through your proxy, because
   │     DeviantArt sends NO CORS headers on its token or API endpoints:
   ▼
Netlify Function (netlify/functions/proxy.mjs)
   │     • POST /token            → deviantart.com/oauth2/token
   │     • GET  /api/v1/oauth2/*  → deviantart.com/api/v1/oauth2/*
   ▼
DeviantArt API
```

The function also (optionally) mints a **client-credentials "app token"** on
the server so signed-out visitors can see public sources. That's the only place
a client secret is used, and it lives in a server environment variable — never
in the browser, never in this repo.

---

## Self-host setup

You need a free [Netlify](https://www.netlify.com) account and a DeviantArt
account. No Node, npm, or build tooling required locally — Netlify builds it.

### 1. Register a DeviantArt application

1. Go to <https://www.deviantart.com/developers/apps> and create an app
   (**Client type: Public**).
2. Note the **Client ID** (you'll paste it into `config.js`). The Client ID is
   not a secret.
3. You'll add the **OAuth2 Redirect URI** in step 3, once you know your site
   URL.

### 2. Deploy to Netlify

1. Fork this repo (or push a copy to your own GitHub).
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
3. Build settings: **Publish directory = `.`**, **Functions directory =
   `netlify/functions`** (already set in `netlify.toml` — just don't override
   the publish directory).
4. Deploy. Note your site URL, e.g. `https://your-site.netlify.app`.

### 3. Configure `config.js`

Edit [`config.js`](config.js) and set:

```js
CLIENT_ID:  "12345",                          // your DeviantArt Client ID
PROXY_BASE: "https://your-site.netlify.app",  // your Netlify site URL
```

Then, back in your DeviantArt app settings, add this to the **OAuth2 Redirect
URI Whitelist** (it must match exactly):

```
https://your-site.netlify.app/callback.html
```

Commit and let Netlify redeploy. Sign in — you should be able to load artwork.

### 4. (Optional) Signed-out public browsing

To let visitors view public sources (Daily Deviations, tags, public galleries)
**without** signing in, give the proxy a client-credentials app token:

1. In your DeviantArt app settings, find the **client secret**. (It's on the
   app's edit screen, below the Client ID. Not every app is authorized for the
   `client_credentials` grant — if minting fails with `unauthorized_client`,
   the app needs that grant enabled/approved by DeviantArt.)
2. In Netlify → **Site configuration → Environment variables**, add:
   - `DA_CLIENT_ID` = your Client ID
   - `DA_CLIENT_SECRET` = your client secret
   - `ALLOWED_ORIGINS` = `https://your-site.netlify.app` (your site's origin)
3. Trigger a redeploy.

Without these, signed-out API calls go out anonymously and DeviantArt rejects
them — the app simply prompts visitors to sign in instead. Nothing breaks.

### Run locally (optional)

Serve the folder over `http://localhost:8000` (e.g. `python -m http.server
8000`). The proxy still has to be the deployed Netlify one — set `PROXY_BASE`
to your Netlify URL. `localhost:8000` is already in the proxy's allowed origins.

---

## Project layout

| File | Purpose |
|---|---|
| `index.html` | App shell, settings dialog |
| `style.css` | All styling (design tokens, stage, panel, responsive) |
| `config.js` | **The one file you edit** (Client ID, proxy URL) |
| `auth.js` | OAuth 2.1 + PKCE sign-in / token refresh |
| `api.js` | DeviantArt API client + deviation normalization |
| `app.js` | Slideshow engine, settings, sharing, quick-start |
| `qrcode.js` | Self-contained QR generator (no dependencies) |
| `sw.js` | Service worker (network-first shell, never caches API/token) |
| `callback.html` | OAuth redirect target |
| `manifest.webmanifest`, `icon.svg` | PWA install metadata |
| `netlify/functions/proxy.mjs` | The CORS helper / token proxy |
| `netlify.toml` | Netlify build config |

---

## License

Licensed under the **PolyForm Noncommercial License 1.0.0** — see
[`LICENSE.md`](LICENSE.md). In plain English: **use it, modify it, and
self-host it freely for any noncommercial purpose**, but please don't sell it
or redistribute it commercially. The official paid app-store builds are how
this project sustains itself.

This project is not affiliated with or endorsed by DeviantArt. "DeviantArt" is
a trademark of its owner. Your use of the DeviantArt API is subject to
DeviantArt's own terms.

## Credits

Built by **Damian Mason & Sapient Technologies**.
