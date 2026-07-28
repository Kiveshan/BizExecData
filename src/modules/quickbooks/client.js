import OAuthClient from "intuit-oauth";
import { getPrismaClient } from "../../config/prismaClient.js";
import { createModuleLogger } from "../../utils/logger.js";

/**
 * Builds a fresh OAuthClient.
 *
 * `OAuthClient` stores the active token on the instance, so a module-level
 * client shared across requests lets one user's token be swapped in while
 * another user's API call is in flight. Every caller gets its own instance.
 */
export function createOAuthClient() {
  return new OAuthClient({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    environment: process.env.QB_ENVIRONMENT || "sandbox",
    redirectUri: process.env.REDIRECT_URI,
  });
}

export function getQuickBooksApiBaseUrl() {
  const env = (process.env.QB_ENVIRONMENT || "sandbox").toLowerCase();
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export const authurl = "/callback";

const qbClientLogger = createModuleLogger("quickbooks-client");

function computeExpiresAt(expiresInSeconds) {
  const expiresInMs = Number(expiresInSeconds || 0) * 1000;
  return new Date(Date.now() + expiresInMs);
}

function isInvalidGrantError(err) {
  const msg = String(err?.message || "");
  const body = err?.authResponse?.text || err?.response?.text || "";
  const combined = `${msg} ${body}`.toLowerCase();
  return combined.includes("invalid_grant") || combined.includes("invalid grant");
}

export async function upsertQuickBooksToken(userid, tokenJson) {
  const prisma = getPrismaClient();
  const raw = tokenJson?.token && typeof tokenJson.token === "object" ? tokenJson.token : tokenJson;
  const accessToken = raw?.access_token || raw?.accessToken;
  const refreshToken = raw?.refresh_token || raw?.refreshToken;
  const expiresIn = raw?.expires_in || raw?.expiresIn;
  const realmId = tokenJson?.realmId || tokenJson?.realm_id || raw?.realmId || raw?.realm_id || null;

  if (!accessToken || !refreshToken) {
    throw new Error("QuickBooks token json missing access_token/refresh_token");
  }

  return prisma.quickbooks_oauth_token.upsert({
    where: { userid },
    create: {
      userid,
      realm_id: realmId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: computeExpiresAt(expiresIn),
    },
    update: {
      realm_id: realmId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: computeExpiresAt(expiresIn),
    },
  });
}

export async function clearQuickBooksToken(userid) {
  const prisma = getPrismaClient();
  await prisma.quickbooks_oauth_token.deleteMany({ where: { userid } });
}

export async function getQuickBooksRealmId(userid) {
  const prisma = getPrismaClient();
  const tokenRow = await prisma.quickbooks_oauth_token.findUnique({
    where: { userid },
    select: { realm_id: true },
  });
  return tokenRow?.realm_id || null;
}

async function loadTokenRow(userid) {
  const prisma = getPrismaClient();
  return prisma.quickbooks_oauth_token.findUnique({ where: { userid } });
}

function setOauthClientTokenFromRow(client, tokenRow) {
  client.setToken({
    realmId: tokenRow.realm_id,
    token_type: "bearer",
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expires_in: Math.max(0, Math.floor((tokenRow.expires_at.getTime() - Date.now()) / 1000)),
  });
}

async function refreshIfNeeded(client, userid, tokenRow) {
  const needsRefresh = !tokenRow?.expires_at || tokenRow.expires_at.getTime() <= Date.now() + 60_000;
  if (!needsRefresh) return tokenRow;

  qbClientLogger.info({ userid }, "Refreshing QuickBooks access token");
  try {
    setOauthClientTokenFromRow(client, tokenRow);
    const refreshed = await client.refresh();
    const refreshedJson = refreshed?.json;
    await upsertQuickBooksToken(userid, { ...refreshedJson, realmId: tokenRow.realm_id });
    return loadTokenRow(userid);
  } catch (err) {
    if (isInvalidGrantError(err)) {
      qbClientLogger.warn({ userid, err }, "QuickBooks refresh failed with invalid_grant - reconnect required");
      await clearQuickBooksToken(userid);
      const e = new Error("QB_RECONNECT_REQUIRED");
      e.code = "QB_RECONNECT_REQUIRED";
      throw e;
    }
    qbClientLogger.error({ userid, err }, "QuickBooks token refresh failed");
    throw err;
  }
}

export async function makeQuickBooksApiCall(userid, options) {
  const tokenRow = await loadTokenRow(userid);
  if (!tokenRow) {
    const e = new Error("QB_RECONNECT_REQUIRED");
    e.code = "QB_RECONNECT_REQUIRED";
    throw e;
  }

  // Scoped to this call so a concurrent extraction for another user cannot
  // swap the token out from under it.
  const client = createOAuthClient();

  let currentRow = await refreshIfNeeded(client, userid, tokenRow);
  setOauthClientTokenFromRow(client, currentRow);

  try {
    const response = await client.makeApiCall(options);
    
    // Capture intuit_tid for troubleshooting (non-invasive)
    const intuitTid = response.headers?.get('intuit_tid') || 
                     response.response?.headers?.get('intuit_tid') ||
                     response.intuit_tid;
    
    if (intuitTid) {
      qbClientLogger.info({ userid, intuitTid, endpoint: options.url }, 
        "QuickBooks API call completed with TID");
    }
    
    return response;
  } catch (err) {
    qbClientLogger.warn({ userid, err }, "QuickBooks API call failed - attempting refresh+retry");

    // Capture intuit_tid from error responses (non-invasive)
    const intuitTid = err?.authResponse?.headers?.get('intuit_tid') ||
                     err?.response?.headers?.get('intuit_tid') ||
                     err?.intuit_tid;

    if (intuitTid) {
      qbClientLogger.error({ userid, intuitTid, err, endpoint: options.url }, 
        "QuickBooks API call failed with TID");
    }

    if (isInvalidGrantError(err)) {
      await clearQuickBooksToken(userid);
      const e = new Error("QB_RECONNECT_REQUIRED");
      e.code = "QB_RECONNECT_REQUIRED";
      throw e;
    }

    currentRow = await refreshIfNeeded(client, userid, await loadTokenRow(userid));
    setOauthClientTokenFromRow(client, currentRow);
    return await client.makeApiCall(options);
  }
}
