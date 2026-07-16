#!/usr/bin/env node

const fs = require("node:fs");

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  process.stderr.write("Usage: sanitize-fixture.js INPUT OUTPUT\n");
  process.exit(2);
}

const emailKeys = new Set(["account", "accountemail", "email"]);
const organizationKeys = new Set(["accountorganization", "organization"]);
const secretKeyPattern = /(access.?token|refresh.?token|cookie|credential|secret|authorization)/i;
const sessionKeyPattern = /^(session.?id|uuid)$/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const homePattern = /\/home\/[^/\s"']+/g;

function sanitizeString(value) {
  return value
    .replace(emailPattern, "user@example.invalid")
    .replace(homePattern, "/home/USER")
    .replace(uuidPattern, "00000000-0000-0000-0000-000000000000");
}

function sanitize(value, key = "") {
  const normalizedKey = key.toLowerCase();
  if (emailKeys.has(normalizedKey)) return value == null ? value : "user@example.invalid";
  if (organizationKeys.has(normalizedKey)) return value == null ? value : "example-org";
  if (secretKeyPattern.test(key)) return value == null ? value : "<redacted>";
  if (sessionKeyPattern.test(key)) return value == null ? value : "00000000-0000-0000-0000-000000000000";
  if (normalizedKey === "id" && typeof value === "string" && value.length > 40) return "<redacted-id>";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return typeof value === "string" ? sanitizeString(value) : value;
}

const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
fs.writeFileSync(outputPath, `${JSON.stringify(sanitize(parsed), null, 2)}\n`, { mode: 0o600 });
