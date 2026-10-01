<script lang="ts">
  import { Button, Icon } from "m3-svelte";
  import iconLock from "@ktibow/iconset-material-symbols/lock";
  import { authState } from "../lib/auth.svelte";
  import SecretField from "./SecretField.svelte";

  let password = $state("");
  let submitting = $state(false);

  // Mechanisms come from the backend; OIDC will add its own redirect flow.
  const methods = $derived(authState.status?.methods ?? []);
  const method = $derived(methods[0]?.id ?? "password");

  async function submit(): Promise<void> {
    if (submitting || password.length === 0) return;
    submitting = true;
    try {
      await authState.login(method, password);
      password = "";
    } finally {
      submitting = false;
    }
  }
</script>

<div class="gate">
  <div class="panel">
    <span class="badge"><Icon icon={iconLock} size={22} /></span>
    <h1>Neuretina</h1>
    <p class="muted">This site is protected. Enter the password to continue.</p>

    <SecretField
      label="Password"
      autocomplete="current-password"
      bind:value={password}
      enter={() => void submit()}
    />

    {#if authState.error}
      <p class="error" role="alert">{authState.error}</p>
    {/if}

    <Button
      variant="filled"
      disabled={submitting || password.length === 0}
      onclick={() => void submit()}
    >
      {submitting ? "Checking…" : "Unlock"}
    </Button>
  </div>
</div>

<style>
  .gate {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: var(--space-large);
    background-color: var(--m3c-surface);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-medium);
    width: min(22rem, 100%);
    padding: var(--space-large);
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-large);
    background-color: var(--m3c-surface-container-low);
    box-shadow: var(--m3-elevation-1);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-primary-container);
    color: var(--m3c-on-primary-container);
  }

  h1 {
    margin: 0;
    font-size: var(--font-large);
    font-weight: 600;
  }

  .panel p {
    margin: 0;
  }

  .error {
    color: var(--m3c-error);
    font-size: var(--font-medium);
  }
</style>
