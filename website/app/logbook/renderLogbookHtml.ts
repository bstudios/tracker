import { formatTime24, formatUtcDay } from "~/utils/dateTime";
import type { LogbookEntry, LogbookEntryKind } from "./buildLogbook";

/**
 * Rendering a logbook as standalone HTML.
 *
 * Used for the page the nightly PDF is rendered from and for the body of the email that
 * carries it, so the attachment and the message always say the same thing. Kept separate
 * from the React route because both outputs need to be self-contained documents with
 * inline styles — a headless browser render and an email client are both hostile to
 * external stylesheets.
 */

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const KIND_LABELS: Record<LogbookEntryKind, string> = {
  first: "Start",
  last: "End",
  arrived: "Arrived",
  departed: "Departed",
  "timing-point-arrived": "Arrived",
  "timing-point-departed": "Departed",
  "timing-point-passed": "Passed",
  voltage: "Power",
};

const renderRows = (entries: LogbookEntry[]) =>
  entries
    .map(
      (entry) => `<tr>
      <td class="time">${escapeHtml(formatTime24(entry.timestamp))}</td>
      <td class="kind">${escapeHtml(KIND_LABELS[entry.kind])}</td>
      <td>${escapeHtml(entry.title)}</td>
      <td class="detail">${escapeHtml(entry.detail ?? "")}</td>
    </tr>`,
    )
    .join("\n");

const renderTable = (entries: LogbookEntry[]) =>
  entries.length === 0
    ? `<p class="empty">No position reports were received on this day.</p>`
    : `<table>
    <thead>
      <tr><th>Time</th><th>Type</th><th>Entry</th><th>Detail</th></tr>
    </thead>
    <tbody>
${renderRows(entries)}
    </tbody>
  </table>`;

type LogbookDocumentArgs = {
  deviceName: string;
  dateString: string;
  entries: LogbookEntry[];
  eventCount: number;
  /** Say so on the document itself rather than letting it look like a complete day. */
  truncated?: boolean;
};

/** A complete printable document, for Browser Rendering to turn into a PDF. */
export const renderLogbookDocument = ({
  deviceName,
  dateString,
  entries,
  eventCount,
  truncated,
}: LogbookDocumentArgs) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Logbook — ${escapeHtml(deviceName)} — ${escapeHtml(dateString)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #111; margin: 0; font-size: 11pt; line-height: 1.45;
  }
  h1 { font-size: 18pt; margin: 0 0 2px; }
  .subtitle { color: #555; font-size: 10pt; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th {
    text-align: left; font-size: 9pt; text-transform: uppercase;
    letter-spacing: 0.05em; color: #555; border-bottom: 1.5px solid #111;
    padding: 6px 8px 6px 0;
  }
  td { padding: 6px 8px 6px 0; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr { break-inside: avoid; }
  .time { white-space: nowrap; font-variant-numeric: tabular-nums; width: 14%; }
  .kind { white-space: nowrap; color: #555; width: 14%; }
  .detail { color: #555; }
  .empty { color: #555; font-style: italic; }
  .warning { border: 1px solid #b58100; background: #fff8e1; color: #6b4e00;
             padding: 8px 10px; border-radius: 4px; margin-bottom: 14px; font-size: 10pt; }
  footer { margin-top: 22px; color: #777; font-size: 9pt; }
</style>
</head>
<body>
  <h1>Logbook — ${escapeHtml(deviceName)}</h1>
  <p class="subtitle">
    ${escapeHtml(formatUtcDay(dateString))} ·
    ${eventCount} position report${eventCount === 1 ? "" : "s"} condensed to
    ${entries.length} entr${entries.length === 1 ? "y" : "ies"} · times shown local
  </p>
  ${
    truncated
      ? `<p class="warning"><strong>Partial day.</strong> This device reported more
         positions than one log can be built from, so only the earliest
         ${eventCount} are included.</p>`
      : ""
  }
  ${renderTable(entries)}
  <footer>Generated automatically from tracked positions.</footer>
</body>
</html>`;

/**
 * The same log as an email body.
 *
 * Inline styles rather than a stylesheet, and no layout beyond a table, because that is
 * the subset mail clients agree on.
 */
export const renderLogbookEmailHtml = ({
  deviceName,
  dateString,
  entries,
  eventCount,
}: LogbookDocumentArgs) => `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;font-size:14px;line-height:1.5">
  <h2 style="margin:0 0 2px">Logbook — ${escapeHtml(deviceName)}</h2>
  <p style="margin:0 0 16px;color:#555;font-size:13px">
    ${escapeHtml(formatUtcDay(dateString))} · ${eventCount} position report${
      eventCount === 1 ? "" : "s"
    } · times shown local
  </p>
  ${
    entries.length === 0
      ? `<p style="color:#555"><em>No position reports were received on this day.</em></p>`
      : `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
    ${entries
      .map(
        (entry) => `<tr>
      <td style="padding:5px 10px 5px 0;border-bottom:1px solid #e0e0e0;white-space:nowrap">${escapeHtml(
        formatTime24(entry.timestamp),
      )}</td>
      <td style="padding:5px 10px 5px 0;border-bottom:1px solid #e0e0e0;color:#555;white-space:nowrap">${escapeHtml(
        KIND_LABELS[entry.kind],
      )}</td>
      <td style="padding:5px 10px 5px 0;border-bottom:1px solid #e0e0e0">${escapeHtml(
        entry.title,
      )}</td>
      <td style="padding:5px 0;border-bottom:1px solid #e0e0e0;color:#555">${escapeHtml(
        entry.detail ?? "",
      )}</td>
    </tr>`,
      )
      .join("\n")}
  </table>`
  }
  <p style="margin-top:18px;color:#777;font-size:12px">
    The full log is attached as a PDF.
  </p>
</div>`;

/** A plain-text fallback for clients that will not render the HTML part. */
export const renderLogbookText = ({
  deviceName,
  dateString,
  entries,
}: LogbookDocumentArgs) =>
  [
    `Logbook - ${deviceName} - ${dateString}`,
    "",
    ...(entries.length === 0
      ? ["No position reports were received on this day."]
      : entries.map((entry) =>
          [
            formatTime24(entry.timestamp),
            KIND_LABELS[entry.kind],
            entry.title,
            entry.detail ?? "",
          ]
            .filter((part) => part.length > 0)
            .join("  "),
        )),
    "",
    "The full log is attached as a PDF.",
  ].join("\n");
