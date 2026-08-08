export type ProjectSession = {
  id: string;
  provider: string;
  externalProjectId: string | null;
  externalProjectName: string | null;
  externalConversationUrl: string | null;
  conversationTitle: string | null;
  endedAt: Date | null;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  usageBasis: string;
};

export type ProjectConversation = {
  id: string;
  title: string;
  url: string | null;
  endedAt: Date | null;
  messageCount: number;
};

export type ProjectRollup = {
  key: string;
  provider: string;
  projectId: string | null;
  projectName: string;
  isUnfiled: boolean;
  conversationCount: number;
  messageCount: number;
  estimatedTokens: number;
  lastActivityAt: Date | null;
  usageIsEstimated: boolean;
  conversations: ProjectConversation[];
};

function newest(first: Date | null, second: Date | null): Date | null {
  if (!first) return second;
  if (!second) return first;
  return first.getTime() >= second.getTime() ? first : second;
}

export function rollUpProjects(rows: ProjectSession[]): ProjectRollup[] {
  const projects = new Map<string, ProjectRollup>();

  for (const row of rows) {
    const identity = row.externalProjectId
      ? `id:${row.externalProjectId}`
      : row.externalProjectName
        ? `name:${row.externalProjectName}`
        : "unfiled";
    const key = `${row.provider}:${identity}`;
    const project = projects.get(key) ?? {
      key,
      provider: row.provider,
      projectId: row.externalProjectId,
      projectName: row.externalProjectName ?? (row.externalProjectId ? "Unnamed project" : "Unfiled chats"),
      isUnfiled: !row.externalProjectId && !row.externalProjectName,
      conversationCount: 0,
      messageCount: 0,
      estimatedTokens: 0,
      lastActivityAt: null,
      usageIsEstimated: false,
      conversations: [],
    };

    if (project.projectName === "Unnamed project" && row.externalProjectName) {
      project.projectName = row.externalProjectName;
    }

    project.conversationCount++;
    project.messageCount += row.messageCount;
    project.estimatedTokens += row.totalInputTokens + row.totalOutputTokens;
    project.lastActivityAt = newest(project.lastActivityAt, row.endedAt);
    project.usageIsEstimated ||= row.usageBasis === "estimated";
    project.conversations.push({
      id: row.id,
      title: row.conversationTitle ?? "Untitled conversation",
      url: row.externalConversationUrl,
      endedAt: row.endedAt,
      messageCount: row.messageCount,
    });
    projects.set(key, project);
  }

  return [...projects.values()]
    .map((project) => ({
      ...project,
      conversations: project.conversations.sort(
        (a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0),
      ),
    }))
    .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));
}
