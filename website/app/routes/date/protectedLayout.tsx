import { Container } from "@mantine/core";
import { Outlet, useLocation, useParams } from "react-router";
import { DatePageNav, type DatePage } from "~/components/DatePageNav";
import { passwordRouteAccessMiddleware } from "~/middleware/passwordRouteAccess.server";
import type { Route } from "./+types/protectedLayout";

export const middleware: Route.MiddlewareFunction[] = [
  passwordRouteAccessMiddleware,
];

export default function ProtectedLayout() {
  const location = useLocation();
  const params = useParams();

  const password = params.password;
  const urlDate = params.date;

  if (!password || !urlDate) {
    return <Outlet />;
  }

  const basePath = `/${password}/${urlDate}`;
  const hide =
    location.pathname === `${basePath}/live` ||
    location.pathname === `${basePath}`;

  const current: DatePage =
    location.pathname === basePath
      ? "menu"
      : location.pathname.startsWith(`${basePath}/analysis`)
        ? "analysis"
        : location.pathname.startsWith(`${basePath}/timingsHistoric`)
          ? "historic"
          : location.pathname.startsWith(`${basePath}/timings`)
            ? "timings"
            : location.pathname.startsWith(`${basePath}/live`)
              ? "live"
              : "none";

  return (
    <>
      {!hide && (
        <Container fluid p="md" pb={0}>
          <DatePageNav
            password={password}
            urlDate={urlDate}
            current={current}
          />
        </Container>
      )}
      <Outlet />
    </>
  );
}
