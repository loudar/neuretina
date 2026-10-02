<script lang="ts">
  import type { DeliveryChannelInfo, WorkflowStepInfo } from "../lib/api";
  import WorkflowStep from "./WorkflowStep.svelte";

  interface Props {
    steps: WorkflowStepInfo[];
    channels: DeliveryChannelInfo[];
    /** Assigned channel ids keyed by "step/output". */
    assignments: Record<string, string[]>;
    /** Channel switches are interactive only for customizable workflows. */
    editable: boolean;
    /** Step the run stops after; null = run the whole pipeline. */
    stopAfter: string | null;
    ontoggle: (step: string, output: string, channelId: string) => void;
    onstop: (stepId: string | null) => void;
  }

  let { steps, channels, assignments, editable, stopAfter, ontoggle, onstop }: Props = $props();

  const stopIndex = $derived(stopAfter ? steps.findIndex((step) => step.id === stopAfter) : -1);
  const visibleSteps = $derived(stopIndex >= 0 ? steps.slice(0, stopIndex + 1) : steps);
  const stoppedSteps = $derived(stopIndex >= 0 ? steps.slice(stopIndex + 1) : []);
</script>

<div class="steps">
  {#each visibleSteps as step, index (step.id)}
    <div class="step">
      <WorkflowStep
        {step}
        {index}
        {channels}
        {assignments}
        {editable}
        isStop={stopIndex === index}
        {ontoggle}
        {onstop}
      />

      {#if index < visibleSteps.length - 1}
        <div class="flow" aria-hidden="true">
          <span class="flow-turn"></span>
          <span class="flow-drop"></span>
          <span class="flow-arrow"></span>
        </div>
      {/if}
    </div>
  {/each}

  {#if stoppedSteps.length > 0}
    <div class="step">
      <div class="flow" aria-hidden="true">
        <span class="flow-turn"></span>
        <span class="flow-drop"></span>
        <span class="flow-arrow"></span>
      </div>

      <div class="stopped">
        <span class="stopped-count">{stoppedSteps.length}</span>
        <div class="stopped-info">
          <span class="stopped-title">
            {stoppedSteps.length} step{stoppedSteps.length === 1 ? "" : "s"} not enabled due to
            stopping step
          </span>
          <span class="muted stopped-names">
            {stoppedSteps.map((entry) => entry.title).join(" · ")}
          </span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .steps {
    display: flex;
    flex-direction: column;
  }

  /*
   * Step-to-step connector: from the outputs card down, left, and down into
   * the next step's inputs card. The horizontal sits exactly midway between
   * the steps; both pieces draw it in the same 2px band so the left bend is
   * a continuous curve.
   */
  .flow {
    position: relative;
    height: 2.75rem;
  }

  .flow-turn {
    box-sizing: border-box;
    position: absolute;
    top: 0;
    right: calc((100% - 4rem) / 6);
    width: calc(100% - (100% - 4rem) / 3 - 0.6rem);
    height: calc(50% + 1px);
    border-right: 2px solid var(--m3c-outline);
    border-bottom: 2px solid var(--m3c-outline);
    border-bottom-right-radius: 0.6rem;
  }

  .flow-drop {
    box-sizing: border-box;
    position: absolute;
    top: calc(50% - 1px);
    left: calc((100% - 4rem) / 6);
    width: 0.6rem;
    height: calc(50% + 1px);
    border-top: 2px solid var(--m3c-outline);
    border-left: 2px solid var(--m3c-outline);
    border-top-left-radius: 0.6rem;
  }

  .flow-arrow {
    position: absolute;
    bottom: 0;
    left: calc((100% - 4rem) / 6 - 5px);
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 7px solid var(--m3c-outline);
  }

  /* The collapsed tail after a stop step. */
  .stopped {
    display: flex;
    align-items: center;
    gap: var(--space-medium);
    padding: var(--space-medium) var(--space-large);
    border: 1px dashed var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background-color: var(--m3c-surface-container-low);
  }

  .stopped-count {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
  }

  .stopped-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
    min-width: 0;
  }

  .stopped-title {
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
  }

  .stopped-names {
    font-size: var(--font-small);
    overflow-wrap: anywhere;
  }
</style>
