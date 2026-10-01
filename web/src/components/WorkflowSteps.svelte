<script lang="ts">
  import { Switch, TextFieldOutlined } from "m3-svelte";
  import type { DeliveryChannelInfo, WorkflowStepInfo } from "../lib/api";

  interface Props {
    steps: WorkflowStepInfo[];
    channels: DeliveryChannelInfo[];
    /** Assigned channel ids keyed by "step/output". */
    assignments: Record<string, string[]>;
    /** Channel switches are interactive only for customizable workflows. */
    editable: boolean;
    ontoggle: (step: string, output: string, channelId: string) => void;
  }

  let { steps, channels, assignments, editable, ontoggle }: Props = $props();

  function assigned(step: string, output: string): string[] {
    return assignments[`${step}/${output}`] ?? [];
  }
</script>

<div class="steps">
  {#each steps as step, index (step.id)}
    <div class="step">
      <div class="cards">
        <article class="card">
          <h4>Inputs</h4>
          {#if step.inputs.length === 0}
            <p class="muted empty">Nothing</p>
          {:else}
            {#each step.inputs as input (input.kind)}
              <div class="port">
                <div class="field">
                  <TextFieldOutlined label="Name" value={input.title} disabled />
                </div>
                <div class="port-row">
                  <div class="field type">
                    <TextFieldOutlined label="Type" value={input.kind} disabled />
                  </div>
                  <label
                    class="flag"
                    title="Required inputs must have a value for the workflow to run"
                  >
                    <Switch checked={input.required} disabled />
                    <span>Required</span>
                  </label>
                </div>
              </div>
            {/each}
          {/if}
        </article>

        <span class="link" aria-hidden="true"></span>

        <article class="card action">
          <h4><span class="step-index">{index + 1}</span> Action</h4>
          <div class="port">
            <div class="field">
              <TextFieldOutlined label="Name" value={step.title} disabled />
            </div>
            <div class="field">
              <TextFieldOutlined label="Type" value={step.type} disabled />
            </div>
          </div>
          {#if step.description}
            <p class="muted description">{step.description}</p>
          {/if}
        </article>

        <span class="link" aria-hidden="true"></span>

        <article class="card">
          <h4>Outputs</h4>
          {#if step.outputs.length === 0}
            <p class="muted empty">Nothing</p>
          {:else}
            {#each step.outputs as output (output.kind)}
              <div class="port">
                <div class="field">
                  <TextFieldOutlined label="Name" value={output.title} disabled />
                </div>
                <div class="port-row">
                  <div class="field type">
                    <TextFieldOutlined label="Type" value={output.kind} disabled />
                  </div>
                  <label
                    class="flag"
                    title="Guaranteed outputs always exist after the step ran"
                  >
                    <Switch checked={output.guaranteed} disabled />
                    <span>Guaranteed</span>
                  </label>
                </div>

                {#if output.deliverable}
                  <div class="delivery">
                    <span class="delivery-label">Send to</span>
                    {#if channels.length === 0}
                      <span class="muted">No delivery channels yet.</span>
                    {:else}
                      <div class="channel-list">
                        {#each channels as channel (channel.id)}
                          <label
                            class="channel"
                            title={channel.enabled
                              ? `Send ${output.title} through “${channel.name}”`
                              : `“${channel.name}” is disabled`}
                          >
                            <Switch
                              checked={assigned(step.id, output.kind).includes(channel.id)}
                              disabled={!editable}
                              onchange={() => ontoggle(step.id, output.kind, channel.id)}
                            />
                            <span>{channel.name}{channel.enabled ? "" : " (disabled)"}</span>
                          </label>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </article>
      </div>

      {#if index < steps.length - 1}
        <div class="flow" aria-hidden="true">
          <span class="flow-turn"></span>
          <span class="flow-drop"></span>
          <span class="flow-arrow"></span>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .steps {
    display: flex;
    flex-direction: column;
  }

  .cards {
    display: flex;
    align-items: stretch;
  }

  .card {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
    padding: var(--space-medium) var(--space-medium);
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
  }

  .card h4 {
    display: flex;
    align-items: center;
    gap: var(--space-small);
    margin: 0;
    font-size: var(--font-medium);
    font-weight: 500;
    color: var(--m3c-on-surface-variant);
  }

  .step-index {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: var(--font-small);
  }

  /* Horizontal connectors: inputs → action → outputs. */
  .link {
    position: relative;
    flex: 0 0 2rem;
  }

  .link::before {
    content: "";
    position: absolute;
    top: calc(50% - 1px);
    left: 0;
    right: 0.45rem;
    border-top: 2px solid var(--m3c-outline);
  }

  .link::after {
    content: "";
    position: absolute;
    top: calc(50% - 5px);
    right: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 7px solid var(--m3c-outline);
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

  /* Port items */
  .port {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
    min-width: 0;
  }

  /* The M3 text field enforces a 15rem minimum; let it shrink to its card. */
  .field {
    min-width: 0;
  }

  .field :global(.m3-container) {
    min-width: 0;
    width: 100%;
  }

  .port-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-small) var(--space-small);
    min-width: 0;
  }

  .port-row .field.type {
    flex: 1 1 6rem;
    min-width: 0;
  }

  .flag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-large);
    flex: none;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    white-space: nowrap;
    user-select: none;
  }

  .description {
    margin: 0;
    font-size: var(--font-medium);
    line-height: 1.4;
  }

  .empty {
    margin: 0;
    font-size: var(--font-medium);
  }

  .delivery {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
  }

  .delivery-label {
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
  }

  .channel-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-large);
  }

  .channel {
    display: inline-flex;
    align-items: center;
    gap: var(--space-large);
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
    cursor: pointer;
    user-select: none;
  }
</style>
