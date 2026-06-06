import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = "1wcqckNai9SyRbQLt-pj6FHzGM7sypoET9glyAE05u2E";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const ENRICHMENT_PATH = path.join(DATA_DIR, "enrichment.json");
const ENRICHMENT_CACHE_PATH = path.join(DATA_DIR, "enrichment-cache.json");
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const HTML_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

const STORE_RULES = [
  ["dm", /\bdm\b|dm-drogerie/i],
  ["Rossmann", /rossmann/i],
  ["REWE", /\brewe\b/i],
  ["Netto", /\bnetto\b/i],
  ["Muller", /müller|mueller/i],
  ["Kaufland", /kaufland/i],
  ["Budni", /budni/i],
  ["Edeka", /edeka/i],
  ["Penny", /penny/i],
  ["Lidl", /lidl/i],
  ["Aldi", /aldi/i],
];

const CATEGORY_RULES = [
  ["cleaning", "Haushalt / Reinigung", "居家清洁", /reiniger|kraftreiniger|cillit|wc-ente|wc ente|wc-|spül|spuel|somat|calgon|waschmittel|wäsche|waesche|putz|geschirr|wasserenthärter/i],
  ["food", "Lebensmittel", "食品", /salat|joghurt|kefir|chocolate|chocolonely|wasa|knäcke|erdnuss|sauce|margarine|ice cream|eis|fertiggerichte|kartoffel|cheez|kühne|bulgur|couscous|nuss|be nuts/i],
  ["drink", "Getränke", "饮料", /bier|wasser|limonade|dose|flasche|eiskaffee|rockstar|nescafé|nescafe|desperados|heineken|bud\b|teanacher|bad liebenwerda/i],
  ["pet", "Tierbedarf", "宠物用品", /katze|katz|hund|tier|whiskas|felix|purina|royal canin|platinum/i],
  ["personal", "Drogerie / Pflege", "个护日化", /deo|dusch|body wash|nivea|tena|always|odaban|pflege|rasier|gillette|toilettenpapier|inkontinenz|o'keefe/i],
  ["health", "Gesundheit", "健康保健", /centrum|biotic|immun|vital|melatonin|tetesept/i],
  ["baby", "Baby", "母婴", /baby|windeln|rascals/i],
];

const TITLE_PHRASES = [
  [/Waschmittel/gi, "洗衣液/洗衣粉"],
  [/Wäscheparfüm/gi, "洗衣香氛"],
  [/Wasserenthärter/gi, "软水/防垢剂"],
  [/Kraftreiniger/gi, "强力清洁剂"],
  [/Bad & Dusche/gi, "浴室和淋浴"],
  [/Kalk & Schmutz/gi, "水垢和污渍"],
  [/Frische-Siegel Halter/gi, "马桶清洁芳香贴"],
  [/Power Gel/gi, "洗碗机凝胶"],
  [/Bier/gi, "啤酒"],
  [/Mineralwasser/gi, "矿泉水"],
  [/Lemonade/gi, "汽水"],
  [/Eiskaffee/gi, "冰咖啡"],
  [/Joghurtalternative/gi, "植物酸奶替代品"],
  [/Katzennahrungsprodukte/gi, "猫粮"],
  [/Hundefutter/gi, "狗粮"],
  [/Tiernahrung/gi, "宠物食品"],
  [/Duschgele?/gi, "沐浴露"],
  [/Deo/gi, "止汗/除味"],
  [/Toilettenpapier/gi, "湿厕纸"],
  [/Rückgabe bei Nichtgefallen/gi, "不满意退款"],
  [/max\./gi, "最高"],
  [/Erstattung/gi, "返现"],
  [/\boder\b/gi, "或"],
  [/\bund\b/gi, "和"],
  [/\bnur bei\b/gi, "仅限"],
  [/\bab\b/gi, "从"],
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function cleanText(value = "") {
  return String(value).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function oneLine(value = "") {
  return cleanText(value).replace(/\s*\n+\s*/g, " | ").replace(/\s{2,}/g, " ");
}

function getCell(row, headers, name) {
  return cleanText(row[headers.indexOf(name)] ?? "");
}

function parseDates(raw) {
  if (!raw) return [];
  const dates = [];
  for (const match of raw.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)) {
    let [, d, m, y] = match;
    if (y.length === 2) y = `20${y}`;
    dates.push(`${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }
  if (/daueraktion/i.test(raw)) dates.push("9999-12-31");
  return dates.sort();
}

function pickLastDate(raw) {
  const dates = parseDates(raw);
  return dates.at(-1) ?? "";
}

function classify(text) {
  const rule = CATEGORY_RULES.find(([, , , regex]) => regex.test(text));
  if (!rule) return { key: "other", de: "Sonstiges", zh: "其他" };
  return { key: rule[0], de: rule[1], zh: rule[2] };
}

function detectStores(text) {
  const stores = STORE_RULES.filter(([, regex]) => regex.test(text)).map(([name]) => name);
  return [...new Set(stores)];
}

function detectStoreMode(text, stores) {
  if (!stores.length) return "not_limited";
  if (/bei allen anderen händlern|bei allen anderen haendlern/i.test(text)) return "not_limited";
  if (/\bnur bei\b|exklusiv bei|lokale verfügbarkeit|lokal/i.test(text)) return "restricted";
  return "mentioned";
}

function translateTitle(title, category) {
  let translated = oneLine(title);
  for (const [regex, replacement] of TITLE_PHRASES) {
    translated = translated.replace(regex, replacement);
  }

  const changed = translated !== oneLine(title);
  const brand = oneLine(title).split(/[|\n(（-]/)[0].trim();
  if (changed && brand && !translated.startsWith(brand)) return `${brand}：${translated}`;
  if (changed) return translated;
  return `${category.zh}：${brand || oneLine(title)}`;
}

async function loadJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizeEnrichment(raw) {
  if (raw && raw.schemaVersion === 1 && raw.items && typeof raw.items === "object") {
    return raw.items;
  }
  if (raw && Array.isArray(raw.deals)) {
    return Object.fromEntries(raw.deals.filter((deal) => deal.id).map((deal) => [deal.id, deal]));
  }
  return raw && typeof raw === "object" ? raw : {};
}

function applyEnrichment(payload, enrichment) {
  const allowedCategories = new Set(CATEGORY_RULES.map(([key]) => key).concat("other"));
  let enrichedCount = 0;

  payload.deals = payload.deals.map((deal) => {
    const cached = enrichment[deal.dealStableId];
    const item = cached?.sourceFingerprint === deal.sourceFingerprint ? cached.enrichment : enrichment[deal.id];
    if (!item) return { ...deal, enrichmentStatus: cached ? "stale" : "missing" };

    const next = { ...deal };
    const clean = {};
    if (typeof item.titleZh === "string" && item.titleZh.trim()) clean.titleZh = item.titleZh.trim();
    if (typeof item.summaryZh === "string") clean.summaryZh = item.summaryZh.trim();
    if (typeof item.productTypeZh === "string") clean.productTypeZh = item.productTypeZh.trim();
    if (typeof item.shoppingHintZh === "string") clean.shoppingHintZh = item.shoppingHintZh.trim();
    if (typeof item.submitHintZh === "string") clean.submitHintZh = item.submitHintZh.trim();
    if (typeof item.priority === "string") clean.priority = item.priority.trim();
    if (Array.isArray(item.tagsZh)) clean.tagsZh = item.tagsZh.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8);
    if (Array.isArray(item.riskFlags)) clean.riskFlags = item.riskFlags.map((flag) => String(flag).trim()).filter(Boolean).slice(0, 8);
    if (typeof item.confidence === "number") clean.confidence = Math.max(0, Math.min(1, item.confidence));
    if (item.normalized && typeof item.normalized === "object") clean.normalized = item.normalized;

    if (clean.titleZh) next.titleZh = clean.titleZh;
    if (clean.summaryZh) next.summaryZh = clean.summaryZh;
    if (clean.productTypeZh) next.productTypeZh = clean.productTypeZh;
    if (clean.shoppingHintZh) next.shoppingHintZh = clean.shoppingHintZh;
    if (clean.submitHintZh) next.submitHintZh = clean.submitHintZh;
    if (clean.priority) next.priority = clean.priority;
    if (clean.tagsZh) next.tagsZh = clean.tagsZh;
    if (item.categoryKey && allowedCategories.has(item.categoryKey)) {
      const rule = CATEGORY_RULES.find(([key]) => key === item.categoryKey);
      next.category = rule
        ? { key: rule[0], de: rule[1], zh: rule[2] }
        : { key: "other", de: "Sonstiges", zh: "其他" };
      clean.categoryKey = item.categoryKey;
    }
    next.enrichment = clean;
    next.enrichmentStatus = cached ? "enriched" : "legacy";
    enrichedCount += 1;
    return next;
  });

  payload.source.enrichedCount = enrichedCount;
  return payload;
}

function buildEnrichmentTodo(payload, enrichment) {
  const missing = payload.deals.filter((deal) => {
    const cached = enrichment[deal.dealStableId];
    return !cached || cached.sourceFingerprint !== deal.sourceFingerprint;
  });
  return {
    generatedAt: new Date().toISOString(),
    instructions: [
      "为每个 deal 生成中文 enrichment，输出 JSON 对象，key 必须是 deal.dealStableId。",
      "不要改日期、链接、图片；只补中文理解字段和必要的 categoryKey。",
      "titleZh 要自然中文，不要逐词硬翻；summaryZh 一句话说明买什么/返什么。",
      "shoppingHintZh 面向在德国超市逛店的人，提示限店、每天几点、上传小票/SMS 等关键动作。",
      "categoryKey 只能是 cleaning, food, drink, pet, personal, health, baby, other。",
      "priority 可填 high / normal / low，按临期、名额少、常去店可买等判断。",
    ],
    schema: {
      "deal.dealStableId": {
        sourceFingerprint: "复制输入里的 sourceFingerprint",
        generatedAt: "ISO 时间",
        status: "enriched",
        confidence: 0.8,
        titleZh: "自然中文商品名",
        summaryZh: "一句中文摘要",
        productTypeZh: "商品类型，如洗衣液/巧克力/啤酒",
        shoppingHintZh: "购买和提交提示",
        submitHintZh: "提交报销提示",
        categoryKey: "cleaning|food|drink|pet|personal|health|baby|other",
        tagsZh: ["最多 8 个短标签"],
        riskFlags: ["store_restricted|quota_limited|daily_window|receipt_photo|sms_confirmation"],
        priority: "high|normal|low",
      },
    },
    deals: missing.map((deal) => ({
      id: deal.id,
      dealStableId: deal.dealStableId,
      sourceFingerprint: deal.sourceFingerprint,
      staleCached: Boolean(enrichment[deal.dealStableId]),
      titleDe: deal.titleDe,
      fallbackTitleZh: deal.titleZh,
      categoryKey: deal.category.key,
      categoryZh: deal.category.zh,
      stores: deal.stores,
      storeMode: deal.storeMode,
      quota: deal.quota,
      purchaseTime: deal.purchaseTime,
      purchaseDeadline: deal.purchaseDeadlineRaw,
      submitDeadline: deal.submitDeadlineRaw,
      submitWindow: deal.submitWindow,
      receiptType: deal.receiptType,
      smsConfirmation: deal.smsConfirmation,
      officialUrl: deal.officialUrl,
      mydealzUrl: deal.mydealzUrl,
    })),
  };
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
}

function mydealzId(url) {
  return url.match(/(\d{6,})/)?.[1] ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrlForKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return oneLine(url).toLowerCase();
  }
}

function stableDealId({ mydealzUrl, officialUrl, rowNumber }) {
  const dealId = mydealzId(mydealzUrl);
  if (dealId) return `mydealz:${dealId}`;
  if (officialUrl) return `official:${sha256(normalizeUrlForKey(officialUrl)).slice(0, 16)}`;
  return `sheet:${SHEET_ID}:row:${rowNumber}`;
}

function fingerprintDeal(fields) {
  return sha256(JSON.stringify(fields));
}

function disambiguateStableIds(deals) {
  const counts = new Map();
  for (const deal of deals) counts.set(deal.dealStableId, (counts.get(deal.dealStableId) || 0) + 1);
  for (const deal of deals) {
    if (counts.get(deal.dealStableId) > 1) {
      const suffix = sha256(`${deal.titleDe}|${deal.officialUrl}`).slice(0, 8);
      deal.dealStableId = `${deal.dealStableId}:${suffix}`;
    }
  }
  return deals;
}

function extractImageUrls(html) {
  const candidates = [...html.matchAll(/https?:\/\/[^\\"]+?\.(?:png|jpe?g|webp)[^\\"]*/gi)]
    .map((match) =>
      match[0]
        .replaceAll("\\u003d", "=")
        .replaceAll("\\u0026", "&")
        .replaceAll("\\/", "/")
        .split("]]")[0]
        .split("\\")[0]
        .trim(),
    )
    .filter((url) => !/googleusercontent\.com\/docs\/AHkb/i.test(url));

  const urls = [];
  for (const url of candidates) {
    if (urls.at(-1) !== url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 mydealz-gzg-updater",
      accept: "text/html,text/csv,*/*",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

function buildDeals(csvText, htmlText) {
  const rows = parseCsv(csvText);
  const headers = rows[2];
  if (!headers?.includes("Aktionsbeschreibung")) {
    throw new Error("Could not find expected Google Sheet header row.");
  }

  const imageUrls = extractImageUrls(htmlText);
  let imageIndex = 0;
  const deals = [];

  for (const [offset, row] of rows.slice(3).entries()) {
    const rowNumber = offset + 4;
    const titleDe = getCell(row, headers, "Aktionsbeschreibung");
    if (!titleDe || /^►|^Alle Angaben|^Fehler oder weitere Aktion/i.test(titleDe)) continue;

    const officialUrl = getCell(row, headers, "Aktionsseite / Aktionshinweis");
    const mydealzUrl = getCell(row, headers, "mydealz Link");
    const fullText = `${titleDe}\n${officialUrl}\n${mydealzUrl}`;
    const category = classify(fullText);
    const stores = detectStores(fullText);
    const storeMode = detectStoreMode(fullText, stores);
    const idPart = mydealzId(mydealzUrl) || slugify(officialUrl) || String(rowNumber);
    const slug = slugify(titleDe.split("\n")[0]);
    const stableId = stableDealId({ mydealzUrl, officialUrl, rowNumber });
    const fingerprint = fingerprintDeal({
      titleDe: oneLine(titleDe),
      officialUrl,
      mydealzUrl,
      quota: oneLine(getCell(row, headers, "Kontingent")),
      purchaseTime: oneLine(getCell(row, headers, "Zeitpunkt")),
      purchaseDeadline: oneLine(getCell(row, headers, "Aktions- ende")),
      submitDeadline: oneLine(getCell(row, headers, "Einsende- schluss")),
      submitWindow: oneLine(getCell(row, headers, "Einreichungs- frist (nach Kauf)")),
      receiptType: oneLine(getCell(row, headers, "Art des Kaufbeleges")),
      smsConfirmation: oneLine(getCell(row, headers, "SMS Bestätigung")),
    });

    deals.push({
      id: `mydealz-${idPart}-${slug}`,
      dealStableId: stableId,
      sourceFingerprint: fingerprint,
      rowNumber,
      titleDe: oneLine(titleDe),
      titleZh: translateTitle(titleDe, category),
      category,
      stores,
      storeMode,
      imageUrl: imageUrls[imageIndex] ?? "",
      quota: oneLine(getCell(row, headers, "Kontingent")),
      purchaseTime: oneLine(getCell(row, headers, "Zeitpunkt")),
      purchaseDeadlineRaw: oneLine(getCell(row, headers, "Aktions- ende")),
      purchaseDeadlineIso: pickLastDate(getCell(row, headers, "Aktions- ende")),
      submitDeadlineRaw: oneLine(getCell(row, headers, "Einsende- schluss")),
      submitDeadlineIso: pickLastDate(getCell(row, headers, "Einsende- schluss")),
      submitWindow: oneLine(getCell(row, headers, "Einreichungs- frist (nach Kauf)")),
      participation: oneLine(getCell(row, headers, "Art der Teilnahme")),
      receiptType: oneLine(getCell(row, headers, "Art des Kaufbeleges")),
      smsConfirmation: oneLine(getCell(row, headers, "SMS Bestätigung")),
      officialUrl,
      mydealzUrl,
      agency: oneLine(getCell(row, headers, "abwickelnde Agentur & Zahlungsdienstleister")),
      added: oneLine(getCell(row, headers, "Hinzu- gefügt")),
      addedIso: pickLastDate(getCell(row, headers, "Hinzu- gefügt")),
    });

    imageIndex += 1;
  }

  deals.sort((a, b) => {
    const aDate = a.purchaseDeadlineIso || "9999-12-30";
    const bDate = b.purchaseDeadlineIso || "9999-12-30";
    return aDate.localeCompare(bDate) || a.rowNumber - b.rowNumber;
  });

  disambiguateStableIds(deals);

  return {
    source: {
      sheetId: SHEET_ID,
      sheetUrl: HTML_URL,
      csvUrl: CSV_URL,
      generatedAt: new Date().toISOString(),
    },
    deals,
  };
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtml(payload) {
  const dataJson = JSON.stringify(payload).replaceAll("</", "<\\/");
  const generated = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(payload.source.generatedAt));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>mydealz GZG 手机清单</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --ink: #1d2522;
      --muted: #65716d;
      --line: #dfe5df;
      --accent: #14785f;
      --accent-soft: #dff3ec;
      --warn: #9a5b00;
      --danger: #b33030;
      --ok: #176b43;
      --shadow: 0 12px 30px rgba(24, 35, 31, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      background: rgba(247, 247, 244, 0.96);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line);
      padding: calc(12px + env(safe-area-inset-top)) 14px 12px;
    }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      max-width: 980px;
      margin: 0 auto;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.15;
    }
    .sync {
      color: var(--muted);
      font-size: 12px;
      margin-top: 3px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button, .link-button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      padding: 8px 10px;
      font: inherit;
      font-size: 14px;
      text-decoration: none;
      cursor: pointer;
    }
    button.active, .link-button.primary {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 14px 14px 90px;
    }
    .filters {
      display: grid;
      gap: 10px;
      margin-bottom: 14px;
    }
    .search {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      font: inherit;
      background: var(--panel);
    }
    .chips {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }
    .chips::-webkit-scrollbar { display: none; }
    .chip {
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 12px 0;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px;
    }
    .stat strong {
      display: block;
      font-size: 18px;
      line-height: 1;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
    }
    .list {
      display: grid;
      gap: 12px;
    }
    .deal {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .deal-body {
      display: grid;
      grid-template-columns: 108px 1fr;
      gap: 12px;
      padding: 12px;
    }
    .photo {
      width: 108px;
      aspect-ratio: 1;
      object-fit: cover;
      background: #eef0ea;
      border-radius: 8px;
      border: 1px solid var(--line);
    }
    .placeholder {
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      padding: 8px;
    }
    .title {
      margin: 0;
      font-size: 17px;
      line-height: 1.22;
    }
    .zh {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.3;
    }
    .summary, .hint {
      margin: 7px 0 0;
      font-size: 14px;
      line-height: 1.35;
    }
    .summary {
      color: var(--ink);
    }
    .hint {
      color: var(--warn);
    }
    .badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin: 8px 0;
    }
    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      color: var(--muted);
      background: #fafbf8;
    }
    .badge.hot { color: var(--danger); border-color: #f0c4c4; background: #fff2f2; }
    .badge.ok { color: var(--ok); border-color: #b9dfcb; background: #eef9f3; }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-top: 8px;
      font-size: 13px;
    }
    .meta div {
      border-top: 1px solid var(--line);
      padding-top: 7px;
      min-width: 0;
    }
    .meta b {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 2px;
    }
    .deal-footer {
      border-top: 1px solid var(--line);
      padding: 10px 12px 12px;
      display: grid;
      gap: 10px;
    }
    .status-row, .links {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-row button {
      flex: 1 1 72px;
    }
    .links a {
      flex: 1 1 120px;
      text-align: center;
    }
    .note {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      font: inherit;
      font-size: 14px;
      background: #fbfcfa;
    }
    .empty {
      text-align: center;
      color: var(--muted);
      padding: 32px 8px;
    }
    input[type="file"] { display: none; }
    @media (max-width: 620px) {
      .topline { align-items: flex-start; }
      .actions button { min-height: 34px; font-size: 13px; padding: 7px 9px; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .deal-body { grid-template-columns: 92px 1fr; gap: 10px; padding: 10px; }
      .photo { width: 92px; }
      .title { font-size: 16px; }
      .meta { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>mydealz GZG</h1>
        <div class="sync">更新：${esc(generated)} · ${payload.deals.length} 个活动</div>
      </div>
      <div class="actions">
        <button id="exportState">导出状态</button>
        <label><input id="importState" type="file" accept="application/json"><span class="link-button">导入</span></label>
      </div>
    </div>
  </header>
  <main>
    <section class="filters">
      <input id="search" class="search" type="search" placeholder="搜索商品、中文、店名、类别">
      <div class="chips" id="storeFilters"></div>
      <div class="chips" id="statusFilters"></div>
      <div class="chips" id="deadlineFilters"></div>
      <div class="chips" id="sortFilters"></div>
      <div class="chips" id="categoryFilters"></div>
    </section>
    <section class="stats" id="stats"></section>
    <section class="list" id="list"></section>
  </main>
  <script id="dealData" type="application/json">${dataJson}</script>
  <script>
    const payload = JSON.parse(document.getElementById("dealData").textContent);
    const deals = payload.deals;
    const statusKey = "mydealz-gzg-status-v1";
    const state = JSON.parse(localStorage.getItem(statusKey) || "{}");
    const filters = { store: "all", status: "open", deadline: "active", sort: "buy", category: "all", query: "" };
    const statusLabels = {
      open: "待处理",
      todo: "待买",
      bought: "已买",
      submitted: "已提交",
      skipped: "跳过",
      all: "全部"
    };
    const deadlineLabels = {
      active: "未过期",
      buy7: "购买7天内",
      buy14: "购买14天内",
      submit7: "提交7天内",
      expired: "已过购买",
      all: "全部日期"
    };
    const sortLabels = {
      buy: "购买最急",
      submit: "提交最急",
      added: "最新加入",
      category: "按类别",
      store: "按店铺"
    };
    const statusOptions = ["todo", "bought", "submitted", "skipped"];
    const storeOptions = ["all", "REWE", "Netto", "Rossmann", "dm"];
    const categoryOptions = ["all", ...Array.from(new Set(deals.map((deal) => deal.category.key)))];
    const categoryNames = Object.fromEntries(deals.map((deal) => [deal.category.key, deal.category.zh]));
    categoryNames.all = "全部类别";

    function saveState() {
      localStorage.setItem(statusKey, JSON.stringify(state));
    }

    function todayIso() {
      return new Date().toISOString().slice(0, 10);
    }

    function daysUntil(iso) {
      if (!iso || iso === "9999-12-31") return null;
      const now = new Date(todayIso() + "T00:00:00");
      const then = new Date(iso + "T00:00:00");
      return Math.round((then - now) / 86400000);
    }

    function dateRank(iso) {
      if (!iso) return 99999999;
      if (iso === "9999-12-31") return 99999998;
      return Number(iso.replaceAll("-", ""));
    }

    function isPurchaseExpired(deal) {
      return Boolean(deal.purchaseDeadlineIso && deal.purchaseDeadlineIso !== "9999-12-31" && deal.purchaseDeadlineIso < todayIso());
    }

    function statusOf(deal) {
      return state[deal.id]?.status || (deal.enrichment?.riskFlags?.includes("user_skip_category") ? "skipped" : "todo");
    }

    function noteOf(deal) {
      return state[deal.id]?.note || "";
    }

    function chip(parent, label, value, group) {
      const button = document.createElement("button");
      button.className = "chip" + (filters[group] === value ? " active" : "");
      button.textContent = label;
      button.addEventListener("click", () => {
        filters[group] = value;
        render();
      });
      parent.append(button);
    }

    function renderFilters() {
      const storeEl = document.getElementById("storeFilters");
      const statusEl = document.getElementById("statusFilters");
      const deadlineEl = document.getElementById("deadlineFilters");
      const sortEl = document.getElementById("sortFilters");
      const categoryEl = document.getElementById("categoryFilters");
      storeEl.replaceChildren();
      statusEl.replaceChildren();
      deadlineEl.replaceChildren();
      sortEl.replaceChildren();
      categoryEl.replaceChildren();
      storeOptions.forEach((store) => chip(storeEl, store === "all" ? "全部店" : store, store, "store"));
      ["open", "all", "todo", "bought", "submitted", "skipped"].forEach((status) => chip(statusEl, statusLabels[status], status, "status"));
      ["active", "buy7", "buy14", "submit7", "expired", "all"].forEach((deadline) => chip(deadlineEl, deadlineLabels[deadline], deadline, "deadline"));
      ["buy", "submit", "added", "category", "store"].forEach((sort) => chip(sortEl, "排序：" + sortLabels[sort], sort, "sort"));
      categoryOptions.forEach((category) => chip(categoryEl, categoryNames[category] || category, category, "category"));
    }

    function storeMatches(deal) {
      if (filters.store === "all") return true;
      if (deal.storeMode === "restricted") return deal.stores.includes(filters.store);
      return deal.stores.length === 0 || deal.stores.includes(filters.store) || deal.storeMode === "not_limited" || deal.storeMode === "mentioned";
    }

    function deadlineMatches(deal) {
      const buyDays = daysUntil(deal.purchaseDeadlineIso);
      const submitDays = daysUntil(deal.submitDeadlineIso);
      if (filters.deadline === "all") return true;
      if (filters.deadline === "active") return !isPurchaseExpired(deal);
      if (filters.deadline === "expired") return isPurchaseExpired(deal);
      if (filters.deadline === "buy7") return buyDays !== null && buyDays >= 0 && buyDays <= 7;
      if (filters.deadline === "buy14") return buyDays !== null && buyDays >= 0 && buyDays <= 14;
      if (filters.deadline === "submit7") return submitDays !== null && submitDays >= 0 && submitDays <= 7;
      return true;
    }

    function matches(deal) {
      const status = statusOf(deal);
      const query = filters.query.trim().toLowerCase();
      const isExpired = isPurchaseExpired(deal);
      if (!storeMatches(deal)) return false;
      if (filters.category !== "all" && deal.category.key !== filters.category) return false;
      if (!deadlineMatches(deal)) return false;
      if (filters.status === "open" && (["bought", "submitted", "skipped"].includes(status) || isExpired)) return false;
      if (!["open", "all"].includes(filters.status) && status !== filters.status) return false;
      if (!query) return true;
      return [
        deal.titleDe,
        deal.titleZh,
        deal.category.de,
        deal.category.zh,
        deal.summaryZh || "",
        deal.productTypeZh || "",
        deal.shoppingHintZh || "",
        (deal.tagsZh || []).join(" "),
        deal.stores.join(" "),
        deal.purchaseDeadlineRaw,
        deal.submitDeadlineRaw
      ].join(" ").toLowerCase().includes(query);
    }

    function sortDeals(items) {
      return [...items].sort((a, b) => {
        if (filters.sort === "submit") {
          return dateRank(a.submitDeadlineIso) - dateRank(b.submitDeadlineIso)
            || dateRank(a.purchaseDeadlineIso) - dateRank(b.purchaseDeadlineIso)
            || a.titleDe.localeCompare(b.titleDe);
        }
        if (filters.sort === "added") {
          return dateRank(b.addedIso) - dateRank(a.addedIso)
            || dateRank(a.purchaseDeadlineIso) - dateRank(b.purchaseDeadlineIso);
        }
        if (filters.sort === "category") {
          return a.category.zh.localeCompare(b.category.zh, "zh")
            || dateRank(a.purchaseDeadlineIso) - dateRank(b.purchaseDeadlineIso);
        }
        if (filters.sort === "store") {
          const sa = a.storeMode === "restricted" ? "0" + a.stores.join(",") : "1未限定";
          const sb = b.storeMode === "restricted" ? "0" + b.stores.join(",") : "1未限定";
          return sa.localeCompare(sb) || dateRank(a.purchaseDeadlineIso) - dateRank(b.purchaseDeadlineIso);
        }
        return dateRank(a.purchaseDeadlineIso) - dateRank(b.purchaseDeadlineIso)
          || dateRank(a.submitDeadlineIso) - dateRank(b.submitDeadlineIso)
          || a.titleDe.localeCompare(b.titleDe);
      });
    }

    function badge(text, kind = "") {
      const span = document.createElement("span");
      span.className = "badge" + (kind ? " " + kind : "");
      span.textContent = text;
      return span;
    }

    function renderStats(visible) {
      const stats = {
        "待买": deals.filter((deal) => statusOf(deal) === "todo").length,
        "已买": deals.filter((deal) => statusOf(deal) === "bought").length,
        "已提交": deals.filter((deal) => statusOf(deal) === "submitted").length,
        "当前显示": visible.length
      };
      const el = document.getElementById("stats");
      el.replaceChildren(...Object.entries(stats).map(([label, value]) => {
        const box = document.createElement("div");
        box.className = "stat";
        box.innerHTML = "<strong>" + value + "</strong><span>" + label + "</span>";
        return box;
      }));
    }

    function renderDeal(deal) {
      const article = document.createElement("article");
      article.className = "deal";
      const remaining = daysUntil(deal.purchaseDeadlineIso);
      const submitRemaining = daysUntil(deal.submitDeadlineIso);
      const stores = deal.storeMode === "restricted"
        ? deal.stores.map((store) => "仅限 " + store)
        : (deal.stores.length ? [...deal.stores, "未限定店铺"] : ["未限定店铺"]);
      const img = deal.imageUrl
        ? '<img class="photo" loading="lazy" referrerpolicy="no-referrer" src="' + deal.imageUrl + '" alt="">'
        : '<div class="photo placeholder">无图片</div>';
      const summary = deal.summaryZh ? '<p class="summary">' + deal.summaryZh + '</p>' : "";
      const hint = deal.shoppingHintZh ? '<p class="hint">' + deal.shoppingHintZh + '</p>' : "";

      article.innerHTML = \`
        <div class="deal-body">
          \${img}
          <div>
            <h2 class="title">\${deal.titleDe}</h2>
            <p class="zh">\${deal.titleZh}</p>
            \${summary}
            \${hint}
            <div class="badges"></div>
            <div class="meta">
              <div><b>购买截止</b>\${deal.purchaseDeadlineRaw || "未写明"}</div>
              <div><b>提交截止</b>\${deal.submitDeadlineRaw || "未写明"}</div>
              <div><b>时间/名额</b>\${deal.purchaseTime || "无固定时间"}\${deal.quota ? " · " + deal.quota : ""}</div>
              <div><b>凭证</b>\${deal.receiptType || "未写明"}\${deal.smsConfirmation ? " · SMS " + deal.smsConfirmation : ""}</div>
            </div>
          </div>
        </div>
        <div class="deal-footer">
          <div class="status-row"></div>
          <input class="note" placeholder="备注：买了哪家店、金额、提交情况" value="\${(noteOf(deal) || "").replaceAll('"', "&quot;")}">
          <div class="links">
            \${deal.mydealzUrl ? '<a class="link-button primary" target="_blank" rel="noreferrer" href="' + deal.mydealzUrl + '">mydealz</a>' : ""}
            \${deal.officialUrl ? '<a class="link-button" target="_blank" rel="noreferrer" href="' + deal.officialUrl + '">官方报销</a>' : ""}
          </div>
        </div>\`;

      const badges = article.querySelector(".badges");
      badges.append(badge(deal.category.zh + " / " + deal.category.de, "ok"));
      if (deal.productTypeZh) badges.append(badge(deal.productTypeZh));
      if (deal.priority === "high") badges.append(badge("优先看", "hot"));
      (deal.tagsZh || []).slice(0, 5).forEach((tag) => badges.append(badge(tag)));
      stores.forEach((store) => badges.append(badge(store)));
      if (remaining !== null && remaining <= 7 && remaining >= 0) badges.append(badge("购买剩 " + remaining + " 天", "hot"));
      if (submitRemaining !== null && submitRemaining <= 7 && submitRemaining >= 0) badges.append(badge("提交剩 " + submitRemaining + " 天", "hot"));
      if (deal.submitWindow && deal.submitWindow !== "-") badges.append(badge(deal.submitWindow));

      const row = article.querySelector(".status-row");
      statusOptions.forEach((status) => {
        const button = document.createElement("button");
        button.textContent = statusLabels[status];
        button.className = statusOf(deal) === status ? "active" : "";
        button.addEventListener("click", () => {
          state[deal.id] = { ...state[deal.id], status, updatedAt: new Date().toISOString() };
          saveState();
          render();
        });
        row.append(button);
      });

      article.querySelector(".note").addEventListener("change", (event) => {
        state[deal.id] = {
          ...state[deal.id],
          status: statusOf(deal),
          note: event.target.value,
          updatedAt: new Date().toISOString()
        };
        saveState();
      });

      return article;
    }

    function render() {
      renderFilters();
      const visible = sortDeals(deals.filter(matches));
      renderStats(visible);
      const list = document.getElementById("list");
      list.replaceChildren(...visible.map(renderDeal));
      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "没有匹配的活动";
        list.append(empty);
      }
    }

    document.getElementById("search").addEventListener("input", (event) => {
      filters.query = event.target.value;
      render();
    });

    document.getElementById("exportState").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mydealz-gzg-state.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("importState").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const imported = JSON.parse(await file.text());
      Object.assign(state, imported);
      saveState();
      render();
      event.target.value = "";
    });

    render();
  </script>
</body>
</html>
`;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const [csvText, htmlText] = await Promise.all([fetchText(CSV_URL), fetchText(HTML_URL)]);
  const enrichmentCache = normalizeEnrichment(await loadJsonIfExists(ENRICHMENT_CACHE_PATH, { schemaVersion: 1, items: {} }));
  const legacyEnrichment = normalizeEnrichment(await loadJsonIfExists(ENRICHMENT_PATH, {}));
  const enrichment = { ...legacyEnrichment, ...enrichmentCache };
  const payload = applyEnrichment(buildDeals(csvText, htmlText), enrichment);
  const enrichmentTodo = buildEnrichmentTodo(payload, enrichment);

  await fs.writeFile(path.join(DATA_DIR, "source.csv"), csvText);
  await fs.writeFile(path.join(DATA_DIR, "source.html"), htmlText);
  await fs.writeFile(ENRICHMENT_CACHE_PATH, `${JSON.stringify({ schemaVersion: 1, items: enrichmentCache }, null, 2)}\n`);
  await fs.writeFile(path.join(DATA_DIR, "deals.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(DATA_DIR, "enrichment.todo.json"), `${JSON.stringify(enrichmentTodo, null, 2)}\n`);
  await fs.writeFile(path.join(ROOT, "index.html"), renderHtml(payload));

  const withImages = payload.deals.filter((deal) => deal.imageUrl).length;
  const focusStores = payload.deals.filter((deal) =>
    deal.stores.some((store) => ["REWE", "Netto", "Rossmann", "dm"].includes(store)),
  ).length;

  console.log(`Generated ${payload.deals.length} deals (${withImages} with images, ${focusStores} in focus stores, ${payload.source.enrichedCount} enriched, ${enrichmentTodo.deals.length} todo).`);
  console.log(path.join(ROOT, "index.html"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
