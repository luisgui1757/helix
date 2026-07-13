// Helix dispatch — prompt compiler.
//
// Step prompts compile from SOURCE-CONTROLLED templates + the role's tracked
// brief + the task envelope + the handoff packet. Records and events persist
// the template id and INPUT HASHES — never the compiled text. Compiled prompts
// exist only in memory as adapter input; there is no debug persistence escape
// hatch because raw prompts are forbidden from every persisted surface.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hashRef } from "./run-record.mjs";

export const COMPILER_CODES = Object.freeze({
  TEMPLATE_MISSING: "prompt-template-missing",
  BRIEF_MISSING: "role-brief-missing",
  PLACEHOLDER_UNRESOLVED: "prompt-placeholder-unresolved",
});

const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Compile one step prompt.
 *
 * @param {object} args
 * @param {string} args.template_id e.g. "step-prompt-v1"
 * @param {string} args.templates_dir tracked templates directory
 * @param {string} args.briefs_dir tracked role-brief directory
 * @param {string} args.role dispatch role (brief = `${briefs_dir}/${role}.md`)
 * @param {object} args.fields { chain_id, stage_id, pass, gate_summary,
 *   task_instruction, handoff } — every {{placeholder}} must resolve
 * @returns {{ok:true, prompt:string, record:{template_id, template_hash,
 *   brief_ref, input_hashes:object}} | {ok:false, code, detail}}
 */
export function compileStepPrompt(args) {
  const { template_id, templates_dir, briefs_dir, role, fields = {} } = args ?? {};
  if (typeof template_id !== "string" || !TEMPLATE_ID_PATTERN.test(template_id)) {
    return { ok: false, code: COMPILER_CODES.TEMPLATE_MISSING, detail: "template-id-invalid" };
  }
  const templatePath = join(templates_dir ?? "", `${template_id}.md`);
  if (!existsSync(templatePath)) return { ok: false, code: COMPILER_CODES.TEMPLATE_MISSING, detail: template_id };
  const briefPath = join(briefs_dir ?? "", `${role}.md`);
  if (!existsSync(briefPath)) return { ok: false, code: COMPILER_CODES.BRIEF_MISSING, detail: String(role) };

  const template = readFileSync(templatePath, "utf8");
  const brief = readFileSync(briefPath, "utf8");

  const resolved = { role_brief: brief, ...fields };
  let prompt = template;
  for (const [key, value] of Object.entries(resolved)) {
    prompt = prompt.split(`{{${key}}}`).join(String(value ?? ""));
  }
  const unresolved = prompt.match(/\{\{[a-z_]+\}\}/);
  if (unresolved) {
    return { ok: false, code: COMPILER_CODES.PLACEHOLDER_UNRESOLVED, detail: unresolved[0].replace(/[{}]/g, "") };
  }

  // Structural record: template identity + input hashes, never compiled text.
  const input_hashes = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, hashRef(String(value ?? ""))]),
  );
  const record = {
    template_id,
    template_hash: hashRef(template),
    brief_ref: hashRef(brief),
    input_hashes,
  };

  return { ok: true, prompt, record };
}
