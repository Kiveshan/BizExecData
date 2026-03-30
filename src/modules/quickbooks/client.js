import OAuthClient from "intuit-oauth";
import { getPrismaClient } from "../../config/prismaClient.js";
import { createModuleLogger } from "../../utils/logger.js";

export const oauthClient = new OAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  environment: process.env.QB_ENVIRONMENT || "sandbox",
  redirectUri: process.env.REDIRECT_URI,
});

export function getQuickBooksApiBaseUrl() {
  const env = (process.env.QB_ENVIRONMENT || "sandbox").toLowerCase();
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export let oauth2_token_json = null;
export const authurl = "/callback";

export function setOAuthToken(token) {
  oauth2_token_json = token;
}

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

function setOauthClientTokenFromRow(tokenRow) {
  oauthClient.setToken({
    realmId: tokenRow.realm_id,
    token_type: "bearer",
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expires_in: Math.max(0, Math.floor((tokenRow.expires_at.getTime() - Date.now()) / 1000)),
  });
}

async function refreshIfNeeded(userid, tokenRow) {
  const needsRefresh = !tokenRow?.expires_at || tokenRow.expires_at.getTime() <= Date.now() + 60_000;
  if (!needsRefresh) return tokenRow;

  qbClientLogger.info({ userid }, "Refreshing QuickBooks access token");
  try {
    setOauthClientTokenFromRow(tokenRow);
    const refreshed = await oauthClient.refresh();
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

  let currentRow = await refreshIfNeeded(userid, tokenRow);
  setOauthClientTokenFromRow(currentRow);

  try {
    return await oauthClient.makeApiCall(options);
  } catch (err) {
    qbClientLogger.warn({ userid, err }, "QuickBooks API call failed - attempting refresh+retry");

    if (isInvalidGrantError(err)) {
      await clearQuickBooksToken(userid);
      const e = new Error("QB_RECONNECT_REQUIRED");
      e.code = "QB_RECONNECT_REQUIRED";
      throw e;
    }

    currentRow = await refreshIfNeeded(userid, await loadTokenRow(userid));
    setOauthClientTokenFromRow(currentRow);
    return await oauthClient.makeApiCall(options);
  }
}
