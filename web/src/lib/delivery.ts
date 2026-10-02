import iconChat from "@ktibow/iconset-material-symbols/chat";
import iconForum from "@ktibow/iconset-material-symbols/forum";
import iconMail from "@ktibow/iconset-material-symbols/mail";
import type { DeliveryChannelInfo, DeliveryChannelType } from "./api";

/** Display label per channel type. */
export const DELIVERY_TYPE_LABELS: Record<DeliveryChannelType, string> = {
  matrix: "Matrix",
  discord: "Discord",
  email: "Email",
};

/** Icon per channel type. */
export const DELIVERY_TYPE_ICONS: Record<DeliveryChannelType, typeof iconChat> = {
  matrix: iconChat,
  discord: iconForum,
  email: iconMail,
};

/** Select options for the channel-type picker. */
export const deliveryTypeOptions = (
  ["matrix", "discord", "email"] as DeliveryChannelType[]
).map((type) => ({
  icon: DELIVERY_TYPE_ICONS[type],
  text: DELIVERY_TYPE_LABELS[type],
  value: type,
}));

/** One-line config summary for the channel list, with secrets masked. */
export function configSummary(channel: DeliveryChannelInfo): string {
  const secrets = new Set(["accessToken", "password", "webhookUrl"]);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(channel.config)) {
    if (typeof value === "boolean") {
      parts.push(`${key}: ${value ? "on" : "off"}`);
    } else if (typeof value === "string" && value !== "") {
      parts.push(`${key}: ${secrets.has(key) ? "••••" : value}`);
    } else if (typeof value === "number") {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.join(" · ");
}
