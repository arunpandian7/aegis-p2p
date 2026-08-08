import Link from "next/link";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, workUnits } from "@/db/schema";
import { rollUpProjects, type ProjectRollup, type ProjectSession } from "@/lib/projects";
import { Stat } from "@/components/cost";
import { TagChat } from "@/components/tag-chat";

export const dynamic = "force-dynamic";

/** Same stand-in owner as /me, until there is an application login. */
const DEMO_USER = "u_arun";

type Issue = { id: string; identifier: string; title: string };

type LoadResult =
  | { state: "ready"; projects: ProjectRollup[]; issues: Issue[] }
  | { state: "unconfigured"; projects: []; issues: [] }
  | { state: "error"; projects: []; issues: [] };

async function loadProjects(): Promise<LoadResult> {
  if (!process.env.DATABASE_URL) return { state: "unconfigured", projects: [], issues: [] };

  try {
    const db = getDb();
    const [rows, issues] = await Promise.all([
      db
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
          workUnitId: sessions.workUnitId,
          issueIdentifier: workUnits.identifier,
          issueTitle: workUnits.title,
        })
        .from(sessions)
        .leftJoin(workUnits, eq(sessions.workUnitId, workUnits.id))
        // Scoped to the owner: this is a personal view, so the filter that keeps
        // one engineer's chats out of another's belongs in the query, the same
        // way team aggregates exclude private rows in `lib/queries.ts` rather
        // than in the markup.
        //
        // Deliberately *not* filtered on `is_private`. Tagging a chat onto an
        // issue clears that flag, and a conversation vanishing from your own
        // page the moment you publish it is the kind of surprise that stops
        // people publishing. Tagged rows stay here, showing where they went.
        .where(
          and(
            eq(sessions.userId, DEMO_USER),
            or(eq(sessions.surface, "claude_web"), eq(sessions.surface, "chatgpt_web")),
          ),
        )
        .orderBy(desc(sessions.endedAt))
        .limit(500),
      db
        .select({ id: workUnits.id, identifier: workUnits.identifier, title: workUnits.title })
        .from(workUnits)
        .orderBy(asc(workUnits.identifier)),
    ]);

    return { state: "ready", projects: rollUpProjects(rows as ProjectSession[]), issues };
  } catch (error) {
    console.error("Could not load browser projects", error);
    return { state: "error", projects: [], issues: [] };
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
  const tagged = projects.reduce((total, project) => total + project.taggedCount, 0);

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
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-dim)]">
          Nothing here reaches the team board on its own. <em>Tag to issue</em> publishes one
          conversation, as <code>tagged</code>, and it appears on that issue in estimated tokens
          beside the dollar figure — never inside it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Projects" value={number(trackedProjects)} sub="provider-native" />
        <Stat label="Conversations" value={number(conversations)} sub="tracked" />
        <Stat label="Messages" value={number(messages)} sub="counted, not stored" />
        <Stat label="Est. tokens" value={number(tokens)} sub="characters ÷ 4, no cost" />
        <Stat
          label="Tagged"
          value={number(tagged)}
          sub={tagged ? "on the board, as tokens" : "none published"}
        />
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

              <div className="mt-4 space-y-1">
                {project.conversations.slice(0, 3).map((conversation) => {
                  const url = safeConversationUrl(conversation.url);
                  return (
                    <div key={conversation.id} className="px-2 py-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                          >
                            {conversation.title}
                          </a>
                        ) : (
                          <span className="truncate">{conversation.title}</span>
                        )}
                        <span className="tabular shrink-0 text-xs text-[var(--color-muted)]">
                          {conversation.messageCount} msgs · {number(conversation.estimatedTokens)}{" "}
                          tok
                        </span>
                      </div>
                      <div className="mt-1">
                        <TagChat
                          sessionId={conversation.id}
                          issues={result.state === "ready" ? result.issues : []}
                          taggedTo={
                            conversation.workUnitId
                              ? {
                                  identifier: conversation.issueIdentifier,
                                  title: conversation.issueTitle,
                                }
                              : null
                          }
                        />
                      </div>
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
