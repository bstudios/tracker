import { Center } from "@mantine/core";
import { ClientOnly } from "remix-utils/client-only";
import { Map } from "./Map.client";
export interface MapProps {
  zoom: number;
  deviceIcon: string | null;
  pins: {
    latitude: number;
    longitude: number;
    timestamp: number;
  }[];
  urlDate: string;
  password: string;
  // When the latest poll failed, the time the data being shown was fetched; otherwise null.
  staleSince: number | null;
  timingPoints: {
    name: string;
    latitude: number;
    longitude: number;
    icon: string | null;
    googleLink: string | null;
    group: string | null;
  }[];
}
export const LiveMap = (props: MapProps) => (
  <ClientOnly fallback={<Center></Center>}>
    {() => <Map {...props} />}
  </ClientOnly>
);
