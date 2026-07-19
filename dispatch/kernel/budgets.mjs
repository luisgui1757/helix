// Deterministic reservations for workflow effects. Calls are the universal
// hard unit; tokens/cost are enforced only when both workflow and runtime can
// attest them. Post-call accounting never pretends to be a pre-call hard cap.

export function createBudgetLedger({
  max_effects, max_tokens = null, max_cost_micros = null,
  initial_effects = 0, initial_tokens = 0, initial_cost_micros = 0,
} = {}) {
  if (!Number.isSafeInteger(max_effects) || max_effects < 1) throw new Error("kernel-budget-invalid");
  if (max_tokens != null && (!Number.isSafeInteger(max_tokens) || max_tokens < 0)) throw new Error("kernel-budget-invalid");
  if (max_cost_micros != null && (!Number.isSafeInteger(max_cost_micros) || max_cost_micros < 0)) throw new Error("kernel-budget-invalid");
  if (!Number.isSafeInteger(initial_effects) || initial_effects < 0 || initial_effects > max_effects
    || !Number.isSafeInteger(initial_tokens) || initial_tokens < 0
    || !Number.isSafeInteger(initial_cost_micros) || initial_cost_micros < 0) throw new Error("kernel-budget-invalid");
  let effects = initial_effects;
  let tokens = initial_tokens;
  let cost = initial_cost_micros;
  let nextId = 0;
  const reservations = new Map();
  const add = (left, right) => {
    const sum = left + right;
    return Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
  };
  const sum = (values) => {
    let total = 0;
    for (const value of values) {
      total = add(total, value);
      if (total == null) return null;
    }
    return total;
  };
  const validateRequest = (request = {}) => {
    if (request === null || typeof request !== "object" || Array.isArray(request)) return false;
    const { tokens: requestedTokens = 0, cost_micros: requestedCost = 0 } = request;
    return Number.isSafeInteger(requestedTokens) && requestedTokens >= 0
      && Number.isSafeInteger(requestedCost) && requestedCost >= 0;
  };
  const canReserve = (requests) => {
    const projectedEffects = sum([effects, reservations.size, requests.length]);
    const reservedTokens = sum([...reservations.values()].map((entry) => entry.tokens));
    const reservedCost = sum([...reservations.values()].map((entry) => entry.cost_micros));
    const requestedTokens = sum(requests.map((entry) => entry.tokens ?? 0));
    const requestedCost = sum(requests.map((entry) => entry.cost_micros ?? 0));
    const projectedTokens = [reservedTokens, requestedTokens].includes(null) ? null : sum([tokens, reservedTokens, requestedTokens]);
    const projectedCost = [reservedCost, requestedCost].includes(null) ? null : sum([cost, reservedCost, requestedCost]);
    if ([projectedEffects, projectedTokens, projectedCost].includes(null)) {
      return { ok: false, code: "kernel-budget-arithmetic-overflow" };
    }
    return projectedEffects <= max_effects
      && (max_tokens == null || projectedTokens <= max_tokens)
      && (max_cost_micros == null || projectedCost <= max_cost_micros)
      ? { ok: true }
      : { ok: false, code: "kernel-budget-exhausted" };
  };
  const install = (request) => {
    const id = `reservation-${++nextId}`;
    reservations.set(id, { tokens: request.tokens ?? 0, cost_micros: request.cost_micros ?? 0 });
    return { ok: true, id };
  };
  return Object.freeze({
    snapshot() { return { effects, tokens, cost_micros: cost, max_effects, max_tokens, max_cost_micros, reserved: reservations.size }; },
    reserve({ tokens: requestedTokens = 0, cost_micros: requestedCost = 0 } = {}) {
      const request = { tokens: requestedTokens, cost_micros: requestedCost };
      if (!validateRequest(request)) return { ok: false, code: "kernel-budget-reservation-invalid" };
      const allowed = canReserve([request]);
      return allowed.ok ? install(request) : allowed;
    },
    reserveBatch(requests) {
      if (!Array.isArray(requests) || requests.length < 1 || requests.some((request) => !validateRequest(request))) {
        return { ok: false, code: "kernel-budget-reservation-invalid" };
      }
      const allowed = canReserve(requests);
      if (!allowed.ok) return allowed;
      return { ok: true, reservations: requests.map(install) };
    },
    consume(id) {
      if (!reservations.has(id)) return { ok: false, code: "kernel-budget-commit-invalid" };
      reservations.delete(id);
      effects += 1;
      return { ok: true };
    },
    revertConsume() {
      if (effects < 1) return { ok: false, code: "kernel-budget-commit-invalid" };
      effects -= 1;
      return { ok: true };
    },
    account({ tokens: actualTokens = 0, cost_micros: actualCost = 0 } = {}) {
      if (!Number.isSafeInteger(actualTokens) || actualTokens < 0
        || !Number.isSafeInteger(actualCost) || actualCost < 0) {
        return { ok: false, code: "kernel-budget-commit-invalid" };
      }
      const nextTokens = add(tokens, actualTokens);
      const nextCost = add(cost, actualCost);
      if (nextTokens == null || nextCost == null) return { ok: false, code: "kernel-budget-arithmetic-overflow" };
      tokens = nextTokens;
      cost = nextCost;
      const overshoot = (max_tokens != null && nextTokens > max_tokens) || (max_cost_micros != null && nextCost > max_cost_micros);
      return overshoot ? { ok: false, code: "kernel-budget-provider-overshoot" } : { ok: true };
    },
    revertAccount({ tokens: actualTokens = 0, cost_micros: actualCost = 0 } = {}) {
      if (!Number.isSafeInteger(actualTokens) || actualTokens < 0
        || !Number.isSafeInteger(actualCost) || actualCost < 0
        || actualTokens > tokens || actualCost > cost) {
        return { ok: false, code: "kernel-budget-commit-invalid" };
      }
      tokens -= actualTokens;
      cost -= actualCost;
      return { ok: true };
    },
    commit(id, { tokens: actualTokens = 0, cost_micros: actualCost = 0 } = {}) {
      if (!reservations.has(id) || !Number.isSafeInteger(actualTokens) || actualTokens < 0
        || !Number.isSafeInteger(actualCost) || actualCost < 0) return { ok: false, code: "kernel-budget-commit-invalid" };
      const nextEffects = add(effects, 1);
      const nextTokens = add(tokens, actualTokens);
      const nextCost = add(cost, actualCost);
      if (nextEffects == null || nextTokens == null || nextCost == null) {
        return { ok: false, code: "kernel-budget-arithmetic-overflow" };
      }
      reservations.delete(id);
      effects = nextEffects;
      tokens = nextTokens;
      cost = nextCost;
      const overshoot = (max_tokens != null && nextTokens > max_tokens) || (max_cost_micros != null && nextCost > max_cost_micros);
      return overshoot ? { ok: false, code: "kernel-budget-provider-overshoot" } : { ok: true };
    },
    release(id) { return reservations.delete(id); },
  });
}
