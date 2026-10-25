import { Center } from "@mantine/core";
import type { InferSelectModel } from "drizzle-orm";
import { ClientOnly } from "remix-utils/client-only";
import * as Schema from "~/database/schema.d";
import { TimingPointEditor as TimingPointEditorClient } from "./TimingPointEditor.client";
export type EditorTimingPoint = InferSelectModel<typeof Schema.TimingPoints> & {
  /** Where the point's anchor cell sits. */
  latitude: number;
  longitude: number;
  /** The point's shape, compacted — see `compactCells` — to keep the payload small. */
  cells: string[];
};
export interface TimingPointEditorProps {
  device: { id: number; name: string };
  /** The day whose track is drawn under the timing points. */
  urlDate: string;
  /** Days this device has a track for, newest first. */
  availableDates: string[];
  /** The editor's path without a date, to switch to another day. */
  editorBasePath: string;
  editorPath: string;
  timingPoints: EditorTimingPoint[];
  pins: {
    latitude: number;
    longitude: number;
    timestamp: number;
  }[];
}
export const TimingPointEditor = (props: TimingPointEditorProps) => (
  <ClientOnly fallback={<Center></Center>}>
    {() => <TimingPointEditorClient {...props} />}
  </ClientOnly>
);
