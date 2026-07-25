import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { searchFiles } from "./lib/helix-file-search.mjs";
import { createProcessSupervisor } from "./lib/helix-process-supervisor.mjs";
import {
  piToolTurnJournal,
  resetPiToolTurnJournal,
} from "./lib/helix-tool-journal.mjs";

const FileSearchParams = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 512, description: "Literal text to find" },
    path: { type: "string", minLength: 1, maxLength: 1_024, description: "Repository-relative file or directory; default ." },
    case_sensitive: { type: "boolean", description: "Use exact case; default true" },
    extensions: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 32 },
      description: "Optional file suffix allowlist",
    },
    max_results: { type: "integer", minimum: 1, maximum: 200 },
  },
});

const ProcessStartParams = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["executable"],
  properties: {
    executable: { type: "string", minLength: 1, maxLength: 1_024, description: "Absolute executable or name resolved from fixed system roots" },
    args: {
      type: "array",
      maxItems: 64,
      items: { type: "string", maxLength: 4_096 },
      description: "Literal argv entries; the supervisor performs no shell parsing",
    },
    cwd: { type: "string", minLength: 1, maxLength: 1_024, description: "Repository-relative working directory; default ." },
    timeout_ms: { type: "integer", minimum: 1_000, maximum: 3_600_000 },
  },
});

const ProcessIdParams = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^proc-[0-9a-f]{16}$",
      description: "Opaque process id returned by helix_process_start",
    },
  },
});

function toolResult(value: any) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: value,
  };
}

async function executeJournaled(
  journal: any,
  { id, tool, params, execute, rollback }: {
    id: string;
    tool: string;
    params: any;
    execute: () => Promise<any> | any;
    rollback?: (details: any) => Promise<void> | void;
  },
) {
  const intent = journal.start({ tool_call_id: id, tool, args: params });
  if (!intent.ok) return toolResult({ ok: false, code: intent.code });
  let result;
  let status = "ok";
  try {
    result = await execute();
    if (result?.details?.ok === false) status = "refused";
  } catch {
    status = "failed";
    result = toolResult({ ok: false, code: "helix-tool-execution-failed" });
  }
  const settled = journal.settle({
    tool_call_id: id,
    tool,
    intent_token: intent.intent_token,
    result: result?.details,
    status,
  });
  if (!settled.ok) {
    await rollback?.(result?.details);
    return toolResult({ ok: false, code: settled.code });
  }
  return result;
}

export default function helixTools(pi: ExtensionAPI) {
  let processes = createProcessSupervisor();
  const lifecycle = { closing: false, generation: 0 };
  const journal = piToolTurnJournal(pi);

  pi.on("session_start", async () => {
    const generation = lifecycle.generation + 1;
    lifecycle.generation = generation;
    lifecycle.closing = true;
    const previousSupervisor = processes;
    const closed = await previousSupervisor.shutdown();
    if (lifecycle.generation !== generation) return;
    if (!closed.ok) throw new Error("helix-process-session-cleanup-failed");
    processes = createProcessSupervisor();
    resetPiToolTurnJournal(pi);
    lifecycle.closing = false;
  });
  pi.on("session_shutdown", async () => {
    lifecycle.generation += 1;
    lifecycle.closing = true;
    const closingSupervisor = processes;
    const closed = await closingSupervisor.shutdown();
    if (!closed.ok) throw new Error("helix-process-session-cleanup-failed");
  });

  pi.registerTool({
    name: "helix_file_search",
    label: "Helix File Search",
    description:
      "Search literal text in bounded regular files under the current repository. " +
      "Returns structured path, line, column, and preview records; never follows symlinks.",
    promptSnippet: "Bounded, structured literal repository search.",
    parameters: FileSearchParams,
    executionMode: "parallel",
    async execute(id: string, params: any, _signal: unknown, _update: unknown, ctx: { cwd: string }) {
      return executeJournaled(journal, {
        id,
        tool: "helix_file_search",
        params,
        execute: () => toolResult(searchFiles({ root: ctx.cwd, ...params })),
      });
    },
  });

  pi.registerTool({
    name: "helix_process_start",
    label: "Helix Process Start",
    description:
      "Start one explicitly approved session-scoped argv-only process in the repository. " +
      "The supervisor performs no implicit shell parsing and passes no ambient credentials, inherited environment, or outside cwd.",
    promptSnippet: "Start an attended, bounded background process after user confirmation.",
    parameters: ProcessStartParams,
    executionMode: "sequential",
    async execute(id: string, params: any, signal: AbortSignal, _update: unknown, ctx: any) {
      const generation = lifecycle.generation;
      const supervisor = processes;
      return executeJournaled(journal, {
        id,
        tool: "helix_process_start",
        params,
        async execute() {
          if (signal?.aborted || lifecycle.closing || lifecycle.generation !== generation) {
            return toolResult({ ok: false, code: "process-start-cancelled" });
          }
          if (ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") {
            return toolResult({ ok: false, code: "process-start-requires-attended-confirmation" });
          }
          const args = Array.isArray(params.args) ? params.args : [];
          const approved = await ctx.ui.confirm(
            "Start supervised process?",
            `Executable: ${params.executable}\nArguments: ${JSON.stringify(args)}\nWorking directory: ${params.cwd ?? "."}`,
          );
          if (!approved) return toolResult({ ok: false, code: "process-start-cancelled" });
          if (signal?.aborted || lifecycle.closing || lifecycle.generation !== generation) {
            return toolResult({ ok: false, code: "process-start-cancelled" });
          }
          return toolResult(supervisor.start({ root: ctx.cwd, ...params }));
        },
        async rollback(details) {
          if (details?.ok === true && typeof details.process?.id === "string") {
            await supervisor.stop(details.process.id);
          }
        },
      });
    },
  });

  pi.registerTool({
    name: "helix_process_status",
    label: "Helix Process Status",
    description: "Read status and bounded combined output for one session-scoped supervised process.",
    parameters: ProcessIdParams,
    executionMode: "parallel",
    async execute(id: string, params: any) {
      return executeJournaled(journal, {
        id,
        tool: "helix_process_status",
        params,
        execute: () => toolResult(processes.status(params.id)),
      });
    },
  });

  pi.registerTool({
    name: "helix_process_stop",
    label: "Helix Process Stop",
    description: "Stop one session-scoped supervised process and confirm process-group closure.",
    parameters: ProcessIdParams,
    executionMode: "sequential",
    async execute(id: string, params: any) {
      return executeJournaled(journal, {
        id,
        tool: "helix_process_stop",
        params,
        execute: async () => toolResult(await processes.stop(params.id)),
      });
    },
  });
}
