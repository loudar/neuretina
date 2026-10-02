import type { WorkflowDefinition } from "../core/workflow/definition.ts";
import type { Workflow, WorkflowRegistry, WorkflowRunContext } from "../core/workflow/Workflow.ts";
import type { UserWorkflow, UserWorkflowStore } from "../domain/workflows/UserWorkflowRepository.ts";
import type {
  BriefingWorkflow,
  BriefingWorkflowInput,
  BriefingWorkflowOutput,
} from "./BriefingWorkflow.ts";

/**
 * A runnable instance of the briefing pipeline: it delegates to the shared
 * `BriefingWorkflow` but pins the input values configured on its user
 * workflow row. Delivery resolves through the channels assigned to this
 * workflow's step outputs.
 */
export class UserBriefingWorkflow
  implements Workflow<BriefingWorkflowInput, BriefingWorkflowOutput>
{
  readonly definition: WorkflowDefinition;

  constructor(
    private readonly userWorkflow: UserWorkflow,
    private readonly briefing: BriefingWorkflow,
  ) {
    this.definition = {
      ...briefing.definition,
      id: userWorkflow.id,
      title: userWorkflow.name,
      description: `User briefing workflow: ${userWorkflow.name}`,
    };
  }

  run(
    input: BriefingWorkflowInput,
    context: WorkflowRunContext,
  ): Promise<BriefingWorkflowOutput> {
    // The stored input values always win: callers cannot widen or change them.
    return this.briefing.run(
      {
        ...input,
        topics: undefined,
        topicIds: undefined,
        inputs: this.userWorkflow.inputs,
        stopAfter: this.userWorkflow.stopAfter,
      },
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
