import { XeroClient } from "xero-node";

export const scopes =
  "openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access";

function baseConfig() {
  return {
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUris: [process.env.XERO_REDIRECT_URI],
    scopes: scopes.split(" "),
  };
}

/**
 * Builds a fresh XeroClient.
 *
 * `XeroClient` carries mutable per-connection state — the token set, the
 * resolved tenant list, and the OAuth `state` used for the consent round trip.
 * A module-level instance shared across requests lets one user's connection
 * overwrite another's tenant list mid-extraction, so every caller gets its own
 * instance instead.
 *
 * Passing `state` makes `buildConsentUrl()` emit it and `apiCallback()` verify
 * the value Xero echoes back. Without it, `config.state` is undefined, no state
 * is sent, and the callback's state check silently passes.
 */
export function createXeroClient({ state } = {}) {
  const config = baseConfig();
  if (state) config.state = state;
  return new XeroClient(config);
}

/**
 * Builds a client bound to an already-issued token set, for background work
 * (extraction) that runs without the originating request's session.
 */
export function createXeroClientFromTokenSet(tokenSet) {
  const client = createXeroClient();
  client.setTokenSet(tokenSet);
  return client;
}

export function getAuthenticationData(req) {
  return {
    decodedIdToken: req.session.decodedIdToken,
    decodedAccessToken: req.session.decodedAccessToken,
    tokenSet: req.session.tokenSet,
    allTenants: req.session.allTenants,
    activeTenant: req.session.activeTenant,
  };
}
