type TokenEndpointResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

function getRequiredEnv(name: string) {
  const value = import.meta.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

export function getGoogleOAuthConfig() {
  return {
    clientId: getRequiredEnv('GOOGLE_CLIENT_ID'),
    clientSecret: getRequiredEnv('GOOGLE_CLIENT_SECRET'),
    calendarId: import.meta.env.GOOGLE_CALENDAR_ID || 'primary'
  };
}

async function exchangeToken(params: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const payload = (await response.json()) as TokenEndpointResponse;

  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || 'Google token exchange failed.';
    throw new Error(message);
  }

  const expiryDate = payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined;

  return { accessToken: payload.access_token, expiryDate };
}

export async function getValidGoogleAccessToken() {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const refreshToken = getRequiredEnv('GOOGLE_OAUTH_REFRESH_TOKEN');

  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60_000) {
    return cachedAccessToken;
  }

  const refreshed = await exchangeToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  );

  cachedAccessToken = refreshed.accessToken;
  cachedAccessTokenExpiresAt = refreshed.expiryDate || Date.now() + 50 * 60_000;
  return cachedAccessToken;
}
