import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGINAL_QUOTE = "Original brain quote contains enough words to verify";
const UPDATED_QUOTE = "Updated brain quote contains enough words to verify";

test("systemFor reloads an existing advisor when a brain file changes", async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "roast-room-brain-reload-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  const lib = path.join(fixture, "app", "lib");
  const agents = path.join(fixture, ".claude", "agents");
  const skill = path.join(fixture, ".claude", "skills", "roast-room");
  const brain = path.join(skill, "brains", "test-advisor");
  fs.mkdirSync(lib, { recursive: true });
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(brain, { recursive: true });

  fs.copyFileSync(path.join(ROOT, "app", "lib", "env.mjs"), path.join(lib, "env.mjs"));
  fs.copyFileSync(path.join(ROOT, "app", "lib", "seats.mjs"), path.join(lib, "seats.mjs"));
  fs.writeFileSync(path.join(agents, "council-test.md"), "---\nname: test\n---\nTest agent\n");
  fs.writeFileSync(path.join(skill, "roster.json"), JSON.stringify({
    seats: [{ key: "test", slug: "test-advisor" }],
  }));
  fs.writeFileSync(path.join(brain, "_hot.md"), `ORIGINAL_BRAIN\n"${ORIGINAL_QUOTE}" (S001)\n`);

  const seats = await import(pathToFileURL(path.join(lib, "seats.mjs")));
  const before = seats.systemFor("test")[0].text;
  assert.match(before, /ORIGINAL_BRAIN/);
  assert.equal(seats.checkQuotes("test", `"${ORIGINAL_QUOTE}" (S001)`)[0]?.verified, true);

  fs.writeFileSync(path.join(brain, "_hot.md"), `UPDATED_BRAIN\n"${UPDATED_QUOTE}" (S002)\n`);
  assert.match(fs.readFileSync(path.join(brain, "_hot.md"), "utf8"), /UPDATED_BRAIN/);

  // This is the same refresh boundary used by app/lib/council.mjs before a new
  // API-runner council. The next system prompt must include the edited brain.
  seats.loadRoster();
  seats.invalidateAdvisorCaches();
  const afterSystem = seats.systemFor("test");
  const after = afterSystem[0].text;

  assert.match(after, /UPDATED_BRAIN/);
  assert.doesNotMatch(after, /ORIGINAL_BRAIN/);
  assert.equal(seats.checkQuotes("test", `"${UPDATED_QUOTE}" (S002)`)[0]?.verified, true);
  assert.equal(seats.checkQuotes("test", `"${ORIGINAL_QUOTE}" (S001)`)[0]?.verified, false);

  // The next council starts with fresh caches, but repeated accesses during that
  // council still reuse the same assembled prompt.
  assert.strictEqual(seats.systemFor("test"), afterSystem);
});
