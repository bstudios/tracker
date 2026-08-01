import { Center } from "@mantine/core";
import { ClientOnly } from "remix-utils/client-only";
import { SignalMap as SignalMapClient, type HexCell } from "./SignalMap.client";

export function SignalMap(props: { cells: HexCell[] }) {
  return (
    <ClientOnly fallback={<Center h={420} />}>
      {() => <SignalMapClient {...props} />}
    </ClientOnly>
  );
}
