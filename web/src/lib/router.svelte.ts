export const TABS = [
  "briefs",
  "topics",
  "jobs",
  "workflows",
  "delivery",
  "artifacts",
  "events",
  "settings",
] as const;
export type Tab = (typeof TABS)[number];

export interface Route {
  tab: Tab;
  /** Decoded path segments after the tab, e.g. ["briefing", "<runId>"]. */
  segments: string[];
  /** Non-empty query parameters. */
  query: Record<string, string>;
}

export interface NavigateOptions {
  /** Replace the current history entry (filters, close actions) instead of pushing. */
  replace?: boolean;
}

const DEFAULT_TAB: Tab = "briefs";

function parse(url: URL): Route {
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

  const tab = (TABS as readonly string[]).includes(parts[0] ?? "") ? (parts[0] as Tab) : DEFAULT_TAB;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value !== "") query[key] = value;
  }

  return { tab, segments: tab === parts[0] ? parts.slice(1) : [], query };
}

/**
 * Minimal SPA router: the URL is the single source of truth for navigation
 * state (tab, selection, filters). Views read `router.current` and call
 * `navigate()`; back/forward work through popstate.
 */
class Router {
  current = $state<Route>(parse(new URL(location.href)));

  constructor() {
    // Canonicalize the entry URL: `/` and unknown first segments land on the
    // default tab so the address bar always represents a real view.
    const [first] = location.pathname.split("/").filter(Boolean);
    if (!first || !(TABS as readonly string[]).includes(first)) {
      history.replaceState(null, "", `/${DEFAULT_TAB}${location.search}`);
      this.current = parse(new URL(location.href));
    }

    window.addEventListener("popstate", () => {
      this.current = parse(new URL(location.href));
    });
  }

  navigate(to: string, options: NavigateOptions = {}): void {
    const url = new URL(to, location.origin);
    const next = parse(url);
    if (url.pathname === location.pathname && url.search === location.search) {
      // Same URL (e.g. a filter that did not change): only refresh the state.
      this.current = next;
      return;
    }

    if (options.replace) history.replaceState(null, "", url.pathname + url.search);
    else history.pushState(null, "", url.pathname + url.search);
    this.current = next;
  }
}

export const router = new Router();

function withQuery(path: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const paths = {
  tab: (tab: Tab) => `/${tab}`,
  briefs: (id?: string | null, query?: { source?: string }) =>
    withQuery(id ? `/briefs/${encodeURIComponent(id)}` : "/briefs", query),
  topics: (id?: string | null) => (id ? `/topics/${encodeURIComponent(id)}` : "/topics"),
  jobs: (id?: string | null) => (id ? `/jobs/${encodeURIComponent(id)}` : "/jobs"),
  events: (id?: string | null, topic?: string) =>
    withQuery(id ? `/events/${encodeURIComponent(id)}` : "/events", { topic }),
  artifacts: (id?: string | null, query?: { q?: string }) =>
    withQuery(id ? `/artifacts/${encodeURIComponent(id)}` : "/artifacts", query),
  workflows: (
    workflowId?: string | null,
    runId?: string | null,
    query?: { context?: string },
  ) => {
    let path = "/workflows";
    if (workflowId) path += `/${encodeURIComponent(workflowId)}`;
    if (workflowId && runId) path += `/${encodeURIComponent(runId)}`;
    return withQuery(path, query);
  },
  delivery: () => "/delivery",
  settings: () => "/settings",
};
