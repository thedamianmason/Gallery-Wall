// ─────────────────────────────────────────────────────────────
// app.js — wires together auth, api, settings panel, and the
// slideshow engine itself.
// ─────────────────────────────────────────────────────────────

(function () {
  const els = {
    stage: document.getElementById("stage"),
    artwork: document.getElementById("artwork"),
    labelWrap: document.getElementById("labelWrap"),
    label: document.getElementById("label"),
    labelLink: document.getElementById("labelLink"),
    labelTitle: document.getElementById("labelTitle"),
    labelArtist: document.getElementById("labelArtist"),
    labelOwnerWrap: document.getElementById("labelOwnerWrap"),
    labelOwner: document.getElementById("labelOwner"),
    labelMediumWrap: document.getElementById("labelMediumWrap"),
    labelMedium: document.getElementById("labelMedium"),
    labelResolutionWrap: document.getElementById("labelResolutionWrap"),
    labelResolution: document.getElementById("labelResolution"),
    labelTags: document.getElementById("labelTags"),
    labelQr: document.getElementById("labelQr"),
    labelQrCanvas: document.getElementById("labelQrCanvas"),
    labelHideBtn: document.getElementById("labelHideBtn"),
    slideAnnouncer: document.getElementById("slideAnnouncer"),
    emptyState: document.getElementById("emptyState"),
    emptyStateMessage: document.getElementById("emptyStateMessage"),
    quickStart: document.getElementById("quickStart"),
    qsDailyCard: document.getElementById("qsDailyCard"),
    qsDailyThumb: document.getElementById("qsDailyThumb"),
    qsDailyTitle: document.getElementById("qsDailyTitle"),
    qsWatchCard: document.getElementById("qsWatchCard"),
    qsWatchThumb: document.getElementById("qsWatchThumb"),
    qsWatchTitle: document.getElementById("qsWatchTitle"),
    qsLoginBtn: document.getElementById("qsLoginBtn"),
    qsSettingsLink: document.getElementById("qsSettingsLink"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    viewOnDaBtn: document.getElementById("viewOnDaBtn"),
    canvasTapIndicator: document.getElementById("canvasTapIndicator"),
    stagePlayPauseBtn: document.getElementById("stagePlayPauseBtn"),
    settingsToggle: document.getElementById("settingsToggle"),
    panel: document.getElementById("panel"),
    panelClose: document.getElementById("panelClose"),

    authStatus: document.getElementById("authStatus"),
    signInBtn: document.getElementById("signInBtn"),
    signOutBtn: document.getElementById("signOutBtn"),

    sourceType: document.getElementById("sourceType"),
    tagField: document.getElementById("tagField"),
    tagInput: document.getElementById("tagInput"),
    tagHistory: document.getElementById("tagHistory"),
    usernameField: document.getElementById("usernameField"),
    usernameInput: document.getElementById("usernameInput"),
    usernameHistory: document.getElementById("usernameHistory"),
    folderField: document.getElementById("folderField"),
    folderSelect: document.getElementById("folderSelect"),
    dailyDateField: document.getElementById("dailyDateField"),
    dailyDateFrom: document.getElementById("dailyDateFrom"),
    dailyDateTo: document.getElementById("dailyDateTo"),
    deviantsYouWatchNote: document.getElementById("deviantsYouWatchNote"),
    loadBtn: document.getElementById("loadBtn"),
    sourceStatus: document.getElementById("sourceStatus"),

    speedInput: document.getElementById("speedInput"),
    speedDown: document.getElementById("speedDown"),
    speedUp: document.getElementById("speedUp"),
    shuffleToggle: document.getElementById("shuffleToggle"),
    matureToggle: document.getElementById("matureToggle"),
    aiToggle: document.getElementById("aiToggle"),
    canvasPauseToggle: document.getElementById("canvasPauseToggle"),
    qrToggle: document.getElementById("qrToggle"),
    titleFontSelect: document.getElementById("titleFontSelect"),
    playPauseBtn: document.getElementById("playPauseBtn"),

    shareLinks: document.getElementById("shareLinks"),
    shareDeviceBtn: document.getElementById("shareDeviceBtn"),
    shareStatus: document.getElementById("shareStatus"),
  };

  // ---- State ----------------------------------------------------

  let deviations = [];      // normalized list for the current source
  let order = [];            // indices into `deviations`, possibly shuffled
  let cursor = 0;            // position within `order`
  let timer = null;
  let labelMinimizeTimer = null;     // collapses the label to title+artist at half the slide time
  let canvasClickTimer = null;       // distinguishes a single canvas tap (pause/play) from a dblclick (fullscreen)
  let idleLanding = false;           // the quick-start landing is the current screen (vs artwork/empty)
  let labelHidden = false;           // sticky wall-label hidden state (persists across slides)
  let lastSwipeAt = 0;               // suppresses the click a swipe may also fire on touch devices
  let current = null;                // the deviation currently on screen, for share/view actions
  let isPlaying = true;
  let metadataRequestToken = 0;      // guards against a slow fetch landing after the user has moved on

  const settings = loadSettings();

  // ---- Settings persistence (non-secret prefs only; tokens live in auth.js storage) ----------------------------------------------------

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem("da_slideshow_settings")) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    const s = {
      sourceType: els.sourceType.value,
      tag: els.tagInput.value,
      username: els.usernameInput.value,
      folderId: els.folderSelect.value,
      dailyDateFrom: els.dailyDateFrom.value,
      dailyDateTo: els.dailyDateTo.value,
      speed: Number(els.speedInput.value),
      shuffle: els.shuffleToggle.checked,
      allowMature: els.matureToggle.checked,
      hideAi: els.aiToggle.checked,
      canvasPause: els.canvasPauseToggle.checked,
      showQr: els.qrToggle.checked,
      titleFont: els.titleFontSelect.value,
    };
    localStorage.setItem("da_slideshow_settings", JSON.stringify(s));
  }

  function applySettingsToForm() {
    els.sourceType.value = settings.sourceType || "dailyDeviations";
    els.tagInput.value = settings.tag || "";
    els.usernameInput.value = settings.username || "";
    els.dailyDateFrom.value = settings.dailyDateFrom || "";
    els.dailyDateTo.value = settings.dailyDateTo || "";
    els.speedInput.value = settings.speed || 12;
    els.shuffleToggle.checked = !!settings.shuffle;
    els.matureToggle.checked = !!settings.allowMature;
    els.aiToggle.checked = !!settings.hideAi;
    // Canvas tap-to-pause and the scan QR both default ON (undefined => true).
    els.canvasPauseToggle.checked = settings.canvasPause !== false;
    els.qrToggle.checked = settings.showQr !== false;
    els.titleFontSelect.value = settings.titleFont === "sans" ? "sans" : "serif";
    applyTitleFont(els.titleFontSelect.value);
    updateSourceFieldVisibility();
  }

  function applyTitleFont(font) {
    document.documentElement.classList.toggle("title-sans", font === "sans");
  }

  // ---- Recent tags / usernames / folders, for quick repeat use ----------------------------------------------------
  // Stored separately from settings: { tags: [...], usernames: [...], folders: { username: folderId } }.
  // Lists are most-recent-first, deduped (case-insensitive), capped.

  const HISTORY_KEY = "da_slideshow_history";
  const HISTORY_CAP = 15;

  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
      return { tags: h.tags || [], usernames: h.usernames || [], folders: h.folders || {} };
    } catch {
      return { tags: [], usernames: [], folders: {} };
    }
  }

  const recents = loadHistory();

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(recents));
  }

  function rememberValue(listName, value) {
    const v = (value || "").trim();
    if (!v) return;
    const list = recents[listName];
    const without = list.filter((x) => x.toLowerCase() !== v.toLowerCase());
    recents[listName] = [v, ...without].slice(0, HISTORY_CAP);
    saveHistory();
    renderHistory();
  }

  function rememberFolder(username, folderId) {
    const u = (username || "").trim().toLowerCase();
    if (!u || !folderId) return;
    recents.folders[u] = folderId;
    saveHistory();
  }

  function renderHistory() {
    fillDatalist(els.tagHistory, recents.tags);
    fillDatalist(els.usernameHistory, recents.usernames);
  }

  function fillDatalist(datalist, values) {
    if (!datalist) return;
    datalist.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
  }

  // ---- Auth UI ----------------------------------------------------

  let cachedUsername = null; // resolved once per session via whoami

  async function refreshAuthUI() {
    const token = await getValidAccessToken();
    if (token) {
      els.signInBtn.hidden = true;
      els.signOutBtn.hidden = false;
      if (!cachedUsername) {
        try {
          const me = await fetchWhoami();
          cachedUsername = (me && me.username) || null;
        } catch {
          cachedUsername = null; // whoami may need the "user" scope — fall back quietly
        }
      }
      els.authStatus.textContent = cachedUsername
        ? `Signed in to DeviantArt as ${cachedUsername}.`
        : "Signed in to DeviantArt.";
    } else {
      cachedUsername = null;
      els.authStatus.textContent =
        "Not signed in. Public art loads — sign in for your watches and favourites.";
      els.signInBtn.hidden = false;
      els.signOutBtn.hidden = true;
    }
    return !!token;
  }

  els.signInBtn.addEventListener("click", () => beginLogin());
  els.signOutBtn.addEventListener("click", async () => {
    logout();
    stopTimer();
    deviations = [];
    order = [];
    await refreshAuthUI();
    showQuickStart(false); // back to the signed-out landing
  });

  // ---- Settings panel open/close (dialog semantics: focus in, focus back out, trap Tab) ----------------------------------------------------

  let lastFocusedBeforePanel = null;

  function getFocusableInPanel() {
    return Array.from(
      els.panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function openPanel() {
    lastFocusedBeforePanel = document.activeElement;
    // Tuck the quick-start landing away while settings is open, so clicking its
    // cards/link behind the panel can't be read as an outside-click-to-close.
    if (idleLanding) els.quickStart.hidden = true;
    els.panel.hidden = false;
    // allow the browser to paint display:block before animating the transform
    requestAnimationFrame(() => els.panel.classList.add("is-open"));
    els.settingsToggle.setAttribute("aria-expanded", "true");
    const focusable = getFocusableInPanel();
    (focusable[0] || els.panel).focus();
  }

  function closePanel() {
    els.panel.classList.remove("is-open");
    if (idleLanding) els.quickStart.hidden = false; // bring the landing back when leaving settings
    els.settingsToggle.setAttribute("aria-expanded", "false");
    const onEnd = (e) => {
      if (e.target !== els.panel) return;
      els.panel.hidden = true;
      els.panel.removeEventListener("transitionend", onEnd);
    };
    els.panel.addEventListener("transitionend", onEnd);
    (lastFocusedBeforePanel || els.settingsToggle).focus();
  }

  function isPanelOpen() {
    return els.panel.classList.contains("is-open");
  }

  els.settingsToggle.addEventListener("click", () => (isPanelOpen() ? closePanel() : openPanel()));
  els.panelClose.addEventListener("click", closePanel);

  // Click anywhere outside the open panel (and not on the toggle) to close it.
  // openPanel adds .is-open on the next frame, so the opening click itself never
  // matches here.
  document.addEventListener("click", (e) => {
    if (!isPanelOpen()) return;
    if (els.panel.contains(e.target) || els.settingsToggle.contains(e.target)) return;
    closePanel();
  });

  // Trap Tab within the panel while it's open.
  els.panel.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = getFocusableInPanel();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---- Source type field visibility ----------------------------------------------------

  // "My Favourites (all)" uses the signed-in account itself, so it needs no
  // username field — it's intentionally absent from this list.
  const USERNAME_SOURCE_TYPES = ["userGalleryAll", "userGalleryFolder", "userCollectionFolder"];
  const FOLDER_SOURCE_TYPES = ["userGalleryFolder", "userCollectionFolder"];

  function updateSourceFieldVisibility() {
    const type = els.sourceType.value;
    els.tagField.hidden = type !== "tag";
    els.usernameField.hidden = !USERNAME_SOURCE_TYPES.includes(type);
    els.folderField.hidden = !FOLDER_SOURCE_TYPES.includes(type);
    els.dailyDateField.hidden = type !== "dailyDeviations";
    els.deviantsYouWatchNote.hidden = type !== "deviantsYouWatch";
  }

  els.sourceType.addEventListener("change", () => {
    updateSourceFieldVisibility();
    els.folderSelect.innerHTML = `<option value="">Load a username first…</option>`;
  });

  // When username changes for a folder-based source, populate the folder dropdown.
  async function populateFolders() {
    const type = els.sourceType.value;
    const username = els.usernameInput.value.trim();
    if (!username || (type !== "userGalleryFolder" && type !== "userCollectionFolder")) return;

    els.folderSelect.innerHTML = `<option value="">Loading folders…</option>`;
    try {
      const data =
        type === "userGalleryFolder"
          ? await fetchGalleryFolders(username)
          : await fetchCollectionFolders(username);

      const folders = data.results || [];
      if (!folders.length) {
        els.folderSelect.innerHTML = `<option value="">No folders found</option>`;
        return;
      }
      els.folderSelect.innerHTML = folders
        .map((f) => `<option value="${f.folderid}">${escapeHtml(f.name)} (${f.size ?? "?"})</option>`)
        .join("");

      // Re-select the folder last used for this username, if it still exists.
      const remembered = recents.folders[username.toLowerCase()];
      if (remembered && folders.some((f) => f.folderid === remembered)) {
        els.folderSelect.value = remembered;
      }
    } catch (e) {
      els.folderSelect.innerHTML = `<option value="">Could not load folders</option>`;
      handleApiError(e);
    }
  }

  els.usernameInput.addEventListener("change", populateFolders);

  // ---- Loading artwork ----------------------------------------------------

  els.loadBtn.addEventListener("click", () => loadSource());

  // Sources that work for signed-out visitors via the proxy's server-side app
  // token. Personal feeds (your watches, your own favourites) are not here and
  // require a personal sign-in.
  const PUBLIC_SOURCE_TYPES = new Set([
    "tag",
    "dailyDeviations",
    "userGalleryAll",
    "userGalleryFolder",
    "userCollectionFolder",
  ]);

  async function loadSource() {
    // Capture this synchronously, before any await: only close the panel at the
    // end if the load was kicked off from inside the panel (the "Load artwork"
    // button). A load started from a quick-start card runs with the panel
    // closed — and if the user opens settings while it's still fetching, we must
    // not yank the panel shut out from under them when the fetch resolves.
    const startedFromPanel = isPanelOpen();
    const type = els.sourceType.value;
    const signedIn = await refreshAuthUI();
    if (!signedIn && !PUBLIC_SOURCE_TYPES.has(type)) {
      // Personal feeds need the user's own token — prompt the sign-in flow.
      els.sourceStatus.textContent = "Sign in required for this source — opening DeviantArt…";
      beginLogin();
      return;
    }

    saveSettings();
    els.quickStart.hidden = true; // leave the idle landing as soon as a load starts
    els.sourceStatus.textContent = "Loading…";
    els.loadBtn.disabled = true;

    try {
      let results = [];
      let collectionOwner = null;

      if (type === "tag") {
        const tag = els.tagInput.value.trim();
        if (!tag) throw new Error("Enter a tag to browse.");
        results = await collectPages((offset) => fetchByTag(tag, offset), 96);
      } else if (type === "userGalleryAll") {
        const username = els.usernameInput.value.trim();
        if (!username) throw new Error("Enter a username.");
        results = await collectPages((offset) => fetchUserGalleryAll(username, offset), 96);
      } else if (type === "userGalleryFolder") {
        const username = els.usernameInput.value.trim();
        const folderId = els.folderSelect.value;
        if (!username || !folderId) throw new Error("Choose a username and folder.");
        results = await collectPages((offset) => fetchGalleryFolder(folderId, username, offset), 96);
      } else if (type === "userCollectionFolder") {
        const username = els.usernameInput.value.trim();
        const folderId = els.folderSelect.value;
        if (!username || !folderId) throw new Error("Choose a username and folder.");
        results = await collectPages((offset) => fetchCollectionFolder(folderId, username, offset), 96);
        collectionOwner = username;
      } else if (type === "userFavouritesAll") {
        // The signed-in user's own favourites. Pass no username so the API uses
        // the authenticated account. DeviantArt has no single "all favourites"
        // endpoint, so walk the account's collection folders up to the cap.
        results = await collectFavouritesAll("", 96);
      } else if (type === "dailyDeviations") {
        // Each call returns one day's picks (no paging). A from–to range walks
        // the days and concatenates; a single/blank date is just one day.
        const from = els.dailyDateFrom.value;
        const to = els.dailyDateTo.value;
        if (from && to) {
          results = await collectDailyRange(from, to, 96);
        } else {
          const data = await fetchDailyDeviations(from || to || null);
          results = data.results || [];
        }
      } else if (type === "deviantsYouWatch") {
        results = await collectPages((offset) => fetchDeviantsYouWatch(offset), 96);
      } else if (type === "homepage") {
        results = await collectPages((offset) => fetchHomepage(offset), 96);
      }

      deviations = results
        .map((d) => normalizeDeviation(d, collectionOwner))
        .filter((d) => d.imageSrc);

      if (!deviations.length) {
        els.sourceStatus.textContent = "No artwork found for that source.";
        showEmptyState("No artwork found for that source.");
        return;
      }

      buildOrder();
      if (!order.length) {
        els.sourceStatus.textContent = FILTERED_OUT_MESSAGE;
        showEmptyState(FILTERED_OUT_MESSAGE);
        return;
      }

      els.sourceStatus.textContent = `Loaded ${order.length} piece${order.length === 1 ? "" : "s"}.`;

      // Remember the inputs that produced a working load, for quick repeat use.
      if (type === "tag") rememberValue("tags", els.tagInput.value);
      if (type === "userGalleryAll" || type === "userGalleryFolder" || type === "userCollectionFolder") {
        rememberValue("usernames", els.usernameInput.value);
      }
      if (type === "userGalleryFolder" || type === "userCollectionFolder") {
        rememberFolder(els.usernameInput.value, els.folderSelect.value);
      }

      cursor = 0;
      hideEmptyState();
      showSlide(cursor);
      setPlaying(true);
      if (startedFromPanel) closePanel();
    } catch (e) {
      handleApiError(e, els.sourceStatus);
    } finally {
      els.loadBtn.disabled = false;
    }
  }

  // Page through an endpoint until has_more is false or we hit a cap.
  async function collectPages(fetchPage, cap) {
    let all = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore && all.length < cap) {
      const data = await fetchPage(offset);
      all = all.concat(data.results || []);
      hasMore = !!data.has_more;
      offset = data.next_offset ?? offset + (data.results?.length || 24);
    }
    return all;
  }

  // Gather a user's favourites across all their collection folders, up to a cap.
  async function collectFavouritesAll(username, cap) {
    const foldersData = await fetchCollectionFolders(username, 0, 50);
    const folders = foldersData.results || [];
    if (!folders.length) return [];
    let all = [];
    for (const folder of folders) {
      if (all.length >= cap) break;
      const remaining = cap - all.length;
      const items = await collectPages(
        (offset) => fetchCollectionFolder(folder.folderid, username, offset),
        remaining
      );
      all = all.concat(items);
    }
    return all;
  }

  // Gather Daily Deviations across an inclusive YYYY-MM-DD range (oldest→newest),
  // capped on total items and on the number of days walked.
  async function collectDailyRange(from, to, cap) {
    let start = from, end = to;
    if (start > end) [start, end] = [end, start]; // tolerate reversed inputs
    const MAX_DAYS = 60;
    let all = [];
    let days = 0;
    for (let d = new Date(start + "T00:00:00"); ; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > end || days >= MAX_DAYS || all.length >= cap) break;
      days++;
      try {
        const data = await fetchDailyDeviations(iso);
        all = all.concat(data.results || []);
      } catch {
        /* skip a day that fails (e.g. a future/empty date) and keep going */
      }
    }
    return all;
  }

  function handleApiError(e, statusEl) {
    if (e instanceof AuthRequiredError || e.name === "AuthRequiredError") {
      refreshAuthUI();
      if (statusEl) statusEl.textContent = e.message;
      stopTimer();
      showEmptyState(e.message);
      return;
    }
    if (statusEl) statusEl.textContent = e.message || "Something went wrong.";
    console.error(e);
  }

  // ---- Ordering / shuffle ----------------------------------------------------

  function buildOrder() {
    // Mature-flagged pieces are dropped from the rotation entirely unless
    // "Allow mature content" is on. AI-flagged pieces are dropped when "Hide
    // AI-generated art" is on. No gate — the slideshow just skips them.
    const allowMature = els.matureToggle.checked;
    const hideAi = els.aiToggle.checked;
    order = deviations
      .map((_, i) => i)
      .filter((i) => {
        const d = deviations[i];
        if (d.isLocked) return false; // premium/locked — only a blurred teaser is available
        if (!allowMature && d.isMature) return false;
        if (hideAi && d.isAiGenerated) return false;
        return true;
      });
    if (els.shuffleToggle.checked) shuffleArray(order);
  }

  const FILTERED_OUT_MESSAGE =
    "Nothing to show with the current filters. Try turning off “Hide AI-generated art” or turning on “Allow mature content”.";

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  els.shuffleToggle.addEventListener("change", () => {
    saveSettings();
    if (deviations.length) {
      buildOrder();
      cursor = 0;
      showSlide(cursor);
    }
  });

  function reapplyFilters() {
    saveSettings();
    if (!deviations.length) return;
    buildOrder(); // pieces enter or leave the rotation
    cursor = 0;
    if (order.length) {
      hideEmptyState();
      showSlide(cursor);
      if (isPlaying) startTimer();
    } else {
      stopTimer();
      showEmptyState(FILTERED_OUT_MESSAGE);
    }
  }

  els.matureToggle.addEventListener("change", reapplyFilters);
  els.aiToggle.addEventListener("change", reapplyFilters);

  function commitSpeed() {
    saveSettings();
    if (isPlaying) startTimer();
  }

  els.speedInput.addEventListener("change", commitSpeed);

  function nudgeSpeed(delta) {
    const min = Number(els.speedInput.min) || 2;
    const max = Number(els.speedInput.max) || 120;
    const next = Math.min(max, Math.max(min, (Number(els.speedInput.value) || 12) + delta));
    els.speedInput.value = next;
    commitSpeed();
  }
  els.speedDown.addEventListener("click", () => nudgeSpeed(-1));
  els.speedUp.addEventListener("click", () => nudgeSpeed(1));

  els.canvasPauseToggle.addEventListener("change", saveSettings);

  els.qrToggle.addEventListener("change", () => {
    saveSettings();
    renderLabelQr(current ? current.url : null);
  });

  els.titleFontSelect.addEventListener("change", () => {
    applyTitleFont(els.titleFontSelect.value);
    saveSettings();
  });

  // ---- Scan-to-view QR ----------------------------------------------------
  // Drawn locally by qrcode.js — no third-party service, no network call.

  function renderLabelQr(url) {
    if (!els.qrToggle.checked || !url || typeof QRCode === "undefined") {
      els.labelQr.hidden = true;
      return;
    }
    try {
      QRCode.render(els.labelQrCanvas, url, {
        ecl: QRCode.ECC.M,
        scale: 4,
        border: 2,
        dark: "#0c0b0a",
        light: "#ffffff",
      });
      els.labelQr.hidden = false;
    } catch {
      els.labelQr.hidden = true; // overly long URL or unsupported canvas — just skip it
    }
  }

  // ---- Slideshow engine ----------------------------------------------------

  function showSlide(pos) {
    if (!deviations.length) return;
    const idx = order[((pos % order.length) + order.length) % order.length];
    const d = deviations[idx];

    // The hide-label choice is sticky across slides (until toggled back), but
    // the half-time minimize resets each slide.
    els.label.classList.remove("is-minimized");
    applyLabelHidden();
    scheduleLabelMinimize();

    els.labelTitle.textContent = d.title;
    els.labelArtist.textContent = d.artist;
    els.labelLink.href = d.url;

    // The on-stage shortcut to this piece's DeviantArt page, plus share targets.
    current = d;
    els.viewOnDaBtn.href = d.url;
    els.viewOnDaBtn.hidden = false;
    updateShareTargets(d);
    renderLabelQr(d.url);

    if (d.collectionOwner && d.collectionOwner.toLowerCase() !== d.artist.toLowerCase()) {
      els.labelOwner.textContent = d.collectionOwner;
      els.labelOwnerWrap.hidden = false;
    } else {
      els.labelOwnerWrap.hidden = true;
    }

    // Tags and medium/category require a separate per-deviation request; fetch
    // lazily so a fast-moving slideshow doesn't fire one for every image.
    els.labelMediumWrap.hidden = true;
    els.labelResolutionWrap.hidden = true;
    els.labelTags.hidden = true;
    els.labelTags.innerHTML = "";
    const myRequestToken = ++metadataRequestToken;
    fetchDeviationMetadata(d.id)
      .then((meta) => {
        if (myRequestToken !== metadataRequestToken || !meta) return; // slide moved on, or fetch failed quietly

        // DeviantArt's API exposes a submission "category" rather than a
        // guaranteed medium taxonomy (e.g. it might read "Digital Art" or a
        // slash-delimited category path) — shown as-is, not relabeled as a
        // clean medium field we can't actually guarantee.
        if (meta.submission?.category) {
          els.labelMedium.textContent = meta.submission.category;
          els.labelMediumWrap.hidden = false;
        }
        if (meta.submission?.resolution) {
          els.labelResolution.textContent = meta.submission.resolution;
          els.labelResolutionWrap.hidden = false;
        }

        if (meta.tags && meta.tags.length) {
          els.labelTags.innerHTML = meta.tags
            .slice(0, 8)
            .map((t) => `<li>${escapeHtml(t.tag_name)}</li>`)
            .join("");
          els.labelTags.hidden = false;
        }
      })
      .catch(() => {
        /* Tags/views/medium are a nice-to-have; a failed fetch here
           shouldn't interrupt the slideshow or surface an error. */
      });

    // Mature pieces are filtered out of `order` in buildOrder() when "Allow
    // mature content" is off, so anything reaching here is meant to be shown.
    els.artwork.src = d.imageSrc;
    els.artwork.alt = `${d.title} by ${d.artist}`;
    els.artwork.onload = () => els.artwork.classList.add("is-visible");
    announceSlide(`${d.title}, by ${d.artist}.`);
  }

  // Polite live region so screen reader users know the slide changed without
  // duplicating the visible wall-label content into a second focusable element.
  function announceSlide(text) {
    els.slideAnnouncer.textContent = text;
  }

  function advance(delta) {
    if (!order.length) return;
    cursor = ((cursor + delta) % order.length + order.length) % order.length;
    showSlide(cursor);
    if (isPlaying) startTimer(); // restart the clock on manual navigation
  }

  els.nextBtn.addEventListener("click", () => advance(1));
  els.prevBtn.addEventListener("click", () => advance(-1));

  function startTimer() {
    stopTimer();
    const seconds = Math.max(2, Number(els.speedInput.value) || 12);
    timer = setInterval(() => advanceAuto(), seconds * 1000);
  }

  function advanceAuto() {
    // Guard on isPlaying so a paused slideshow never advances, even if a timer
    // tick is still in flight when pause happens.
    if (!isPlaying || !order.length) return;
    cursor = (cursor + 1) % order.length;
    showSlide(cursor);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // Collapse the label to just title + artist halfway through the slide's
  // dwell time, giving the artwork more room. Reset + rescheduled per slide.
  // Only while playing — paused means someone's likely reading the full label.
  function scheduleLabelMinimize() {
    if (labelMinimizeTimer) clearTimeout(labelMinimizeTimer);
    if (!isPlaying) {
      els.label.classList.remove("is-minimized");
      return;
    }
    const seconds = Math.max(2, Number(els.speedInput.value) || 12);
    labelMinimizeTimer = setTimeout(() => {
      els.label.classList.add("is-minimized");
    }, (seconds * 1000) / 2);
  }

  function setPlaying(playing) {
    isPlaying = playing;
    els.playPauseBtn.textContent = isPlaying ? "Pause slideshow" : "Play slideshow";
    els.stagePlayPauseBtn.innerHTML = `<span aria-hidden="true">${isPlaying ? "⏸" : "▶"}</span>`;
    els.stagePlayPauseBtn.setAttribute("aria-label", isPlaying ? "Pause slideshow" : "Play slideshow");
    els.stagePlayPauseBtn.setAttribute("aria-pressed", isPlaying ? "false" : "true");
    if (isPlaying) {
      startTimer();
      scheduleLabelMinimize(); // start the half-time countdown for the current slide
    } else {
      stopTimer();
      if (labelMinimizeTimer) clearTimeout(labelMinimizeTimer);
      els.label.classList.remove("is-minimized"); // restore the full label while paused
    }
  }

  function togglePlayPause() {
    setPlaying(!isPlaying);
  }

  els.playPauseBtn.addEventListener("click", togglePlayPause);
  els.stagePlayPauseBtn.addEventListener("click", togglePlayPause);

  // ---- Hide label (sticky: stays hidden across slides until toggled back) ----------------------------------------------------

  function applyLabelHidden() {
    els.labelWrap.classList.toggle("is-hidden", labelHidden);
    if (labelHidden) {
      els.label.setAttribute("aria-hidden", "true");
      els.labelLink.setAttribute("tabindex", "-1");
    } else {
      els.label.removeAttribute("aria-hidden");
      els.labelLink.removeAttribute("tabindex");
    }
    els.labelHideBtn.setAttribute("aria-pressed", String(labelHidden));
    els.labelHideBtn.setAttribute("aria-label", labelHidden ? "Show label" : "Hide label");
  }

  els.labelHideBtn.addEventListener("click", () => {
    labelHidden = !labelHidden;
    applyLabelHidden();
  });

  // ---- Keyboard controls ----------------------------------------------------
  // Single-key shortcuts (arrows, space, f) only act when focus is on the
  // stage itself — never while a form control has focus (WCAG 2.1.4).

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isPanelOpen()) closePanel();
      return;
    }

    if (isTypingTarget(document.activeElement) || isPanelOpen()) return;

    if (e.key === "ArrowRight") advance(1);
    else if (e.key === "ArrowLeft") advance(-1);
    else if (e.key === " ") {
      // If a button (e.g. the on-stage play/pause) has focus, let its native
      // click activation handle Space so we don't toggle twice (no-op pause).
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      e.preventDefault();
      togglePlayPause();
    } else if (e.key.toLowerCase() === "f") toggleFullscreen();
    else if (e.key.toLowerCase() === "l") els.labelHideBtn.click();
  });

  // ---- Tap/click the canvas to pause/play ----------------------------------------------------
  // A single click on the artwork area toggles play/pause and flashes a glyph in
  // the centre. A double-click (fullscreen) cancels the pending single-click so
  // the two don't fight. Clicks on controls, the label, links, or the panel are
  // ignored. Can be turned off in settings.
  const CANVAS_CLICK_DELAY = 220;

  function isCanvasClick(target) {
    // Only treat clicks on empty stage / artwork / backdrop as canvas taps.
    return !target.closest(
      "button, a, input, select, textarea, label, .label, .panel, .stage-controls, .nav, .tap-indicator"
    );
  }

  els.stage.addEventListener("click", (e) => {
    if (isPanelOpen()) return; // a click out here is closing the panel, not toggling play
    if (!els.canvasPauseToggle.checked) return;
    if (!order.length) return;
    if (Date.now() - lastSwipeAt < 500) return; // a swipe just navigated — ignore its click
    if (!isCanvasClick(e.target)) return;
    if (canvasClickTimer) clearTimeout(canvasClickTimer);
    canvasClickTimer = setTimeout(() => {
      togglePlayPause();
      flashTapIndicator(isPlaying ? "▶" : "⏸"); // show the state just entered
    }, CANVAS_CLICK_DELAY);
  });

  els.stage.addEventListener("dblclick", (e) => {
    if (canvasClickTimer) clearTimeout(canvasClickTimer); // cancel the pending single-click toggle
    if (isCanvasClick(e.target)) toggleFullscreen();
  });

  // A transparent glyph that pops in the centre, then fades out.
  function flashTapIndicator(glyph) {
    const el = els.canvasTapIndicator;
    el.textContent = glyph;
    el.classList.remove("is-active");
    void el.offsetWidth; // force reflow so the animation restarts on rapid taps
    el.classList.add("is-active");
  }
  els.canvasTapIndicator.addEventListener("animationend", () => {
    els.canvasTapIndicator.classList.remove("is-active");
  });

  // ---- Share the current artwork ----------------------------------------------------
  // Each target either opens that network's web "share/compose" URL, copies the
  // link, or (for apps with no web share URL: Signal, Instagram, WeChat) hands
  // off to the device share sheet via the Web Share API, falling back to copy.

  function updateShareTargets(d) {
    els.shareLinks.querySelectorAll("button[data-net]").forEach((b) => (b.disabled = !d));
    if (!d) els.shareStatus.textContent = "";
  }

  async function copyCurrentLink() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      els.shareStatus.textContent = "Link copied to clipboard.";
    } catch {
      els.shareStatus.textContent = current.url; // clipboard blocked — show it to copy manually
    }
  }

  function nativeShareOrCopy(label) {
    if (navigator.share) {
      navigator.share({ title: current.title, text: `${current.title} by ${current.artist}`, url: current.url }).catch(() => {});
    } else {
      copyCurrentLink();
      els.shareStatus.textContent = `${label} has no web share link — link copied; paste it into the app.`;
    }
  }

  function shareTo(net) {
    if (!current) return;
    const url = current.url;
    const u = encodeURIComponent(url);
    const title = encodeURIComponent(current.title);
    const text = encodeURIComponent(`${current.title} by ${current.artist}`);
    const textUrl = encodeURIComponent(`${current.title} by ${current.artist} ${url}`);
    const media = current.imageSrc ? `&media=${encodeURIComponent(current.imageSrc)}` : "";

    let openUrl = null;
    switch (net) {
      case "copy": return copyCurrentLink();
      case "device": return nativeShareOrCopy("Your device"); // OS share sheet (AirDrop/Bluetooth/apps)
      case "bluesky": openUrl = `https://bsky.app/intent/compose?text=${textUrl}`; break;
      case "reddit": openUrl = `https://www.reddit.com/submit?url=${u}&title=${title}`; break;
      case "tumblr": openUrl = `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${u}&caption=${text}`; break;
      case "pinterest": openUrl = `https://pinterest.com/pin/create/button/?url=${u}&description=${text}${media}`; break;
      case "threads": openUrl = `https://www.threads.net/intent/post?text=${textUrl}`; break;
      case "whatsapp": openUrl = `https://wa.me/?text=${textUrl}`; break;
      case "mastodon": {
        let inst = window.prompt(
          "Your Mastodon instance (e.g. mastodon.social):",
          localStorage.getItem("da_mastodon_instance") || "mastodon.social"
        );
        if (!inst) return;
        inst = inst.replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
        localStorage.setItem("da_mastodon_instance", inst);
        openUrl = `https://${inst}/share?text=${textUrl}`;
        break;
      }
      // No web share URL for these — use the device share sheet, or copy.
      case "signal": return nativeShareOrCopy("Signal");
      case "instagram": return nativeShareOrCopy("Instagram");
      case "wechat": return nativeShareOrCopy("WeChat");
    }
    if (openUrl) window.open(openUrl, "_blank", "noopener");
  }

  els.shareLinks.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-net]");
    if (btn && !btn.disabled) shareTo(btn.dataset.net);
  });

  // The device-share-sheet button only makes sense where the Web Share API exists
  // (mobile + some desktop browsers); reveal it there.
  if (navigator.share) els.shareDeviceBtn.hidden = false;

  // ---- Touch swipe: left = next, right = previous ----------------------------------------------------
  // Enhancement only — the nav buttons and arrow keys remain the primary
  // controls (WCAG 2.5.1: no path-based/multipoint gesture is required).
  let touchStartX = 0;
  let touchStartY = 0;
  let touchTracking = false;
  const SWIPE_MIN_X = 50;   // px of horizontal travel to count as a swipe
  const SWIPE_MAX_OFF_AXIS = 0.6; // |dy| must stay below this fraction of |dx|

  els.stage.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) { touchTracking = false; return; }
      touchTracking = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );

  els.stage.addEventListener(
    "touchend",
    (e) => {
      if (!touchTracking) return;
      touchTracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      if (Math.abs(dx) < SWIPE_MIN_X) return;            // too small — let taps/clicks through
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_OFF_AXIS) return; // mostly vertical — ignore
      lastSwipeAt = Date.now(); // so the synthetic click a swipe may fire doesn't also toggle pause
      advance(dx < 0 ? 1 : -1); // swipe left → next, swipe right → previous
    },
    { passive: true }
  );

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  // ---- Empty state ----------------------------------------------------

  function showEmptyState(message) {
    idleLanding = false;
    els.emptyStateMessage.textContent = message;
    els.emptyState.hidden = false;
    els.quickStart.hidden = true;
    els.artwork.classList.remove("is-visible");
    els.viewOnDaBtn.hidden = true; // no current piece to link to
    els.labelQr.hidden = true;
    current = null;
    updateShareTargets(null);
    if (labelMinimizeTimer) clearTimeout(labelMinimizeTimer);
  }

  function hideEmptyState() {
    idleLanding = false;
    els.emptyState.hidden = true;
    els.quickStart.hidden = true;
  }

  // ---- Quick-start (signed-in idle landing) ----------------------------------------------------

  async function showQuickStart(signedIn) {
    els.emptyState.hidden = true;
    els.artwork.classList.remove("is-visible");
    els.viewOnDaBtn.hidden = true;
    els.labelQr.hidden = true;
    current = null;
    updateShareTargets(null);
    idleLanding = true;
    els.quickStart.hidden = false;

    // Daily Deviations is public (served via the proxy's app token), so its
    // preview loads signed in or out. The watch card needs a personal token;
    // when signed out, a sign-in button takes its place.
    els.qsLoginBtn.hidden = signedIn;
    await loadQuickStartPreviews(signedIn);
  }

  // Pick the first deviation that has an image and isn't mature or locked.
  function firstShowable(results) {
    for (const r of results || []) {
      const d = normalizeDeviation(r);
      if (d.imageSrc && !d.isMature && !d.isLocked) return d;
    }
    return null;
  }

  function fillQuickCard(card, thumb, titleEl, d) {
    thumb.src = d.imageSrc;
    thumb.alt = "";
    titleEl.textContent = d.title;
    card.hidden = false;
  }

  async function loadQuickStartPreviews(signedIn) {
    try {
      const dd = await fetchDailyDeviations();
      const pick = firstShowable(dd.results);
      if (pick) fillQuickCard(els.qsDailyCard, els.qsDailyThumb, els.qsDailyTitle, pick);
      else els.qsDailyCard.hidden = true;
    } catch {
      els.qsDailyCard.hidden = true; // leave the Daily Deviations card hidden if it can't load
    }

    if (!signedIn) {
      els.qsWatchCard.hidden = true; // personal feed needs a personal token
      return;
    }
    try {
      const dyw = await fetchDeviantsYouWatch(0, 24);
      const pick = firstShowable(dyw.results);
      if (pick) fillQuickCard(els.qsWatchCard, els.qsWatchThumb, els.qsWatchTitle, pick);
      else els.qsWatchCard.hidden = true;
    } catch {
      els.qsWatchCard.hidden = true; // user may watch no one, or the feed failed
    }
  }

  function quickStartLoad(type) {
    els.sourceType.value = type;
    updateSourceFieldVisibility();
    saveSettings();
    loadSource();
  }

  els.qsDailyCard.addEventListener("click", () => quickStartLoad("dailyDeviations"));
  els.qsWatchCard.addEventListener("click", () => quickStartLoad("deviantsYouWatch"));
  els.qsLoginBtn.addEventListener("click", () => beginLogin());
  els.qsSettingsLink.addEventListener("click", openPanel);

  // ---- Utility ----------------------------------------------------

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Init ----------------------------------------------------

  (async function init() {
    applySettingsToForm();
    renderHistory();
    const signedIn = await refreshAuthUI();
    if (signedIn && settings.username) {
      // best-effort: pre-populate folder list if a folder-based source was saved
      await populateFolders();
      if (settings.folderId) els.folderSelect.value = settings.folderId;
    }
    // Land on the quick-start either way: signed-in shows preview cards; signed
    // out shows a sign-in button (and a link into settings).
    showQuickStart(signedIn);
  })();
})();
