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

  "topic.created": { id: string; name: string; description?: string };
  "topic.deleted": { id: string; name: string };

  "job.created": { id: string; name: string; cron: string; workflow: string };
  "job.updated": { id: string; name: string };
  "job.deleted": { id: string; name: string };
  "job.started": { id: string; name: string; workflow: string; trigger: "schedule" | "manual" };
  "job.finished": { id: string; name: string; workflow: string; durationMs: number };
  "job.failed": { id: string; name: string; workflow: string; error: string };

  "workflow.started": { workflow: string; correlationId: string; input: unknown };
  "workflow.finished": { workflow: string; correlationId: string; durationMs: number; output: unknown };
  "workflow.failed": { workflow: string; correlationId: string; error: string };

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
  };
  "agent.failed": { agent: string; correlationId: string; error: string };

  "brief.research.started": { correlationId: string; topics: string[] };
  "brief.topic.researched": {
    correlationId: string;
    topic: string;
    sources: number;
    found: boolean;
    notes: string;
  };
  "brief.generated": {
    correlationId: string;
    briefId: string;
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

  "tts.synthesized": {
    correlationId: string;
    briefId: string;
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

  "message.received": { type: string; correlationId: string; payload: unknown };
  "command.completed": { type: string; correlationId: string; result: unknown };
  "command.failed": { type: string; correlationId: string; error: string };

  "hook.received": { channel: string; event: string };

  "chat.command.received": { channel: string; sender: string; command: string; args: string };
  "chat.command.handled": { channel: string; command: string; reply: string };
  "chat.command.failed": { channel: string; command: string; error: string };
}
