import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Verify that the request is authorized to access the admin routes via Cloudflare Access.
 */

const isAdminPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const isLocalDevelopmentRequest = (request: Request) => {
  const { hostname } = new URL(request.url);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
};

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const getJwks = (teamDomain: string) => {
  const existingJwks = jwksByTeamDomain.get(teamDomain);
  if (existingJwks) {
    return existingJwks;
  }

  const createdJwks = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
  );
  jwksByTeamDomain.set(teamDomain, createdJwks);
  return createdJwks;
};

export const enforceCloudflareAccessOnAdminRoutes = async (
  request: Request,
  env: Env
) => {
  const { pathname } = new URL(request.url);
  if (!isAdminPath(pathname)) {
    return null;
  }

  if (isLocalDevelopmentRequest(request)) {
    return null;
  }

  if (!env.CLOUDFLARE_ACCESS_POLICY_AUD || !env.CLOUDFLARE_ACCESS_TEAM_DOMAIN) {
    console.warn("Missing Cloudflare Access required audience or team domain");
    return new Response("Missing Cloudflare Access config", { status: 500 });
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    console.warn("Missing required Cloudflare Access JWT");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await jwtVerify(token, getJwks(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.CLOUDFLARE_ACCESS_TEAM_DOMAIN}`,
      audience: env.CLOUDFLARE_ACCESS_POLICY_AUD,
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`Invalid cloudflare access token: ${message}`);
    return new Response("Unauthorized", { status: 401 });
  }
};
