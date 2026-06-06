import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODO_PATH = path.join(ROOT, "data", "enrichment.todo.json");
const CACHE_PATH = path.join(ROOT, "data", "enrichment-cache.json");
const inputPath = path.resolve(ROOT, process.argv[2] || "data/enrichment.result.json");

const CATEGORY_KEYS = new Set(["cleaning", "food", "drink", "pet", "personal", "health", "baby", "other"]);
const PRIORITIES = new Set(["high", "normal", "low"]);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

function normalizeResult(raw) {
  if (raw?.items && typeof raw.items === "object") return raw.items;
  if (Array.isArray(raw?.deals)) return Object.fromEntries(raw.deals.map((item) => [item.dealStableId, item]));
  return raw;
}

function cleanItem(item) {
  const output = {};
  for (const key of ["titleZh", "summaryZh", "productTypeZh", "shoppingHintZh", "submitHintZh"]) {
    if (typeof item[key] === "string" && item[key].trim()) output[key] = item[key].trim();
  }
  if (CATEGORY_KEYS.has(item.categoryKey)) output.categoryKey = item.categoryKey;
  if (PRIORITIES.has(item.priority)) output.priority = item.priority;
  if (Array.isArray(item.tagsZh)) output.tagsZh = item.tagsZh.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  if (Array.isArray(item.riskFlags)) output.riskFlags = item.riskFlags.map(String).map((flag) => flag.trim()).filter(Boolean).slice(0, 8);
  if (typeof item.confidence === "number") output.confidence = Math.max(0, Math.min(1, item.confidence));
  if (item.normalized && typeof item.normalized === "object") output.normalized = item.normalized;
  return output;
}

const todo = await readJson(TODO_PATH);
const result = normalizeResult(await readJson(inputPath));
const cache = await readJson(CACHE_PATH, { schemaVersion: 1, items: {} });
const todoByStableId = Object.fromEntries(todo.deals.map((deal) => [deal.dealStableId, deal]));

let merged = 0;
const errors = [];

for (const [dealStableId, item] of Object.entries(result)) {
  const expected = todoByStableId[dealStableId];
  if (!expected) {
    errors.push(`${dealStableId}: not present in enrichment.todo.json`);
    continue;
  }
  if (item.sourceFingerprint !== expected.sourceFingerprint) {
    errors.push(`${dealStableId}: sourceFingerprint mismatch`);
    continue;
  }

  const enrichment = cleanItem(item);
  if (!enrichment.titleZh && !enrichment.summaryZh) {
    errors.push(`${dealStableId}: missing titleZh/summaryZh`);
    continue;
  }

  cache.items[dealStableId] = {
    sourceFingerprint: expected.sourceFingerprint,
    generatedAt: item.generatedAt || new Date().toISOString(),
    model: item.model || "manual/subagent",
    status: "enriched",
    enrichment,
  };
  merged += 1;
}

await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}

console.log(`Merged ${merged} enrichment items into ${CACHE_PATH}`);
