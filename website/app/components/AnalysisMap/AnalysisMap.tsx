import { Center } from "@mantine/core";
import { ClientOnly } from "remix-utils/client-only";
import {
  AnalysisMap as AnalysisMapClient,
  type AnalysisRoutePoint,
  type AnalysisRouteSegment,
} from "./AnalysisMap.client";

export function AnalysisMap(props: {
  points: AnalysisRoutePoint[];
  segments: AnalysisRouteSegment[];
}) {
  return (
    <ClientOnly fallback={<Center h={420} />}>
      {() => <AnalysisMapClient {...props} />}
    </ClientOnly>
  );
}
