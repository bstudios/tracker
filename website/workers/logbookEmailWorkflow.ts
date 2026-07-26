import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { and, isNotNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { DateTime } from "luxon";
import * as schema from "~/database/schema.d";
import { loadLogbook } from "~/logbook/loadLogbook.server";
import {
  getOrRenderLogbookPdf,
  logbookPdfFilename,
} from "~/logbook/pdfArchive.server";
import {
  renderLogbookEmailHtml,
  renderLogbookText,
} from "~/logbook/renderLogbookHtml";
import { drizzleLogger } from "~/database/logger";

/**
 * The nightly logbook email.
 *
 * Runs shortly after midnight UTC and, for each device with recipients configured, renders
 * that device's logbook page to a PDF and emails it out. The day boundary is UTC to match
 * `events.date_string` and every page in the app; only the times inside the log are local.
 */

export type DailyLogbookEmailParams = {
  /**
   * `YYYY-MM-DD` to send. Omitted on the scheduled run, which sends the day that has just
   * ended; supplied when re-sending a specific day by hand.
   */
  date?: string;
};

type DeviceToSend = {
  id: number;
  name: string;
  recipients: string[];
};

export class DailyLogbookEmailWorkflow extends WorkflowEntrypoint<
  Env,
  DailyLogbookEmailParams
> {
  async run(event: WorkflowEvent<DailyLogbookEmailParams>, step: WorkflowStep) {
    const dateString = await step.do("resolve-date", async () =>
      event.payload?.date && /^\d{4}-\d{2}-\d{2}$/.test(event.payload.date)
        ? event.payload.date
        : DateTime.utc().minus({ days: 1 }).toFormat("yyyy-MM-dd"),
    );

    const devices = await step.do<DeviceToSend[]>("list-devices", async () => {
      const db = drizzle(this.env.DB, { schema, logger: drizzleLogger });

      // Only devices that both want the email and actually recorded something, so a boat
      // laid up for the winter does not send an empty log every morning.
      const rows = await db
        .select({
          id: schema.Devices.id,
          name: schema.Devices.name,
          recipients: schema.Devices.logbookEmailRecipients,
          eventCount: sql<number>`(
              SELECT COUNT(*) FROM ${schema.Events}
              WHERE ${schema.Events.deviceId} = ${schema.Devices.id}
                AND ${schema.Events.dateString} = ${dateString}
            )`,
        })
        .from(schema.Devices)
        .where(
          and(
            isNotNull(schema.Devices.logbookEmailRecipients),
            ne(schema.Devices.logbookEmailRecipients, ""),
          ),
        );

      return rows
        .filter((row) => row.eventCount > 0)
        .map((row) => ({
          id: row.id,
          name: row.name,
          recipients: (row.recipients ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        }))
        .filter((device) => device.recipients.length > 0);
    });

    const results: Array<{ device: string; sent: number; failed: number }> = [];

    for (const device of devices) {
      // Rendering and sending share one step rather than passing the PDF between two.
      // Step return values have to be serialisable, so splitting them would mean base64ing
      // a multi-hundred-kilobyte buffer through the workflow's state for no benefit — the
      // render is cheap to repeat if the step retries.
      const result = await step.do(`send-${device.id}`, async () => {
        const db = drizzle(this.env.DB, { schema, logger: drizzleLogger });
        const logbook = await loadLogbook(db, {
          deviceId: device.id,
          dateString,
        });
        if (!logbook) return { device: device.name, sent: 0, failed: 0 };

        // Renders and stores in R2, so the download link on the logbook page for this day
        // is already warm and never triggers a second render.
        const pdf = await getOrRenderLogbookPdf(this.env, {
          deviceId: device.id,
          dateString,
        });
        if (!pdf) {
          throw new Error(
            `Browser Rendering unavailable, cannot build the logbook PDF for ${device.name}`,
          );
        }

        const documentArgs = {
          deviceName: logbook.deviceName,
          dateString,
          entries: logbook.entries,
          eventCount: logbook.eventCount,
        };

        let sent = 0;
        let failed = 0;

        for (const recipient of device.recipients) {
          // Per recipient rather than one message with many addressees, so one bad address
          // cannot stop the others receiving their log — and so nobody learns who else is
          // on the list.
          try {
            await this.env.EMAIL.send({
              to: recipient,
              from: this.env.LOGBOOK_EMAIL_FROM,
              subject: `Logbook — ${logbook.deviceName} — ${dateString}`,
              html: renderLogbookEmailHtml(documentArgs),
              text: renderLogbookText(documentArgs),
              attachments: [
                {
                  filename: logbookPdfFilename(logbook.deviceName, dateString),
                  content: pdf.body,
                  type: "application/pdf",
                  disposition: "attachment",
                },
              ],
            });
            sent += 1;
          } catch (error) {
            failed += 1;
            console.error(
              `Logbook email to ${recipient} for ${device.name} on ${dateString} failed`,
              error,
            );
          }
        }

        return { device: device.name, sent, failed };
      });

      results.push(result);
    }

    return { dateString, results };
  }
}
