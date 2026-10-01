import { describe, expect, test } from "bun:test";
import type { CreateChannelInput } from "../src/domain/delivery/DeliveryRepository.ts";
import type { Kernel } from "../src/kernel/Kernel.ts";
import { createTestKernel } from "./support.ts";

const CHANNEL: CreateChannelInput = {
  type: "discord",
  name: "Ops",
  config: { webhookUrl: "https://discord.example/hook" },
  enabled: true,
};

async function exportBundle(kernel: Kernel): Promise<Record<string, unknown>> {
  return (await kernel.commands.execute("data.export", null, "test")) as Record<string, unknown>;
}

async function importBundle(
  kernel: Kernel,
  bundle: Record<string, unknown>,
): Promise<{ deliveryChannels: number; deliveryAttachments: number }> {
  return (await kernel.commands.execute("data.import", { bundle }, "test")) as {
    deliveryChannels: number;
    deliveryAttachments: number;
  };
}

describe("data transfer", () => {
  test("exports delivery channels with their assignments and recreates them elsewhere", async () => {
    const source = await createTestKernel();
    const target = await createTestKernel();
    try {
      const channel = source.deliveries.createChannel(CHANNEL);
      source.deliveries.attach(
        { workflow: "briefing", step: "audio", output: "tts" },
        channel.id,
      );

      const bundle = await exportBundle(source);
      expect(bundle.deliveryChannels).toEqual([
        {
          id: channel.id,
          type: CHANNEL.type,
          name: CHANNEL.name,
          config: CHANNEL.config,
          enabled: true,
        },
      ]);
      expect(bundle.deliveryAttachments).toEqual([
        { workflow: "briefing", step: "audio", output: "tts", channelId: channel.id },
      ]);

      const summary = await importBundle(target, bundle);
      expect(summary.deliveryChannels).toBe(1);
      expect(summary.deliveryAttachments).toBe(1);

      const [imported] = target.deliveries.channels();
      expect(imported?.name).toBe(CHANNEL.name);
      expect(imported?.config).toEqual(CHANNEL.config);
      expect(target.deliveries.attachments()).toEqual([
        {
          workflow: "briefing",
          step: "audio",
          output: "tts",
          channelId: imported!.id,
        },
      ]);
    } finally {
      await source.shutdown();
      await target.shutdown();
    }
  });

  test("updates a same-named channel from the bundle instead of ignoring it", async () => {
    const source = await createTestKernel();
    const target = await createTestKernel();
    try {
      const channel = source.deliveries.createChannel(CHANNEL);
      source.deliveries.attach(
        { workflow: "briefing", step: "audio", output: "tts" },
        channel.id,
      );
      const bundle = await exportBundle(source);

      // The target already has the same channel with a stale configuration.
      const local = target.deliveries.createChannel({
        type: "discord",
        name: CHANNEL.name,
        config: { webhookUrl: "https://old.example/hook" },
        enabled: false,
      });

      const summary = await importBundle(target, bundle);
      expect(summary.deliveryChannels).toBe(1);

      const channels = target.deliveries.channels();
      expect(channels).toHaveLength(1);
      expect(channels[0]?.id).toBe(local.id);
      expect(channels[0]?.name).toBe(CHANNEL.name);
      expect(channels[0]?.config).toEqual(CHANNEL.config);
      expect(channels[0]?.enabled).toBe(true);

      // Assignments from the bundle land on the updated local channel.
      expect(target.deliveries.attachments()).toEqual([
        {
          workflow: "briefing",
          step: "audio",
          output: "tts",
          channelId: local.id,
        },
      ]);
    } finally {
      await source.shutdown();
      await target.shutdown();
    }
  });
});
