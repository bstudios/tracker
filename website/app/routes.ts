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
  ...prefix(":password", [
    index("./routes/passwordDateSelector.tsx"),
  ]),
  ...prefix(":password/:date", [
    route("table/:cursor?", "./routes/table.tsx"),
    route("timings", "./routes/timingPoints.tsx"),
    route("timingsHistoric", "./routes/timingPointsHistoricComparison.tsx"),
    route("export.gpx", "./routes/downloadGPX.ts"),
    index("./routes/map.tsx"),
  ]),
  ...prefix("admin", [
    index("./routes/admin/index.tsx"),
    route("passwords", "./routes/admin/passwords.tsx"),
    route("data", "./routes/admin/data.tsx"),
    route(":date?/timingPointEditor", "./routes/admin/timingPointEditor.tsx"),
    route("generateDummyDataLocally", "./routes/generateDummy.tsx"),
  ]),
] satisfies RouteConfig;
