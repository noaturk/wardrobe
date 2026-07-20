import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function files(directory) {
  return (await readdir(directory, { withFileTypes: true })).flatMap((entry) => (
    entry.isDirectory() ? [] : [path.join(directory, entry.name)]
  ));
}

const roots = [path.resolve("dist"), path.resolve("dist", "assets")];
const candidates = [];
for (const root of roots) {
  try { candidates.push(...await files(root)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const configuredSecrets = [process.env.OPENAI_API_KEY, process.env.SESSION_SECRET]
  .filter((value) => typeof value === "string" && value.length >= 8);
for (const file of candidates) {
  const content = await readFile(file);
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(content.toString("utf8"))) throw new Error(`Possible OpenAI key found in ${file}`);
  for (const secret of configuredSecrets) {
    if (content.includes(Buffer.from(secret))) throw new Error(`Configured secret found in ${file}`);
  }
}
console.log(`Checked ${candidates.length} frontend build files; no configured secrets found`);
