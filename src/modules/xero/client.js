import { XeroClient } from "xero-node";

export const client_id = process.env.XERO_CLIENT_ID;
export const client_secret = process.env.XERO_CLIENT_SECRET;
export const redirectUrl = process.env.XERO_REDIRECT_URI;
export const scopes =
  "openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access";

export const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(" "),
});

export function getAuthenticationData(req) {
  return {
    decodedIdToken: req.session.decodedIdToken,
    decodedAccessToken: req.session.decodedAccessToken,
    tokenSet: req.session.tokenSet,
    allTenants: req.session.allTenants,
    activeTenant: req.session.activeTenant,
  };
}
