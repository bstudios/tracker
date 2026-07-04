import { Outlet } from "react-router";
import { passwordRouteAccessMiddleware } from "~/middleware/passwordRouteAccess.server";
import type { Route } from "./+types/protectedLayout";

export const middleware: Route.MiddlewareFunction[] = [
  passwordRouteAccessMiddleware,
];

export default function ProtectedLayout() {
  return <Outlet />;
}
