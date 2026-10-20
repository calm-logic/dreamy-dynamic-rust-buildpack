<template>
  <span class="app-number">{{ text }}</span>
</template>

<script>
// A number that counts to its new value instead of jumping:
//   <AnimatedNumber :value="openLoans" />
//   <AnimatedNumber :value="revenue" :format="v => `$${Math.round(v).toLocaleString()}`" />
// No value yet reads as "–". A device set to reduce motion shows the
// value at once.
import { computed, onBeforeUnmount, ref, watch } from "vue";

const ease = (t) => 1 - Math.pow(1 - t, 3);

export default {
  name: "AnimatedNumber",
  props: {
    value: { type: Number, default: null },
    format: { type: Function, default: null },
    duration: { type: Number, default: 900 },
  },
  setup(props) {
    const shown = ref(null);
    let frame = null;
    const reduced = () => typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const run = (to) => {
      if (frame) cancelAnimationFrame(frame);
      if (to == null || reduced()) {
        shown.value = to;
        return;
      }
      const from = shown.value ?? 0;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / props.duration);
        shown.value = t === 1 ? to : from + (to - from) * ease(t);
        frame = t === 1 ? null : requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    watch(() => props.value, run, { immediate: true });
    onBeforeUnmount(() => frame && cancelAnimationFrame(frame));
    const whole = (value) => Number.isInteger(props.value) ? Math.round(value) : value;
    const text = computed(() => {
      if (shown.value == null) return "–";
      const value = whole(shown.value);
      if (props.format) return props.format(value);
      return value.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(props.value) ? 0 : 2 });
    });
    return { text };
  },
};
</script>

<style>
.app-number {
  font-variant-numeric: tabular-nums;
}
</style>
