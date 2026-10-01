export interface AppEvents {
  "system.ready": { port: number; jobs: number; workflows: string[] };
  "system.stopping": { reason: string };
  "system.check.completed": {
    name: string;
    status: "ok" | "failed" | "skipped";
    detail: string;
    durationMs: number;
  };
  "system.validation.completed": {
    ok: boolean;
    checks: number;
    failed: string[];
    skipped: string[];
  };
  "system.startup.announced": { channel: string; eventId: string };
  "system.startup.announce_failed": { error: string };

  "topic.created": { id: string; name: string; description?: string; muted?: boolean };
  "topic.updated": { id: string; name: string; description?: string; muted?: boolean };
  "topic.deleted": { id: string; name: string };

  "job.created": { id: string; name: string; cron: string; workflow: string };
  "job.updated": { id: string; name: string };
  "job.deleted": { id: string; name: string };
  "job.started": { id: string; name: string; workflow: string; trigger: "schedule" | "manual" };
  "job.finished": { id: string; name: string; workflow: string; durationMs: number };
  "job.failed": { id: string; name: string; workflow: string; error: string };

  "workflow.started": {
    workflow: string;
    correlationId: string;
    contextId?: string;
    trigger?: "schedule" | "matrix" | "manual";
    input: unknown;
  };
  "workflow.finished": {
    workflow: string;
    correlationId: string;
    contextId?: string;
    trigger?: "schedule" | "matrix" | "manual";
    durationMs: number;
    output: unknown;
    /** Provider cost report for the run, when anything metered was used. */
    cost?: unknown;
  };
  "workflow.failed": {
    workflow: string;
    correlationId: string;
    contextId?: string;
    trigger?: "schedule" | "matrix" | "manual";
    error: string;
    /** Provider cost report for the run, when anything metered was used. */
    cost?: unknown;
  };
  "workflow.cancelled": {
    workflow: string;
    correlationId: string;
    contextId?: string;
    trigger?: "schedule" | "matrix" | "manual";
  };
  "workflow.deleted": {
    workflow: string;
    correlationId: string;
    /** Number of artifacts removed along with the run, if requested. */
    artifacts: number;
  };
  "workflow.user.changed": {
    action: "create" | "update" | "delete";
    workflowId: string;
  };

  "agent.started": { agent: string; correlationId: string; input: string };
  "agent.tool.invoked": {
    agent: string;
    correlationId: string;
    tool: string;
    args: Record<string, unknown>;
  };
  "agent.tool.succeeded": {
    agent: string;
    correlationId: string;
    tool: string;
    durationMs: number;
    summary: string;
  };
  "agent.tool.failed": { agent: string; correlationId: string; tool: string; error: string };
  "agent.finished": {
    agent: string;
    correlationId: string;
    steps: number;
    durationMs: number;
    output: string;
    /** Token/cost usage summed across the agent's LLM completions. */
    usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  };
  "agent.failed": { agent: string; correlationId: string; error: string };

  "artifact.created": {
    artifactId: string;
    kind: string;
    workflow?: string;
    parentId?: string;
    correlationId?: string;
  };
  "artifact.deleted": { artifactId: string; kind: string };

  "brief.research.started": { correlationId: string; topics: string[] };
  "brief.research.completed": {
    correlationId: string;
    topics: string[];
    sources: number;
    found: boolean;
    queries: string[];
    missingTopics?: string[];
  };
  "brief.generated": {
    correlationId: string;
    briefId: string;
    artifactId: string;
    topics: string[];
    sources: number;
    characters: number;
  };
  "brief.skipped": {
    correlationId: string;
    reason: string;
    topics?: string[];
    queries?: string[];
  };
  "brief.deleted": { correlationId: string; briefId: string };

  "tts.synthesized": {
    correlationId: string;
    briefId: string;
    artifactId?: string;
    audioArtifactId?: string;
    characters: number;
    bytes: number;
    durationMs: number;
  };
  "message.voice.sent": {
    correlationId: string;
    briefId: string;
    channel: string;
    eventId: string;
  };
  "message.text.sent": {
    correlationId: string;
    channel: string;
    eventId: string;
  };

  "settings.updated": { key: string; action: "set" | "cleared" };

  /** Authentication activity; payloads never carry credentials. */
  "auth.login": { method: string; subject: string };
  "auth.login.failed": { method: string };
  "auth.logout": { method: string; subject: string };

  /** Any channel/attachment change; consumers refetch the delivery state. */
  "delivery.updated": { action: "create" | "update" | "delete" | "attach" | "detach" };
  /** One delivery attempt through a channel, from recording to settlement. */
  "delivery.status": {
    briefId: string;
    runId?: string;
    channelId: string;
    kind: "text" | "voice";
    status: "pending" | "sent" | "failed";
    eventId?: string;
    error?: string;
  };

  "message.received": { type: string; correlationId: string; payload: unknown };
  "command.completed": { type: string; correlationId: string; result: unknown };
  "command.failed": { type: string; correlationId: string; error: string };

  "hook.received": { channel: string; event: string };

  "chat.command.received": { channel: string; sender: string; command: string; args: string };
  "chat.command.handled": { channel: string; command: string; reply: string };
  "chat.command.failed": { channel: string; command: string; error: string };
  "chat.message.received": {
    channel: string;
    sender: string;
    body: string;
    replyToBot: boolean;
  };
  "chat.question.received": { channel: string; sender: string; question: string };
  "chat.question.answered": {
    channel: string;
    sender: string;
    question: string;
    answer: string;
  };
  "chat.question.failed": { channel: string; sender: string; question: string; error: string };
}
