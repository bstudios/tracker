import { Center } from "@mantine/core";
import { ClientOnly } from "remix-utils/client-only";
import type { SpeedUnit } from "~/utils/speedUnits";
import {
  AnalysisMap as AnalysisMapClient,
  type AnalysisRoutePoint,
  type AnalysisRouteSegment,
} from "./AnalysisMap.client";

export function AnalysisMap(props: {
  points: AnalysisRoutePoint[];
  segments: AnalysisRouteSegment[];
  highlightedPointId?: number | null;
  speedUnit?: SpeedUnit;
}) {
  return (
    <ClientOnly fallback={<Center h={420} />}>
      {() => <AnalysisMapClient {...props} />}
    </ClientOnly>
  );
}
