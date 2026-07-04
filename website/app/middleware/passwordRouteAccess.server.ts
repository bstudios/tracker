import type { MiddlewareFunction } from "react-router";
import { ensurePasswordAccess } from "~/passwordAccess.server";
import { passwordRouteAccessContext } from "~/routeContext";

export const passwordRouteAccessMiddleware: MiddlewareFunction<
  Response
> = async ({ params, request, context }) => {
  const access = await ensurePasswordAccess({
    password: params.password,
    dateParam: params.date,
    request,
  });

  context.set(passwordRouteAccessContext, access);
};
