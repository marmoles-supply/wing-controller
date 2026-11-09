export type TargetType = 'fixed' | 'selected' | 'custom';

export type TargetSubCategory =
  | 'mix'
  | 'preamp'
  | 'filters'
  | 'eq'
  | 'dynamics'
  | 'sends'
  | 'routing'
  | 'library'
  | 'groups';

export type TargetParameterOption = {
  key: string;
  label: string;
};

export type TargetCategoryItem = {
  key: string;
  label: string;
  count: number;
  prefix: string;
};

export type TargetCategoryGroup = {
  title: string;
  color: string;
  items: TargetCategoryItem[];
};

export type TargetCategoryDetails = TargetCategoryItem & {
  groupColor: string;
};

export const MIX_CATEGORY_KEYS = ['ch', 'bus', 'aux', 'main', 'matrix'] as const;
export type MixCategoryKey = (typeof MIX_CATEGORY_KEYS)[number];
export const SELECTED_TARGET_CATEGORY = 'selected_mix';

const ALL_CATEGORY_GROUPS: TargetCategoryGroup[] = [
  {
    title: 'MIX CHANNELS',
    color: '#FFB357',
    items: [
      { key: 'ch', label: 'CHANNELS', count: 40, prefix: 'CH' },
      { key: 'bus', label: 'BUSES', count: 16, prefix: 'BUS' },
      { key: 'aux', label: 'AUX IN', count: 8, prefix: 'AUX' },
      { key: 'main', label: 'MAINS', count: 4, prefix: 'MAIN' },
      { key: 'matrix', label: 'MATRICES', count: 8, prefix: 'MTX' },
    ],
  },
  {
    title: 'AUDIO SOURCES & CARD',
    color: '#FF9800',
    items: [
      { key: 'preamp_local', label: 'LOCAL IN', count: 24, prefix: 'LOCAL' },
      { key: 'preamp_aux', label: 'AUX IN SRC', count: 8, prefix: 'AUX' },
      { key: 'preamp_aes50a', label: 'AES50-A', count: 48, prefix: 'AES-A' },
      { key: 'preamp_aes50b', label: 'AES50-B', count: 48, prefix: 'AES-B' },
      { key: 'preamp_aes50c', label: 'AES50-C', count: 48, prefix: 'AES-C' },
      { key: 'preamp_stageconnect', label: 'STAGE CONNECT', count: 32, prefix: 'SC' },
      { key: 'preamp_card', label: 'CARD IN', count: 64, prefix: 'CRD' },
      { key: 'preamp_module', label: 'MODULE IN', count: 64, prefix: 'MOD' },
      { key: 'preamp_usbplayer', label: 'USB PLAYER IN', count: 4, prefix: 'PLY' },
      { key: 'preamp_aesebu', label: 'AES/EBU IN', count: 2, prefix: 'AES' },
      { key: 'usb', label: 'LOCAL USB', count: 48, prefix: 'USB' },
      { key: 'preamp_oscillator', label: 'OSCILLATOR', count: 2, prefix: 'OSC' },
      { key: 'preamp_bus', label: 'BUS SOURCES', count: 32, prefix: 'BUS' },
      { key: 'preamp_main', label: 'MAIN SOURCES', count: 8, prefix: 'MAIN' },
      { key: 'preamp_matrix', label: 'MATRIX SOURCES', count: 16, prefix: 'MTX' },
    ],
  },
  {
    title: 'AUDIO OUTPUTS',
    color: '#C9A24B',
    items: [
      { key: 'output_local', label: 'LOCAL OUT', count: 8, prefix: 'LOUT' },
      { key: 'output_aux', label: 'AUX OUT', count: 8, prefix: 'AUXO' },
      { key: 'output_aes50a', label: 'AES50-A OUT', count: 48, prefix: 'AESA' },
      { key: 'output_aes50b', label: 'AES50-B OUT', count: 48, prefix: 'AESB' },
      { key: 'output_aes50c', label: 'AES50-C OUT', count: 48, prefix: 'AESC' },
      { key: 'output_stageconnect', label: 'STAGE CONNECT OUT', count: 32, prefix: 'SCO' },
      { key: 'output_usb', label: 'USB AUDIO OUT', count: 48, prefix: 'USBO' },
      { key: 'output_card', label: 'CARD OUT', count: 64, prefix: 'CARD' },
      { key: 'output_module', label: 'MODULE OUT', count: 64, prefix: 'MOD' },
      { key: 'output_usbrec', label: 'USB REC OUT', count: 4, prefix: 'USBR' },
      { key: 'output_aesebu', label: 'AES/EBU OUT', count: 2, prefix: 'AES' },
    ],
  },
  {
    title: 'SYSTEM, USER & DCAs',
    color: '#B5836A',
    items: [
      { key: 'dca', label: 'DCAs', count: 8, prefix: 'DCA' },
      { key: 'mutegroup', label: 'MUTE GRP', count: 8, prefix: 'MUTE GRP' },
      { key: 'fx', label: 'FX SLOT', count: 16, prefix: 'FX' },
      { key: 'usersig', label: 'USER SIGNALS', count: 48, prefix: 'USR' },
      { key: 'userctrl', label: 'USER CONTROLS', count: 8, prefix: 'USR BTN' },
      { key: 'monitor', label: 'MONITOR METERS', count: 6, prefix: 'MON' },
      { key: 'rta', label: 'RTA BANDS', count: 120, prefix: 'RTA' },
    ],
  },
];

const X32_CATEGORY_GROUPS: TargetCategoryGroup[] = [
  {
    title: 'X32 / M32 MIX OBJECTS',
    color: '#FF9500',
    items: ALL_CATEGORY_GROUPS[0].items.filter((item) =>
      ['ch', 'bus', 'aux', 'main', 'matrix'].includes(item.key),
    ),
  },
  {
    title: 'X32 / M32 GROUPS',
    color: '#FF9500',
    items: ALL_CATEGORY_GROUPS[3].items.filter((item) => item.key === 'dca'),
  },
];

const DEFAULT_CATEGORY_DETAILS: TargetCategoryDetails = {
  key: 'ch',
  label: 'CHANNELS',
  count: 40,
  prefix: 'CH',
  groupColor: '#FFB357',
};

const X32_COUNTS: Record<string, number> = {
  ch: 32,
  bus: 16,
  aux: 8,
  main: 1,
  matrix: 6,
  dca: 8,
};

const WING_MIX_SUB_CATEGORIES: Record<string, TargetSubCategory[]> = {
  ch: ['mix', 'preamp', 'filters', 'eq', 'dynamics', 'sends', 'routing', 'groups', 'library'],
  aux: ['mix', 'preamp', 'filters', 'eq', 'dynamics', 'sends', 'routing', 'groups', 'library'],
  bus: ['mix', 'filters', 'eq', 'dynamics', 'sends', 'routing', 'groups', 'library'],
  main: ['mix', 'filters', 'eq', 'dynamics', 'routing', 'groups', 'library'],
  matrix: ['mix', 'filters', 'eq', 'dynamics', 'routing', 'groups', 'library'],
};

const SELECTED_SUB_CATEGORY_WHITELIST: TargetSubCategory[] = ['mix', 'preamp', 'filters', 'eq', 'dynamics', 'sends', 'routing'];
const SELECTED_SUB_CATEGORIES_CONSERVATIVE: TargetSubCategory[] = ['mix', 'filters', 'eq', 'dynamics', 'routing'];
const X32_MIX_SUB_CATEGORIES: TargetSubCategory[] = ['mix', 'sends'];

const WING_MIX_PARAMETERS: Record<TargetSubCategory, TargetParameterOption[]> = {
  mix: [
    { key: 'mute', label: 'Mute/Unmute' },
    { key: 'fader', label: 'Volume (Fader)' },
    { key: 'pan', label: 'Pan (L/R)' },
    { key: 'meter', label: 'Audio Level Meter (dB)' },
    { key: 'meter_v2_gate_led', label: 'Gate LED State (V2)' },
    { key: 'meter_v2_dyn_state', label: 'Dyn Active State (V2)' },
    { key: 'meter_v2_automix', label: 'Automix Gain (V2 dB)' },
  ],
  preamp: [
    { key: 'gain', label: 'Preamp Gain / Trim (dB)' },
    { key: 'phantom_48v', label: 'Phantom Power (+48V)' },
    { key: 'phase', label: 'Phase Invert (Pol)' },
  ],
  filters: [
    { key: 'hpf_on', label: 'HPF On/Off' },
    { key: 'hpf_freq', label: 'HPF Frequency (Hz)' },
    { key: 'lpf_on', label: 'LPF On/Off' },
    { key: 'lpf_freq', label: 'LPF Frequency (Hz)' },
  ],
  eq: [
    { key: 'eq_on', label: 'EQ Bypass On/Off' },
    { key: 'eq_1_gain', label: 'Band 1 Low Gain (dB)' },
    { key: 'eq_1_freq', label: 'Band 1 Low Freq (Hz)' },
    { key: 'eq_1_q', label: 'Band 1 Low Q (Width)' },
    { key: 'eq_2_gain', label: 'Band 2 LoMid Gain (dB)' },
    { key: 'eq_2_freq', label: 'Band 2 LoMid Freq (Hz)' },
    { key: 'eq_2_q', label: 'Band 2 LoMid Q (Width)' },
    { key: 'eq_3_gain', label: 'Band 3 Mid Gain (dB)' },
    { key: 'eq_3_freq', label: 'Band 3 Mid Freq (Hz)' },
    { key: 'eq_3_q', label: 'Band 3 Mid Q (Width)' },
    { key: 'eq_4_gain', label: 'Band 4 HiMid Gain (dB)' },
    { key: 'eq_4_freq', label: 'Band 4 HiMid Freq (Hz)' },
    { key: 'eq_4_q', label: 'Band 4 HiMid Q (Width)' },
    { key: 'eq_5_gain', label: 'Band 5 High Gain (dB)' },
    { key: 'eq_5_freq', label: 'Band 5 High Freq (Hz)' },
    { key: 'eq_5_q', label: 'Band 5 High Q (Width)' },
    { key: 'eq_6_gain', label: 'Band 6 Air Gain (dB)' },
    { key: 'eq_6_freq', label: 'Band 6 Air Freq (Hz)' },
    { key: 'eq_6_q', label: 'Band 6 Air Q (Width)' },
  ],
  dynamics: [
    { key: 'gate_on', label: 'Noise Gate On/Off' },
    { key: 'gate_thr', label: 'Gate Threshold (dB)' },
    { key: 'gate_range', label: 'Gate Range (dB)' },
    { key: 'gate_attack', label: 'Gate Attack time (ms)' },
    { key: 'gate_release', label: 'Gate Release time (ms)' },
    { key: 'gate_type', label: 'Gate Model (Gate/Exp/Duck)' },
    { key: 'comp_on', label: 'Compressor On/Off' },
    { key: 'comp_thr', label: 'Compressor Threshold (dB)' },
    { key: 'comp_ratio', label: 'Compressor Ratio (:1)' },
    { key: 'comp_attack', label: 'Compressor Attack (ms)' },
    { key: 'comp_release', label: 'Compressor Release (ms)' },
    { key: 'comp_knee', label: 'Compressor Knee (0-5)' },
    { key: 'comp_makeup', label: 'Compressor Makeup Gain (dB)' },
    { key: 'comp_type', label: 'Comp Model (Comp/Lim/Exp)' },
  ],
  sends: [
    { key: 'send_level', label: 'Mix Bus Send Level (dB)' },
    { key: 'send_on', label: 'Mix Bus Send On/Off' },
    { key: 'fx_mix', label: 'FX Wet/Dry Mix (%)' },
  ],
  routing: [{ key: 'insert_on', label: 'Pre-Insert On/Off' }],
  library: [
    { key: 'load_snapshot', label: 'Recall Console Snapshot' },
    { key: 'load_preset', label: 'Recall Channel Preset' },
  ],
  groups: [
    { key: 'mute_group', label: 'Mute Group (1-8) On/Off' },
    { key: 'mute', label: 'DCA Mute' },
    { key: 'fader', label: 'DCA Volume (Fader)' },
  ],
};

const WING_PREAMP_GAIN_CAPABLE = new Set(['preamp_local', 'preamp_aes50a', 'preamp_aes50b', 'preamp_aes50c']);
const MIX_CATEGORY_SET = new Set<string>([...MIX_CATEGORY_KEYS, SELECTED_TARGET_CATEGORY]);
const normalizeSelectedMixFamily = (family?: string | null): MixCategoryKey | null =>
  MIX_CATEGORY_KEYS.includes(family as MixCategoryKey) ? (family as MixCategoryKey) : null;

export const getAvailableCategoryGroups = (consoleFamily?: string): TargetCategoryGroup[] =>
  consoleFamily === 'x32-family' ? X32_CATEGORY_GROUPS : ALL_CATEGORY_GROUPS;

export const getAvailableCategoryKeys = (consoleFamily?: string): Set<string> =>
  new Set(getAvailableCategoryGroups(consoleFamily).flatMap((group) => group.items.map((item) => item.key)));

const getBaseCategoryDetails = (categoryKey: string): TargetCategoryDetails => {
  for (const group of ALL_CATEGORY_GROUPS) {
    const item = group.items.find((candidate) => candidate.key === categoryKey);
    if (item) {
      return {
        ...item,
        groupColor: group.color,
      };
    }
  }
  return DEFAULT_CATEGORY_DETAILS;
};

export const getEffectiveCategoryCount = (
  categoryKey: string,
  baseCount: number,
  options: { consoleFamily?: string; consoleModel?: string } = {},
): number => {
  if (options.consoleFamily === 'x32-family') {
    return X32_COUNTS[categoryKey] ?? baseCount;
  }
  if (categoryKey === 'preamp_local' && String(options.consoleModel || '').toLowerCase() === 'wing') {
    return 8;
  }
  return baseCount;
};

export const getCategoryConfig = (
  categoryKey: string,
  options: { consoleFamily?: string; consoleModel?: string } = {},
): TargetCategoryDetails => {
  const details = getBaseCategoryDetails(categoryKey);
  return {
    ...details,
    count: getEffectiveCategoryCount(categoryKey, details.count, options),
  };
};

export const getAvailableSubCategories = ({
  consoleFamily,
  targetType,
  category,
  selectedStripFamily,
}: {
  consoleFamily?: string;
  targetType: TargetType;
  category: string;
  selectedStripFamily?: string | null;
}): TargetSubCategory[] => {
  if (!MIX_CATEGORY_SET.has(category)) {
    return [];
  }
  if (consoleFamily === 'x32-family') {
    return X32_MIX_SUB_CATEGORIES;
  }
  if (targetType === 'selected') {
    const selectedFamily = normalizeSelectedMixFamily(selectedStripFamily);
    if (!selectedFamily) {
      return SELECTED_SUB_CATEGORIES_CONSERVATIVE;
    }
    const perFamily = WING_MIX_SUB_CATEGORIES[selectedFamily] || ['mix'];
    return perFamily.filter((subcategory) => SELECTED_SUB_CATEGORY_WHITELIST.includes(subcategory));
  }
  return WING_MIX_SUB_CATEGORIES[category] || ['mix'];
};

export const isMixCategory = (category: string): boolean =>
  MIX_CATEGORY_SET.has(category);

export const getParameterOptionsForTarget = ({
  consoleFamily,
  targetType,
  category,
  subCategory,
  selectedStripFamily,
}: {
  consoleFamily?: string;
  targetType?: TargetType;
  category: string;
  subCategory: TargetSubCategory;
  selectedStripFamily?: string | null;
}): TargetParameterOption[] => {
  const selectedFamily = normalizeSelectedMixFamily(selectedStripFamily);
  const effectiveCategory = targetType === 'selected'
    ? (selectedFamily || SELECTED_TARGET_CATEGORY)
    : category;

  if (consoleFamily === 'x32-family') {
    if (effectiveCategory === 'dca') {
      return [
        { key: 'fader', label: 'DCA Volume (Fader)' },
        { key: 'mute', label: 'DCA Mute' },
        { key: 'name', label: 'DCA Name' },
        { key: 'color', label: 'DCA Color' },
      ];
    }
    if (isMixCategory(effectiveCategory)) {
      const base: TargetParameterOption[] = [
        { key: 'mute', label: 'Mute/Unmute' },
        { key: 'fader', label: 'Volume (Fader)' },
        { key: 'pan', label: 'Pan (L/R)' },
      ];
      if (effectiveCategory === 'ch' || effectiveCategory === 'aux') {
        base.push({ key: 'gain', label: 'Input Trim (dB)' });
      }
      if (effectiveCategory !== 'main') {
        base.push(
          { key: 'send_level', label: 'Mix Bus Send Level (dB)' },
          { key: 'send_on', label: 'Mix Bus Send On/Off' },
        );
      }
      base.push(
        { key: 'name', label: effectiveCategory === 'main' ? 'Main L/R Name' : 'Channel/Bus Name' },
        { key: 'color', label: 'Color Label' },
      );
      if (subCategory === 'sends') {
        return base.filter((entry) => entry.key === 'send_level' || entry.key === 'send_on');
      }
      return base;
    }
    return [];
  }

  if (effectiveCategory === 'fx') {
    return [{ key: 'fx_mix', label: 'FX Wet/Dry Mix' }];
  }
  if (effectiveCategory === 'dca') {
    return [
      { key: 'meter', label: 'DCA Audio Meter (dB)' },
      { key: 'fader', label: 'DCA Volume (Fader)' },
      { key: 'mute', label: 'DCA Mute' },
    ];
  }
  if (effectiveCategory === 'mutegroup') {
    return [{ key: 'mute_group', label: 'Mute Group On/Off' }];
  }
  if (effectiveCategory === 'usersig') {
    return [
      { key: 'meter', label: 'User Signal Meter (dB)' },
      { key: 'mute', label: 'User Signal Mute/Bypass' },
      { key: 'phase', label: 'User Signal Polarity (Phase)' },
      { key: 'name', label: 'User Signal Name' },
      { key: 'color', label: 'User Signal Color' },
    ];
  }
  if (effectiveCategory === 'userctrl') {
    return [{ key: 'user_btn', label: 'Trigger User Assign Button' }];
  }
  if (effectiveCategory === 'monitor') {
    return [{ key: 'meter_monitor', label: 'Monitor Meter (dB)' }];
  }
  if (effectiveCategory === 'rta') {
    return [{ key: 'meter_rta_band', label: 'RTA Band Meter (dB)' }];
  }
  if (effectiveCategory === SELECTED_TARGET_CATEGORY) {
    const conservativeMap: Partial<Record<TargetSubCategory, TargetParameterOption[]>> = {
      mix: [
        { key: 'mute', label: 'Mute/Unmute' },
        { key: 'fader', label: 'Volume (Fader)' },
        { key: 'pan', label: 'Pan (L/R)' },
        { key: 'meter', label: 'Audio Level Meter (dB)' },
      ],
      filters: [
        { key: 'hpf_on', label: 'HPF On/Off' },
        { key: 'hpf_freq', label: 'HPF Frequency (Hz)' },
        { key: 'lpf_on', label: 'LPF On/Off' },
        { key: 'lpf_freq', label: 'LPF Frequency (Hz)' },
      ],
      eq: WING_MIX_PARAMETERS.eq,
      dynamics: WING_MIX_PARAMETERS.dynamics,
      routing: WING_MIX_PARAMETERS.routing,
    };
    return conservativeMap[subCategory] || [];
  }
  if (effectiveCategory.startsWith('preamp_')) {
    const hasRemoteGain = WING_PREAMP_GAIN_CAPABLE.has(effectiveCategory);
    return [
      { key: 'meter', label: 'Source Audio Meter (dB)' },
      ...(hasRemoteGain ? [{ key: 'gain', label: 'Source Gain / Trim (dB)' }] : []),
      ...(hasRemoteGain ? [{ key: 'phantom_48v', label: 'Phantom Power (+48V)' }] : []),
      { key: 'phase', label: 'Polarity Invert (Phase)' },
      { key: 'name', label: 'Source Custom Name' },
      { key: 'color', label: 'Source Color Label' },
      { key: 'icon', label: 'Source Icon Identifier' },
    ];
  }
  if (effectiveCategory === 'usb') {
    return [
      { key: 'meter', label: 'USB Audio Meter (dB)' },
      { key: 'phase', label: 'Polarity Invert (Phase)' },
      { key: 'name', label: 'USB Channel Name' },
      { key: 'color', label: 'USB Channel Color' },
    ];
  }
  if (effectiveCategory.startsWith('output_')) {
    return [{ key: 'meter', label: 'Output Audio Meter (dB)' }];
  }
  if (isMixCategory(effectiveCategory)) {
    const allowedSubCategories = WING_MIX_SUB_CATEGORIES[effectiveCategory] || ['mix'];
    const normalizedSubCategory = allowedSubCategories.includes(subCategory) ? subCategory : allowedSubCategories[0];
    return WING_MIX_PARAMETERS[normalizedSubCategory] || [];
  }
  return [];
};

export const getAllowedParameterKeysForTargetContext = ({
  consoleFamily,
  targetType,
  category,
  selectedStripFamily,
}: {
  consoleFamily?: string;
  targetType: TargetType;
  category: string;
  selectedStripFamily?: string | null;
}): string[] => {
  const subCategories = getAvailableSubCategories({
    consoleFamily,
    targetType,
    category,
    selectedStripFamily,
  });
  const keys = new Set<string>();
  subCategories.forEach((subCategory) => {
    getParameterOptionsForTarget({
      consoleFamily,
      targetType,
      category,
      subCategory,
      selectedStripFamily,
    }).forEach((option) => keys.add(option.key));
  });
  return Array.from(keys);
};
