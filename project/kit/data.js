// Reading the app's own API for a page of the app's own, signed in as the person
// viewing it, so every number and chart follows their roles.
//
//   const open = await count("loans", { "status": "open" });
//   const overdue = await whenAllowed(count("loans", { "due_date.lt": today }));
//   const recent = await list("loans", { sort: "-created", per_page: 8 });
//   const loans = await listAll("loans", { filter: { "created.gte": since } });
//   const { labels, series } = overTime(loans, "created", { unit: "day", last: 30 });
//   const byStatus = countBy(loans, "status");
//
// Filters are Dynamic REST's: { field: value }, or with an operator after the field
// ("amount.gte", "status.in": [...], "due_date.lt", "notes.icontains",
// "approver.isnull": true, "-status": "closed" to exclude).
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { api } from "dynamic-rust-admin";

const listOf = (values) => (values == null ? undefined : Array.isArray(values) ? values : [values]);

function params({ filter, sort, include, exclude, ...rest } = {}) {
  return { ...rest, filter, "sort": listOf(sort), "include": listOf(include), "exclude": listOf(exclude) };
}

function records(data, resource) {
  if (Array.isArray(data?.[resource])) return data[resource];
  return Object.values(data || {}).find(Array.isArray) || [];
}

/** How many records match, counted by the API from a one-record page. */
export async function count(resource, filter = {}) {
  const response = await api.get(resource, { params: params({ filter, per_page: 1 }) });
  return response.data?.meta?.total_results ?? records(response.data, resource).length;
}

/** One page of records: { filter, sort, include, per_page (default 100), page }. */
export async function list(resource, query = {}) {
  const response = await api.get(resource, { params: params({ per_page: 100, ...query }) });
  return records(response.data, resource);
}

/** Every matching record, a thousand per request, up to `limit` (default 5000). */
export async function listAll(resource, query = {}, { limit = 5000 } = {}) {
  const all = [];
  for (let page = 1; all.length < limit; page += 1) {
    const response = await api.get(resource, { params: params({ ...query, per_page: 1000, page }) });
    const batch = records(response.data, resource);
    all.push(...batch);
    const pages = response.data?.meta?.total_pages;
    if (!batch.length || (pages ? page >= pages : batch.length < 1000)) break;
  }
  return all.slice(0, limit);
}

/** What went wrong, in words a person can act on. */
export function errorMessage(failure) {
  const status = failure?.response?.status;
  if (status === 403) return "You don't have access to this.";
  if (typeof failure?.error === "string") return failure.error;
  return failure?.message || "Something went wrong. Try again.";
}

/** A part of the page the person's roles may not reach: null instead of a failure. */
export async function whenAllowed(promise) {
  try {
    return await promise;
  } catch (failure) {
    if ([403, 404].includes(failure?.response?.status)) return null;
    throw failure;
  }
}

/**
 * Load something when the page opens, and again every `every` milliseconds while
 * the tab is visible (a live hub): { data, loading, error, reload }. `loading` is
 * only the first load, so later ones animate charts from the last values.
 */
export function useLoad(load, { every = 0 } = {}) {
  const data = shallowRef(null);
  const loading = ref(true);
  const error = ref("");
  let timer = null;
  const reload = async () => {
    try {
      data.value = await load();
      error.value = "";
    } catch (failure) {
      error.value = errorMessage(failure);
    } finally {
      loading.value = false;
    }
  };
  onMounted(() => {
    reload();
    if (every) timer = setInterval(() => document.visibilityState !== "hidden" && reload(), every);
  });
  onBeforeUnmount(() => clearInterval(timer));
  return { data, loading, error, reload };
}

const valueOf = (record, field) => (typeof field === "function" ? field(record) : field.split(".").reduce((value, key) => value?.[key], record));
const pad = (number) => String(number).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// A date-only value is that day where the person is, not midnight UTC.
function toDate(value) {
  if (value instanceof Date) return value;
  const day = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
}

function bucket(date, unit) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (unit === "month") start.setDate(1);
  return start;
}

function previous(date, unit) {
  const result = new Date(date);
  if (unit === "month") result.setMonth(result.getMonth() - 1);
  else result.setDate(result.getDate() - (unit === "week" ? 7 : 1));
  return result;
}

/**
 * Records per day, week (from Monday) or month over the `last` ones up to `now`,
 * by a date field: { labels: ["2026-10-01", ...], series: [3, 0, 5, ...] }.
 * `value` sums a field (or a function of the record) instead of counting.
 */
export function overTime(items, field, { unit = "day", last = 30, value = null, now = new Date() } = {}) {
  const labels = [];
  for (let cursor = bucket(now, unit), i = 0; i < last; i += 1, cursor = previous(cursor, unit)) labels.unshift(dateKey(cursor));
  const index = new Map(labels.map((label, i) => [label, i]));
  const series = labels.map(() => 0);
  for (const item of items || []) {
    const raw = valueOf(item, field);
    if (raw == null || raw === "") continue;
    const date = toDate(raw);
    if (Number.isNaN(date.getTime())) continue;
    const i = index.get(dateKey(bucket(date, unit)));
    if (i !== undefined) series[i] += value ? Number(valueOf(item, value)) || 0 : 1;
  }
  return { labels, series };
}

/**
 * Records per value of a field, largest first: { labels, series }. `top` keeps
 * that many and adds the rest up as `other`; `value` sums instead of counting.
 */
export function countBy(items, field, { top = 0, other = "Other", value = null, empty = "None" } = {}) {
  const totals = new Map();
  for (const item of items || []) {
    const key = valueOf(item, field);
    const label = key == null || key === "" ? empty : String(key);
    totals.set(label, (totals.get(label) || 0) + (value ? Number(valueOf(item, value)) || 0 : 1));
  }
  let entries = [...totals].sort((a, b) => b[1] - a[1]);
  if (top && entries.length > top) {
    const rest = entries.slice(top).reduce((total, [, amount]) => total + amount, 0);
    entries = [...entries.slice(0, top), [other, rest]];
  }
  return { labels: entries.map(([label]) => label), series: entries.map(([, amount]) => amount) };
}

/** The total of a field (or a function of the record) over records. */
export function sum(items, field) {
  return (items || []).reduce((total, item) => total + (Number(valueOf(item, field)) || 0), 0);
}

/**
 * Where a resource's list opens, filtered as the admin's own filters are, e.g.
 * listRoute("loans", { "status.$eq": "overdue" }) for a tile's "View all".
 * Operators: $eq, $neq, $in, $lt, $lte, $gt, $gte, $isnull, $notnull, $icontains.
 */
export function listRoute(resource, filter = null) {
  const conditions = Object.entries(filter || {}).map(([key, value]) => ({ [key]: value }));
  return { name: "resource", params: { resource }, query: conditions.length ? { filter: JSON.stringify(conditions) } : {} };
}

/** Where one record's page opens. */
export function recordRoute(resource, id) {
  return { name: "record", params: { resource, id } };
}
