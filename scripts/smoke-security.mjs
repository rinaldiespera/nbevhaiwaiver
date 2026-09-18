// Node-based smoke test for security gates (avoids PowerShell/curl quoting horrors).
// Usage: node scripts/smoke-security.mjs
import assert from "node:assert/strict";
const BASE = process.env.WAIVER_BASE_URL || "http://localhost:3000";

const okGreen = (s) => `\u001b[32mOK\u001b[39m  ${s}`;
const failRed = (s) => `\u001b[31mFAIL\u001b[39m ${s}`;
const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass });
  console.log((pass ? okGreen : failRed)(name) + (detail ? `  (${detail})` : ""));
}

async function http(method, path, { headers = {}, body = undefined, parseJson = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "user-agent": "waiver-smoke/v1",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = undefined;
  if (parseJson && text.length > 0) {
    try { json = JSON.parse(text); } catch { /* ignore */ }
  }
  return { status: res.status, text, json };
}

console.log(`\n== T1: GET /api/waiver-types (ADMIN_API_AUTH_REQUIRED=false, no auth header) ==`);
const t1 = await http("GET", "/api/waiver-types", { parseJson: true });
check("HTTP 200", t1.status === 200, `got ${t1.status}`);
check("response is array length>=2", Array.isArray(t1.json) && t1.json.length >= 2, `len=${Array.isArray(t1.json) ? t1.json.length : "n/a"}`);
const bb = t1.json?.find((r) => r.slug === "basketball-court");
const sf = t1.json?.find((r) => r.slug === "sports-facilities");
check("basketball-court row has signedQrRelativeUrl /waiver/basketball-court?h=<12hex>",
  !!bb && typeof bb.signedQrRelativeUrl === "string" && /^\/waiver\/basketball-court\?h=[a-f0-9]{12}$/.test(bb.signedQrRelativeUrl),
  bb ? `rel=${bb.signedQrRelativeUrl}` : "no row");
check("sports-facilities row has signedQrFullUrl prefixed with http://localhost:3000",
  !!sf && typeof sf.signedQrFullUrl === "string" && sf.signedQrFullUrl.startsWith("http://localhost:3000/waiver/sports-facilities?h="),
  sf ? `full=${sf.signedQrFullUrl}` : "no row");

console.log(`\n== T2: GET /api/waiver-types WITH wrong Bearer (auth off => still 200) ==`);
const t2 = await http("GET", "/api/waiver-types", { headers: { authorization: "Bearer definitely-wrong-token-123456" } });
check("HTTP 200 with wrong Bearer when admin-auth toggle disabled", t2.status === 200, `got ${t2.status}`);

console.log(`\n== T3: GET /waiver/basketball-court (NO ?h=, WAIVER_HASH_REQUIRED=false => transition mode) ==`);
const t3 = await http("GET", "/waiver/basketball-court");
check("HTTP 200", t3.status === 200, `got ${t3.status}`);
check("renders transition-mode banner 'Unsecured access enabled (transition mode)'",
  t3.text.includes("Unsecured access enabled"),
  "banner match");

console.log(`\n== T4: GET /waiver/sports-facilities?h=<CORRECT sig from server> ==`);
const sfRel = sf.signedQrRelativeUrl;
const t4 = await http("GET", sfRel);
check("HTTP 200 with correct h", t4.status === 200, `got ${t4.status}`);
check("contains waiver name 'Sports Facilities'", t4.text.includes("Sports Facilities"), "name match");
check("contains sign form checkbox phrase 'I have read and accept'", t4.text.includes("I have read and accept"), "prose match");
check("does NOT contain transition banner (hash used not bypass)", !t4.text.includes("Unsecured access enabled"), "no bypass banner");
// Extract the h value for later use in sign gate
const sfHash = sfRel.split("?h=")[1];

console.log(`\n== T5: GET /waiver/sports-facilities?h=<12hex 1 char mangled> => mismatch reason page ==`);
const last = sfHash[sfHash.length - 1];
const alt = "0123456789abcdef".split("").filter((c) => c !== last)[0];
const badRel = `${sfRel.slice(0, sfRel.length - 1)}${alt}`;
const t5 = await http("GET", badRel);
check("renders mismatch reason title 'security code does not match'",
  t5.text.includes("security code does not match"),
  "mismatch copy match");

console.log(`\n== T6: GET /waiver/sports-facilities?h=zz (bad format, non-12-hex, 2 chars) => bad-format page ==`);
const t6 = await http("GET", "/waiver/sports-facilities?h=zz");
check("renders bad-format copy with word 'malformed'",
  t6.text.includes("malformed"),
  "bad-format copy match");

console.log(`\n== T7: POST /api/sign sign-gate in transition mode (WAIVER_HASH_REQUIRED=false) ==`);
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
// T7a: no accessHash (MISSING) in transition mode => bypass allowed,
//      falls through to blank-signature quality check (400 expected, NOT a 403)
const t7a = await http("POST", "/api/sign", {
  body: { waiverTypeId: sf.id, signerName: "Smoke Test No Hash", signatureDataUrl: tinyPng },
  parseJson: true,
});
check("no accessHash in transition mode -> passes gate and fails blankness check (HTTP 400, NOT 403)",
  t7a.status === 400 && typeof t7a.json?.error === "string" && t7a.json.error.toLowerCase().includes("blank"),
  `got ${t7a.status} body=${JSON.stringify(t7a.json)}`);
// T7b: accessHash present but BAD-FORMAT in transition mode => STILL rejected (403 bad-format)
const t7b = await http("POST", "/api/sign", {
  body: { waiverTypeId: sf.id, signerName: "Smoke Test Bad Format", signatureDataUrl: tinyPng, accessHash: "zz" },
  parseJson: true,
});
check("bad-format accessHash (present but wrong length) still 403 in transition mode",
  t7b.status === 403 && t7b.json?.status === "forbidden" && typeof t7b.json?.error === "string" && t7b.json.error.toLowerCase().includes("format"),
  `got ${t7b.status} body=${JSON.stringify(t7b.json)}`);

console.log(`\n== T8: POST /api/sign WITH correct accessHash => passes hash gate (status != 403) ==`);
const t8 = await http("POST", "/api/sign", {
  body: { waiverTypeId: sf.id, signerName: "Smoke Test With Correct Hash", signatureDataUrl: tinyPng, accessHash: sfHash },
  parseJson: true,
});
check("HTTP != 403 (passed access gate; may be 201/400/409 for PNG/dup reasons)", t8.status !== 403, `got ${t8.status}`);

console.log(`\n== T9: POST /api/sign WITH WRONG cross-waiver accessHash => 403 mismatch ==`);
const bbHash = bb.signedQrRelativeUrl.split("?h=")[1];
const t9 = await http("POST", "/api/sign", {
  body: { waiverTypeId: sf.id, signerName: "Smoke Test Wrong Cross Hash", signatureDataUrl: tinyPng, accessHash: bbHash },
  parseJson: true,
});
check("HTTP 403", t9.status === 403, `got ${t9.status}`);
check("error mentions mismatch / does not match this waiver type", typeof t9.json?.error === "string" && t9.json.error.includes("does not match"), "mismatch copy match");

console.log("\n=====================");
const passN = checks.filter((c) => c.pass).length;
console.log(`Smoke results: ${passN}/${checks.length} passed`);
if (passN !== checks.length) {
  for (const c of checks) if (!c.pass) console.log("  - " + c.name);
  process.exit(1);
}
console.log("All smoke checks passed.");
process.exit(0);
