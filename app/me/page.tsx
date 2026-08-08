import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { rollUpProjects, type ProjectRollup, type ProjectSession } from "@/lib/projects";

export const dynamic = "force-dynamic";

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
      .where(
        and(
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

export default async function MyProjectsPage() {
  const result = await loadProjects();
  const projects = result.projects;
  const trackedProjects = projects.filter((project) => !project.isUnfiled).length;
  const conversations = projects.reduce((total, project) => total + project.conversationCount, 0);
  const messages = projects.reduce((total, project) => total + project.messageCount, 0);
  const tokens = projects.reduce((total, project) => total + project.estimatedTokens, 0);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Private workspace
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">My Claude + ChatGPT projects</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
            Automatically captured after one-time browser consent. Content stays in your browser; Aegis
            receives project metadata and estimated usage only.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[var(--color-edge)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
          estimated / pool · never API dollars
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Projects", trackedProjects],
          ["Conversations", conversations],
          ["Messages", messages],
          ["Est. tokens", tokens],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
            <div className="text-xs text-[var(--color-muted)]">{label}</div>
            <div className="tabular mt-2 text-2xl font-semibold">{number(Number(value))}</div>
          </div>
        ))}
      </div>

      {result.state !== "ready" ? (
        <div className="rounded-xl border border-dashed border-[var(--color-edge)] p-8 text-sm text-[var(--color-muted)]">
          {result.state === "unconfigured"
            ? "Add DATABASE_URL to .env.local, then run pnpm db:push."
            : "The database is reachable, but the project fields are not ready. Run pnpm db:push and reload."}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-edge)] p-8">
          <h2 className="font-medium">No browser projects yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
            Load the extension, enter an ingest key, enable capture once, then open or reload a Claude or
            ChatGPT conversation.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <article key={project.key} className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span>{providerLabel(project.provider)}</span>
                    <span>·</span>
                    <span>{project.isUnfiled ? "outside a project" : "project"}</span>
                  </div>
                  <h2 className="mt-1 truncate text-lg font-semibold">{project.projectName}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-cool)_13%,transparent)] px-2.5 py-1 text-xs text-[var(--color-cool)]">
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
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-edge)]"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={conversation.id} className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
                      {content}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
