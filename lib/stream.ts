/**
 * A small in-process ring buffer of recently ingested sessions, so the live
 * view can flash "this just landed" without waiting on a database round trip.
 *
 * Deliberately not SSE and deliberately not durable. Serverless instances do
 * not share memory, so a cross-instance push channel would need a broker we
 * do not need: the database is the source of truth and the live view polls it.
 * This buffer only decorates that poll with recency, and an empty buffer (cold
 * instance, different instance) degrades to "no flash", never to wrong data.
 */

export type IngestNotice = {
  type: "session";
  sessionId: string;
  repo: string | null;
  branch: string | null;
  costUsd: number;
  messages: number;
  attribution: string;
  at?: number;
};

const CAPACITY = 50;

// Survives module reload in dev, where Next re-evaluates modules on edit.
const globalRef = globalThis as unknown as { __aegisNotices?: IngestNotice[] };
const buffer: IngestNotice[] = (globalRef.__aegisNotices ??= []);

export function publish(notice: IngestNotice): void {
  buffer.push({ ...notice, at: Date.now() });
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
}

/** Notices newer than `since` (epoch ms), oldest first. */
export function drain(since: number): IngestNotice[] {
  return buffer.filter((n) => (n.at ?? 0) > since);
}
