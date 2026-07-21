import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareFunction } from "react-router";
import { cloudflareContext } from "~/routeContext";

const isLocalDevelopmentRequest = (request: Request) => {
  const { hostname } = new URL(request.url);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
};

const jwksByTeamDomain = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

const getJwks = (teamDomain: string) => {
  const existingJwks = jwksByTeamDomain.get(teamDomain);
  if (existingJwks) {
    return existingJwks;
  }

  const createdJwks = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  );
  jwksByTeamDomain.set(teamDomain, createdJwks);
  return createdJwks;
};

const parseCookieHeader = (cookieHeader: string) => {
  const cookies = new Map<string, string>();

  for (const part of cookieHeader.split(";")) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }

    const separatorIndex = trimmedPart.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedPart.slice(0, separatorIndex).trim();
    const value = trimmedPart.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      cookies.set(key, value);
    }
  }

  return cookies;
};

const getAccessTokenFromRequest = (request: Request) => {
  const headerToken = request.headers.get("cf-access-jwt-assertion");
  if (headerToken) {
    return headerToken;
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);
  return cookies.get("CF_Authorization") ?? null;
};

export const cloudflareAccessAdminMiddleware: MiddlewareFunction<
  Response
> = async ({ request, context }) => {
  if (isLocalDevelopmentRequest(request)) {
    return;
  }

  const { env } = context.get(cloudflareContext);

  if (!env.CLOUDFLARE_ACCESS_POLICY_AUD || !env.CLOUDFLARE_ACCESS_TEAM_DOMAIN) {
    console.warn("Missing Cloudflare Access required audience or team domain");
    throw new Response("Missing Cloudflare Access config", { status: 500 });
  }

  const token = getAccessTokenFromRequest(request);
  if (!token) {
    console.warn(
      "Missing required Cloudflare Access JWT in assertion header and cookie",
    );
    throw new Response("Unauthorized", { status: 401 });
  }

  try {
    await jwtVerify(token, getJwks(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.CLOUDFLARE_ACCESS_TEAM_DOMAIN}`,
      audience: env.CLOUDFLARE_ACCESS_POLICY_AUD,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`Invalid cloudflare access token: ${message}`);
    throw new Response("Unauthorized", { status: 401 });
  }
};
