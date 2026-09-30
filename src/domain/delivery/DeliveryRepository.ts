import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";

export type DeliveryChannelType = "matrix" | "discord" | "email";

export const DELIVERY_CHANNEL_TYPES: readonly DeliveryChannelType[] = ["matrix", "discord", "email"];

export interface DeliveryChannel {
  id: string;
  type: DeliveryChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateChannelInput {
  type: DeliveryChannelType;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateChannelInput {
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * A step output a message can be routed to. Channels are assigned to these
 * targets, never to the workflow as a whole.
 */
export interface DeliveryTarget {
  workflow: string;
  step: string;
  output: string;
}

/** A channel assignment (one row of workflow_delivery_channels). */
export interface DeliveryAttachment extends DeliveryTarget {
  channelId: string;
}

/** Workflows that have at least one assignment, with their channel ids. */
export interface DeliveryWorkflow {
  workflow: string;
  channelIds: string[];
}

export type DeliveryKind = "text" | "voice";
export type DeliveryStatus = "pending" | "sent" | "failed";

export interface DeliveryRecord {
  id: string;
  briefId: string;
  runId?: string;
  channelId: string;
  kind: DeliveryKind;
  status: DeliveryStatus;
  eventId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RecordDeliveryInput {
  briefId: string;
  runId?: string;
  channelId: string;
  kind: DeliveryKind;
}

export interface CompleteDeliveryInput {
  status: Exclude<DeliveryStatus, "pending">;
  eventId?: string;
  error?: string;
}

export interface DeliveryListFilter {
  briefId?: string;
  runId?: string;
}

/** Storage-agnostic delivery store; swap the implementation without touching consumers. */
export interface DeliveryStore {
  channels(): DeliveryChannel[];
  channel(id: string): DeliveryChannel;
  createChannel(input: CreateChannelInput): DeliveryChannel;
  updateChannel(id: string, patch: UpdateChannelInput): DeliveryChannel;
  removeChannel(id: string): DeliveryChannel;
  /** Total number of channels; used by the boot migration. */
  countChannels(): number;

  workflows(): DeliveryWorkflow[];
  attachments(): DeliveryAttachment[];
  /** Assigns a channel to a step output (idempotent). */
  attach(target: DeliveryTarget, channelId: string): void;
  /** Removes one channel from a step output. */
  detach(target: DeliveryTarget, channelId: string): void;
  /** Removes every assignment of one workflow (e.g. when it is deleted). */
  detachWorkflow(workflow: string): void;

  deliveries(filter?: DeliveryListFilter): DeliveryRecord[];
  record(input: RecordDeliveryInput): DeliveryRecord;
  complete(id: string, result: CompleteDeliveryInput): DeliveryRecord;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  config: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface DeliveryRow {
  id: string;
  brief_id: string;
  run_id: string | null;
  channel_id: string;
  kind: string;
  status: string;
  event_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface AttachmentRow {
  workflow: string;
  step: string;
  output: string;
  channel_id: string;
}

export class DeliveryRepository implements DeliveryStore {
  constructor(private readonly db: SqliteDatabase) {}

  channels(): DeliveryChannel[] {
    const rows = this.db.raw
      .query<ChannelRow, []>("SELECT * FROM delivery_channels ORDER BY rowid ASC")
      .all();
    return rows.map(toChannel);
  }

  channel(id: string): DeliveryChannel {
    const row = this.db.raw
      .query<ChannelRow, [string]>("SELECT * FROM delivery_channels WHERE id = ?")
      .get(id);
    if (!row) throw new NotFoundError(`Delivery channel ${id} not found`);
    return toChannel(row);
  }

  createChannel(input: CreateChannelInput): DeliveryChannel {
    assertChannelType(input.type);
    if (!input.name?.trim()) throw new ValidationError("Channel name is required");

    const now = Date.now();
    const channel: DeliveryChannel = {
      id: crypto.randomUUID(),
      type: input.type,
      name: input.name.trim(),
      config: input.config ?? {},
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO delivery_channels (id, type, name, config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channel.id,
        channel.type,
        channel.name,
        JSON.stringify(channel.config),
        channel.enabled ? 1 : 0,
        channel.createdAt,
        channel.updatedAt,
      );

    return channel;
  }

  updateChannel(id: string, patch: UpdateChannelInput): DeliveryChannel {
    const existing = this.channel(id);
    const updated: DeliveryChannel = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      config: patch.config ?? existing.config,
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: Date.now(),
    };

    this.db.raw
      .query(
        `UPDATE delivery_channels
         SET name = ?, config = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.name,
        JSON.stringify(updated.config),
        updated.enabled ? 1 : 0,
        updated.updatedAt,
        id,
      );

    return updated;
  }

  removeChannel(id: string): DeliveryChannel {
    const channel = this.channel(id);
    // Attachments cascade (workflow_delivery_channels.channel_id ON DELETE CASCADE).
    this.db.raw.query("DELETE FROM delivery_channels WHERE id = ?").run(id);
    return channel;
  }

  countChannels(): number {
    const row = this.db.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM delivery_channels")
      .get();
    return row?.n ?? 0;
  }

  workflows(): DeliveryWorkflow[] {
    const byWorkflow = new Map<string, DeliveryWorkflow>();
    for (const attachment of this.attachments()) {
      let entry = byWorkflow.get(attachment.workflow);
      if (!entry) {
        entry = { workflow: attachment.workflow, channelIds: [] };
        byWorkflow.set(attachment.workflow, entry);
      }
      if (!entry.channelIds.includes(attachment.channelId)) {
        entry.channelIds.push(attachment.channelId);
      }
    }
    return [...byWorkflow.values()];
  }

  attachments(): DeliveryAttachment[] {
    return this.db.raw
      .query<AttachmentRow, []>(
        "SELECT workflow, step, output, channel_id FROM workflow_delivery_channels ORDER BY rowid ASC",
      )
      .all()
      .map((row) => ({
        workflow: row.workflow,
        step: row.step,
        output: row.output,
        channelId: row.channel_id,
      }));
  }

  attach(target: DeliveryTarget, channelId: string): void {
    this.channel(channelId); // NotFoundError when unknown
    this.db.raw
      .query(
        `INSERT OR IGNORE INTO workflow_delivery_channels (workflow, step, output, channel_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(target.workflow, target.step, target.output, channelId);
  }

  detach(target: DeliveryTarget, channelId: string): void {
    this.db.raw
      .query(
        `DELETE FROM workflow_delivery_channels
         WHERE workflow = ? AND step = ? AND output = ? AND channel_id = ?`,
      )
      .run(target.workflow, target.step, target.output, channelId);
  }

  detachWorkflow(workflow: string): void {
    this.db.raw
      .query("DELETE FROM workflow_delivery_channels WHERE workflow = ?")
      .run(workflow);
  }

  deliveries(filter: DeliveryListFilter = {}): DeliveryRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.briefId) {
      conditions.push("brief_id = ?");
      params.push(filter.briefId);
    }
    if (filter.runId) {
      conditions.push("run_id = ?");
      params.push(filter.runId);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.raw
      .query<DeliveryRow, string[]>(
        `SELECT * FROM deliveries${where} ORDER BY rowid ASC`,
      )
      .all(...params);
    return rows.map(toDelivery);
  }

  record(input: RecordDeliveryInput): DeliveryRecord {
    const now = Date.now();
    const delivery: DeliveryRecord = {
      id: crypto.randomUUID(),
      briefId: input.briefId,
      runId: input.runId,
      channelId: input.channelId,
      kind: input.kind,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO deliveries (id, brief_id, run_id, channel_id, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        delivery.id,
        delivery.briefId,
        delivery.runId ?? null,
        delivery.channelId,
        delivery.kind,
        delivery.createdAt,
        delivery.updatedAt,
      );

    return delivery;
  }

  complete(id: string, result: CompleteDeliveryInput): DeliveryRecord {
    const existing = this.getDelivery(id);
    const updated: DeliveryRecord = {
      ...existing,
      status: result.status,
      eventId: result.eventId ?? existing.eventId,
      error: result.error ?? existing.error,
      updatedAt: Date.now(),
    };

    this.db.raw
      .query(
        `UPDATE deliveries
         SET status = ?, event_id = ?, error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(updated.status, updated.eventId ?? null, updated.error ?? null, updated.updatedAt, id);

    return updated;
  }

  private getDelivery(id: string): DeliveryRecord {
    const row = this.db.raw
      .query<DeliveryRow, [string]>("SELECT * FROM deliveries WHERE id = ?")
      .get(id);
    if (!row) throw new NotFoundError(`Delivery ${id} not found`);
    return toDelivery(row);
  }
}

export function assertChannelType(type: unknown): asserts type is DeliveryChannelType {
  if (typeof type !== "string" || !DELIVERY_CHANNEL_TYPES.includes(type as DeliveryChannelType)) {
    throw new ValidationError(
      `"type" must be one of: ${DELIVERY_CHANNEL_TYPES.join(", ")}`,
    );
  }
}

function toChannel(row: ChannelRow): DeliveryChannel {
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.config) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    config = {};
  }
  return {
    id: row.id,
    type: row.type as DeliveryChannelType,
    name: row.name,
    config,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    briefId: row.brief_id,
    runId: row.run_id ?? undefined,
    channelId: row.channel_id,
    kind: row.kind as DeliveryKind,
    status: row.status as DeliveryStatus,
    eventId: row.event_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
