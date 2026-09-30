import type { Workflow, WorkflowRegistry, WorkflowRunContext } from "../core/workflow/Workflow.ts";
import type { UserWorkflow, UserWorkflowStore } from "../domain/workflows/UserWorkflowRepository.ts";
import type {
  BriefingWorkflow,
  BriefingWorkflowInput,
  BriefingWorkflowOutput,
} from "./BriefingWorkflow.ts";

/**
 * A runnable instance of the briefing pipeline: it delegates to the shared
 * `BriefingWorkflow` but pins the topics selected by its user workflow row.
 * Delivery resolves through the channels attached to this workflow's id.
 */
export class UserBriefingWorkflow
  implements Workflow<BriefingWorkflowInput, BriefingWorkflowOutput>
{
  readonly id: string;
  readonly description: string;
  readonly contextId: string;
  readonly triggers = [{ kind: "schedule" as const }, { kind: "manual" as const }];

  constructor(
    private readonly userWorkflow: UserWorkflow,
    private readonly briefing: BriefingWorkflow,
  ) {
    this.id = userWorkflow.id;
    this.description = `User briefing workflow: ${userWorkflow.name}`;
    this.contextId = briefing.contextId;
  }

  run(
    input: BriefingWorkflowInput,
    context: WorkflowRunContext,
  ): Promise<BriefingWorkflowOutput> {
    // The stored topic ids always win: callers cannot widen or change them.
    return this.briefing.run(
      { ...input, topics: undefined, topicIds: this.userWorkflow.topicIds },
      context,
    );
  }
}

/**
 * Keeps the registry in sync with the user workflow store: rows that no
 * longer exist are unregistered (or restored to their core workflow when the
 * id belongs to one), current rows are registered (or refreshed).
 * Call at boot, before the runner resumes interrupted runs, and on
 * `workflow.user.changed`.
 */
export function createUserWorkflowSync(
  registry: WorkflowRegistry,
  briefing: BriefingWorkflow,
  store: UserWorkflowStore,
  coreWorkflows: ReadonlyMap<string, Workflow>,
): () => void {
  const registered = new Set<string>();

  return () => {
    const rows = store.list();
    const current = new Set(rows.map((row) => row.id));

    for (const id of registered) {
      if (current.has(id)) continue;
      // A removed row may have been customizing a core workflow (same id):
      // the core implementation takes the registration back over.
      const core = coreWorkflows.get(id);
      if (core) registry.register(core);
      else registry.unregister(id);
      registered.delete(id);
    }

    for (const row of rows) {
      registry.register(new UserBriefingWorkflow(row, briefing));
      registered.add(row.id);
    }
  };
}
