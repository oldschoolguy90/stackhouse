// Dropbox integration: OAuth2 PKCE (no client secret needed for a browser app)
// plus a simple last-write-wins JSON sync of the whole library to
// /Apps/<your app>/library.json in the user's Dropbox.
const DropboxSync = (() => {
  const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
  const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
  const LIBRARY_PATH = "/library.json";

  function redirectUri() {
    return location.origin + location.pathname;
  }

  function b64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256(str) {
    const data = new TextEncoder().encode(str);
    return crypto.subtle.digest("SHA-256", data);
  }

  function randomString(len = 64) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return b64url(arr.buffer).slice(0, len);
  }

  async function getAppKey() {
    return DB.getMeta("dropboxAppKey");
  }

  async function isConnected() {
    const t = await DB.getMeta("dropboxToken");
    return !!(t && t.access_token);
  }

  async function beginAuth(appKey) {
    await DB.setMeta("dropboxAppKey", appKey);
    const verifier = randomString(64);
    localStorage.setItem("stackhouse_pkce_verifier", verifier);
    const challenge = b64url(await sha256(verifier));
    const params = new URLSearchParams({
      client_id: appKey,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri(),
      token_access_type: "offline",
    });
    location.href = `${AUTH_URL}?${params.toString()}`;
  }

  async function handleRedirectIfPresent() {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    if (!code) return false;
    const appKey = await getAppKey();
    const verifier = localStorage.getItem("stackhouse_pkce_verifier");
    if (!appKey || !verifier) return false;

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: appKey,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error("Dropbox authorization failed. Check your App Key and try reconnecting.");
    const token = await res.json();
    token.obtained_at = Date.now();
    await DB.setMeta("dropboxToken", token);

    // clean the ?code= param out of the URL
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    history.replaceState({}, "", url.pathname);
    return true;
  }

  async function refreshIfNeeded() {
    const token = await DB.getMeta("dropboxToken");
    if (!token) throw new Error("Not connected to Dropbox yet.");
    const ageMs = Date.now() - token.obtained_at;
    const expiresMs = (token.expires_in || 14400) * 1000;
    if (ageMs < expiresMs - 60000) return token.access_token;

    if (!token.refresh_token) return token.access_token; // best effort
    const appKey = await getAppKey();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: appKey,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return token.access_token; // fall back, next call will surface the error
    const fresh = await res.json();
    const merged = { ...token, ...fresh, obtained_at: Date.now() };
    await DB.setMeta("dropboxToken", merged);
    return merged.access_token;
  }

  async function downloadLibrary() {
    const accessToken = await refreshIfNeeded();
    const res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: LIBRARY_PATH }),
      },
    });
    if (res.status === 409) return []; // no file yet on this account
    if (!res.ok) throw new Error("Couldn't reach Dropbox. Check your connection and try again.");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function uploadLibrary(records) {
    const accessToken = await refreshIfNeeded();
    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: LIBRARY_PATH,
          mode: "overwrite",
          mute: true,
        }),
      },
      body: JSON.stringify(records),
    });
    if (!res.ok) throw new Error("Couldn't save to Dropbox. Your scans are still safe on this device.");
  }

  function mergeRecords(local, remote) {
    const byId = new Map();
    const keyOf = (rec) => rec.id || rec.isbn;  // heal legacy records that predate ids
    for (const rec of remote) { if (!rec.id) rec.id = keyOf(rec); byId.set(rec.id, rec); }
    for (const rec of local) {
      if (!rec.id) rec.id = keyOf(rec);
      const existing = byId.get(rec.id);
      if (!existing || (rec.updatedAt || 0) >= (existing.updatedAt || 0)) {
        byId.set(rec.id, rec);
      }
    }
    return Array.from(byId.values());
  }

  async function sync() {
    if (!(await isConnected())) return { synced: false };
    const local = await DB.getAllRaw();
    const remote = await downloadLibrary();
    const merged = mergeRecords(local, remote);
    await DB.putManyRaw(merged);
    await uploadLibrary(merged);
    await DB.setMeta("lastSyncedAt", Date.now());
    return { synced: true, count: merged.filter((b) => !b.deleted).length };
  }

  async function disconnect() {
    await DB.setMeta("dropboxToken", null);
  }

  return { beginAuth, handleRedirectIfPresent, isConnected, sync, disconnect, getAppKey };
})();
