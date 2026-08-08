import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, workUnits, toolCalls, attributions } from "@/db/schema";

/**
 * Attribution suggestion and confirmation — the engineer's own surface.
 *
 * The suggestion is a proposal, never a write. Only an explicit confirm
 * attaches a session to an issue, and only the owner can mark one private.
 * That confirm step is both the UX and the privacy boundary: it is what makes
 * this a participant relationship rather than surveillance, and it is how
 * session-level data exists at all for surfaces with no API.
 */

const DEMO_USER = "u_arun";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    action?: "suggest" | "confirm" | "private";
    sessionId?: string;
    workUnitId?: string;
  } | null;

  if (!body?.action || !body.sessionId) {
    return NextResponse.json({ error: "action and sessionId are required" }, { status: 400 });
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, body.sessionId))
    .limit(1);

  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });
  if (session.userId !== DEMO_USER) {
    return NextResponse.json({ error: "not your session" }, { status: 403 });
  }

  if (body.action === "private") {
    await db
      .update(sessions)
      .set({ isPrivate: true, workUnitId: null, attributionMethod: "none", attributionConfidence: "none" })
      .where(eq(sessions.id, session.id));
    return NextResponse.json({ ok: true, isPrivate: true });
  }

  if (body.action === "confirm") {
    if (!body.workUnitId) {
      return NextResponse.json({ error: "workUnitId is required to confirm" }, { status: 400 });
    }
    await db
      .update(sessions)
      .set({
        workUnitId: body.workUnitId,
        attributionMethod: "tagged",
        attributionConfidence: "high",
        isPrivate: false,
      })
      .where(eq(sessions.id, session.id));

    await db.insert(attributions).values({
      sessionId: session.id,
      workUnitId: body.workUnitId,
      method: "tagged",
      confidence: "high",
      actor: DEMO_USER,
      rationale: "Confirmed by the engineer on their own sessions view.",
    });

    return NextResponse.json({ ok: true, workUnitId: body.workUnitId });
  }

  // suggest
  const candidates = await db
    .select({
      id: workUnits.id,
      identifier: workUnits.identifier,
      title: workUnits.title,
      state: workUnits.state,
    })
    .from(workUnits);

  const calls = await db
    .select({ name: toolCalls.name, target: toolCalls.target })
    .from(toolCalls)
    .where(eq(toolCalls.sessionId, session.id));

  const targets = [...new Set(calls.map((c) => c.target).filter(Boolean))].slice(0, 25);

  const prompt = [
    "A developer ran an agent session. Propose which issue it belongs to.",
    "",
    `Working directory: ${session.cwd ?? "unknown"}`,
    `Git branch: ${session.gitBranch ?? "unknown"}`,
    `Repository: ${session.repo ?? "unknown"}`,
    `Messages: ${session.messageCount}, tool calls: ${session.toolCallCount}`,
    "",
    "Files and commands touched:",
    ...targets.map((t) => `  ${t}`),
    "",
    "Candidate issues:",
    ...candidates.map((c) => `  ${c.identifier} [${c.state}] ${c.title}`),
    "",
    'Reply with exactly one line: `IDENTIFIER | one short sentence of reasoning`.',
    'If nothing is a plausible match, reply `NONE | why`.',
  ].join("\n");

  const res = await new Anthropic().messages.create({
    model: "claude-opus-5",
    max_tokens: 200,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const [rawId, ...rest] = text.split("|");
  const identifier = rawId.trim().toUpperCase();
  const rationale = rest.join("|").trim();
  const match = candidates.find((c) => c.identifier === identifier);

  return NextResponse.json({
    suggestion: match ? { id: match.id, identifier: match.identifier, title: match.title } : null,
    rationale: rationale || text,
  });
}
