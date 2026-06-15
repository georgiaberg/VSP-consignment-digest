/**
 * VSP Consignment weekly digest — SCORED edition
 * ------------------------------------------------
 * Polls VSP's Shopify feed for ONLY the categories you wear (dresses, skirts,
 * tops, sets, optionally jewelry), scores each new item on size-fit + aesthetic
 * keywords + designer, and emails you the matches ranked high-to-low. Each item
 * shows its score and the reasons, so you can tune the thresholds to taste.
 *
 * Setup:
 *   1. script.google.com -> New project -> paste this in.
 *   2. Edit CONFIG below if you want.
 *   3. Run `runDigest` once (authorize Gmail + external fetch). First run seeds a
 *      baseline and only emails a confirmation -- no 500-item dump.
 *   4. Triggers (clock icon) -> Add Trigger -> runDigest, time-driven, week timer.
 */
 
const CONFIG = {
  // Only the categories you wear. Each is its own Shopify collection, so pants/
  // shoes/bags/outerwear never even get fetched. Remove "jewelry" if it's noise.
  collections: ["dresses", "skirts", "womens-tops", "co-ord-sets", "jewelry"],
 
  maxPriceCad: 600,      // hard cap. null for none.
  minPriceCad: null,
 
  scoreThreshold: 6,     // lower = more items / higher = pickier. Score is shown
                         // in the email so you can recalibrate after a week or two.
  maxItemsPerEmail: 50,
  recipient: "",         // "" = the Google account running this (you)
};
 
const STORE = "https://vspconsignment.com";
 
/* ---------- Designer tiers (feminine / whimsical / twee / boho, work-wearable) ---------- */
const BRAND_TIERS = {
  love: [ // +3
    "simone rocha","shushu","red valentino","miu miu","self-portrait","self portrait",
    "ulla johnson","zimmermann","chloe","chloé","etro","isabel marant","missoni","cult gaia"
  ],
  like: [ // +2
    "ganni","jacquemus","marni","dries van noten","gucci","prada","pucci","marc jacobs","loewe",
    "jw anderson","j.w. anderson","birgitte herskind","alberta ferretti","valentino","dior",
    "tory burch","veronica beard","tibi","sandro","a.l.c","alc"
  ],
  avoid: [ // -2 (off-aesthetic minimal/avant/edgy, or evening/body-con)
    "acne","helmut lang","jil sander","ann demeulemeester","rick owens","comme des garcons",
    "comme des garçons","junya watanabe","maison margiela","balenciaga","alexander wang","sacai",
    "proenza schouler","alaia","alaïa","herve leger","hervé léger","mugler","balmain","versace",
    "tom ford","roberto cavalli","brandon maxwell","rabanne","givenchy","saint laurent",
    "jean paul gaultier","gaultier","christopher esber","dsquared"
  ]
};
 
function brandTier_(text) {
  const s = (text || "").toLowerCase();
  if (s.includes("mm6")) return 0;                                  // wearable diffusion -> neutral
  if (BRAND_TIERS.love.some(b => s.includes(b))) return 3;
  if (BRAND_TIERS.like.some(b => s.includes(b))) return 2;
  if (BRAND_TIERS.avoid.some(b => s.includes(b))) return -2;
  return 0;
}
 
/* ---------- Aesthetic keywords ---------- */
const POS = ["floral","flower","ditsy","prairie","peasant","ruffle","frill","bow","lace","broderie",
  "eyelet","tiered","smock","puff","pouf","polka","gingham","embroider","pintuck","peplum","scallop",
  "tulle","pearl","daisy","cottage","milkmaid","babydoll","pussy bow","pussybow","peter pan",
  "sweetheart","paisley","print","watercolor","pastel","gathered","shirred","picot","rickrack",
  "bishop sleeve","balloon sleeve","butterfly","cherry","strawberry","crochet","romantic","whimsical",
  "feminine","bohemian","boho","a-line","tea dress","wrap dress","midi"];
 
const NEG = ["evening","gown","black tie","cocktail","sequin","bustier","corset","bandage","bodycon",
  "body-con","cut-out","cutout","cut out","backless","open back","plunge","plunging","naked","sheer",
  "mesh","see-through","see through","fishnet","lingerie","high slit","thigh slit","strapless"];
 
/* ---------- Silhouette / fabric ---------- */
const FLOWY = ["maxi","midi","a-line","aline","tiered","smock","babydoll","empire","wrap","pleat",
  "gathered","flowy","flowing","trapeze","tent","swing","kaftan","caftan","prairie","peasant",
  "billow","ruffle","tulle","gypsy","balloon","puff","voluminous","oversized","relaxed","draped","bias"];
const FITTED = ["bodycon","body-con","fitted","tailored","pencil","sheath","bandage","corset","bustier",
  "slim","column","tube"];
const FORGIVING = ["jersey","knit","ribbed","rib ","stretch","elastic","smock","drawstring","tie waist","elasticated"];
 
function silhouette_(text) {
  const s = (text || "").toLowerCase();
  if (FORGIVING.some(w => s.includes(w))) return "flowy";          // stretch/knit -> forgiving
  const fitted = FITTED.some(w => s.includes(w));
  const flowy  = FLOWY.some(w => s.includes(w));
  if (fitted && !flowy) return "fitted";
  return "flowy";                                                   // default generous (over-accept)
}
 
/* ---------- Size parsing -> bucket or waist-inches ---------- */
function euToBucket_(sys, n) {
  if (sys === "fr")      return n <= 28 ? "XXS" : n <= 32 ? "XS" : n <= 36 ? "S" : n <= 40 ? "M" : n <= 44 ? "L" : n <= 48 ? "XL" : "XXL";
  if (sys === "uk")      return n <= 4 ? "XS" : n <= 8 ? "S" : n <= 12 ? "M" : n <= 16 ? "L" : "XL";
  if (sys === "jp")      return n <= 0 ? "XS" : n === 1 ? "S" : n === 2 ? "M" : n === 3 ? "L" : n === 4 ? "XL" : "XXL";
  if (sys === "dk")      return n <= 26 ? "XXS" : n <= 30 ? "XS" : n <= 34 ? "S" : n <= 38 ? "M" : n <= 42 ? "L" : n <= 46 ? "XL" : "XXL";
  /* it / eu */          return n <= 32 ? "XXS" : n <= 36 ? "XS" : n <= 40 ? "S" : n <= 44 ? "M" : n <= 48 ? "L" : n <= 52 ? "XL" : "XXL";
}
 
function parseSize_(raw) {
  const s = (raw || "").toLowerCase().trim();
  if (!s || /one size|^os$|free size|onesize/.test(s)) return { kind: "os" };
  let m;
  if ((m = s.match(/waist\s*(\d{2})/)))      return { kind: "waist", n: parseInt(m[1], 10) };
  if ((m = s.match(/\bus\s*(\d{1,2})\b/))) {   // US numeric tuned to your body, not the generic chart
    const n = parseInt(m[1], 10);
    const map = { 0: "XS", 2: "XS", 4: "S", 6: "M", 8: "M", 10: "L", 12: "L", 14: "XL", 16: "XL", 18: "XXL", 20: "XXL" };
    return { kind: "bucket", b: map[n] || (n <= 2 ? "XS" : n <= 8 ? "M" : "L") };
  }
  if ((m = s.match(/\b(fr|it|eu|dk|uk|jp)\s*(\d{1,2})\b/))) return { kind: "bucket", b: euToBucket_(m[1], parseInt(m[2], 10)) };
  if (/xx-?small|xxs/.test(s))               return { kind: "bucket", b: "XXS" };
  if (/x-?small|\bxs\b/.test(s))             return { kind: "bucket", b: "XS" };
  if (/xx-?large|xxl/.test(s))               return { kind: "bucket", b: "XXL" };
  if (/x-?large|\bxl\b/.test(s))             return { kind: "bucket", b: "XL" };
  if (/\blarge\b|\bl\b/.test(s))             return { kind: "bucket", b: "L" };
  if (/\bmedium\b|\bm\b/.test(s))            return { kind: "bucket", b: "M" };
  if (/\bsmall\b|\bs\b/.test(s))             return { kind: "bucket", b: "S" };
  return null;                                                      // unknown
}
 
// Hips ~42 / waist ~28 / bust ~36: smalls fit FLOWY (small bust); fitted needs L (waist/hips).
function fitScore_(size, sil) {
  if (!size) return 1;                                              // unknown -> mildly accept
  if (size.kind === "os") return 2;
  if (size.kind === "waist") {
    const n = size.n;
    if (sil === "fitted") return n >= 30 ? 3 : n >= 28 ? 1 : n >= 26 ? -2 : -3;
    return n >= 27 ? 3 : n >= 25 ? 1 : n >= 23 ? -1 : -2;
  }
  const fittedTable = { XXS: -3, XS: -3, S: -2, M: 1, L: 3, XL: 2, XXL: 1 };
  const flowyTable  = { XXS: -1, XS: 0,  S: 3,  M: 3, L: 3, XL: 2, XXL: 1 };
  return (sil === "fitted" ? fittedTable : flowyTable)[size.b];
}
 
/* ---------- Category ---------- */
function category_(text) {
  const s = (text || "").toLowerCase();
  const has = arr => arr.some(w => s.includes(w));
  if (has(["necklace","earring","ring ","bracelet","brooch","pendant","charm"])) return { name: "Jewelry", score: 2 };
  if (s.includes("dress"))                                  return { name: "Dress",  score: 5 };
  if (s.includes("skirt"))                                  return { name: "Skirt",  score: 3 };
  if (has(["co-ord","coord"," set"]))                       return { name: "Set",    score: 3 };
  if (has(["blouse","shirt","top","tee","tank","camisole","cami","bodysuit","sweater","knit","cardigan"]))
                                                            return { name: "Top",    score: 3 };
  if (s.includes("jumpsuit"))                               return { name: "Jumpsuit", score: 1 };
  // safety exclusions (rare inside these collections, but just in case)
  if (has(["pant","trouser","jean","legging","shorts","shoe","boot","heel","sneaker","loafer","mule",
           "sandal","pump","slide","bag","tote","clutch","wallet","coat","jacket","blazer","trench","puffer"]))
                                                            return null;
  return { name: "Item", score: 1 };                                // unknown -> low, still over-accepted
}
 
/* ---------- Scoring ---------- */
function scoreProduct_(p) {
  const variants = p.variants || [];
  const avail = variants.filter(v => v.available);
  if (avail.length === 0) return null;                              // sold out
 
  const prices = avail.map(v => parseFloat(v.price)).filter(n => !isNaN(n));
  const price = prices.length ? Math.min(...prices) : null;
  if (CONFIG.maxPriceCad != null && (price == null || price > CONFIG.maxPriceCad)) return null;
  if (CONFIG.minPriceCad != null && (price == null || price < CONFIG.minPriceCad)) return null;
 
  const text = `${p.product_type || ""} ${p.title || ""} ${(p.tags || []).join(" ")} ${p.body_html || ""}`.toLowerCase();
  const cat = category_(text);
  if (!cat) return null;
 
  const sil = silhouette_(text);
  const sizeStrs = avail.map(v => `${v.title || ""} ${v.option1 || ""}`);
  const bestFit = Math.max(...sizeStrs.map(s => fitScore_(parseSize_(s), sil)));
  const bestSize = sizeStrs[sizeStrs.map(s => fitScore_(parseSize_(s), sil)).indexOf(bestFit)].trim();
 
  const posHits = POS.filter(w => text.includes(w));
  const negHits = NEG.filter(w => text.includes(w));
  const aesthetic = Math.min(posHits.length, 4) - Math.min(negHits.length * 2, 4);
 
  const brand = brandTier_(`${p.vendor || ""} ${p.title || ""}`);
 
  const score = cat.score + bestFit + aesthetic + brand;
 
  const fitWord = bestFit >= 3 ? "fits" : bestFit >= 1 ? "likely fits" : bestFit === 0 ? "borderline" : "may not fit";
  const reasons = [`${cat.name} · ${fitWord} (${bestSize || "?"}, ${sil})`];
  if (posHits.length) reasons.push(posHits.slice(0, 4).join(", "));
  if (negHits.length) reasons.push("⚠ may be evening/sheer");
  if (brand === 3) reasons.push("♥ on-aesthetic designer");
  else if (brand === 2) reasons.push("✓ good designer");
  else if (brand === -2) reasons.push("⚠ off-aesthetic designer");
 
  return { score, reasons, price, p };
}
 
/* ---------- Main ---------- */
function runDigest() {
  const seen = getSeenIds_();
  const firstRun = seen.size === 0;
  const scoredById = {};
 
  for (const handle of CONFIG.collections) {
    for (const p of fetchCollection_(handle)) {
      if (scoredById[p.id]) continue;
      const r = scoreProduct_(p);
      if (r && r.score >= CONFIG.scoreThreshold && !seen.has(String(p.id))) scoredById[p.id] = r;
    }
  }
 
  const matches = Object.values(scoredById).sort((a, b) => b.score - a.score);
  matches.forEach(r => seen.add(String(r.p.id)));
  saveSeenIds_(seen);
 
  if (firstRun) {
    sendEmail_("digest is live", `<p>Tracking started — <b>${matches.length}</b> current items clear your ` +
      `score threshold of ${CONFIG.scoreThreshold}. They're logged as baseline so this stays short. ` +
      `From next run you'll only get <b>new</b> arrivals, ranked by score.</p>`);
    return;
  }
  if (matches.length === 0) return;
 
  sendEmail_(`${matches.length} new pick${matches.length === 1 ? "" : "s"}`,
    buildHtml_(matches.slice(0, CONFIG.maxItemsPerEmail), matches.length));
}
 
function fetchCollection_(handle) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const res = UrlFetchApp.fetch(`${STORE}/collections/${handle}/products.json?limit=250&page=${page}`, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) break;
    const products = (JSON.parse(res.getContentText()).products) || [];
    if (products.length === 0) break;
    all.push(...products);
    Utilities.sleep(400);
    if (products.length < 250) break;
  }
  return all;
}

// Run this anytime to email yourself the current top items, ranked — ignores the
// "already seen" list and changes no state. Purely for previewing / sanity-checking.
function previewDigest() {
  const scoredById = {};
  for (const handle of CONFIG.collections) {
    for (const p of fetchCollection_(handle)) {
      if (scoredById[p.id]) continue;
      const r = scoreProduct_(p);
      if (r && r.score >= CONFIG.scoreThreshold) scoredById[p.id] = r;
    }
  }
  const matches = Object.values(scoredById).sort((a, b) => b.score - a.score);
  sendEmail_(`PREVIEW · top ${Math.min(15, matches.length)} of ${matches.length}`,
    buildHtml_(matches.slice(0, 15), matches.length));
}
 
function buildHtml_(items, total) {
  const rows = items.map(r => {
    const p = r.p, img0 = p.images && p.images[0] && p.images[0].src;
    const img = img0 ? img0.replace(/(\?|&)width=\d+/g, "") + (img0.includes("?") ? "&" : "?") + "width=220" : "";
    const link = `${STORE}/products/${p.handle}`;
    return `<tr>
      <td style="padding:10px 14px 10px 0;vertical-align:top;width:120px;">
        ${img ? `<a href="${link}"><img src="${img}" width="110" style="border-radius:6px;display:block;"></a>` : ""}</td>
      <td style="padding:10px 0;vertical-align:top;font-family:Helvetica,Arial,sans-serif;">
        <span style="display:inline-block;background:#111;color:#fff;border-radius:10px;font-size:11px;padding:1px 7px;">${r.score}</span>
        <a href="${link}" style="font-size:15px;color:#111;text-decoration:none;font-weight:600;"> ${p.title}</a><br>
        <span style="color:#444;font-size:13px;">${p.vendor || ""}${r.price != null ? " · $" + r.price.toFixed(0) + " CAD" : ""}</span><br>
        <span style="color:#777;font-size:12px;">${r.reasons.join(" · ")}</span>
      </td></tr>`;
  }).join("");
  const more = total > items.length
    ? `<p style="font-family:Helvetica,Arial,sans-serif;color:#777;font-size:12px;">+${total - items.length} more above threshold not shown.</p>` : "";
  return `<div style="max-width:580px;">
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#555;">
      ${total} new item${total === 1 ? "" : "s"}, ranked by fit-to-you. Number = score (size + style + designer).</p>
    <table cellpadding="0" cellspacing="0">${rows}</table>${more}</div>`;
}
 
function sendEmail_(subject, html) {
  MailApp.sendEmail({ to: CONFIG.recipient || Session.getActiveUser().getEmail(), subject: `[VSP] ${subject}`, htmlBody: html });
}
 
/* ---------- State (chunked to stay under the 9KB-per-property limit) ---------- */
function getSeenIds_() {
  const props = PropertiesService.getScriptProperties();
  const n = parseInt(props.getProperty("seenChunks") || "0", 10);
  const set = new Set();
  for (let i = 0; i < n; i++) (JSON.parse(props.getProperty("seen_" + i) || "[]")).forEach(id => set.add(id));
  return set;
}
function saveSeenIds_(set) {
  const props = PropertiesService.getScriptProperties();
  let ids = Array.from(set);
  if (ids.length > 4000) ids = ids.slice(ids.length - 4000);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
  const old = parseInt(props.getProperty("seenChunks") || "0", 10);
  for (let i = 0; i < old; i++) props.deleteProperty("seen_" + i);
  chunks.forEach((c, i) => props.setProperty("seen_" + i, JSON.stringify(c)));
  props.setProperty("seenChunks", String(chunks.length));
}
