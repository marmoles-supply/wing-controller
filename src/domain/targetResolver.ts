export type TargetResolverFn = (target: any) => string[] | null | undefined;

export type TargetResolutionReport = {
  label: string;
  target: any;
  addresses: string[];
  meterAddresses: string[];
  errors: string[];
  warnings: string[];
};

const uniqueStrings = (items: unknown[]): string[] => (
  Array.from(new Set(
    items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  ))
);

const normalizeResolvedAddresses = (raw: string[] | null | undefined): string[] => (
  uniqueStrings(Array.isArray(raw) ? raw : [])
);

export const validateCustomOscTarget = (target: any, label: string, errors: string[], warnings: string[]) => {
  if (!target || target.type !== 'custom') return;
  const address = String(target.customAddress || '').trim();
  if (!address) {
    errors.push(`${label}: Custom OSC address is required.`);
    return;
  }
  if (!address.startsWith('/')) {
    errors.push(`${label}: Custom OSC address must start with "/".`);
  }
  if (/\s/.test(address)) {
    errors.push(`${label}: Custom OSC address cannot contain spaces.`);
  }
  if (address.length > 96) {
    warnings.push(`${label}: Custom OSC address is unusually long; verify it on the console before relying on it live.`);
  }
};

export const resolveTargetReport = (
  target: any,
  label: string,
  resolveAddresses: TargetResolverFn,
): TargetResolutionReport => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!target) {
    errors.push(`${label}: Target is required.`);
    return { label, target, addresses: [], meterAddresses: [], errors, warnings };
  }

  validateCustomOscTarget(target, label, errors, warnings);

  if (target.type !== 'custom' && !String(target.ids || '').trim()) {
    errors.push(`${label}: Select at least one target object.`);
  }

  const addresses = errors.length === 0
    ? normalizeResolvedAddresses(resolveAddresses(target))
    : [];

  if (errors.length === 0 && addresses.length === 0) {
    errors.push(`${label}: Target does not resolve to any OSC address.`);
  }

  return {
    label,
    target,
    addresses,
    meterAddresses: addresses.filter((address) => address.startsWith('/meters/')),
    errors,
    warnings,
  };
};

export const collectMacroTargetResolutionReport = (
  draft: any,
  resolveAddresses: TargetResolverFn,
): {
  targets: TargetResolutionReport[];
  readAddresses: string[];
  writeAddresses: string[];
  meterAddresses: string[];
  errors: string[];
  warnings: string[];
} => {
  const targets: TargetResolutionReport[] = [];
  const writeAddresses: string[] = [];
  const readAddresses: string[] = [];
  const meterAddresses: string[] = [];

  const addTarget = (target: any, label: string, mode: 'read' | 'write') => {
    const report = resolveTargetReport(target, label, resolveAddresses);
    targets.push(report);
    if (mode === 'read') readAddresses.push(...report.addresses);
    if (mode === 'write') writeAddresses.push(...report.addresses);
    meterAddresses.push(...report.meterAddresses);
  };

  if (draft?.triggerType === 'console') {
    addTarget(draft?.triggerTarget, 'Trigger', 'read');
  }

  (draft?.conditions || []).forEach((cond: any, index: number) => {
    addTarget(cond?.target, `Rule #${index + 1}`, 'read');
  });

  (draft?.actions || []).forEach((action: any, index: number) => {
    if (action?.type === 'delay' || action?.type === 'automization_control') return;
    if (action?.type === 'automation_cue' || action?.type === 'fade' || !action?.type || action?.type === 'osc') {
      addTarget(action?.target, `Action #${index + 1}`, 'write');
    }
  });

  return {
    targets,
    readAddresses: uniqueStrings(readAddresses),
    writeAddresses: uniqueStrings(writeAddresses),
    meterAddresses: uniqueStrings(meterAddresses),
    errors: targets.flatMap((report) => report.errors),
    warnings: targets.flatMap((report) => report.warnings),
  };
};
