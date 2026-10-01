<script lang="ts">
  import { TextFieldOutlined } from "m3-svelte";
  import iconVisibility from "@ktibow/iconset-material-symbols/visibility";
  import iconVisibilityOff from "@ktibow/iconset-material-symbols/visibility-off";

  interface Props {
    label: string;
    value: string;
    placeholder?: string;
    disabled?: boolean;
    autocomplete?: string;
    spellcheck?: boolean;
    enter?: () => void;
  }

  let {
    label,
    value = $bindable(),
    placeholder,
    disabled = false,
    autocomplete = "off",
    spellcheck = false,
    enter,
  }: Props = $props();

  let visible = $state(false);
</script>

<TextFieldOutlined
  {label}
  type={visible ? "text" : "password"}
  {placeholder}
  {disabled}
  {autocomplete}
  {spellcheck}
  bind:value
  {enter}
  trailing={{
    icon: visible ? iconVisibilityOff : iconVisibility,
    title: visible ? "Hide value" : "Show value",
    onclick: () => (visible = !visible),
  }}
/>
