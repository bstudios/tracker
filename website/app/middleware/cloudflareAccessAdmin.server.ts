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

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    console.warn("Missing required Cloudflare Access JWT");
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
