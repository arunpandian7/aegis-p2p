import Link from "next/link";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { rollUpProjects, type ProjectRollup, type ProjectSession } from "@/lib/projects";
import { Stat } from "@/components/cost";

export const dynamic = "force-dynamic";

/** Same stand-in owner as /me, until there is an application login. */
const DEMO_USER = "u_arun";

type LoadResult =
  | { state: "ready"; projects: ProjectRollup[] }
  | { state: "unconfigured"; projects: [] }
  | { state: "error"; projects: [] };

async function loadProjects(): Promise<LoadResult> {
  if (!process.env.DATABASE_URL) return { state: "unconfigured", projects: [] };

  try {
    const db = getDb();
    const rows: ProjectSession[] = await db
      .select({
        id: sessions.id,
        provider: sessions.provider,
        externalProjectId: sessions.externalProjectId,
        externalProjectName: sessions.externalProjectName,
        externalConversationUrl: sessions.externalConversationUrl,
        conversationTitle: sessions.conversationTitle,
        endedAt: sessions.endedAt,
        messageCount: sessions.messageCount,
        totalInputTokens: sessions.totalInputTokens,
        totalOutputTokens: sessions.totalOutputTokens,
        usageBasis: sessions.usageBasis,
      })
      .from(sessions)
      // Scoped to the owner, not just to `is_private`: this page is the private
      // view, so the filter that keeps one engineer's chats out of another's
      // belongs in the query, the same way the team aggregates exclude private
      // rows in `lib/queries.ts` rather than in the markup.
      .where(
        and(
          eq(sessions.userId, DEMO_USER),
          eq(sessions.isPrivate, true),
          or(eq(sessions.surface, "claude_web"), eq(sessions.surface, "chatgpt_web")),
        ),
      )
      .orderBy(desc(sessions.endedAt))
      .limit(500);
    return { state: "ready", projects: rollUpProjects(rows) };
  } catch (error) {
    console.error("Could not load browser projects", error);
    return { state: "error", projects: [] };
  }
}

function providerLabel(provider: string) {
  if (provider === "anthropic") return "Claude";
  if (provider === "openai") return "ChatGPT";
  return provider;
}

function number(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}

function relativeDate(value: Date | null) {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    value,
  );
}

function safeConversationUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "claude.ai" && url.hostname !== "chatgpt.com") return null;
    return url.href;
  } catch {
    return null;
  }
}

export default async function MyChatsPage() {
  const result = await loadProjects();
  const projects = result.projects;
  const trackedProjects = projects.filter((project) => !project.isUnfiled).length;
  const conversations = projects.reduce((total, project) => total + project.conversationCount, 0);
  const messages = projects.reduce((total, project) => total + project.messageCount, 0);
  const tokens = projects.reduce((total, project) => total + project.estimatedTokens, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My chats</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-dim)]">
          Claude and ChatGPT web conversations, grouped by the provider&rsquo;s own project. Captured
          by the browser collector after you enable it once; the text of a conversation never leaves
          your browser. Token figures here are <strong>estimated from characters</strong> and carry{" "}
          <code>cost_basis = pool</code> — they are counts, not dollars, and no total on the team
          board can include them. See{" "}
          <Link href="/me" className="underline">
            My sessions
          </Link>{" "}
          for the API-priced side.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Projects" value={number(trackedProjects)} sub="provider-native" />
        <Stat label="Conversations" value={number(conversations)} sub="tracked" />
        <Stat label="Messages" value={number(messages)} sub="counted, not stored" />
        <Stat label="Est. tokens" value={number(tokens)} sub="characters ÷ 4, no cost" />
      </div>

      {result.state !== "ready" ? (
        <div className="rounded-lg border border-dashed border-[var(--color-edge)] p-8 text-sm text-[var(--color-muted)]">
          {result.state === "unconfigured"
            ? "Add DATABASE_URL to .env.local, then run pnpm db:push."
            : "The database is reachable, but the project fields are not ready. Run pnpm db:push and reload."}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-edge)] p-8">
          <h2 className="font-medium">No chats captured yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
            Load <code>extension/</code> unpacked, enter an ingest key from{" "}
            <code>scripts/bootstrap.ts</code>, enable capture once, then open or reload a Claude or
            ChatGPT conversation.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <article
              key={project.key}
              className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span>{providerLabel(project.provider)}</span>
                    <span>·</span>
                    <span>{project.isUnfiled ? "outside a project" : "project"}</span>
                  </div>
                  <h2 className="mt-1 truncate text-lg font-semibold">{project.projectName}</h2>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--color-edge)] px-2.5 py-1 text-xs text-[var(--color-dim)]">
                  {project.conversationCount} chat{project.conversationCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[var(--color-edge)] py-4 text-sm">
                <div>
                  <div className="text-xs text-[var(--color-muted)]">Messages</div>
                  <div className="tabular mt-1">{number(project.messageCount)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--color-muted)]">Est. tokens</div>
                  <div className="tabular mt-1">{number(project.estimatedTokens)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--color-muted)]">Last activity</div>
                  <div className="mt-1">{relativeDate(project.lastActivityAt)}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {project.conversations.slice(0, 3).map((conversation) => {
                  const url = safeConversationUrl(conversation.url);
                  const content = (
                    <>
                      <span className="truncate">{conversation.title}</span>
                      <span className="tabular shrink-0 text-xs text-[var(--color-muted)]">
                        {conversation.messageCount} msgs
                      </span>
                    </>
                  );
                  return url ? (
                    <a
                      key={conversation.id}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-[var(--color-edge)]"
                    >
                      {content}
                    </a>
                  ) : (
                    <div
                      key={conversation.id}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm"
                    >
                      {content}
                    </div>
                  );
                })}
                {project.conversations.length > 3 ? (
                  <div className="px-2 pt-1 text-xs text-[var(--color-muted)]">
                    +{project.conversations.length - 3} more
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
