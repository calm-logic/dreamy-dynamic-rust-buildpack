<template>
  <div class="app-chart" :class="{ 'app-chart--sparkline': sparkline }">
    <transition name="app-fade" mode="out-in">
      <q-skeleton
        v-if="loading"
        key="loading"
        class="app-chart__skeleton"
        animation="wave"
        :height="cssHeight"
      />
      <div
        v-else-if="empty"
        key="empty"
        class="app-chart__empty column flex-center text-caption"
        :style="{ height: cssHeight }"
      >
        <q-icon v-if="!sparkline" name="mdi-chart-box-outline" size="28px" class="q-mb-xs" />
        <span v-if="!sparkline">{{ emptyText }}</span>
      </div>
      <apexchart
        v-else
        :key="type"
        :type="type"
        :height="height"
        width="100%"
        :options="chartOptions"
        :series="chartSeries"
        @dataPointSelection="select"
      />
    </transition>
  </div>
</template>

<script>
// One chart of the app's own data, drawn by ApexCharts (bundled with the admin) in
// the workspace's colors, light or dark as the person chose, with motion.
//
//   <AppChart type="area" :labels="days" :series="[{ name: 'Loans', data: perDay }]" />
//   <AppChart type="donut" :labels="['Open', 'Overdue']" :series="[12, 3]" />
//   <AppChart type="bar" horizontal :labels="names" :series="totals" :format="money" />
//   <AppChart type="area" sparkline :height="60" :series="lastWeek" />
//
// - type: any ApexCharts type: area, line, bar, donut, pie, radialBar, heatmap,
//   treemap, radar, scatter, rangeBar, ... (default area).
// - series: ApexCharts series ([{ name, data }] for axis charts, numbers for donut,
//   pie and radialBar); a plain list of numbers on an axis chart is one series
//   called `name`.
// - labels: the x-axis categories, or the slices' names. ISO dates
//   ("2026-10-19") make a time axis.
// - format: how a value reads (axis, tooltip, totals), e.g. v => `$${v}`.
// - colors: Quasar color names (primary, accent, positive, teal-5, ...) or CSS
//   colors; by default the workspace's colors, then Quasar's palette.
// - loading shows a placeholder; no data shows `emptyText`.
// - stacked, horizontal, sparkline (a bare trend line for a tile), height.
// - options: any ApexCharts options, merged over these (arrays replace); the
//   chart's own events are not taken from them.
// - @select: { seriesIndex, dataPointIndex, label, value } when a bar, slice or
//   point is clicked, e.g. to open the records behind it.
import { computed } from "vue";
import { colors as palette, getCssVar, useQuasar } from "quasar";
import ApexCharts from "vue3-apexcharts";

const AXIS_LESS = ["donut", "pie", "polarArea", "radialBar"];
// The workspace's primary and second colors (branding sets both), then colors that
// read on light and dark alike; the admin's own accent and positive are near-greys.
const DEFAULT_COLORS = ["primary", "secondary", "info", "warning", "purple-5", "orange-6", "pink-5", "teal-5", "blue-grey-5", "negative"];
const BRAND = ["primary", "secondary", "accent", "dark", "positive", "negative", "info", "warning"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// Options laid over the defaults: objects merge, anything else replaces.
export function mergeOptions(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    result[key] = isObject(value) && isObject(base[key]) ? mergeOptions(base[key], value) : value;
  }
  return result;
}

function resolveColor(name) {
  if (typeof name !== "string" || name.startsWith("#") || name.includes("(")) return name;
  if (BRAND.includes(name)) return getCssVar(name) || name;
  try {
    return palette.getPaletteColor(name);
  } catch (error) {
    return name;
  }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default {
  name: "AppChart",
  components: { apexchart: ApexCharts },
  props: {
    type: { type: String, default: "area" },
    series: { type: Array, default: () => [] },
    labels: { type: Array, default: null },
    name: { type: String, default: "Value" },
    height: { type: [Number, String], default: 280 },
    format: { type: Function, default: null },
    colors: { type: Array, default: null },
    loading: { type: Boolean, default: false },
    stacked: { type: Boolean, default: false },
    horizontal: { type: Boolean, default: false },
    sparkline: { type: Boolean, default: false },
    emptyText: { type: String, default: "No data yet" },
    options: { type: Object, default: () => ({}) },
  },
  emits: ["select"],
  setup(props, { emit }) {
    const $q = useQuasar();
    const axisLess = computed(() => AXIS_LESS.includes(props.type));
    const chartSeries = computed(() => {
      const series = props.series || [];
      if (!axisLess.value && series.length && series.every((value) => typeof value === "number" || value === null)) {
        return [{ name: props.name, data: series }];
      }
      return series;
    });
    // Nothing to draw: no series, or only zeros and gaps.
    const empty = computed(() => {
      const values = chartSeries.value.flatMap((item) => (isObject(item) ? item.data || [] : [item]));
      return !values.some((value) => {
        const amount = isObject(value) ? value.y : Array.isArray(value) ? value[1] : value;
        return Array.isArray(amount) ? amount.length > 0 : amount != null && amount !== 0;
      });
    });
    const cssHeight = computed(() => (typeof props.height === "number" ? `${props.height}px` : props.height));
    const chartOptions = computed(() => {
      const dark = $q.dark.isActive;
      const format = props.format || ((value) => (typeof value === "number" ? value.toLocaleString() : value));
      const labels = props.labels || undefined;
      const datetime = !axisLess.value && labels?.length && labels.every((label) => ISO_DATE.test(String(label)));
      const surface = dark ? getCssVar("dark") || "#1d1d1d" : "#ffffff";
      const grid = dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.07)";
      const animate = !prefersReducedMotion();
      const line = ["line", "area", "radar"].includes(props.type);
      const base = {
        chart: {
          type: props.type,
          stacked: props.stacked,
          background: "transparent",
          foreColor: dark ? "rgba(255, 255, 255, 0.72)" : "rgba(0, 0, 0, 0.62)",
          fontFamily: "inherit",
          parentHeightOffset: 0,
          toolbar: { show: false },
          zoom: { enabled: false },
          sparkline: { enabled: props.sparkline },
          animations: {
            enabled: animate,
            easing: "easeinout",
            speed: 700,
            animateGradually: { enabled: true, delay: 80 },
            dynamicAnimation: { enabled: true, speed: 450 },
          },
        },
        theme: { mode: dark ? "dark" : "light" },
        colors: (props.colors || DEFAULT_COLORS).map(resolveColor),
        dataLabels: { enabled: false },
        stroke: {
          // Through every point without overshooting it: counts never dip below zero.
          curve: "monotoneCubic",
          lineCap: "round",
          width: line ? (props.sparkline ? 2 : 3) : axisLess.value ? 2 : 0,
          colors: axisLess.value ? [surface] : undefined,
        },
        fill:
          props.type === "area"
            ? { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.04, stops: [0, 92, 100] } }
            : { opacity: 1 },
        markers: { size: 0, strokeWidth: 0, hover: { size: 5 } },
        grid: { borderColor: grid, strokeDashArray: 4, padding: { left: 8, right: 8 } },
        legend: {
          show: axisLess.value || chartSeries.value.length > 1,
          position: "bottom",
          fontSize: "13px",
          markers: { radius: 12 },
          itemMargin: { horizontal: 8, vertical: 4 },
        },
        tooltip: { theme: dark ? "dark" : "light", y: { formatter: format }, x: datetime ? { format: "d MMM yyyy" } : {} },
        states: { hover: { filter: { type: "lighten", value: 0.06 } }, active: { filter: { type: "darken", value: 0.12 } } },
        plotOptions: {
          bar: {
            horizontal: props.horizontal,
            borderRadius: 6,
            borderRadiusApplication: "end",
            columnWidth: "56%",
            barHeight: "62%",
          },
          pie: {
            expandOnClick: true,
            donut: {
              size: "68%",
              labels: {
                show: !props.sparkline,
                value: { formatter: (value) => format(Number(value)) },
                total: {
                  show: true,
                  label: "Total",
                  formatter: (context) => format(context.globals.seriesTotals.reduce((sum, value) => sum + value, 0)),
                },
              },
            },
          },
          radialBar: {
            hollow: { size: "58%" },
            track: { background: grid },
            dataLabels: { value: { formatter: (value) => format(Number(value)) } },
          },
        },
        noData: { text: "" },
      };
      if (labels && axisLess.value) base.labels = labels;
      if (!axisLess.value) {
        base.xaxis = {
          type: datetime ? "datetime" : "category",
          categories: labels,
          axisBorder: { show: false },
          axisTicks: { show: false },
          labels: { hideOverlappingLabels: true, ...(props.horizontal ? { formatter: format } : {}) },
        };
        base.yaxis = { labels: { formatter: props.horizontal ? undefined : format } };
      }
      if (props.sparkline) {
        // Kept bare when the theme changes, which redraws the chart with these options.
        base.xaxis = { ...base.xaxis, labels: { show: false }, tooltip: { enabled: false } };
        base.yaxis = { show: false };
        base.grid = { show: false, padding: { top: 2, bottom: 2, left: 0, right: 0 } };
        base.tooltip = { ...base.tooltip, x: { show: false }, marker: { show: false } };
      }
      return mergeOptions(base, props.options);
    });
    // vue3-apexcharts sends the chart's events as its own, over any in `options`.
    const select = (event, context, { seriesIndex, dataPointIndex }) => {
      const item = chartSeries.value[seriesIndex];
      const value = isObject(item) ? item.data?.[dataPointIndex] : chartSeries.value[dataPointIndex];
      emit("select", { seriesIndex, dataPointIndex, label: props.labels?.[dataPointIndex], value });
    };
    return { chartOptions, chartSeries, empty, cssHeight, select };
  },
};
</script>

<style>
.app-chart {
  position: relative;
  min-width: 0;
}
.app-chart__skeleton {
  border-radius: 8px;
}
.app-chart__empty {
  opacity: 0.6;
}
.app-chart .apexcharts-tooltip {
  border-radius: 8px;
}
</style>
