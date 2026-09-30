<script lang="ts">
  interface Props {
    /** Diameter of the dot in pixels. */
    size?: number;
  }

  let { size = 10 }: Props = $props();
</script>

<span class="pulse" style:--pulse-size={`${size}px`} aria-hidden="true"></span>

<style>
  .pulse {
    display: inline-block;
    flex: none;
    width: var(--pulse-size);
    height: var(--pulse-size);
    border-radius: var(--m3-shape-full);
    background-color: currentColor;
    animation-name: pulse;
    animation-duration: 2.4s;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.4;
    }

    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
      opacity: 0.8;
    }
  }
</style>
