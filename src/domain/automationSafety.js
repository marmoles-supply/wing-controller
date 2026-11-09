const uniqueAddresses = (addresses) => Array.from(new Set(
  (Array.isArray(addresses) ? addresses : [])
    .filter((address) => typeof address === 'string' && address.length > 0)
));

export const MAX_AUTOMATION_COMMANDS_PER_SECOND = 200;

export const buildAutomationFleetPreflight = (automations, resolveAddresses) => {
  /** @type {Record<string, string[]>} */
  const errorsById = {};
  const addError = (id, message) => {
    if (!errorsById[id]) errorsById[id] = [];
    if (!errorsById[id].includes(message)) errorsById[id].push(message);
  };
  const enabled = (Array.isArray(automations) ? automations : []).filter((item) => item?.enabled === true);
  const sourcesById = new Map();
  const targetsById = new Map();
  const targetOwners = new Map();
  const adjacency = new Map();
  const projectedRateById = new Map();

  enabled.forEach((automation) => {
    const sources = uniqueAddresses(resolveAddresses(automation.sourceTarget));
    const targets = uniqueAddresses(
      (Array.isArray(automation.targetItems) ? automation.targetItems : []).flatMap((item) =>
        uniqueAddresses(resolveAddresses(item?.target))
          .filter((address) => !address.startsWith('/meters/'))
      )
    );
    sourcesById.set(automation.id, sources);
    targetsById.set(automation.id, targets);
    const responseMs = Math.max(20, Math.min(2000, Number(automation.responseMs) || 50));
    const projectedRate = targets.length * (1000 / responseMs);
    projectedRateById.set(automation.id, projectedRate);
    if (projectedRate > MAX_AUTOMATION_COMMANDS_PER_SECOND) {
      addError(
        automation.id,
        `Projected command rate ${Math.ceil(projectedRate)}/s exceeds the safe limit ${MAX_AUTOMATION_COMMANDS_PER_SECOND}/s. Increase response time or reduce targets.`,
      );
    }

    targets.forEach((target) => {
      if (!targetOwners.has(target)) targetOwners.set(target, new Set());
      targetOwners.get(target).add(automation.id);
    });
    sources.forEach((source) => {
      if (!adjacency.has(source)) adjacency.set(source, new Set());
      targets.forEach((target) => adjacency.get(source).add(target));
    });
    if (sources.some((source) => targets.includes(source))) {
      addError(automation.id, 'Source and target resolve to the same address.');
    }
  });

  targetOwners.forEach((owners, address) => {
    if (owners.size < 2) return;
    owners.forEach((id) => addError(id, `Target conflict: multiple enabled automations write ${address}.`));
  });

  const hasPath = (start, goal, visited = new Set()) => {
    if (start === goal) return true;
    if (visited.has(start)) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(start);
    return Array.from(adjacency.get(start) || []).some((next) => hasPath(next, goal, nextVisited));
  };

  enabled.forEach((automation) => {
    const sources = sourcesById.get(automation.id) || [];
    const targets = targetsById.get(automation.id) || [];
    if (sources.some((source) => targets.some((target) => target !== source && hasPath(target, source)))) {
      addError(automation.id, 'Automation cycle detected. Enabled mappings would feed back into each other.');
    }
  });

  const fleetProjectedRate = Array.from(projectedRateById.values())
    .reduce((total, rate) => total + rate, 0);
  if (fleetProjectedRate > MAX_AUTOMATION_COMMANDS_PER_SECOND) {
    enabled.forEach((automation) => {
      addError(
        automation.id,
        `Combined enabled automations project ${Math.ceil(fleetProjectedRate)} commands/s; safe fleet limit is ${MAX_AUTOMATION_COMMANDS_PER_SECOND}/s.`,
      );
    });
  }

  return { errorsById, projectedCommandsPerSecond: Math.ceil(fleetProjectedRate) };
};

export default { buildAutomationFleetPreflight };
