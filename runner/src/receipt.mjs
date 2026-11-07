// Receipts must stay inside the protocol's 16 KB request limit, or the resident refuses the whole result.
// Long text is cut (never the receipt dropped), counted in the bytes the request really has.
export const RECEIPT_MAX_BYTES = 15_000;
export const RESOLVE_MAX = 50;
const bytes = value => Buffer.byteLength(JSON.stringify(value));

function cut(text, by) {
  let out = text.slice(0, Math.max(0, text.length - by - 1));
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1); // not in the middle of a character
  return out + "…";
}

/** The same receipt with its longest text shortened until it fits in `max` bytes. */
export function fit(receipt, max = RECEIPT_MAX_BYTES) {
  const out = structuredClone(receipt);
  if (out.resolve) out.resolve = out.resolve.slice(0, RESOLVE_MAX);
  for (let round = 0; round < 60 && bytes(out) > max; round++) {
    const excess = bytes(out) - max, summary = out.summary?.length ?? 0, question = out.ask?.question?.length ?? 0;
    if (summary < 2 && question < 2) break;
    const by = Math.ceil(excess / 3) + 4; // a Chinese character is 3 bytes
    if (summary >= question) out.summary = cut(out.summary, by); else out.ask.question = cut(out.ask.question, by);
  }
  return out;
}

/** After the resident answered 413: half the size, or null when there is nothing left to cut. */
export function shrink(receipt) {
  const size = bytes(receipt);
  if (size < 700) return null;
  const smaller = fit(receipt, Math.floor(size / 2));
  return bytes(smaller) < size ? smaller : null;
}
