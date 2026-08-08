"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Issue = { id: string; identifier: string; title: string };

/**
 * Tag a web conversation onto a work unit — the only way one reaches a team
 * surface.
 *
 * There is no suggestion step here, unlike `AttributeRow`. Suggesting means
 * sending the session's file and command trace to Claude to match against open
 * issues; a web conversation has no trace, and the only material we could send
 * instead is its title and project name — user content, to a model, to save a
 * dropdown. So the engineer picks.
 *
 * Tagging publishes: it clears `is_private`, which is what makes the row
 * visible on the issue page. That is stated on the button, not buried here.
 */
export function TagChat({
  sessionId,
  issues,
  taggedTo,
}: {
  sessionId: string;
  issues: Issue[];
  taggedTo: { identifier: string | null; title: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");

  async function post(action: "confirm" | "private", workUnitId?: string) {
    setBusy(true);
    await fetch("/api/attribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, sessionId, workUnitId }),
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (taggedTo?.identifier) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 text-xs text-[var(--color-dim)]">
          {taggedTo.identifier}
        </span>
        <button
          onClick={() => post("private")}
          disabled={busy}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {busy ? "…" : "make private"}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--color-edge)] px-2 py-0.5 text-xs text-[var(--color-muted)] hover:bg-white/5 hover:text-[var(--color-text)]"
      >
        Tag to issue
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="max-w-[11rem] rounded border border-[var(--color-edge)] bg-[var(--color-ink)] px-1.5 py-0.5 text-xs"
      >
        <option value="">Choose an issue…</option>
        {issues.map((issue) => (
          <option key={issue.id} value={issue.id}>
            {issue.identifier} {issue.title}
          </option>
        ))}
      </select>
      <button
        onClick={() => choice && post("confirm", choice)}
        disabled={busy || !choice}
        title="Publishes this conversation to the issue page, in tokens. Never as dollars."
        className="rounded border border-[var(--color-edge)] px-2 py-0.5 text-xs hover:bg-white/5 disabled:opacity-40"
      >
        {busy ? "…" : "Publish"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="px-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
      >
        cancel
      </button>
    </div>
  );
}
