import type { Component } from "svelte";
import iconFinance from "@ktibow/iconset-material-symbols/finance";
import iconPsychology from "@ktibow/iconset-material-symbols/psychology";
import iconSearch from "@ktibow/iconset-material-symbols/search";
import iconSmartToy from "@ktibow/iconset-material-symbols/smart-toy";
import { commands } from "./commands";
import type {
  ConnectionPreset,
  DecisionModelConnection,
  FinanceConnection,
  LlmConnection,
  SearchConnection,
} from "./api";
import {
  DECISION_PROVIDER_IDS,
  DECISION_PROVIDER_PRESETS,
  decisionModelLabel,
  FINANCE_PROVIDER_IDS,
  FINANCE_PROVIDER_PRESETS,
  LLM_PROVIDER_IDS,
  LLM_PROVIDER_PRESETS,
  llmProviderLabel,
  parseDecisionModelConnections,
  parseFinanceConnections,
  parseLlmConnections,
  parseSearchConnections,
  SEARCH_PROVIDER_IDS,
  SEARCH_PROVIDER_PRESETS,
} from "./api";

export interface ConnectionForm {
  provider: string;
  model: string;
  baseUrl: string;
  accountId: string;
  apiKey: string;
}

function buildConnection(form: ConnectionForm, id: string): Record<string, unknown> {
  return {
    id,
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    ...(form.model.trim() ? { model: form.model.trim() } : {}),
    ...(form.accountId.trim() ? { accountId: form.accountId.trim() } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  };
}

/**
 * Everything the generic settings connection group needs for one provider
 * kind: labels, list parsing, form mapping, verification and active-selection
 * handling. Connection types differ, so the callbacks are typed loosely here;
 * the exported configs below are the single source of truth.
 */
export interface ConnectionGroupConfig {
  group: string;
  settingKey: string;
  /** Setting holding the active selection; absent = no active row. */
  activeKey?: string;
  /** Connection ids in a stored setting value, for active-selection fallback. */
  parseIds: (value: string | null) => string[];
  presets: Record<string, ConnectionPreset>;
  providerIds: string[];
  noun: string;
  header: string;
  empty: string;
  icon: Component;
  label: (connection: never) => string;
  subtitle?: (connection: never) => string;
  formOf: (connection: never) => ConnectionForm;
  build: (form: ConnectionForm, id: string) => unknown;
  verify: (payload: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
  uniqueProvider?: boolean;
  allowDuplicate?: boolean;
  removeNote?: string;
  /** Copy for the "active selection" row above the list. */
  activeTitle?: string;
  activeSummary?: (selected: never | null) => string;
  activeEmpty?: string;
}

export const LLM_CONNECTION_GROUP: ConnectionGroupConfig = {
  group: "LLM",
  settingKey: "LLM_PROVIDERS",
  activeKey: "LLM_PROVIDER",
  parseIds: (value) => parseLlmConnections(value).map((connection) => connection.id),
  presets: LLM_PROVIDER_PRESETS,
  providerIds: LLM_PROVIDER_IDS,
  noun: "LLM provider",
  header: "Connections",
  empty: "No LLM providers yet.",
  icon: iconSmartToy,
  label: (connection: LlmConnection) => llmProviderLabel(connection),
  subtitle: (connection: LlmConnection) => connection.baseUrl,
  formOf: (connection: LlmConnection) => ({
    provider: connection.provider,
    model: connection.model,
    baseUrl: connection.baseUrl,
    accountId: "",
    apiKey: connection.apiKey ?? "",
  }),
  build: buildConnection,
  verify: commands.llm.verify,
  activeTitle: "Active provider",
  activeSummary: (selected: LlmConnection | null) =>
    selected ? llmProviderLabel(selected) : "default OpenCode pairing",
  activeEmpty: "No LLM providers configured.",
};

export const DECISION_CONNECTION_GROUP: ConnectionGroupConfig = {
  group: "Decision models",
  settingKey: "DECISION_MODELS",
  activeKey: "DECISION_MODEL",
  parseIds: (value) => parseDecisionModelConnections(value).map((connection) => connection.id),
  presets: DECISION_PROVIDER_PRESETS,
  providerIds: DECISION_PROVIDER_IDS,
  noun: "decision model",
  header: "Hosted connections",
  empty: "No hosted decision models yet.",
  icon: iconPsychology,
  label: (connection: DecisionModelConnection) => decisionModelLabel(connection),
  subtitle: (connection: DecisionModelConnection) =>
    `${connection.baseUrl}${connection.accountId ? ` · account ${connection.accountId}` : ""}`,
  formOf: (connection: DecisionModelConnection) => ({
    provider: connection.provider,
    model: connection.model,
    baseUrl: connection.baseUrl,
    accountId: connection.accountId ?? "",
    apiKey: connection.apiKey ?? "",
  }),
  build: buildConnection,
  verify: commands.decision.verify,
  removeNote: "Decisions fall back to the local model or the LLM.",
  activeTitle: "Active model",
  activeSummary: (selected: DecisionModelConnection | null) =>
    selected ? decisionModelLabel(selected) : "local model / LLM fallback",
  activeEmpty: "No hosted models configured.",
};

export const SEARCH_CONNECTION_GROUP: ConnectionGroupConfig = {
  group: "Web search",
  settingKey: "SEARCH_PROVIDERS",
  activeKey: "SEARCH_PROVIDER",
  parseIds: (value) => parseSearchConnections(value).map((connection) => connection.id),
  presets: SEARCH_PROVIDER_PRESETS,
  providerIds: SEARCH_PROVIDER_IDS,
  noun: "web search provider",
  header: "Providers",
  empty: "No web search providers yet.",
  icon: iconSearch,
  uniqueProvider: true,
  allowDuplicate: false,
  label: (connection: SearchConnection) => searchConnectionLabel(connection),
  subtitle: (connection: SearchConnection) => connection.baseUrl,
  formOf: (connection: SearchConnection) => ({
    provider: connection.provider,
    model: "",
    baseUrl: connection.baseUrl,
    accountId: "",
    apiKey: connection.apiKey ?? "",
  }),
  build: buildConnection,
  verify: commands.search.verify,
  activeTitle: "Active provider",
  activeSummary: (selected: SearchConnection | null) =>
    selected ? searchConnectionLabel(selected) : "no provider configured",
  activeEmpty: "No web search providers configured.",
};

export const FINANCE_CONNECTION_GROUP: ConnectionGroupConfig = {
  group: "Finance data",
  settingKey: "FINANCE_PROVIDERS",
  parseIds: (value) => parseFinanceConnections(value).map((connection) => connection.id),
  presets: FINANCE_PROVIDER_PRESETS,
  providerIds: FINANCE_PROVIDER_IDS,
  noun: "finance provider",
  header: "Providers",
  empty: "No finance data providers yet.",
  icon: iconFinance,
  uniqueProvider: true,
  allowDuplicate: false,
  label: (connection: FinanceConnection) =>
    FINANCE_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider,
  subtitle: (connection: FinanceConnection) =>
    connection.model ? `${connection.baseUrl} · ${connection.model}` : connection.baseUrl,
  formOf: (connection: FinanceConnection) => ({
    provider: connection.provider,
    model: connection.model ?? "",
    baseUrl: connection.baseUrl,
    accountId: "",
    apiKey: connection.apiKey ?? "",
  }),
  build: buildConnection,
  verify: commands.finance.verify,
};

function searchConnectionLabel(connection: SearchConnection): string {
  return SEARCH_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider;
}
