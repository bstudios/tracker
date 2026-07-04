import { Outlet } from "react-router";
import { cloudflareAccessAdminMiddleware } from "~/middleware/cloudflareAccessAdmin.server";
import type { Route } from "./+types/layout";

export const middleware: Route.MiddlewareFunction[] = [
  cloudflareAccessAdminMiddleware,
];

export default function AdminLayout() {
  return <Outlet />;
}
