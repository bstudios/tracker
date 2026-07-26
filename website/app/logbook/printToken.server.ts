/**
 * Signing the URL that the nightly PDF is rendered from.
 *
 * The workflow drives a headless browser at the print route, which means the route has to
 * be reachable without a session. Rather than depend on an `access_passwords` row existing
 * for the device — devices can have none, or several, and the workflow should not have to
 * pick one — the URL carries an HMAC of the device and date it is allowed to render.
 */

const encoder = new TextEncoder();

const importKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const createLogbookPrintToken = async (args: {
  secret: string;
  deviceId: number;
  dateString: string;
}) => {
  const key = await importKey(args.secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${args.deviceId}:${args.dateString}`),
  );
  return toHex(signature);
};

/**
 * Compare in constant time so a caller cannot narrow the signature down byte by byte from
 * how long the check takes.
 */
export const verifyLogbookPrintToken = async (args: {
  secret: string;
  deviceId: number;
  dateString: string;
  token: string;
}) => {
  const expected = await createLogbookPrintToken(args);
  if (expected.length !== args.token.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ args.token.charCodeAt(index);
  }
  return difference === 0;
};
