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
    <article class="step">
      <span class="step-index">{index + 1}</span>

      <section class="section">
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
      </section>

      <section class="section">
        <h4>Action</h4>
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
      </section>

      <section class="section">
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
      </section>
    </article>
  {/each}
</div>

<style>
  .steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
  }

  .step-index {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: 0.78rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .section h4 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .port {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }

  /* The M3 text field enforces a 15rem minimum; let it shrink to its column. */
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
    gap: 0.4rem 0.5rem;
    min-width: 0;
  }

  .port-row .field.type {
    flex: 1 1 6rem;
    min-width: 0;
  }

  .flag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex: none;
    color: var(--m3c-on-surface-variant);
    font-size: 0.78rem;
    white-space: nowrap;
    user-select: none;
  }

  .description {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .empty {
    margin: 0;
    font-size: 0.82rem;
  }

  .delivery {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .delivery-label {
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
  }

  .channel-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.9rem;
  }

  .channel {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.8rem;
    cursor: pointer;
    user-select: none;
  }
</style>
