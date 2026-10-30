// The resident changing its own persona (src/persona-edit.ts), without a Worker. Usage: node test/persona-edit.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-persona-edit-"));
const out = join(dir, "persona-edit.mjs");
await build({ entryPoints: ["src/persona-edit.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { EDIT_PERSONA_DESCRIPTION, PERSONA_MAX_CHARS, editPersona, personaTools } = await import(pathToFileURL(join(process.cwd(), out)).href);
rmSync(dir, { recursive: true, force: true });

const persona = "You are Mochi.\n\nYou talk softly.";

// Added at the end, after a blank line; spaces around it go.
assert.deepEqual(editPersona(persona, undefined, "  You like rain.\n"), { text: "You are Mochi.\n\nYou talk softly.\n\nYou like rain." });
assert.deepEqual(editPersona(persona, "", "You like rain."), { text: "You are Mochi.\n\nYou talk softly.\n\nYou like rain." }, "an empty old_text adds too");
assert.match(editPersona(persona, undefined, "  ").error, /nothing to add/);

// A piece replaced, or removed; the rest stays as it was.
assert.deepEqual(editPersona(persona, "softly", "fast"), { text: "You are Mochi.\n\nYou talk fast." });
assert.deepEqual(editPersona(persona, "\n\nYou talk softly.", ""), { text: "You are Mochi." });
assert.match(editPersona(persona, "loudly", "x").error, /not in your persona/);
assert.match(editPersona("a a", "a", "b").error, /more than once/);
assert.match(editPersona(persona, persona, "").error, /empty/);

// Not longer than the web page allows, and never the words some keys refuse.
assert.ok(editPersona(persona, undefined, "长".repeat(PERSONA_MAX_CHARS - persona.length - 2)).text);
assert.match(editPersona(persona, undefined, "长".repeat(PERSONA_MAX_CHARS)).error, new RegExp(`at most ${PERSONA_MAX_CHARS}`));
assert.match(editPersona(persona, undefined, "I live in claude  code.").error, /Claude Code/);

// The tool: saves through the host, says when nothing changed, and does nothing while blocked.
const saved = [];
let blocked = null;
let current = persona;
const { edit_persona } = personaTools({ current: () => current, save: (text) => saved.push((current = text)), blocked: () => blocked });
assert.equal(edit_persona.description, EDIT_PERSONA_DESCRIPTION);
assert.ok(!/think/i.test(EDIT_PERSONA_DESCRIPTION), "nothing about thinking in what the model reads");
const run = (input) => edit_persona.execute(input, { toolCallId: "t", messages: [] });
assert.deepEqual(await run({ old_text: "softly", new_text: "warmly" }), { saved: true, characters: 32, note: "It applies from your next reply." });
assert.deepEqual(saved, ["You are Mochi.\n\nYou talk warmly."]);
assert.deepEqual(await run({ old_text: "warmly", new_text: "warmly" }), { saved: false, note: "That changes nothing." });
assert.match((await run({ old_text: "nope", new_text: "x" })).error, /^Not changed: /);
blocked = "Not changed: not while writing a letter.";
assert.deepEqual(await run({ new_text: "x" }), { error: blocked });
assert.equal(saved.length, 1, "only the one change was saved");

console.log("persona-edit: ok");
