// The resident changing its own persona (edit_persona, when PERSONA_EDIT is on). It is the persona the web page
// edits, saved the same way (Resident.savePersona): they see the new one on the 人设 page, with the one before it
// among the earlier versions, ready to bring back. A change applies from the next reply: Think reads the system
// prompt once at the start of a turn.
import { tool, type ToolSet } from "ai";
import { z } from "zod";

export const PERSONA_MAX_CHARS = 30000;

export const EDIT_PERSONA_DESCRIPTION =
  "Change your persona: the text your system prompt starts with, before the chat rules. They see the change on the " +
  "web page and can undo it there. Give old_text, copied exactly from your persona, and new_text to put in its " +
  "place (empty removes it); leave out old_text to add new_text at the end. It applies from your next reply.";

export type PersonaHost = {
  /** The persona in use: the one saved, or the default line. */
  current(): string;
  save(text: string): void;
  /** Why it cannot be changed from here (a letter being written), or null. */
  blocked(): string | null;
};

/** The persona after one edit, or why it cannot be made. */
export function editPersona(current: string, oldText: string | undefined, newText: string): { text: string } | { error: string } {
  let text: string;
  if (!oldText) {
    if (!newText.trim()) return { error: "new_text is empty: nothing to add." };
    text = `${current.trimEnd()}\n\n${newText.trim()}`;
  } else {
    const at = current.indexOf(oldText);
    if (at < 0) return { error: "old_text is not in your persona. Copy it exactly, or leave it out to add to the end." };
    if (current.indexOf(oldText, at + 1) >= 0) return { error: "old_text is in your persona more than once. Copy a longer piece of it." };
    text = current.slice(0, at) + newText + current.slice(at + oldText.length);
  }
  text = text.trim();
  if (!text) return { error: "That would leave your persona empty." };
  if (text.length > PERSONA_MAX_CHARS) return { error: `That makes it ${text.length} characters; at most ${PERSONA_MAX_CHARS}.` };
  // The web page warns about this too: with the API key that comes with Max, every request would be refused.
  if (/claude\s*code/i.test(text)) return { error: 'Some Claude API keys refuse every request with "Claude Code" in it. Put it another way.' };
  return { text };
}

export function personaTools(host: PersonaHost): ToolSet {
  return {
    edit_persona: tool({
      description: EDIT_PERSONA_DESCRIPTION,
      inputSchema: z.object({
        old_text: z.string().optional().describe("A piece of your persona, exactly as it is written."),
        new_text: z.string().describe("What goes in its place, or at the end.")
      }),
      execute: async ({ old_text, new_text }) => {
        const blocked = host.blocked();
        if (blocked) return { error: blocked };
        const current = host.current();
        const edited = editPersona(current, old_text, new_text);
        if ("error" in edited) return { error: `Not changed: ${edited.error}` };
        if (edited.text === current.trim()) return { saved: false, note: "That changes nothing." };
        host.save(edited.text);
        return { saved: true, characters: edited.text.length, note: "It applies from your next reply." };
      }
    })
  };
}
