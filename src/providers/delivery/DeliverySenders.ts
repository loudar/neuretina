import { ValidationError } from "../../core/errors.ts";
import type { DeliveryChannelSender } from "../../capabilities/delivery/DeliveryChannel.ts";
import type { DeliveryChannelType } from "../../domain/delivery/DeliveryRepository.ts";
import {
  MatrixDeliveryChannel,
  matrixChannelConfig,
} from "./MatrixDeliveryChannel.ts";
import { DiscordDeliveryChannel } from "./DiscordDeliveryChannel.ts";
import { EmailDeliveryChannel, emailChannelConfig } from "./EmailDeliveryChannel.ts";

/**
 * Builds the sender for one stored delivery channel. Configuration problems
 * surface here (ConfigurationError) so callers can record a failed delivery
 * without crashing the run.
 */
export function createDeliverySender(
  type: DeliveryChannelType,
  config: Record<string, unknown>,
): DeliveryChannelSender {
  switch (type) {
    case "matrix": {
      const matrix = matrixChannelConfig(config);
      if (!matrix) throw new ValidationError("Matrix channel config needs a homeserverUrl");
      return new MatrixDeliveryChannel(matrix);
    }
    case "discord":
      return new DiscordDeliveryChannel({ webhookUrl: stringField(config, "webhookUrl") });
    case "email":
      return new EmailDeliveryChannel(emailChannelConfig(config));
    default:
      // Runtime guard for data that bypassed the type system (e.g. hand-edited DB rows).
      throw new ValidationError(`Unknown delivery channel type: ${String(type)}`);
  }
}

function stringField(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
