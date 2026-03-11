import OAuthClient from "intuit-oauth";

export const oauthClient = new OAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  environment: "sandbox",
  redirectUri: process.env.REDIRECT_URI,
});

export let oauth2_token_json = null;
export const authurl = "/callback";

export function setOAuthToken(token) {
  oauth2_token_json = token;
}
