export const RUN_SUPERVISOR_LIMITS = Object.freeze({
  max_records: 128,
  max_active_runs: 4,
  max_label_length: 128,
});

const PUBLIC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function publicToken(value, maxLength = 160) {
  return typeof value === "string" && value.length <= maxLength && PUBLIC_TOKEN.test(value)
    ? value
    : null;
}

function normalizedResult(result) {
  return {
    ok: result?.ok === true,
    code: publicToken(result?.code),
    converged: result?.converged === true,
    stop_reason: publicToken(result?.stop_reason),
    resumable: result?.resumable === true,
    terminal_authoritative: result?.terminal_authoritative === true,
    has_run_record: typeof result?.state_path === "string" && result.state_path.length > 0,
  };
}

function publicRecord(record) {
  const result = record.result;
  return {
    run_id: record.run_id,
    label: record.label,
    status: record.status,
    started_at: record.started_at,
    ended_at: record.ended_at,
    last_event: record.last_event == null ? null : { ...record.last_event },
    completion_pending: record.result != null && record.completion_claimed !== true,
    outcome: result == null ? null : {
      ok: result.ok,
      code: result.code,
      converged: result.converged,
      stop_reason: result.stop_reason,
      resumable: result.resumable,
    },
  };
}

function terminal(status) {
  return ["succeeded", "failed", "cancelled", "paused"].includes(status);
}

function resultStatus(result) {
  if (result?.stop_reason === "paused") return result?.ok === false ? "paused" : "failed";
  if (["workflow-run-cancelled", "kernel-run-cancelled", "kernel-effect-cancelled"].includes(result?.code)
    || result?.status === "cancelled" || result?.stop_reason === "cancelled") {
    return result?.ok === false ? "cancelled" : "failed";
  }
  return result?.ok === true ? "succeeded" : "failed";
}

export function createRunSupervisor({ now = Date.now } = {}) {
  const records = new Map();

  const trim = () => {
    if (records.size < RUN_SUPERVISOR_LIMITS.max_records) return;
    const removable = [...records.values()]
      .filter((record) => terminal(record.status))
      .sort((left, right) => left.started_at - right.started_at);
    while (records.size >= RUN_SUPERVISOR_LIMITS.max_records && removable.length > 0) {
      records.delete(removable.shift().run_id);
    }
  };

  const launch = (record, execute, failureCode) => {
    record.completion = Promise.resolve().then(() => execute({
      signal: record.controller.signal,
      onEvent(event) {
        if (event && typeof event === "object" && !Array.isArray(event)) {
          record.last_event = {
            kind: publicToken(event.kind) ?? "unknown",
            node_id: publicToken(event.node_id, 64),
            visit: Number.isSafeInteger(event.visit) ? event.visit : null,
            status: publicToken(event.status),
            code: publicToken(event.code),
          };
        }
      },
    })).then(
      (result) => {
        record.result = normalizedResult(result);
        record.status = resultStatus(result);
        record.ended_at = now();
      },
      () => {
        record.result = {
          ok: false,
          code: failureCode,
          converged: false,
          stop_reason: null,
          resumable: false,
          terminal_authoritative: false,
          has_run_record: false,
        };
        record.status = "failed";
        record.ended_at = now();
      },
    ).then(() => publicRecord(record));
    return record.completion;
  };

  return Object.freeze({
    start({ run_id, label, execute }) {
      if (publicToken(run_id, 256) == null
        || publicToken(label, RUN_SUPERVISOR_LIMITS.max_label_length) == null
        || typeof execute !== "function" || records.has(run_id)) {
        return { ok: false, code: "run-supervisor-start-invalid" };
      }
      const active = [...records.values()].filter((record) => !terminal(record.status)).length;
      if (active >= RUN_SUPERVISOR_LIMITS.max_active_runs) {
        return { ok: false, code: "run-supervisor-capacity-exceeded" };
      }
      trim();
      if (records.size >= RUN_SUPERVISOR_LIMITS.max_records) {
        return { ok: false, code: "run-supervisor-capacity-exceeded" };
      }
      const controller = new AbortController();
      const record = {
        run_id,
        label,
        controller,
        status: "running",
        started_at: now(),
        ended_at: null,
        last_event: null,
        result: null,
        completion_claimed: false,
      };
      records.set(run_id, record);
      launch(record, execute, "helix-runner-failed");
      return { ok: true, code: null, run: publicRecord(record), completion: record.completion };
    },
    resume({ run_id, label, execute }) {
      if (publicToken(run_id, 256) == null
        || publicToken(label, RUN_SUPERVISOR_LIMITS.max_label_length) == null
        || typeof execute !== "function") {
        return { ok: false, code: "run-supervisor-resume-invalid" };
      }
      let record = records.get(run_id);
      if (record && (record.status !== "paused" || record.label !== label)) {
        return { ok: false, code: "run-supervisor-resume-invalid" };
      }
      const active = [...records.values()].filter((entry) => !terminal(entry.status)).length;
      if (active >= RUN_SUPERVISOR_LIMITS.max_active_runs) {
        return { ok: false, code: "run-supervisor-capacity-exceeded" };
      }
      if (!record) {
        trim();
        if (records.size >= RUN_SUPERVISOR_LIMITS.max_records) {
          return { ok: false, code: "run-supervisor-capacity-exceeded" };
        }
        record = {
          run_id,
          label,
          started_at: now(),
          last_event: null,
        };
        records.set(run_id, record);
      }
      record.controller = new AbortController();
      record.status = "running";
      record.ended_at = null;
      record.result = null;
      record.completion_claimed = false;
      launch(record, execute, "helix-resume-failed");
      return { ok: true, code: null, run: publicRecord(record), completion: record.completion };
    },
    list() {
      return [...records.values()]
        .sort((left, right) => right.started_at - left.started_at)
        .map(publicRecord);
    },
    status(runId) {
      const record = records.get(runId);
      return record
        ? { ok: true, code: null, run: publicRecord(record) }
        : { ok: false, code: "run-supervisor-not-found" };
    },
    cancel(runId) {
      const record = records.get(runId);
      if (!record) return { ok: false, code: "run-supervisor-not-found" };
      if (terminal(record.status)) return { ok: true, code: null, run: publicRecord(record), already_closed: true };
      record.status = "cancelling";
      if (!record.controller.signal.aborted) record.controller.abort("workflow-run-cancelled");
      return { ok: true, code: null, run: publicRecord(record), already_closed: false };
    },
    claimCompletion(runId) {
      const record = records.get(runId);
      if (!record || record.result == null || record.completion_claimed) return null;
      record.completion_claimed = true;
      return structuredClone(record.result);
    },
    async shutdown() {
      const completions = [];
      for (const record of records.values()) {
        if (!terminal(record.status) && !record.controller.signal.aborted) {
          record.controller.abort("workflow-run-cancelled");
        }
        if (record.completion) completions.push(record.completion);
      }
      await Promise.allSettled(completions);
    },
  });
}
