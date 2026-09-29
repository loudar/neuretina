export interface ChatCommand {
  /** Channel the command was sent to (room id). */
  channel: string;
  /** Sender of the command (matrix user id). */
  sender: string;
  /** Lowercased command name without the leading slash, e.g. "start". */
  command: string;
  /** Everything after the command name, trimmed. */
  args: string;
  /** The raw message body. */
  raw: string;
}

export interface ChatCommandSource {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
}
