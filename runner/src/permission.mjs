// Answers a helper's session/request_permission by the access tier this machine allows, never by what the helper
// or the job text says. Only one-time choices are ever picked, so nothing stays allowed after the turn.
import { realpathSync } from "node:fs";
import path from "node:path";

export const TIERS = ["read", "edit", "full"];
export const tierOf = value => (TIERS.includes(value) ? value : null);
/** The job may ask for less than this machine allows, never more. */
export const lowest = (...tiers) => TIERS[Math.min(...tiers.map(tier => TIERS.indexOf(tier)).filter(i => i >= 0))];

const READ = new Set(["read", "search", "think"]);
const EDIT = new Set([...READ, "edit", "fetch"]);

function inside(root, file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return false;
  let real;
  try { real = realpathSync(file); } // a link out of the folder counts as outside
  catch { try { real = path.join(realpathSync(path.dirname(file)), path.basename(file)); } catch { return false; } } // a new file: check its folder
  const rel = path.relative(realpathSync(root), real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** @returns {{allow: boolean, why: string}} */
export function judge(tier, toolCall, cwd) {
  const kind = typeof toolCall?.kind === "string" ? toolCall.kind : "other";
  if (tier === "full") return { allow: true, why: "" };
  if (READ.has(kind)) return { allow: true, why: "" };
  if (tier === "edit" && EDIT.has(kind)) {
    if (kind !== "edit") return { allow: true, why: "" };
    const files = (toolCall.locations ?? []).map(place => place?.path);
    if (files.length && files.every(file => inside(cwd, file))) return { allow: true, why: "" };
    return { allow: false, why: "编辑的位置不在工作目录里，或没有说明位置" };
  }
  return { allow: false, why: `档位 ${tier} 不允许「${kind}」` };
}

/**
 * The reply for the helper, and what to tell the person when a request was turned down.
 * @returns {{response: object, denied: string|null}}
 */
export function answer(tier, params, cwd) {
  const options = Array.isArray(params?.options) ? params.options : [];
  const pick = kind => options.find(option => option?.kind === kind && typeof option.optionId === "string");
  const { allow, why } = judge(tier, params?.toolCall, cwd);
  const title = String(params?.toolCall?.title ?? params?.toolCall?.kind ?? "一个操作").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120);
  if (allow) {
    const choice = pick("allow_once");
    if (choice) return { response: { outcome: { outcome: "selected", optionId: choice.optionId } }, denied: null };
    return { response: { outcome: { outcome: "cancelled" } }, denied: `${title}（帮手没有给出「只这一次」的选项）` };
  }
  const choice = pick("reject_once");
  return { response: choice ? { outcome: { outcome: "selected", optionId: choice.optionId } } : { outcome: { outcome: "cancelled" } }, denied: `${title}（${why}）` };
}
