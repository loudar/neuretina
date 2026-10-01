import { loadConfig, type AppConfig } from "../src/config/env.ts";
import { createLogger } from "../src/core/logger.ts";
import {
  createKernel,
  type Kernel,
  type KernelOverrides,
} from "../src/kernel/Kernel.ts";
import type { EventBus } from "../src/core/events/EventBus.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
} from "../src/capabilities/llm/LlmProvider.ts";
import type {
  SearchKind,
  SearchProvider,
  SearchResult,
} from "../src/capabilities/search/SearchProvider.ts";
import type { FinanceProvider } from "../src/capabilities/finance/FinanceProvider.ts";
import type {
  MessagingProvider,
  OutboundMessage,
  SentMessage,
} from "../src/capabilities/messaging/MessagingProvider.ts";
import type { TextToSpeechProvider } from "../src/capabilities/tts/TtsProvider.ts";
import type {
  DeliveryChannelSender,
  DeliverySentMessage,
  DeliveryTextInput,
  DeliveryVoiceInput,
} from "../src/capabilities/delivery/DeliveryChannel.ts";
import type { DeliveryAttempt, DeliverInput } from "../src/delivery/DeliveryService.ts";
import type { WorkflowDefinition } from "../src/core/workflow/definition.ts";
import type { Workflow, WorkflowRunContext } from "../src/core/workflow/Workflow.ts";

export function testConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return loadConfig({
    DB_PATH: ":memory:",
    PORT: "0",
    LOG_LEVEL: "error",
    STARTUP_CHECK: "false",
    ...overrides,
  });
}

/** A kernel wired with the standard test stubs; override anything as needed. */
export async function createTestKernel(overrides: KernelOverrides = {}): Promise<Kernel> {
  return createKernel({
    config: overrides.config ?? testConfig(),
    logger: createLogger("test", { level: "error" }),
    llm: stubLlm(() => completion("ok")),
    webSearch: stubSearch("perplexity", "web"),
    socialSearch: stubSearch("bluesky", "social"),
    tts: new StubTts(),
    ...overrides,
  });
}

export function completion(
  text: string,
  toolCalls: LlmCompletionResult["toolCalls"] = [],
  usage: LlmCompletionResult["usage"] = {},
): LlmCompletionResult {
  return { text, toolCalls, finishReason: "stop", model: "stub", usage };
}

export function stubLlm(
  responder: (request: LlmCompletionRequest) => LlmCompletionResult | Promise<LlmCompletionResult>,
): LlmProvider {
  return {
    name: "stub-llm",
    defaultModel: "stub",
    complete: async (request) => responder(request),
  };
}

export function stubSearch(
  name: string,
  kind: SearchKind,
  results: SearchResult[] = [],
): SearchProvider {
  return {
    name,
    kind,
    search: async (query) => ({
      query: query.query,
      provider: name,
      kind,
      results,
    }),
  };
}

export function stubFinance(
  results: SearchResult[] = [],
  answer = "Stub finance answer",
): FinanceProvider {
  return {
    name: "perplexity",
    lookup: async (query) => ({
      question: query.question,
      provider: "perplexity",
      answer,
      data: [
        {
          category: "quote",
          tickers: ["NVDA"],
          content: answer,
          sources: results.map((result) => result.url),
        },
      ],
      results,
    }),
  };
}

export class StubMessaging implements MessagingProvider {
  readonly name = "stub-messaging";
  readonly defaultChannel = "!test:example.org";
  readonly sent: Array<{ message: OutboundMessage; sent: SentMessage }> = [];

  async send(message: OutboundMessage): Promise<SentMessage> {
    const sent: SentMessage = {
      id: `event-${this.sent.length + 1}`,
      channel: message.channel ?? this.defaultChannel ?? "test",
      kind: message.kind,
    };
    this.sent.push({ message, sent });
    return sent;
  }
}

export class StubTts implements TextToSpeechProvider {
  readonly name = "stub-tts";
  readonly defaultVoiceId = "stub-voice";
  readonly requests: string[] = [];
  options: { mimeType?: string; extension?: string; durationMs?: number } = {};
  /** When set, synthesize() rejects with this message. */
  failWith?: string;

  async synthesize(request: { text: string }) {
    this.requests.push(request.text);
    if (this.failWith) throw new Error(this.failWith);
    return {
      data: new Uint8Array([1, 2, 3, 4]),
      mimeType: this.options.mimeType ?? "audio/ogg",
      extension: this.options.extension ?? "ogg",
      durationMs: this.options.durationMs ?? 1000,
    };
  }
}

/** Records the messages a delivery channel sender receives. */
export class StubChannelSender implements DeliveryChannelSender {
  readonly name = "stub-channel";
  readonly sent: Array<{
    kind: "text" | "voice";
    text: string;
    html?: string;
    audio?: Uint8Array;
    mimeType?: string;
    filename?: string;
    caption?: string;
  }> = [];
  /** When set, sends of that kind reject with this message. */
  failText?: string;
  failVoice?: string;

  async verify(): Promise<string> {
    return "verified";
  }

  async sendText(input: DeliveryTextInput): Promise<DeliverySentMessage> {
    if (this.failText) throw new Error(this.failText);
    this.sent.push({ kind: "text", text: input.text, ...(input.html ? { html: input.html } : {}) });
    return { eventId: `evt-${this.sent.length}` };
  }

  async sendVoice(input: DeliveryVoiceInput): Promise<DeliverySentMessage> {
    if (this.failVoice) throw new Error(this.failVoice);
    this.sent.push({
      kind: "voice",
      text: input.text,
      audio: input.audio,
      mimeType: input.mimeType,
      filename: input.filename,
      caption: input.caption,
    });
    return { eventId: `evt-${this.sent.length}` };
  }
}

/** Minimal workflow with a code-shaped definition, for runner-level tests. */
export function stubWorkflow<TInput = unknown, TOutput = unknown>(options: {
  id: string;
  title?: string;
  description?: string;
  triggers?: WorkflowDefinition["triggers"];
  inputs?: WorkflowDefinition["inputs"];
  steps?: WorkflowDefinition["steps"];
  run: (input: TInput, context: WorkflowRunContext) => Promise<TOutput>;
}): Workflow<TInput, TOutput> {
  return {
    definition: {
      id: options.id,
      title: options.title ?? options.id,
      description: options.description ?? options.id,
      triggers: options.triggers ?? [],
      inputs: options.inputs ?? [],
      steps: options.steps ?? [],
    },
    run: options.run,
  };
}

/** Stands in for the DeliveryService in kernel-level tests. */
export class StubDeliveryService {
  readonly delivered: DeliverInput[] = [];
  /** Channel ids returned for every step-output target (default: one channel). */
  channels: string[] = ["chan-1"];
  /** Returned by deliver(); defaults to one successful channel. */
  results?: DeliveryAttempt[];

  async deliver(input: DeliverInput): Promise<DeliveryAttempt[]> {
    this.delivered.push(input);
    return this.results ?? [{ channelId: "chan-1", status: "sent", eventId: "event-1" }];
  }

  channelsFor(): string[] {
    return this.channels;
  }

  workflowChannels(): string[] {
    return this.channels;
  }
}

export const sampleResults: SearchResult[] = [
  {
    title: "Example article",
    url: "https://example.com/article",
    snippet: "Something happened",
    publishedAt: "2026-09-28",
    source: "example.com",
  },
  {
    title: "Another source",
    url: "https://news.example.org/story",
    snippet: "People are discussing it",
    source: "news.example.org",
  },
];

export function waitForEvent(
  bus: EventBus,
  topic: string,
  predicate: (event: DomainEvent) => boolean = () => true,
  timeoutMs = 3000,
): Promise<DomainEvent> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;

    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error(`Timed out waiting for "${topic}"`));
    }, timeoutMs);

    unsubscribe = bus.subscribe(topic, (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(event);
    });
  });
}
