import { commands, type AppConfigInfo } from "./api";

/**
 * App config shared between the shell (health pill, job defaults) and the
 * settings view, which reloads it after every change so the pill stays live.
 */
export class ConfigStore {
  value = $state<AppConfigInfo | null>(null);

  async load(): Promise<void> {
    try {
      this.value = await commands.config();
    } catch {
      this.value = null;
    }
  }
}

export const configState = new ConfigStore();
