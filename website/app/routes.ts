import {
  type RouteConfig,
  index,
  prefix,
  route,
} from "@react-router/dev/routes";

export default [
  index("./routes/login.tsx"),
  route("upload-traccar.json", "./routes/api/traccarUpload.ts"),
  route("upload-flespi.json", "./routes/api/flespiUpload.ts"),
  route("upload.json", "./routes/api/appUpload.ts"),
  // Signed, session-less render target for the nightly logbook PDF. Above the :password
  // routes so "print" is never read as a password.
  route("print/logbook/:deviceId/:date", "./routes/print/logbookPrint.ts"),
  ...prefix(":password", [index("./routes/passwordDateSelector.tsx")]),
  route(":password/:date", "./routes/date/protectedLayout.tsx", [
    route("live", "./routes/date/map.tsx"),
    route("logbook", "./routes/date/logbook.tsx"),
    route("logbook.pdf", "./routes/date/logbookPdf.ts"),
    route("table/:cursor?", "./routes/date/table.tsx"),
    route("timings", "./routes/date/timingPoints.tsx"),
    route(
      "timingsHistoric",
      "./routes/date/timingPointsHistoricComparison.tsx",
    ),
    route("analysis", "./routes/date/analysis.tsx"),
    route("export.gpx", "./routes/date/downloadGPX.ts"),
    index("./routes/date/index.tsx"),
  ]),
  route("admin", "./routes/admin/layout.tsx", [
    index("./routes/admin/index.tsx"),
    route("devices", "./routes/admin/devices.tsx"),
    route("devices/:deviceId/logbook", "./routes/admin/deviceLogbook.tsx"),
    route("passwords", "./routes/admin/passwords.tsx"),
    route("data", "./routes/admin/data.tsx"),
    route(":date?/timingPointEditor", "./routes/admin/timingPointEditor.tsx"),
    route("generateDummyDataLocally", "./routes/generateDummy.tsx"),
  ]),
] satisfies RouteConfig;
