import React, { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { AppState, PanResponder, Platform, StyleSheet, View, Text as RNText, TextInput as RNTextInput, TouchableOpacity, ScrollView, Modal, Alert, Switch, useWindowDimensions, type TextProps, type TextInputProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import {
  Activity,
  ArrowLeft,
  AudioLines,
  ChevronRight,
  CircleHelp,
  Database,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Search,
  Save,
  Settings2,
  ShieldCheck,
  Waypoints,
  Wifi,
  WifiOff,
  Play,
  Zap,
} from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import OscManager from '../osc/OscManager';
import MacroEngine from '../osc/MacroEngine';
import HaCompensationEngine from '../ha/HaCompensationEngine';
import Constants from 'expo-constants';
import {
  getAvailableCategoryGroups,
  getAvailableCategoryKeys,
  getAvailableSubCategories,
  getCategoryConfig,
  getParameterOptionsForTarget,
  isMixCategory,
  type TargetSubCategory,
} from '../domain/targetCapabilities';
import {
  FADER_DB_MIN,
  FADER_DB_MAX,
  METER_DB_MIN,
  METER_DB_MAX,
  PAN_MIN,
  PAN_MAX,
  faderFloatToDb,
  dbToFaderFloat,
  formatDbValue,
  formatFaderDbValue,
  clampNumber,
  mapDbToScaledMeter,
  mapScaledMeterToDb,
  mapDbToScaledFader,
  mapScaledFaderToDb,
  meterDbToFillPercent,
  formatFrequencyValue,
  formatMillisecondsValue,
  formatPercentValue,
  formatRatioValue,
  formatQValue,
  frequencyToSliderValue,
  sliderValueToFrequency,
} from '../domain/valueScales';
import {
  surface0,
  surface1,
  surface2,
  surface3,
  border0,
  border1,
  border2,
  accentMacro,
  accentAutomation,
  accentHa,
  accentPrimary,
  success,
  danger,
  textPrimary,
  textSecondary,
  textMuted,
} from '../constants/designTokens';
import { readJsonTextWithBackup, safeWriteJson } from '../storage/safeJsonStorage';
import { buildAutomationFleetPreflight } from '../domain/automationSafety';
import { collectMacroTargetResolutionReport, validateCustomOscTarget } from '../domain/targetResolver';

const TYPOGRAPHY_OPTIONS = [
  { key: 'system', label: 'System', fontFamily: undefined as string | undefined },
  { key: 'sans', label: 'Sans', fontFamily: Platform.select({ android: 'sans-serif', default: undefined }) || 'sans-serif' },
  { key: 'condensed', label: 'Condensed', fontFamily: Platform.select({ android: 'sans-serif-condensed', default: 'Helvetica Neue' }) || 'sans-serif-condensed' },
  { key: 'serif', label: 'Serif', fontFamily: Platform.select({ android: 'serif', default: 'Times New Roman' }) || 'serif' },
  { key: 'mono', label: 'Mono', fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }) || 'monospace' },
];
const TEXT_SCALE_OPTIONS = [
  { key: 'small', label: 'Small', multiplier: 0.9 },
  { key: 'normal', label: 'Normal', multiplier: 1.0 },
  { key: 'large', label: 'Large', multiplier: 1.12 },
  { key: 'xl', label: 'XL', multiplier: 1.22 },
];
const DENSITY_OPTIONS = [
  { key: 'compact', label: 'Compact' },
  { key: 'comfortable', label: 'Comfortable' },
];
const METER_UI_RATE_OPTIONS = [
  { key: 'smooth', label: 'Smooth', intervalMs: 16 },
  { key: 'balanced', label: 'Balanced', intervalMs: 33 },
  { key: 'economical', label: 'Economical', intervalMs: 66 },
] as const;
const METER_PREVIEW_OPTIONS = [4, 8, 12] as const;
const UI_SETTINGS_FILE = `${FileSystem.documentDirectory}ui_settings.json`;
const UI_SETTINGS_SCHEMA_VERSION = 3;
const WORKSPACE_STATE_FILE = `${FileSystem.documentDirectory}workspace_state.json`;
const WORKSPACE_STATE_SCHEMA_VERSION = 2;
const APP_PRESETS_FILE = `${FileSystem.documentDirectory}app_presets.json`;
const APP_PRESET_SCHEMA_VERSION = 2;
const CUSTOM_METER_GROUPS_FILE = `${FileSystem.documentDirectory}custom_meter_groups.json`;
const CUSTOM_METER_GROUPS_SCHEMA_VERSION = 1;
const MAX_MACROS = 250;
const MAX_APP_PRESETS = 250;
const MAX_AUTOMIZATIONS = 250;
const MAX_HA_PAIRS = 32;
const MAX_HA_MAPPINGS = 256;
const MAX_HA_TARGETS_PER_ENDPOINT = 64;
const MAX_MACRO_CONDITIONS = 64;
const MAX_MACRO_ACTIONS = 128;
const MAX_DISCRETE_ACTION_TARGETS = 128;
const MAX_RAMP_ACTION_TARGETS = 64;
const MAX_RAMP_COMMANDS_PER_SECOND = 200;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_CUSTOM_METER_GROUPS = 32;
const MAX_CUSTOM_METER_GROUP_ADDRESSES = 128;
const MAX_CUSTOM_METER_GROUP_NAME_LENGTH = 48;
const METER_ROW_DRAG_RAIL_WIDTH = 42;
const GLOBAL_METER_OVERVIEW_SAMPLE_PER_GROUP = 1;
type TriggerMeterMode = 'level' | 'transient';
const DEFAULT_TRIGGER_METER_MODE: TriggerMeterMode = 'level';
const DEFAULT_TRIGGER_METER_COOLDOWN_MS = 120;
const DEFAULT_TRIGGER_METER_REARM_DB = 3;
const DEFAULT_TRIGGER_METER_DWELL_MS = 0;
const DEFAULT_TRIGGER_METER_STALE_AFTER_MS = 1500;
type MacroOverlapStrategy = 'drop' | 'restart' | 'queue_one' | 'queue_many' | 'concurrent';
const DEFAULT_MACRO_OVERLAP_STRATEGY: MacroOverlapStrategy = 'drop';
const DEFAULT_MACRO_MAX_QUEUE_DEPTH = 1;
const GLOBAL_METER_OVERVIEW_GROUP_ALLOWLIST = new Set([
  'ch',
  'bus',
  'aux',
  'main',
  'matrix',
  'dca',
  'fx',
  'monitor',
]);
const NEW_MACRO_WORKSPACE_ID = '__NEW_MACRO__';
const LIBRARY_NAV_DELAY_MS = 120;
const isAutomizationStoragePayloadValid = (payload: any): boolean => {
  const items = Array.isArray(payload) ? payload : payload?.items;
  return Array.isArray(items)
    && items.length <= MAX_AUTOMIZATIONS
    && items.every((item: any) =>
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && (!('targetItems' in item) || Array.isArray(item.targetItems))
    );
};
const isAppPresetStoragePayloadValid = (payload: any): boolean =>
  Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Array.isArray(payload.items)
    && payload.items.length <= MAX_APP_PRESETS
    && payload.items.every((item: any) =>
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && item.scopes
      && typeof item.scopes === 'object'
    )
  );
const isCustomMeterGroupsStoragePayloadValid = (payload: any): boolean =>
  Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Array.isArray(payload.items)
    && payload.items.length <= MAX_CUSTOM_METER_GROUPS
    && payload.items.every((item: any) =>
      item
      && typeof item === 'object'
      && !Array.isArray(item)
      && Array.isArray(item.addresses)
    )
  );
const isCompleteBackupPayloadValid = (payload: any): boolean =>
  Boolean(
    payload
    && payload.backupType === 'wing-controller-complete'
    && payload.currentShow
    && typeof payload.currentShow === 'object'
    && Array.isArray(payload.currentShow.macros)
    && payload.currentShow.macros.length <= MAX_MACROS
    && Array.isArray(payload.currentShow.automizations)
    && payload.currentShow.automizations.length <= MAX_AUTOMIZATIONS
    && Array.isArray(payload.currentShow.haPairs)
    && payload.currentShow.haPairs.length <= MAX_HA_PAIRS
    && Array.isArray(payload.showPresets)
    && isAppPresetStoragePayloadValid({ items: payload.showPresets })
  );

type UiTypographyKey = 'system' | 'sans' | 'condensed' | 'serif' | 'mono';
type UiTextScaleKey = 'small' | 'normal' | 'large' | 'xl';
type UiDensityKey = 'compact' | 'comfortable';
type MeterUiRateKey = (typeof METER_UI_RATE_OPTIONS)[number]['key'];
type WorkspaceKind = 'overview' | 'macro' | 'automization' | 'ha' | 'meters';
type OverviewFocusKind = 'global' | 'macros' | 'automizations' | 'ha';
type AppPresetScope = { macros: boolean; automizations: boolean; ha: boolean };
type AppPreset = {
  id: string;
  name: string;
  createdAt: number;
  isRecovery?: boolean;
  scopes: AppPresetScope;
  macros?: MacroRecord[];
  automizations?: SidebarAutomization[];
  haPairs?: HaPair[];
};
type CustomMeterGroup = {
  id: string;
  name: string;
  addresses: string[];
  createdAt: number;
  updatedAt: number;
};

type UiSettingsPayload = {
  schemaVersion: number;
  typographyKey: UiTypographyKey;
  textScaleKey: UiTextScaleKey;
  densityKey: UiDensityKey;
  showInlineGuides: boolean;
  meterUiRateKey: MeterUiRateKey;
  meterPreviewRows: (typeof METER_PREVIEW_OPTIONS)[number];
  showDiagnostics: boolean;
  connectionIp: string;
};

type WorkspaceStatePayload = {
  schemaVersion: number;
  workspace: WorkspaceKind;
  macroId: string | null;
  macroName: string | null;
  automizationId: string | null;
  haPairId: string | null;
  macroDraft?: any;
};

const DEFAULT_UI_SETTINGS: UiSettingsPayload = {
  schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
  typographyKey: 'sans',
  textScaleKey: 'normal',
  densityKey: 'compact',
  showInlineGuides: true,
  meterUiRateKey: 'smooth',
  meterPreviewRows: 8,
  showDiagnostics: true,
  connectionIp: '192.168.1.10',
};

const DEFAULT_WORKSPACE_STATE: WorkspaceStatePayload = {
  schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
  workspace: 'overview',
  macroId: null,
  macroName: null,
  automizationId: null,
  haPairId: null,
};

type UiTypographyContextValue = {
  fontFamily?: string;
  textScale: number;
};

const UiTypographyContext = React.createContext<UiTypographyContextValue>({
  fontFamily: undefined,
  textScale: 1,
});

const clampUiTextScale = (value: number): number => Math.max(0.82, Math.min(value || 1, 1.35));

const Text = ({ style, ...rest }: TextProps) => {
  const { fontFamily, textScale } = useContext(UiTypographyContext);
  const flat = StyleSheet.flatten(style) || {};
  const baseSize = typeof flat.fontSize === 'number' ? flat.fontSize : null;
  const baseLineHeight = typeof flat.lineHeight === 'number' ? flat.lineHeight : null;
  const scaledSize = typeof baseSize === 'number'
    ? Math.max(9, Number((baseSize * clampUiTextScale(textScale)).toFixed(2)))
    : undefined;
  const scaledLineHeight = typeof baseLineHeight === 'number'
    ? Math.max(
        scaledSize ? scaledSize + 2 : baseLineHeight + 2,
        Number((baseLineHeight * clampUiTextScale(textScale)).toFixed(2)),
      )
    : undefined;

  return (
    <RNText
      {...rest}
      style={[
        style,
        fontFamily ? { fontFamily } : null,
        scaledSize !== undefined || scaledLineHeight !== undefined
          ? { fontSize: scaledSize, lineHeight: scaledLineHeight, includeFontPadding: false }
          : null,
      ]}
    />
  );
};

const TextInput = React.forwardRef<React.ElementRef<typeof RNTextInput>, TextInputProps>(({ style, ...rest }, ref) => {
  const { fontFamily, textScale } = useContext(UiTypographyContext);
  const flat = StyleSheet.flatten(style) || {};
  const baseSize = typeof flat.fontSize === 'number' ? flat.fontSize : null;
  const baseLineHeight = typeof flat.lineHeight === 'number' ? flat.lineHeight : null;
  const scaledSize = typeof baseSize === 'number'
    ? Math.max(10, Number((baseSize * clampUiTextScale(textScale)).toFixed(2)))
    : undefined;
  const scaledLineHeight = typeof baseLineHeight === 'number'
    ? Math.max(
        scaledSize ? scaledSize + 2 : baseLineHeight + 2,
        Number((baseLineHeight * clampUiTextScale(textScale)).toFixed(2)),
      )
    : undefined;

  return (
    <RNTextInput
      ref={ref}
      {...rest}
      style={[
        style,
        fontFamily ? { fontFamily } : null,
        scaledSize !== undefined || scaledLineHeight !== undefined
          ? { fontSize: scaledSize, lineHeight: scaledLineHeight }
          : null,
      ]}
    />
  );
});
TextInput.displayName = 'UiTextInput';

// Lightweight progressive-disclosure section. Closed by default: keeps advanced
// options and diagnostics out of the way until the user asks for them.
const Disclosure = ({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.disclosure}>
      <TouchableOpacity
        style={styles.disclosureHeader}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
      >
        <Text style={styles.disclosureCaret}>{open ? '▾' : '▸'}</Text>
        <Text style={styles.disclosureTitle}>{title}</Text>
      </TouchableOpacity>
      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  );
};

const sanitizeUiSettings = (raw: any): UiSettingsPayload => {
  const typographyValues = new Set(TYPOGRAPHY_OPTIONS.map((option) => option.key));
  const textScaleValues = new Set(TEXT_SCALE_OPTIONS.map((option) => option.key));
  const densityValues = new Set(DENSITY_OPTIONS.map((option) => option.key));
  const meterRateValues = new Set(METER_UI_RATE_OPTIONS.map((option) => option.key));
  const meterValues = new Set(METER_PREVIEW_OPTIONS);

  const typographyKey = typographyValues.has(raw?.typographyKey)
    ? raw.typographyKey as UiTypographyKey
    : DEFAULT_UI_SETTINGS.typographyKey;
  const textScaleKey = textScaleValues.has(raw?.textScaleKey)
    ? raw.textScaleKey as UiTextScaleKey
    : DEFAULT_UI_SETTINGS.textScaleKey;
  const densityKey = densityValues.has(raw?.densityKey)
    ? raw.densityKey as UiDensityKey
    : DEFAULT_UI_SETTINGS.densityKey;
  const meterPreviewRows = meterValues.has(raw?.meterPreviewRows)
    ? raw.meterPreviewRows as (typeof METER_PREVIEW_OPTIONS)[number]
    : DEFAULT_UI_SETTINGS.meterPreviewRows;
  const meterUiRateKey = meterRateValues.has(raw?.meterUiRateKey)
    ? raw.meterUiRateKey as MeterUiRateKey
    : DEFAULT_UI_SETTINGS.meterUiRateKey;

  return {
    schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
    typographyKey,
    textScaleKey,
    densityKey,
    showInlineGuides: typeof raw?.showInlineGuides === 'boolean' ? raw.showInlineGuides : DEFAULT_UI_SETTINGS.showInlineGuides,
    meterUiRateKey,
    meterPreviewRows,
    showDiagnostics: typeof raw?.showDiagnostics === 'boolean' ? raw.showDiagnostics : DEFAULT_UI_SETTINGS.showDiagnostics,
    connectionIp: typeof raw?.connectionIp === 'string'
      ? raw.connectionIp.trim()
      : DEFAULT_UI_SETTINGS.connectionIp,
  };
};

const sanitizeWorkspaceState = (raw: any): WorkspaceStatePayload => {
  const workspace = ['overview', 'macro', 'automization', 'ha', 'meters'].includes(String(raw?.workspace || '').trim())
    ? raw.workspace as WorkspaceKind
    : DEFAULT_WORKSPACE_STATE.workspace;

  return {
    schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspace,
    macroId: typeof raw?.macroId === 'string' && raw.macroId.trim() ? raw.macroId.trim() : null,
    macroName: typeof raw?.macroName === 'string' && raw.macroName.trim() ? raw.macroName.trim() : null,
    automizationId: typeof raw?.automizationId === 'string' && raw.automizationId.trim() ? raw.automizationId.trim() : null,
    haPairId: typeof raw?.haPairId === 'string' && raw.haPairId.trim() ? raw.haPairId.trim() : null,
    macroDraft: raw?.macroDraft && typeof raw.macroDraft === 'object' && !Array.isArray(raw.macroDraft)
      ? raw.macroDraft
      : undefined,
  };
};

const getMeterUiRateIntervalMs = (key: MeterUiRateKey): number => (
  METER_UI_RATE_OPTIONS.find((option) => option.key === key)?.intervalMs
  ?? METER_UI_RATE_OPTIONS.find((option) => option.key === DEFAULT_UI_SETTINGS.meterUiRateKey)?.intervalMs
  ?? 16
);

const isBooleanParameter = (param: string): boolean => {
  return [
    'mute', 'mute_group', 'phantom_48v', 'phase', 
    'hpf_on', 'lpf_on', 'eq_on', 'gate_on', 'comp_on', 
    'insert_on', 'user_btn', 'send_on'
  ].includes(param);
};

const isFaderParameter = (param: string | undefined): boolean => {
  if (!param) return false;
  return ['fdr', 'fader', 'level', 'trim', 'send_level'].includes(param);
};

const isMeterParameter = (param: string | undefined): boolean => {
  return Boolean(param && param.startsWith('meter'));
};

// Value-scale and value-format helpers now live in src/domain/valueScales.ts
// (imported above). Kept there as pure, reusable, testable functions.

const getParameterDescriptor = (target: any) => {
  const parameter = target?.parameter;
  const category = target?.category || '';

  if (!parameter) {
    return { kind: 'text', manualLabel: 'MANUAL VALUE', placeholder: 'Enter value' };
  }

  if (isBooleanParameter(parameter)) {
    return { kind: 'boolean' };
  }

  if (parameter === 'pan') {
    return {
      kind: 'pan',
      min: PAN_MIN,
      max: PAN_MAX,
      step: 1,
      minLabel: 'L100',
      maxLabel: 'R100',
      manualLabel: 'MANUAL PAN (L-/R+)',
      placeholder: '0',
    };
  }

  if (String(parameter).startsWith('meter')) {
    const isBinaryMeter = parameter === 'meter_v2_gate_led' || parameter === 'meter_v2_dyn_state';
    if (isBinaryMeter) {
      return {
        kind: 'integer',
        min: 0,
        max: 1,
        step: 1,
        minLabel: '0',
        maxLabel: '1',
        manualLabel: 'MANUAL STATE (0/1)',
        placeholder: '1',
      };
    }
    return {
      kind: 'meter',
      min: METER_DB_MIN,
      max: METER_DB_MAX,
      step: 0.1,
      minLabel: '-oo dB',
      maxLabel: '+12 dB',
      manualLabel: 'MANUAL THRESHOLD (dB)',
      placeholder: '-18.0',
    };
  }

  if (isFaderParameter(parameter)) {
    return {
      kind: 'fader',
      min: FADER_DB_MIN,
      max: FADER_DB_MAX,
      step: 0.1,
      minLabel: '-oo dB',
      maxLabel: '+10 dB',
      manualLabel: parameter === 'send_level' ? 'MANUAL SEND LEVEL (dB)' : 'MANUAL FADER LEVEL (dB)',
      placeholder: '-10.0',
    };
  }

  if (parameter === 'gain') {
    const isRemotePreamp = String(category).startsWith('preamp_');
    return {
      kind: 'db',
      min: isRemotePreamp ? 0 : -18,
      max: isRemotePreamp ? 60 : 18,
      step: 0.5,
      minLabel: isRemotePreamp ? '0 dB' : '-18 dB',
      maxLabel: isRemotePreamp ? '+60 dB' : '+18 dB',
      manualLabel: isRemotePreamp ? 'MANUAL GAIN (dB)' : 'MANUAL TRIM (dB)',
      placeholder: isRemotePreamp ? '30.0' : '0.0',
    };
  }

  if (parameter === 'hpf_freq' || parameter === 'lpf_freq' || (parameter.startsWith('eq_') && parameter.endsWith('_freq'))) {
    return {
      kind: 'frequency',
      min: 20,
      max: 20000,
      step: 1,
      minLabel: '20 Hz',
      maxLabel: '20 kHz',
      manualLabel: 'MANUAL FREQUENCY (Hz)',
      placeholder: '1000',
    };
  }

  if (parameter.startsWith('eq_') && parameter.endsWith('_gain')) {
    return {
      kind: 'db',
      min: -15,
      max: 15,
      step: 0.5,
      minLabel: '-15 dB',
      maxLabel: '+15 dB',
      manualLabel: 'MANUAL EQ GAIN (dB)',
      placeholder: '0.0',
    };
  }

  if (parameter.startsWith('eq_') && parameter.endsWith('_q')) {
    return {
      kind: 'q',
      min: 0.44,
      max: 10,
      step: 0.05,
      minLabel: 'Q 0.44',
      maxLabel: 'Q 10.00',
      manualLabel: 'MANUAL Q VALUE',
      placeholder: '1.00',
    };
  }

  if (parameter === 'gate_thr') {
    return {
      kind: 'db',
      min: -80,
      max: 0,
      step: 0.5,
      minLabel: '-80 dB',
      maxLabel: '0 dB',
      manualLabel: 'MANUAL THRESHOLD (dB)',
      placeholder: '-20.0',
    };
  }

  if (parameter === 'comp_thr') {
    return {
      kind: 'db',
      min: -60,
      max: 0,
      step: 0.5,
      minLabel: '-60 dB',
      maxLabel: '0 dB',
      manualLabel: 'MANUAL THRESHOLD (dB)',
      placeholder: '-18.0',
    };
  }

  if (parameter === 'gate_range') {
    return {
      kind: 'db',
      min: 3,
      max: 60,
      step: 1,
      minLabel: '3 dB',
      maxLabel: '60 dB',
      manualLabel: 'MANUAL RANGE (dB)',
      placeholder: '20',
    };
  }

  if (parameter === 'comp_makeup') {
    return {
      kind: 'db',
      min: -6,
      max: 12,
      step: 0.5,
      minLabel: '-6 dB',
      maxLabel: '+12 dB',
      manualLabel: 'MANUAL MAKEUP GAIN (dB)',
      placeholder: '0.0',
    };
  }

  if (parameter === 'comp_knee') {
    return {
      kind: 'integer',
      min: 0,
      max: 5,
      step: 1,
      minLabel: '0',
      maxLabel: '5',
      manualLabel: 'MANUAL KNEE INDEX',
      placeholder: '2',
    };
  }

  if (parameter === 'gate_attack') {
    return {
      kind: 'ms',
      min: 0,
      max: 120,
      step: 0.5,
      minLabel: '0 ms',
      maxLabel: '120 ms',
      manualLabel: 'MANUAL ATTACK (ms)',
      placeholder: '10.0',
    };
  }

  if (parameter === 'gate_release') {
    return {
      kind: 'ms',
      min: 4,
      max: 4000,
      step: 1,
      minLabel: '4 ms',
      maxLabel: '4000 ms',
      manualLabel: 'MANUAL RELEASE (ms)',
      placeholder: '200',
    };
  }

  if (parameter === 'comp_attack') {
    return {
      kind: 'ms',
      min: 0,
      max: 120,
      step: 0.5,
      minLabel: '0 ms',
      maxLabel: '120 ms',
      manualLabel: 'MANUAL ATTACK (ms)',
      placeholder: '5.0',
    };
  }

  if (parameter === 'comp_release') {
    return {
      kind: 'ms',
      min: 4,
      max: 4000,
      step: 1,
      minLabel: '4 ms',
      maxLabel: '4000 ms',
      manualLabel: 'MANUAL RELEASE (ms)',
      placeholder: '120',
    };
  }

  if (parameter === 'comp_ratio') {
    return {
      kind: 'ratio',
      min: 1.1,
      max: 100,
      step: 0.1,
      minLabel: '1.1:1',
      maxLabel: '100:1',
      manualLabel: 'MANUAL RATIO',
      placeholder: '2.0',
    };
  }

  if (parameter === 'fx_mix') {
    return {
      kind: 'percent',
      min: 0,
      max: 100,
      step: 1,
      minLabel: '0%',
      maxLabel: '100%',
      manualLabel: 'MANUAL FX MIX (%)',
      placeholder: '50',
    };
  }

  if (parameter === 'gate_type' || parameter === 'comp_type' || parameter === 'color' || parameter === 'icon' || parameter === 'load_snapshot' || parameter === 'load_preset') {
    return {
      kind: 'integer',
      min: 0,
      max: 999,
      step: 1,
      minLabel: '0',
      maxLabel: '999',
      manualLabel: 'MANUAL INDEX / ID',
      placeholder: '0',
    };
  }

  if (parameter === 'name') {
    return {
      kind: 'text',
      manualLabel: 'MANUAL TEXT VALUE',
      placeholder: 'Enter custom name',
    };
  }

  return {
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    minLabel: '0.0',
    maxLabel: '1.0',
    manualLabel: 'MANUAL VALUE',
    placeholder: '0.000',
  };
};

const formatParameterValue = (target: any, rawValue: any): string => {
  if (rawValue === null || rawValue === undefined) return '--';
  const descriptor = getParameterDescriptor(target);

  if (descriptor.kind === 'boolean') {
    return rawValue === true || rawValue === '1' || rawValue === '1.0' || rawValue === 1 ? 'ON' : 'OFF';
  }

  if (descriptor.kind === 'text') {
    return String(rawValue);
  }

  const numericValue = Number(rawValue);
  if (Number.isNaN(numericValue)) return String(rawValue);

  if (descriptor.kind === 'pan') {
    const panValue = numericValue >= 0 && numericValue <= 1
      ? (numericValue - 0.5) * 200
      : numericValue;
    const panRounded = Math.round(clampNumber(panValue, PAN_MIN, PAN_MAX));
    if (panRounded < 0) return `L${Math.abs(panRounded)}`;
    if (panRounded > 0) return `R${panRounded}`;
    return 'C';
  }

  if (descriptor.kind === 'fader') {
    const dbValue = numericValue >= 0.0 && numericValue <= 1.0 ? faderFloatToDb(numericValue) : numericValue;
    return formatFaderDbValue(dbValue);
  }

  if (descriptor.kind === 'meter' || descriptor.kind === 'db') {
    return formatDbValue(numericValue);
  }

  if (descriptor.kind === 'frequency') {
    return formatFrequencyValue(numericValue);
  }

  if (descriptor.kind === 'ms') {
    return formatMillisecondsValue(numericValue);
  }

  if (descriptor.kind === 'percent') {
    return formatPercentValue(numericValue);
  }

  if (descriptor.kind === 'ratio') {
    return formatRatioValue(numericValue);
  }

  if (descriptor.kind === 'q') {
    return formatQValue(numericValue);
  }

  if (descriptor.kind === 'integer') {
    return `${Math.round(numericValue)}`;
  }

  return numericValue.toFixed(3);
};

const getPrecisionFromStep = (step?: number): number => {
  if (!step || step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
};

const normalizeValueForTarget = (target: any, rawValue: any): number | string => {
  const descriptor: any = getParameterDescriptor(target);
  const rawString = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();

  if (descriptor.kind === 'text') {
    return rawString;
  }

  if (descriptor.kind === 'boolean') {
    if (rawValue === true || rawString === '1' || rawString.toLowerCase() === 'true') return 1;
    return 0;
  }

  const parsed = Number(rawString);
  if (Number.isNaN(parsed)) {
    if (descriptor.kind === 'integer') return 0;
    if (descriptor.kind === 'fader') return -10.0;
    if (descriptor.kind === 'meter') return -18.0;
    if (descriptor.kind === 'frequency') return 1000;
    return 0;
  }

  if (descriptor.kind === 'pan') {
    const panValue = parsed >= 0 && parsed <= 1 ? (parsed - 0.5) * 200 : parsed;
    return Math.round(clampNumber(panValue, PAN_MIN, PAN_MAX));
  }

  if (descriptor.kind === 'fader') {
    const dbValue = parsed >= 0 && parsed <= 1 ? faderFloatToDb(parsed) : parsed;
    return Number(clampNumber(dbValue, FADER_DB_MIN, FADER_DB_MAX).toFixed(1));
  }

  if (descriptor.kind === 'integer') {
    const min = descriptor.min ?? 0;
    const max = descriptor.max ?? 9999;
    return Math.round(clampNumber(parsed, min, max));
  }

  const min = descriptor.min ?? parsed;
  const max = descriptor.max ?? parsed;
  const step = descriptor.step ?? 1;
  const precision = getPrecisionFromStep(step);
  return Number(clampNumber(parsed, min, max).toFixed(precision));
};

const getDefaultUiValueForTarget = (target: any): string => {
  const descriptor: any = getParameterDescriptor(target);
  if (descriptor.kind === 'boolean') return '1';
  if (descriptor.kind === 'pan') return '0';
  if (descriptor.kind === 'fader') return '-10.0';
  if (descriptor.kind === 'meter') return '-18.0';
  if (descriptor.kind === 'frequency') return '1000';
  if (descriptor.kind === 'text') return '';
  if (descriptor.kind === 'integer') return String(Math.round(descriptor.min ?? 0));

  const numericPlaceholder = Number(descriptor.placeholder);
  const fallback = Number.isNaN(numericPlaceholder)
    ? Number(descriptor.min ?? 0)
    : numericPlaceholder;
  const precision = getPrecisionFromStep(descriptor.step ?? 1);
  return Number(fallback.toFixed(precision)).toString();
};

const toUiValueString = (target: any, rawValue: any): string => {
  const descriptor: any = getParameterDescriptor(target);
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return getDefaultUiValueForTarget(target);
  }

  if (descriptor.kind === 'text') {
    return String(rawValue);
  }

  if (descriptor.kind === 'boolean') {
    return (rawValue === true || String(rawValue).trim().toLowerCase() === 'true' || String(rawValue).trim() === '1') ? '1' : '0';
  }

  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    return getDefaultUiValueForTarget(target);
  }

  if (descriptor.kind === 'pan') {
    const panValue = parsed >= 0 && parsed <= 1 ? (parsed - 0.5) * 200 : parsed;
    return String(Math.round(clampNumber(panValue, PAN_MIN, PAN_MAX)));
  }

  if (descriptor.kind === 'fader') {
    const dbValue = parsed >= 0 && parsed <= 1 ? faderFloatToDb(parsed) : parsed;
    return clampNumber(dbValue, FADER_DB_MIN, FADER_DB_MAX).toFixed(1);
  }

  if (descriptor.kind === 'meter') {
    return clampNumber(parsed, descriptor.min ?? METER_DB_MIN, descriptor.max ?? METER_DB_MAX).toFixed(1);
  }

  if (descriptor.kind === 'frequency') {
    return String(Math.round(clampNumber(parsed, descriptor.min ?? 20, descriptor.max ?? 20000)));
  }

  if (descriptor.kind === 'integer' || descriptor.kind === 'percent') {
    return String(Math.round(clampNumber(parsed, descriptor.min ?? 0, descriptor.max ?? 100)));
  }

  const min = descriptor.min ?? parsed;
  const max = descriptor.max ?? parsed;
  const precision = getPrecisionFromStep(descriptor.step ?? 1);
  return clampNumber(parsed, min, max).toFixed(precision);
};

const formatElapsedRuntime = (timestamp: number | null | undefined): string => {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'never';
  const delta = Math.max(0, Date.now() - numeric);
  if (delta < 1000) return `${delta} ms ago`;
  if (delta < 10000) return `${(delta / 1000).toFixed(1)} s ago`;
  if (delta < 60000) return `${Math.round(delta / 1000)} s ago`;
  return `${(delta / 60000).toFixed(1)} min ago`;
};

const formatByteRate = (bytesPerSecond: number | null | undefined): string => {
  const value = Math.max(0, Number(bytesPerSecond) || 0);
  if (value < 1024) return `${Math.round(value)} B/s`;
  return `${(value / 1024).toFixed(1)} KB/s`;
};

const formatPacketRate = (packetsPerSecond: number | null | undefined): string => {
  const value = Math.max(0, Number(packetsPerSecond) || 0);
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
};

const getMeterHealthDescriptor = (runtimeStatus: any) => {
  if (runtimeStatus?.wingOnline !== true) {
    return { label: 'OFFLINE', color: danger };
  }
  if (!runtimeStatus?.nativeBinaryReady) {
    const recovering = String(runtimeStatus?.subscriptionMode || '').includes('recover')
      || Number(runtimeStatus?.nativeReconnectAttempt || 0) > 0;
    return { label: recovering ? 'RECOVERING' : 'PENDING', color: '#FF9500' };
  }

  const lastRxAt = Number(runtimeStatus?.lastMeterRxAt || 0);
  const lastRenewAt = Number(runtimeStatus?.lastMeterRenewAt || 0);
  const rxAge = lastRxAt > 0 ? Date.now() - lastRxAt : Number.POSITIVE_INFINITY;
  const renewAge = lastRenewAt > 0 ? Date.now() - lastRenewAt : Number.POSITIVE_INFINITY;

  if (rxAge <= 6500) {
    return { label: 'HEALTHY', color: success };
  }
  if (renewAge <= 6500) {
    return { label: 'WAITING RX', color: '#FFCC00' };
  }
  return { label: 'STALE', color: danger };
};

const buildMacroPreflight = (draft: any, runtimeStatus: any) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const targetReport = collectMacroTargetResolutionReport(
    draft,
    (target: any) => MacroEngine.resolveAddresses(target),
  );

  if (!draft?.name || !String(draft.name).trim()) {
    errors.push('Macro name is required.');
  }

  if (draft?.triggerType === 'console') {
    if (!draft?.triggerTarget) {
      errors.push('Console trigger requires a target parameter.');
    }
    if (isMeterParameter(draft?.triggerTarget?.parameter) && draft?.triggerMeterMode === 'transient' && draft?.triggerOperator !== '>') {
      warnings.push('Meter FAST profile is designed for > threshold triggers.');
    }
    if (isMeterParameter(draft?.triggerTarget?.parameter) && draft?.macroOverlapStrategy === 'concurrent') {
      warnings.push('Concurrent overlap can flood meter-triggered macros; DROP is safer for fast audio triggers.');
    }
    if (isMeterParameter(draft?.triggerTarget?.parameter) && Number(draft?.triggerMeterStaleAfterMs) < 500) {
      warnings.push('Meter stale timeout below 500 ms may inhibit triggers on busy Wi-Fi.');
    }
  }

  if (!Array.isArray(draft?.actions) || draft.actions.length === 0) {
    errors.push('At least one action is required.');
  }
  if (Array.isArray(draft?.actions) && draft.actions.length > MAX_MACRO_ACTIONS) {
    errors.push(`Macros support at most ${MAX_MACRO_ACTIONS} actions.`);
  }
  if (Array.isArray(draft?.conditions) && draft.conditions.length > MAX_MACRO_CONDITIONS) {
    errors.push(`Macros support at most ${MAX_MACRO_CONDITIONS} conditions.`);
  }

  (draft?.actions || []).forEach((action: any, index: number) => {
    const resolvedWriteAddresses = action?.target
      ? (MacroEngine.resolveAddresses(action.target) || [])
        .filter((address: string) => typeof address === 'string' && address.length > 0 && !address.startsWith('/meters/'))
      : [];
    if (action?.type === 'delay') {
      const ms = Number(action.ms);
      if (Number.isNaN(ms) || ms < 1) {
        errors.push(`Action #${index + 1}: delay must be >= 1 ms.`);
      }
      return;
    }

    if (action?.type === 'fade') {
      const duration = Number(action.durationSec);
      if (Number.isNaN(duration) || duration <= 0) {
        errors.push(`Action #${index + 1}: fade duration must be > 0.`);
      }
      if (action.endVal === undefined || action.endVal === '' || !Number.isFinite(Number(action.endVal))) {
        errors.push(`Action #${index + 1}: fade end value must be numeric.`);
      }
      if (action?.target && isBooleanParameter(action.target.parameter)) {
        warnings.push(`Action #${index + 1}: fade target is boolean, consider OSC action instead.`);
      }
      if (resolvedWriteAddresses.length > MAX_RAMP_ACTION_TARGETS) {
        errors.push(`Action #${index + 1}: ramps support at most ${MAX_RAMP_ACTION_TARGETS} resolved targets.`);
      } else if (resolvedWriteAddresses.length > Math.floor(MAX_RAMP_COMMANDS_PER_SECOND * 0.033)) {
        warnings.push(`Action #${index + 1}: ramp cadence will be reduced to keep command traffic bounded.`);
      }
      return;
    }

    if (action?.type === 'automation_cue') {
      const durationMs = Number(action.durationMs) || ((Number(action.durationSec) || 0) * 1000);
      if (!action?.target) {
        errors.push(`Action #${index + 1}: automation cue requires a target.`);
      }
      if (Number.isNaN(durationMs) || durationMs < 10) {
        errors.push(`Action #${index + 1}: automation cue duration must be at least 10 ms.`);
      }
      if (action.startMode === 'fixed' && (action.startVal === undefined || action.startVal === '')) {
        errors.push(`Action #${index + 1}: fixed start value is required.`);
      }
      if (action.endVal === undefined || action.endVal === '') {
        errors.push(`Action #${index + 1}: automation cue end value is required.`);
      }
      if (resolvedWriteAddresses.length > MAX_RAMP_ACTION_TARGETS) {
        errors.push(`Action #${index + 1}: ramps support at most ${MAX_RAMP_ACTION_TARGETS} resolved targets.`);
      } else if (resolvedWriteAddresses.length > Math.floor(MAX_RAMP_COMMANDS_PER_SECOND * 0.033)) {
        warnings.push(`Action #${index + 1}: ramp cadence will be reduced to keep command traffic bounded.`);
      }
      return;
    }

    if (action?.type === 'automization_control') {
      if (!action.automizationId) {
        errors.push(`Action #${index + 1}: choose an automation to control.`);
      }
      return;
    }

    if (!action?.target) {
      errors.push(`Action #${index + 1}: missing target.`);
    } else if (resolvedWriteAddresses.length > MAX_DISCRETE_ACTION_TARGETS) {
      errors.push(`Action #${index + 1}: discrete writes support at most ${MAX_DISCRETE_ACTION_TARGETS} resolved targets.`);
    }
  });

  if (Array.isArray(draft?.conditions) && draft.conditions.length > 6) {
    warnings.push('Large condition set detected (>6). Consider splitting into smaller macros for maintainability.');
  }

  return {
    errors: Array.from(new Set([...errors, ...targetReport.errors])),
    warnings: Array.from(new Set([...warnings, ...targetReport.warnings])),
    targetReport,
  };
};

const compareLiveValues = (parameter: string | undefined, current: number, target: number, operator: '==' | '!=' | '>' | '<'): boolean => {
  let curNum = current;
  let tarNum = target;

  if (isFaderParameter(parameter) && !Number.isNaN(curNum) && !Number.isNaN(tarNum)) {
    // Keep fader comparisons in dB domain for WING consistency.
    if (tarNum >= 0.0 && tarNum <= 1.0) tarNum = faderFloatToDb(tarNum);
    if (curNum >= 0.0 && curNum <= 1.0) curNum = faderFloatToDb(curNum);
  }

  const epsilon = isFaderParameter(parameter)
    ? 0.1
    : (isMeterParameter(parameter) ? 0.1 : 0.001);
  if (operator === '==') return Math.abs(curNum - tarNum) < epsilon;
  if (operator === '!=') return Math.abs(curNum - tarNum) >= epsilon;
  if (operator === '>') return curNum > tarNum;
  if (operator === '<') return curNum < tarNum;
  return false;
};

const toAutomationNumericValue = (target: Target | null | undefined, rawValue: any): number | null => {
  if (!target) return null;
  const descriptor: any = getParameterDescriptor(target);
  if (descriptor.kind === 'text') return null;
  if (descriptor.kind === 'boolean') {
    if (rawValue === true) return 1;
    const boolNum = Number(rawValue);
    if (!Number.isNaN(boolNum)) return boolNum >= 0.5 ? 1 : 0;
    const boolStr = String(rawValue || '').trim().toLowerCase();
    return boolStr === 'true' || boolStr === 'on' ? 1 : 0;
  }

  const numericValue = Number(rawValue);
  if (Number.isNaN(numericValue)) return null;
  if (descriptor.kind === 'fader') {
    return numericValue >= 0 && numericValue <= 1 ? faderFloatToDb(numericValue) : numericValue;
  }
  if (descriptor.kind === 'pan') {
    return numericValue >= 0 && numericValue <= 1 ? ((numericValue - 0.5) * 200) : numericValue;
  }
  return numericValue;
};

const mapAutomizationTargetValue = (
  target: Target,
  minRaw: string,
  maxRaw: string,
  normalizedRatio: number,
): number | string | null => {
  const descriptor: any = getParameterDescriptor(target);
  if (descriptor.kind === 'text') return null;

  if (descriptor.kind === 'boolean') {
    return normalizedRatio >= 0.5 ? 1 : 0;
  }

  const minValue = toAutomationNumericValue(target, minRaw);
  const maxValue = toAutomationNumericValue(target, maxRaw);
  if (minValue === null || maxValue === null) return null;

  const mappedValue = minValue + (maxValue - minValue) * clampNumber(normalizedRatio, 0, 1);
  return normalizeValueForTarget(target, mappedValue);
};

const buildAutomizationPreflight = (automization: SidebarAutomization | null) => {
  if (!automization) return { errors: [] as string[], warnings: [] as string[] };
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!automization.name.trim()) {
    errors.push('Automation name is required.');
  }

  const sourceAddresses = (MacroEngine.resolveAddresses(automization.sourceTarget) || [])
    .filter((address: string) => typeof address === 'string' && address.length > 0);
  if (sourceAddresses.length === 0) {
    errors.push('Source target does not resolve to a valid WING address.');
  }
  validateCustomOscTarget(automization.sourceTarget, 'Source', errors, warnings);

  const sourceDescriptor: any = getParameterDescriptor(automization.sourceTarget);
  if (sourceDescriptor.kind === 'text') {
    errors.push('Source parameter cannot be text for proportional mapping.');
  }

  const sourceMin = toAutomationNumericValue(automization.sourceTarget, automization.sourceMin);
  const sourceMax = toAutomationNumericValue(automization.sourceTarget, automization.sourceMax);
  if (sourceMin === null || sourceMax === null) {
    errors.push('Source min/max values are invalid for the selected source parameter.');
  } else if (Math.abs(sourceMax - sourceMin) < 0.0001) {
    errors.push('Source range min and max must be different.');
  }

  if (!Array.isArray(automization.targetItems) || automization.targetItems.length === 0) {
    errors.push('At least one target is required.');
  }

  if (automization.targetItems.length > MAX_AUTOMIZATION_TARGETS) {
    warnings.push(`Automation currently has ${automization.targetItems.length} targets; only first ${MAX_AUTOMIZATION_TARGETS} are used.`);
  }

  automization.targetItems.forEach((item, index) => {
    const descriptor: any = getParameterDescriptor(item.target);
    if (String(item.target.parameter || '').startsWith('meter')) {
      errors.push(`Target #${index + 1}: meter parameters are read-only and cannot be automation destinations.`);
    }
    if (descriptor.kind === 'text') {
      errors.push(`Target #${index + 1}: text parameters are not valid for proportional mapping.`);
    }

    const resolved = (MacroEngine.resolveAddresses(item.target) || [])
      .filter((address: string) => typeof address === 'string' && address.length > 0);
    if (resolved.length === 0) {
      errors.push(`Target #${index + 1}: address resolution failed.`);
    }
    validateCustomOscTarget(item.target, `Target #${index + 1}`, errors, warnings);

    const targetMin = toAutomationNumericValue(item.target, item.min);
    const targetMax = toAutomationNumericValue(item.target, item.max);
    if (targetMin === null || targetMax === null) {
      errors.push(`Target #${index + 1}: min/max values are invalid.`);
    }
  });

  return { errors, warnings };
};

const getAllowedOperatorsForTarget = (target: any): ('==' | '!=' | '>' | '<')[] => {
  const descriptor: any = getParameterDescriptor(target);
  if (descriptor.kind === 'boolean' || descriptor.kind === 'text') {
    return ['==', '!='];
  }
  return ['>', '<', '==', '!='];
};

const normalizeOperatorForTarget = (target: any, operator: '==' | '!=' | '>' | '<'): '==' | '!=' | '>' | '<' => {
  const allowed = getAllowedOperatorsForTarget(target);
  return allowed.includes(operator) ? operator : allowed[0];
};

const getMeterAddressLabel = (address: string): string => {
  const parts = address.split('/').filter(Boolean);
  if (parts[1] === 'ch') return `CH ${parts[2]}`;
  if (parts[1] === 'bus') return `BUS ${parts[2]}`;
  if (parts[1] === 'aux') return `AUX ${parts[2]}`;
  if (parts[1] === 'main') return `MAIN ${parts[2]}`;
  if (parts[1] === 'matrix') return `MTX ${parts[2]}`;
  if (parts[1] === 'chv2') return `CH ${parts[2]} ${String(parts[3] || '').replace('_', ' ').toUpperCase()}`.trim();
  if (parts[1] === 'auxv2') return `AUX ${parts[2]} ${String(parts[3] || '').replace('_', ' ').toUpperCase()}`.trim();
  if (parts[1] === 'busv2') return `BUS ${parts[2]} ${String(parts[3] || '').replace('_', ' ').toUpperCase()}`.trim();
  if (parts[1] === 'mainv2') return `MAIN ${parts[2]} ${String(parts[3] || '').replace('_', ' ').toUpperCase()}`.trim();
  if (parts[1] === 'matrixv2') return `MTX ${parts[2]} ${String(parts[3] || '').replace('_', ' ').toUpperCase()}`.trim();
  if (parts[1] === 'dca') return `DCA ${parts[2]}`;
  if (parts[1] === 'fx') return `FX ${parts[2]}`;
  if (parts[1] === 'usb') return `USB ${parts[2]}`;
  if (parts[1] === 'usersig') return `USR ${parts[2]}`;
  if (parts[1] === 'preamp') return `${String(parts[2] || '').toUpperCase()} ${parts[3]}`;
  if (parts[1] === 'output') return `${String(parts[2] || '').toUpperCase()} OUT ${parts[3]}`;
  if (parts[1] === 'monitor') {
    const monLabelMap: Record<string, string> = {
      solo_l: 'MON SOLO L',
      solo_r: 'MON SOLO R',
      mon1_l: 'MON 1 L',
      mon1_r: 'MON 1 R',
      mon2_l: 'MON 2 L',
      mon2_r: 'MON 2 R',
    };
    return monLabelMap[String(parts[2] || '').toLowerCase()] || `MON ${parts[2]}`;
  }
  if (parts[1] === 'rta') return `RTA ${parts[2]}`;
  return address.replace('/meters/', '').toUpperCase();
};

const getMeterEntriesForAddresses = (addresses: string[], meterMap: Record<string, number>) => (
  Array.from(new Set(addresses))
    .filter((address) => typeof address === 'string' && address.startsWith('/meters/'))
    .map((address) => {
      const isStateMeter = address.endsWith('/gate_led') || address.endsWith('/dyn_state');
      return {
        address,
        label: getMeterAddressLabel(address),
        kind: (isStateMeter ? 'state' : 'db') as 'db' | 'state',
        value: typeof meterMap[address] === 'number' ? meterMap[address] : null,
      };
    })
);

const getSignalMeterEntries = (target: any, meterMap: Record<string, number>) => {
  if (!target || typeof target === 'string') return [];

  const parameter = String(target?.parameter || '');
  const probeTarget = isMeterParameter(parameter)
    ? target
    : { ...target, parameter: 'meter' };
  const addresses = (MacroEngine.resolveAddresses(probeTarget) || [])
    .filter((address: string) => typeof address === 'string' && address.startsWith('/meters/'));

  const isStateMeter = parameter === 'meter_v2_gate_led' || parameter === 'meter_v2_dyn_state';
  const entryKind: 'db' | 'state' = isStateMeter ? 'state' : 'db';

  return addresses.map((address: string) => ({
    address,
    label: getMeterAddressLabel(address),
    kind: entryKind,
    value: typeof meterMap[address] === 'number' ? meterMap[address] : null,
  }));
};

type SignalMeterEntry = ReturnType<typeof getSignalMeterEntries>[number];

const getOscEventNumericValue = (evt: any): number | null => {
  const args = Array.isArray(evt?.args) ? evt.args : [];
  const raw = args.length >= 3 ? args[2] : args[0];
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
};

const getMeterFillColor = (dbVal: number | null): string => {
  if (dbVal === null || dbVal <= -84) return '#636366';
  if (dbVal > -3) return danger;
  if (dbVal > -18) return '#FFCC00';
  if (dbVal > -42) return success;
  return '#6FA07D';
};

const getMeterParameterForCategory = (category: string): string => {
  if (category === 'monitor') return 'meter_monitor';
  if (category === 'rta') return 'meter_rta_band';
  return 'meter';
};

const buildMeterTargetForCategory = (category: string, count: number): Target => ({
  type: 'fixed',
  category,
  ids: count > 0 ? `1-${count}` : '',
  parameter: getMeterParameterForCategory(category),
  customAddress: '',
});

const buildMeterGroups = (consoleFamily?: string, consoleModel?: string) => {
  return getAvailableCategoryGroups(consoleFamily).flatMap((group) =>
    group.items.map((item) => {
      const config = getCategoryConfig(item.key, { consoleFamily, consoleModel });
      const target = buildMeterTargetForCategory(item.key, config.count);
      const addresses = (MacroEngine.resolveAddresses(target) || [])
        .filter((address: string) => typeof address === 'string' && address.startsWith('/meters/'));
      return {
        key: item.key,
        label: config.label,
        prefix: config.prefix,
        color: group.color,
        section: group.title,
        count: config.count,
        addresses,
        target,
        custom: false,
        customGroupId: null,
      };
    }).filter((item) => item.addresses.length > 0)
  );
};

const getGlobalMeterOverviewAddresses = (meterGroups: ReturnType<typeof buildMeterGroups>) => {
  const addresses = new Set<string>();
  meterGroups.forEach((group) => {
    if (!GLOBAL_METER_OVERVIEW_GROUP_ALLOWLIST.has(group.key)) return;
    group.addresses
      .slice(0, GLOBAL_METER_OVERVIEW_SAMPLE_PER_GROUP)
      .forEach((address) => addresses.add(address));
  });
  return Array.from(addresses);
};

const MeterRows = ({
  entries,
  maxRows,
  emptyText = 'No meter-capable targets selected yet.',
  waitingText = 'Waiting for realtime meter packets from the WING...',
  actionLabel,
  getActionLabel,
  onActionPress,
  selectionMode = false,
  selectedAddresses = [],
  onSelectionRangeChange,
}: {
  entries: SignalMeterEntry[];
  maxRows: number;
  emptyText?: string;
  waitingText?: string;
  actionLabel?: string;
  getActionLabel?: (entry: SignalMeterEntry) => string;
  onActionPress?: (entry: SignalMeterEntry) => void;
  selectionMode?: boolean;
  selectedAddresses?: string[];
  onSelectionRangeChange?: (addresses: string[], selected: boolean) => void;
}) => {
  const rowLayoutsRef = useRef<Record<number, { y: number; height: number }>>({});
  const dragAnchorIndexRef = useRef<number | null>(null);
  const dragModeRef = useRef<'select' | 'deselect'>('select');
  const lastDragIndexRef = useRef<number | null>(null);
  const visibleEntries = entries.slice(0, maxRows);
  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);
  const selectedAddressSet = useMemo(() => new Set(selectedAddresses), [selectedAddresses]);

  const getDragIndexAtY = useCallback((y: number) => {
    let nearestIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < visibleEntries.length; index += 1) {
      const layout = rowLayoutsRef.current[index];
      if (!layout) continue;
      const start = layout.y;
      const end = layout.y + layout.height;
      if (y >= start && y <= end) return index;
      const distance = y < start ? start - y : y - end;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    return nearestIndex;
  }, [visibleEntries.length]);

  const applySelectionRange = useCallback((targetIndex: number | null) => {
    if (targetIndex === null || !onSelectionRangeChange) return;
    const anchorIndex = dragAnchorIndexRef.current ?? targetIndex;
    const start = Math.max(0, Math.min(anchorIndex, targetIndex));
    const end = Math.min(visibleEntries.length - 1, Math.max(anchorIndex, targetIndex));
    const addresses = visibleEntries.slice(start, end + 1).map((entry) => entry.address);
    onSelectionRangeChange(addresses, dragModeRef.current === 'select');
  }, [onSelectionRangeChange, visibleEntries]);

  const selectionPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => selectionMode && visibleEntries.length > 0,
    onMoveShouldSetPanResponder: () => selectionMode && visibleEntries.length > 0,
    onPanResponderGrant: (event) => {
      const index = getDragIndexAtY(event.nativeEvent.locationY);
      if (index === null) return;
      const entry = visibleEntries[index];
      dragAnchorIndexRef.current = index;
      lastDragIndexRef.current = index;
      dragModeRef.current = selectedAddressSet.has(entry.address) ? 'deselect' : 'select';
      applySelectionRange(index);
    },
    onPanResponderMove: (event) => {
      const index = getDragIndexAtY(event.nativeEvent.locationY);
      if (index === null || index === lastDragIndexRef.current) return;
      lastDragIndexRef.current = index;
      applySelectionRange(index);
    },
    onPanResponderRelease: () => {
      dragAnchorIndexRef.current = null;
      lastDragIndexRef.current = null;
    },
    onPanResponderTerminate: () => {
      dragAnchorIndexRef.current = null;
      lastDragIndexRef.current = null;
    },
  }), [applySelectionRange, getDragIndexAtY, selectedAddressSet, selectionMode, visibleEntries]);

  if (entries.length === 0) {
    return <Text style={styles.vuMeterOfflineText}>{emptyText}</Text>;
  }

  const hasSignalData = entries.some((entry) => entry.value !== null);

  return (
    <View style={[styles.vuMeterStack, selectionMode && styles.vuMeterSelectableStack]}>
      {!hasSignalData ? <Text style={styles.vuMeterOfflineText}>{waitingText}</Text> : null}
      {selectionMode ? (
        <View
          style={styles.meterSelectionDragRail}
          pointerEvents="box-only"
          {...selectionPanResponder.panHandlers}
        />
      ) : null}
      {visibleEntries.map((entry, index) => {
        const resolvedActionLabel = getActionLabel ? getActionLabel(entry) : actionLabel;
        const isSelected = selectedAddressSet.has(entry.address);
        const rowStyle = [
          styles.vuMeterRow,
          selectionMode && styles.vuMeterRowSelectable,
          isSelected && styles.vuMeterRowSelected,
        ];
        const selectionIndicator = selectionMode ? (
          <View style={[styles.meterSelectionIndicator, isSelected && styles.meterSelectionIndicatorSelected]}>
            <Text style={[styles.meterSelectionIndicatorText, isSelected && styles.meterSelectionIndicatorTextSelected]}>
              {isSelected ? '✓' : ''}
            </Text>
          </View>
        ) : null;

        if (entry.kind === 'state') {
          const rawState = entry.value;
          const stateActive = rawState !== null && rawState >= 0.5;
          return (
            <View
              key={entry.address}
              style={rowStyle}
              onLayout={(event) => {
                rowLayoutsRef.current[index] = event.nativeEvent.layout;
              }}
            >
              {selectionIndicator}
              <Text style={styles.vuMeterChannelLabel}>{entry.label}</Text>
              <View style={styles.stateMeterChipTrack}>
                <View style={[styles.stateMeterChip, stateActive ? styles.stateMeterChipOn : styles.stateMeterChipOff]}>
                  <Text style={styles.stateMeterChipText}>{stateActive ? 'ON' : 'OFF'}</Text>
                </View>
              </View>
              <Text style={styles.vuMeterValue}>
                {rawState === null || rawState === undefined || Number.isNaN(rawState)
                  ? '--'
                  : `${Math.round(rawState)}`}
              </Text>
              {!selectionMode && onActionPress && resolvedActionLabel ? (
                <TouchableOpacity style={styles.vuMeterActionBtn} onPress={() => onActionPress(entry)}>
                  <Text style={styles.vuMeterActionBtnText}>{resolvedActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }

        const normalizedDb = entry.value === null ? null : clampNumber(entry.value, METER_DB_MIN, METER_DB_MAX);
        const barWidthPercent = normalizedDb === null ? 0 : meterDbToFillPercent(normalizedDb);

        return (
          <View
            key={entry.address}
            style={rowStyle}
            onLayout={(event) => {
              rowLayoutsRef.current[index] = event.nativeEvent.layout;
            }}
          >
            {selectionIndicator}
            <Text style={styles.vuMeterChannelLabel}>{entry.label}</Text>
            <View style={styles.vuMeterTrack}>
              <View
                style={[
                  styles.vuMeterFill,
                  {
                    width: `${Math.min(Math.max(barWidthPercent, 0), 100)}%`,
                    backgroundColor: getMeterFillColor(normalizedDb),
                  },
                ]}
              />
            </View>
            <Text style={styles.vuMeterValue}>{formatDbValue(normalizedDb)}</Text>
            {!selectionMode && onActionPress && resolvedActionLabel ? (
              <TouchableOpacity style={styles.vuMeterActionBtn} onPress={() => onActionPress(entry)}>
                <Text style={styles.vuMeterActionBtnText}>{resolvedActionLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      {hiddenCount > 0 && (
        <Text style={styles.vuMeterOverflowText}>
          +{hiddenCount} more selected channels
        </Text>
      )}
    </View>
  );
};

const subscribeOscCompat = (address: string, callback: (args: any) => void): (() => void) => {
  const maybeUnsubscribe = (OscManager as any).on(address, callback);
  if (typeof maybeUnsubscribe === 'function') {
    return maybeUnsubscribe;
  }
  if (typeof (OscManager as any).off === 'function') {
    return () => (OscManager as any).off(address, callback);
  }
  return () => {};
};

const createNumericMapBatcher = <T extends Record<string, number | null>,>(
  setMap: React.Dispatch<React.SetStateAction<T>>,
  intervalMs = 40,
) => {
  let pending: Record<string, number> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const updates = pending;
    pending = {};
    if (Object.keys(updates).length === 0) return;
    setMap((previous) => ({ ...previous, ...updates }));
  };

  return {
    push(address: string, value: number) {
      pending[address] = value;
      if (!timer) timer = setTimeout(flush, intervalMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = {};
    },
  };
};

const createCounterMapBatcher = (
  setMap: React.Dispatch<React.SetStateAction<Record<string, number>>>,
  intervalMs = 200,
) => {
  let pending: Record<string, number> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const increments = pending;
    pending = {};
    if (Object.keys(increments).length === 0) return;
    setMap((previous) => {
      const next = { ...previous };
      Object.entries(increments).forEach(([key, amount]) => {
        next[key] = (next[key] || 0) + amount;
      });
      return next;
    });
  };

  return {
    increment(key: string, amount = 1) {
      pending[key] = (pending[key] || 0) + amount;
      if (!timer) timer = setTimeout(flush, intervalMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = {};
    },
  };
};

// Helper to convert the Target Object into a human-readable label
const describeTarget = (target: any): string => {
  if (!target) return 'Unknown Target';
  if (typeof target === 'string') return target;
  if (target.type === 'custom') return target.customAddress || 'Custom';
  
  let paramStr = 'Mute';
  if (target.parameter === 'mute') paramStr = 'Mute';
  else if (target.parameter === 'fdr' || target.parameter === 'fader') paramStr = 'Volume';
  else if (target.parameter === 'pan') paramStr = 'Pan';
  else if (target.parameter === 'lpf_on') paramStr = 'LPF On/Off';
  else if (target.parameter === 'lpf_freq') paramStr = 'LPF Freq';
  else if (target.parameter === 'hpf_on') paramStr = 'HPF On/Off';
  else if (target.parameter === 'hpf_freq') paramStr = 'HPF Freq';
  else if (target.parameter === 'gain') paramStr = 'Gain/Trim';
  else if (target.parameter === 'phantom_48v') paramStr = 'Phantom +48V';
  else if (target.parameter === 'phase') paramStr = 'Phase Invert';
  else if (target.parameter === 'name') paramStr = 'Custom Name';
  else if (target.parameter === 'color') paramStr = 'Color Label';
  else if (target.parameter === 'icon') paramStr = 'Icon ID';
  else if (target.parameter === 'meter') paramStr = 'Audio Meter (dB)';
  else if (target.parameter === 'meter_monitor') paramStr = 'Monitor Meter (dB)';
  else if (target.parameter === 'meter_rta_band') paramStr = 'RTA Band Meter (dB)';
  else if (target.parameter === 'meter_v2_gate_led') paramStr = 'Gate LED State (V2)';
  else if (target.parameter === 'meter_v2_dyn_state') paramStr = 'Dyn Active State (V2)';
  else if (target.parameter === 'meter_v2_automix') paramStr = 'Automix Gain (V2 dB)';
  
  // EQ 6 bandas
  else if (target.parameter === 'eq_on') paramStr = 'EQ Bypass';
  else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_gain')) {
    const b = target.parameter.split('_')[1];
    paramStr = `EQ Band ${b} Gain`;
  } else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_freq')) {
    const b = target.parameter.split('_')[1];
    paramStr = `EQ Band ${b} Freq`;
  } else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_q')) {
    const b = target.parameter.split('_')[1];
    paramStr = `EQ Band ${b} Q (Width)`;
  }
  
  // Dinámicas extendidas
  else if (target.parameter === 'gate_on') paramStr = 'Gate On/Off';
  else if (target.parameter === 'gate_thr') paramStr = 'Gate Thr';
  else if (target.parameter === 'gate_range') paramStr = 'Gate Range';
  else if (target.parameter === 'gate_attack') paramStr = 'Gate Attack';
  else if (target.parameter === 'gate_release') paramStr = 'Gate Release';
  else if (target.parameter === 'gate_type') paramStr = 'Gate Model/Type';
  else if (target.parameter === 'comp_on') paramStr = 'Comp On/Off';
  else if (target.parameter === 'comp_thr') paramStr = 'Comp Thr';
  else if (target.parameter === 'comp_ratio') paramStr = 'Comp Ratio';
  else if (target.parameter === 'comp_attack') paramStr = 'Comp Attack';
  else if (target.parameter === 'comp_release') paramStr = 'Comp Release';
  else if (target.parameter === 'comp_knee') paramStr = 'Comp Knee';
  else if (target.parameter === 'comp_makeup') paramStr = 'Comp Makeup';
  else if (target.parameter === 'comp_type') paramStr = 'Comp Model/Type';
  
  // Ruteo e Insertos
  else if (target.parameter === 'insert_on') paramStr = 'Insert On/Off';

  // Efectos y envíos
  else if (target.parameter === 'fx_mix') paramStr = 'FX Mix';
  else if (target.parameter === 'send_level') paramStr = `Send ${target.sendId || 1} Level`;
  else if (target.parameter === 'send_on') paramStr = `Send ${target.sendId || 1} On/Off`;
  else if (target.parameter === 'load_snapshot') paramStr = 'Load Snapshot';
  else if (target.parameter === 'load_preset') paramStr = 'Load Preset';
  
  let catStr = 'CH';
  if (target.category === 'ch') catStr = 'CH';
  else if (target.category === 'bus') catStr = 'BUS';
  else if (target.category === 'aux') catStr = 'AUX';
  else if (target.category === 'usb') catStr = 'USB';
  else if (target.category === 'main') catStr = 'MAIN';
  else if (target.category === 'matrix') catStr = 'MATRIX';
  else if (target.category === 'fx') catStr = 'FX Slot';
  else if (target.category === 'dca') catStr = 'DCA';
  else if (target.category === 'mutegroup') catStr = 'MuteGrp';
  else if (target.category === 'preamp_local') catStr = 'LOCAL IN';
  else if (target.category === 'preamp_aes50a') catStr = 'AES50-A';
  else if (target.category === 'preamp_aes50b') catStr = 'AES50-B';
  else if (target.category === 'preamp_aes50c') catStr = 'AES50-C';
  else if (target.category === 'preamp_stageconnect') catStr = 'StageConnect';
  else if (target.category === 'preamp_aux') catStr = 'AUX IN';
  else if (target.category === 'preamp_card' || target.category === 'preamp_expansion') catStr = 'CARD IN';
  else if (target.category === 'preamp_module') catStr = 'MODULE IN';
  else if (target.category === 'preamp_usbplayer') catStr = 'USB PLAYER';
  else if (target.category === 'preamp_aesebu') catStr = 'AES/EBU IN';
  else if (target.category === 'preamp_oscillator') catStr = 'OSC';
  else if (target.category === 'preamp_bus') catStr = 'BUS SRC';
  else if (target.category === 'preamp_main') catStr = 'MAIN SRC';
  else if (target.category === 'preamp_matrix') catStr = 'MTX SRC';
  else if (target.category === 'output_local') catStr = 'LOCAL OUT';
  else if (target.category === 'output_aux') catStr = 'AUX OUT';
  else if (target.category === 'output_aes50a') catStr = 'AES50-A OUT';
  else if (target.category === 'output_aes50b') catStr = 'AES50-B OUT';
  else if (target.category === 'output_aes50c') catStr = 'AES50-C OUT';
  else if (target.category === 'output_stageconnect') catStr = 'SC OUT';
  else if (target.category === 'output_usb') catStr = 'USB OUT';
  else if (target.category === 'output_card') catStr = 'CARD OUT';
  else if (target.category === 'output_module') catStr = 'MODULE OUT';
  else if (target.category === 'output_usbrec') catStr = 'USB REC OUT';
  else if (target.category === 'output_aesebu') catStr = 'AES/EBU OUT';
  else if (target.category === 'usersig') catStr = 'UserSig';
  else if (target.category === 'userctrl') catStr = 'UserCtrl';
  else if (target.category === 'monitor') catStr = 'MONITOR';
  else if (target.category === 'rta') catStr = 'RTA';

  return `${catStr} [${target.ids}] ${paramStr}`;
};

const HA_SOURCE_FAMILY_OPTIONS: { key: HaSourceRef['family']; label: string; max: number }[] = [
  { key: 'local', label: 'LOCAL', max: 32 },
  { key: 'aes50a', label: 'AES-A', max: 48 },
  { key: 'aes50b', label: 'AES-B', max: 48 },
  { key: 'aes50c', label: 'AES-C', max: 48 },
];

const HA_TARGET_FAMILY_OPTIONS: { key: HaTargetRef['family']; label: string; max: number }[] = [
  { key: 'ch', label: 'CH', max: 40 },
  { key: 'aux', label: 'AUX', max: 8 },
];

const isHaCompatibleConsoleFamily = (family: any): family is Exclude<HaConsoleFamily, 'unknown'> =>
  family === 'wing' || family === 'x32-family';

const normalizeHaConsoleFamily = (family: any): HaConsoleFamily =>
  isHaCompatibleConsoleFamily(family) ? family : 'unknown';

const formatHaConsoleFamily = (family: HaConsoleFamily | string | null | undefined): string => {
  if (family === 'wing') return 'WING';
  if (family === 'x32-family') return 'X32/M32';
  return 'Unknown';
};

const getHaSourceMax = (family: HaSourceRef['family'], ownerConsoleFamily: HaConsoleFamily = 'unknown'): number => {
  if (ownerConsoleFamily === 'x32-family') {
    if (family === 'local') return 32;
    if (family === 'aes50a' || family === 'aes50b') return 48;
    return 0;
  }
  if (family === 'local') return ownerConsoleFamily === 'wing' ? 24 : 32;
  if (family === 'aes50a' || family === 'aes50b' || family === 'aes50c') return 48;
  return 0;
};

const getHaSourceFamilyOptions = (ownerConsoleFamily: HaConsoleFamily = 'unknown') =>
  HA_SOURCE_FAMILY_OPTIONS.filter((item) => getHaSourceMax(item.key, ownerConsoleFamily) > 0);

const getHaTargetMax = (family: HaTargetRef['family'], endpointConsoleFamily: HaConsoleFamily = 'unknown'): number => {
  if (family === 'aux') return 8;
  return endpointConsoleFamily === 'x32-family' ? 32 : 40;
};

const clampHaSourceIndex = (
  family: HaSourceRef['family'],
  rawIndex: any,
  ownerConsoleFamily: HaConsoleFamily = 'unknown',
): number => {
  const max = getHaSourceMax(family, ownerConsoleFamily);
  const parsed = Number(rawIndex);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(max || 1, parsed));
};

const clampHaTargetIndex = (
  family: HaTargetRef['family'],
  rawIndex: any,
  endpointConsoleFamily: HaConsoleFamily = 'unknown',
): number => {
  const max = getHaTargetMax(family, endpointConsoleFamily);
  const parsed = Number(rawIndex);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(max || 1, parsed));
};

const describeHaSource = (source: HaSourceRef | null | undefined): string => {
  if (!source) return 'Unknown source';
  const config = HA_SOURCE_FAMILY_OPTIONS.find((item) => item.key === source.family);
  return `${config?.label || source.family.toUpperCase()} ${source.index}`;
};

const describeHaTarget = (target: HaTargetRef | null | undefined): string => {
  if (!target) return 'Unknown trim';
  return `${target.family.toUpperCase()} ${target.index} Trim`;
};

const describeHaOwner = (pair: HaPair | null | undefined): string => {
  if (!pair) return '--';
  const endpoint = pair.endpoints[pair.haOwner];
  return endpoint?.label || pair.haOwner.toUpperCase();
};

const getHaFollowerEndpointId = (owner: 'a' | 'b'): 'a' | 'b' => (owner === 'a' ? 'b' : 'a');

const getHaStateVisual = (state: string | null | undefined) => {
  if (state === 'tracking') return { label: 'TRACKING', bg: 'rgba(52, 199, 89, 0.16)', border: success, text: '#D9FFE5' };
  if (state === 'saturated') return { label: 'SATURATED', bg: 'rgba(255, 149, 0, 0.16)', border: '#FF9500', text: '#FFE1B0' };
  if (state === 'needs_resync') return { label: 'NEEDS RESYNC', bg: 'rgba(255, 59, 48, 0.16)', border: danger, text: '#FFD0CC' };
  if (state === 'needs_config') return { label: 'NEEDS CONFIG', bg: 'rgba(255, 204, 0, 0.16)', border: '#FFCC00', text: '#FFF0B2' };
  if (state === 'offline') return { label: 'OFFLINE', bg: 'rgba(99, 99, 102, 0.16)', border: '#636366', text: '#DDD' };
  if (state === 'idle') return { label: 'IDLE', bg: 'rgba(99, 99, 102, 0.12)', border: '#636366', text: '#DDD' };
  return { label: 'DISARMED', bg: 'rgba(255, 179, 87, 0.12)', border: accentPrimary, text: '#D8FBFF' };
};

const getHaEventVisual = (level: string | null | undefined) => {
  if (level === 'error') return { label: 'ERROR', tone: '#FF6B5F', bg: 'rgba(255, 59, 48, 0.12)', border: danger };
  if (level === 'warn') return { label: 'WARN', tone: '#FFBE70', bg: 'rgba(255, 149, 0, 0.12)', border: '#FF9500' };
  if (level === 'success') return { label: 'OK', tone: '#88F0A5', bg: 'rgba(52, 199, 89, 0.12)', border: success };
  return { label: 'INFO', tone: '#8ED6FF', bg: 'rgba(255, 179, 87, 0.10)', border: accentPrimary };
};

const isValidIpv4Address = (value: string | null | undefined) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const numeric = Number(part);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
};

const getHaEndpointStatusVisual = (
  pair: HaPair | null | undefined,
  runtime: any,
  endpointId: 'a' | 'b',
) => {
  const endpoint = pair?.endpoints?.[endpointId];
  const peerEndpoint = pair?.endpoints?.[endpointId === 'a' ? 'b' : 'a'];
  const endpointRuntime = runtime?.endpoints?.[endpointId];
  const rawIp = String(endpoint?.ip || '').trim();
  const peerIp = String(peerEndpoint?.ip || '').trim();
  const configuredPort = Number(endpoint?.oscPort || 2223);
  const activePort = Number(endpointRuntime?.activeOscPort || endpointRuntime?.lastConsoleReplyPort || configuredPort || 2223);
  const sessionConnected = endpointRuntime?.sessionConnected === true;
  const localSocketBound = endpointRuntime?.localSocketBound === true;
  const routeConfigured = endpointRuntime?.routeConfigured === true || Boolean(rawIp);
  const supportLevel = String(endpointRuntime?.consoleSupportLevel || 'unknown').trim();
  const runtimeFamily = normalizeHaConsoleFamily(endpointRuntime?.consoleFamily);
  const unsupportedFamilyDetected = supportLevel === 'unsupported'
    || (runtimeFamily !== 'unknown' && !isHaCompatibleConsoleFamily(runtimeFamily));

  if (!rawIp) {
    return {
      statusKey: 'not_set',
      label: 'NOT SET',
      bg: 'rgba(99, 99, 102, 0.18)',
      border: '#636366',
      text: '#DDD',
      detail: 'Assign an IP address or copy the current console route into this slot.',
      inputBorder: '#3C3C46',
      detailColor: '#8E8E93',
    };
  }

  if (!isValidIpv4Address(rawIp)) {
    return {
      statusKey: 'invalid_ip',
      label: 'INVALID IP',
      bg: 'rgba(255, 59, 48, 0.16)',
      border: danger,
      text: '#FFD0CC',
      detail: `The value "${rawIp}" is not a valid IPv4 address.`,
      inputBorder: danger,
      detailColor: '#FFB4AC',
    };
  }

  if (peerIp && rawIp === peerIp) {
    return {
      statusKey: 'duplicate_ip',
      label: 'DUPLICATE IP',
      bg: 'rgba(255, 149, 0, 0.16)',
      border: '#FF9500',
      text: '#FFE1B0',
      detail: 'Console A and B must target different consoles.',
      inputBorder: '#FF9500',
      detailColor: '#FFD38A',
    };
  }

  if (unsupportedFamilyDetected) {
    return {
      statusKey: 'unsupported',
      label: 'UNSUPPORTED',
      bg: 'rgba(255, 59, 48, 0.16)',
      border: danger,
      text: '#FFD0CC',
      detail: `${endpointRuntime?.consoleDisplayName || endpointRuntime?.consoleModel || 'Detected console'} is not supported for HA compensation in this build.`,
      inputBorder: danger,
      detailColor: '#FFB4AC',
    };
  }

  if (endpointRuntime?.online) {
    const portDetail = activePort !== configuredPort
      ? `Receiving OSC replies from ${rawIp}:${activePort}. Auto-detected active port differs from the saved hint ${configuredPort}.`
      : `Receiving OSC replies from ${rawIp}:${activePort}.`;
    return {
      statusKey: 'online',
      label: 'ONLINE',
      bg: 'rgba(52, 199, 89, 0.16)',
      border: success,
      text: '#D9FFE5',
      detail: portDetail,
      inputBorder: success,
      detailColor: '#7BE09F',
    };
  }

  if (sessionConnected && !localSocketBound) {
    return {
      statusKey: 'socket_init',
      label: 'SOCKET INIT',
      bg: 'rgba(255, 149, 0, 0.16)',
      border: '#FF9500',
      text: '#FFE1B0',
      detail: `Route ${rawIp}:${configuredPort} armed. Waiting for local UDP socket bind before probing replies.`,
      inputBorder: '#FF9500',
      detailColor: '#FFD38A',
    };
  }

  if (sessionConnected && localSocketBound) {
    return {
      statusKey: 'probing',
      label: 'PROBING',
      bg: 'rgba(255, 149, 0, 0.16)',
      border: '#FF9500',
      text: '#FFE1B0',
      detail: `Route armed on ${rawIp}:${configuredPort}. Probing WING 2223 and X32/M32 10023, waiting for OSC replies.`,
      inputBorder: '#FF9500',
      detailColor: '#FFD38A',
    };
  }

  if (routeConfigured) {
    return {
      statusKey: 'route_ready',
      label: 'ROUTE READY',
      bg: 'rgba(142, 142, 147, 0.14)',
      border: '#8E8E93',
      text: '#D9DAE3',
      detail: `Route is configured for ${rawIp}:${configuredPort}, but endpoint probing is not active yet.`,
      inputBorder: '#8E8E93',
      detailColor: '#C6C8D2',
    };
  }

  return {
    statusKey: 'offline',
    label: 'OFFLINE',
    bg: 'rgba(99, 99, 102, 0.16)',
    border: '#636366',
    text: '#DDD',
    detail: `No OSC replies from ${rawIp}:${configuredPort} yet.`,
    inputBorder: '#54545C',
    detailColor: '#B0B3BC',
  };
};

const getHaConnectivitySummary = (pair: HaPair | null | undefined, runtime: any) => {
  if (runtime?.monitoring === false) return 'Monitoring starts when opened';
  const aStatus = getHaEndpointStatusVisual(pair, runtime, 'a').label;
  const bStatus = getHaEndpointStatusVisual(pair, runtime, 'b').label;
  return `A ${aStatus} | B ${bStatus}`;
};

const getHaRuntimeControlState = (pair: HaPair | null | undefined, runtime: any) => {
  if (!pair || !runtime) {
    return {
      canArm: false,
      canDisarm: false,
      canResync: false,
      canCaptureBaseline: false,
      armReason: 'Select an HA setup first.',
      resyncReason: 'Select an HA setup first.',
      captureReason: 'Select an HA setup first.',
    };
  }

  const diagnosticsErrors = Array.isArray(runtime?.diagnostics?.errors) ? runtime.diagnostics.errors : [];
  const ownerId = pair.haOwner;
  const followerId = getHaFollowerEndpointId(ownerId);
  const ownerLabel = pair.endpoints[ownerId]?.label || ownerId.toUpperCase();
  const followerLabel = pair.endpoints[followerId]?.label || followerId.toUpperCase();
  const ownerOnline = runtime?.endpoints?.[ownerId]?.online === true;
  const followerOnline = runtime?.endpoints?.[followerId]?.online === true;
  const hasPreflightErrors = diagnosticsErrors.length > 0;
  const setupEnabled = pair.enabled !== false;
  const armed = runtime?.armed === true;

  let armReason: string | null = null;
  if (!setupEnabled) armReason = 'Enable this HA setup before arming.';
  else if (hasPreflightErrors) armReason = diagnosticsErrors[0];
  else if (!ownerOnline && !followerOnline) armReason = `${ownerLabel} and ${followerLabel} must be online before arming.`;
  else if (!ownerOnline) armReason = `${ownerLabel} must be online before arming.`;
  else if (!followerOnline) armReason = `${followerLabel} must be online before arming.`;
  else if (armed) armReason = 'Compensation is already armed.';

  let resyncReason: string | null = null;
  if (!setupEnabled) resyncReason = 'Enable this HA setup before resync.';
  else if (hasPreflightErrors) resyncReason = diagnosticsErrors[0];
  else if (!ownerOnline && !followerOnline) resyncReason = `${ownerLabel} and ${followerLabel} must be online before resync.`;
  else if (!ownerOnline) resyncReason = `${ownerLabel} must be online before resync.`;
  else if (!followerOnline) resyncReason = `${followerLabel} must be online before resync.`;

  let captureReason: string | null = null;
  if (!armed) captureReason = 'Capture baseline requires an armed HA setup.';

  return {
    canArm: !armReason,
    canDisarm: armed,
    canResync: !resyncReason,
    canCaptureBaseline: !captureReason,
    armReason: armReason || null,
    resyncReason: resyncReason || null,
    captureReason: captureReason || null,
  };
};

const summarizeHaSaturation = (runtime: any) => {
  const targetRows: { targetKey: string; overshoot: number }[] = [];
  Object.values(runtime?.mappings || {}).forEach((mappingRuntime: any) => {
    Object.entries(mappingRuntime?.saturationByTarget || {}).forEach(([targetKey, payload]: any) => {
      const overshoot = Number(payload?.overshoot || 0);
      if (overshoot > 0.05) {
        targetRows.push({ targetKey, overshoot });
      }
    });
  });
  return targetRows.sort((a, b) => b.overshoot - a.overshoot);
};

const formatHaDb = (value: any): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const tenthRounded = Math.round(numeric * 10) / 10;
  const quarterRounded = Math.round(numeric * 4) / 4;
  const precision = Math.abs(quarterRounded - numeric) < 0.001 && Math.abs(tenthRounded - numeric) > 0.001 ? 2 : 1;
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(precision)} dB`;
};

const formatHaPort = (value: any): string => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? String(numeric) : '--';
};

interface Target {
  type: 'fixed' | 'custom';
  category: string;
  ids: string;
  parameter: string;
  customAddress: string;
  sendId?: string;
}

const DEFAULT_UNSELECTED_TARGET: Target = {
  type: 'fixed',
  category: 'ch',
  ids: '',
  parameter: 'mute',
  customAddress: '',
};

type MacroRecord = {
  id?: string;
  name: string;
  enabled?: boolean;
  [key: string]: any;
};

const getMacroIdentity = (macro: MacroRecord | null | undefined): string => {
  if (typeof macro?.id === 'string' && macro.id.trim()) return macro.id.trim();
  if (typeof macro?.name === 'string' && macro.name.trim()) return macro.name.trim();
  return '';
};

const formatMacroRuntimeSummary = (runtime: any): string => {
  if (!runtime) return 'Runtime idle';
  const active = Number(runtime.activeCount || 0);
  const queued = Number(runtime.queuedCount || 0);
  const dropped = Number(runtime.dropped || 0);
  const restarted = Number(runtime.restarted || 0);
  const aborted = Number(runtime.aborted || 0);
  const failed = Number(runtime.failed || 0);
  const parts = [
    active > 0 ? `${active} active` : 'idle',
    queued > 0 ? `${queued} queued` : '',
    failed > 0 ? `${failed} failed` : '',
    aborted > 0 ? `${aborted} aborted` : '',
    dropped > 0 ? `${dropped} dropped` : '',
    restarted > 0 ? `${restarted} restarted` : '',
  ].filter(Boolean);
  return parts.join(' | ');
};

type SidebarAutomization = {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'inverse' | 'direct';
  sourceTarget: Target;
  sourceMin: string;
  sourceMax: string;
  targetItems: {
    id: string;
    target: Target;
    min: string;
    max: string;
  }[];
  deadband: string;
  responseMs: number;
  // Legacy fields kept for migration compatibility only.
  source?: string;
  targets?: number;
};

type HaEndpointConfig = {
  id: 'a' | 'b';
  label: string;
  ip: string;
  oscPort: number;
};

type HaSourceRef = {
  family: 'local' | 'aes50a' | 'aes50b' | 'aes50c';
  index: number;
};

type HaTargetRef = {
  family: 'ch' | 'aux';
  index: number;
};

type HaMapping = {
  id: string;
  name: string;
  enabled: boolean;
  source: HaSourceRef;
  targetsByEndpoint: {
    a: HaTargetRef[];
    b: HaTargetRef[];
  };
};

type HaPair = {
  id: string;
  name: string;
  enabled: boolean;
  haOwner: 'a' | 'b';
  endpoints: {
    a: HaEndpointConfig;
    b: HaEndpointConfig;
  };
  mappings: HaMapping[];
};

type HaRangeDraft = {
  sourceFamily: HaSourceRef['family'];
  sourceStart: string;
  count: string;
  targetFamilyA: HaTargetRef['family'];
  targetStartA: string;
  targetFamilyB: HaTargetRef['family'];
  targetStartB: string;
};

type HaConsoleFamily = 'wing' | 'x32-family' | 'unknown';

const AUTOMIZATIONS_FILE = `${FileSystem.documentDirectory}automizations.json`;
const AUTOMIZATION_SCHEMA_VERSION = 1;
const MAX_AUTOMIZATION_TARGETS = 32;

const createAutoId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const DEFAULT_HA_RANGE_DRAFT: HaRangeDraft = {
  sourceFamily: 'aes50a',
  sourceStart: '1',
  count: '8',
  targetFamilyA: 'ch',
  targetStartA: '1',
  targetFamilyB: 'ch',
  targetStartB: '1',
};

const parseHaPositiveInt = (rawValue: any, fallback = 1): number => {
  const parsed = parseInt(String(rawValue ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildHaRangePlan = (
  draft: HaRangeDraft,
  options: {
    ownerConsoleFamily?: HaConsoleFamily;
    endpointConsoleFamilies?: { a?: HaConsoleFamily; b?: HaConsoleFamily };
  } = {},
) => {
  const ownerConsoleFamily = options.ownerConsoleFamily || 'unknown';
  const endpointConsoleFamilies = options.endpointConsoleFamilies || {};
  const sourceStart = clampHaSourceIndex(draft.sourceFamily, parseHaPositiveInt(draft.sourceStart, 1), ownerConsoleFamily);
  const targetStartA = clampHaTargetIndex(draft.targetFamilyA, parseHaPositiveInt(draft.targetStartA, 1), endpointConsoleFamilies.a || 'unknown');
  const targetStartB = clampHaTargetIndex(draft.targetFamilyB, parseHaPositiveInt(draft.targetStartB, 1), endpointConsoleFamilies.b || 'unknown');
  const requestedCount = Math.max(1, parseHaPositiveInt(draft.count, 1));
  const maxCount = Math.max(
    1,
    Math.min(
      getHaSourceMax(draft.sourceFamily, ownerConsoleFamily) - sourceStart + 1,
      getHaTargetMax(draft.targetFamilyA, endpointConsoleFamilies.a || 'unknown') - targetStartA + 1,
      getHaTargetMax(draft.targetFamilyB, endpointConsoleFamilies.b || 'unknown') - targetStartB + 1,
    ),
  );
  const count = Math.max(1, Math.min(requestedCount, maxCount));
  return {
    sourceStart,
    targetStartA,
    targetStartB,
    requestedCount,
    count,
    truncated: count !== requestedCount,
  };
};

const buildHaRangeMappings = (
  draft: HaRangeDraft,
  existingMappingCount = 0,
  options: {
    ownerConsoleFamily?: HaConsoleFamily;
    endpointConsoleFamilies?: { a?: HaConsoleFamily; b?: HaConsoleFamily };
  } = {},
): { items: HaMapping[]; plan: ReturnType<typeof buildHaRangePlan> } => {
  const plan = buildHaRangePlan(draft, options);
  const items: HaMapping[] = Array.from({ length: plan.count }, (_, offset) => {
    const source = {
      family: draft.sourceFamily,
      index: plan.sourceStart + offset,
    } as HaSourceRef;
    return {
      id: createAutoId('ha_map'),
      name: `${describeHaSource(source)} LINK`,
      enabled: true,
      source,
      targetsByEndpoint: {
        a: [{
          family: draft.targetFamilyA,
          index: plan.targetStartA + offset,
        }],
        b: [{
          family: draft.targetFamilyB,
          index: plan.targetStartB + offset,
        }],
      },
    };
  }).map((item, offset) => ({
    ...item,
    name: `${describeHaSource(item.source)} -> ${describeHaTarget(item.targetsByEndpoint.a[0])} / ${describeHaTarget(item.targetsByEndpoint.b[0])}`,
    id: `${item.id}_${existingMappingCount + offset + 1}`,
  }));

  return { items, plan };
};

const DEFAULT_AUTOMIZATION_SOURCE_TARGET: Target = {
  type: 'fixed',
  category: 'ch',
  ids: '1',
  parameter: 'fader',
  customAddress: '',
};

const DEFAULT_AUTOMIZATION_TARGET_TARGET: Target = {
  type: 'fixed',
  category: 'ch',
  ids: '2',
  parameter: 'fader',
  customAddress: '',
};

const sanitizeTarget = (raw: any, fallback: Target): Target => {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const type = raw.type === 'custom' ? 'custom' : 'fixed';
  const category = raw.type === 'selected'
    ? 'ch'
    : typeof raw.category === 'string' && raw.category.trim()
    ? raw.category.trim()
    : fallback.category;
  const ids = raw.type === 'selected'
    ? '1'
    : typeof raw.ids === 'string'
    ? raw.ids
    : (raw.ids !== undefined && raw.ids !== null ? String(raw.ids) : fallback.ids);
  const parameter = typeof raw.parameter === 'string' && raw.parameter.trim()
    ? raw.parameter.trim()
    : fallback.parameter;
  const customAddress = typeof raw.customAddress === 'string' ? raw.customAddress : '';
  const target: Target = {
    type,
    category,
    ids,
    parameter,
    customAddress,
  };
  if (raw.sendId !== undefined && raw.sendId !== null) {
    target.sendId = String(raw.sendId);
  }
  return target;
};

const getDefaultRangeForTarget = (target: Target): { min: string; max: string } => {
  const descriptor: any = getParameterDescriptor(target);
  if (descriptor.kind === 'boolean') return { min: '0', max: '1' };
  if (descriptor.kind === 'pan') return { min: '-100', max: '100' };
  if (descriptor.kind === 'fader') return { min: '-60.0', max: '0.0' };
  if (descriptor.kind === 'meter') return { min: '-72.0', max: '-6.0' };
  if (descriptor.kind === 'frequency') return { min: '120', max: '8000' };
  if (descriptor.kind === 'integer' || descriptor.kind === 'percent') {
    return {
      min: String(Math.round(Number(descriptor.min ?? 0))),
      max: String(Math.round(Number(descriptor.max ?? 100))),
    };
  }

  const minNum = Number(descriptor.min ?? 0);
  const maxNum = Number(descriptor.max ?? 1);
  const precision = getPrecisionFromStep(descriptor.step ?? 1);
  return {
    min: Number(minNum).toFixed(precision),
    max: Number(maxNum).toFixed(precision),
  };
};

const createDefaultAutomizationTargetItem = (indexHint = 1) => {
  const target = sanitizeTarget(
    {
      ...DEFAULT_AUTOMIZATION_TARGET_TARGET,
      ids: String(Math.min(40, Math.max(1, indexHint + 1))),
    },
    DEFAULT_AUTOMIZATION_TARGET_TARGET
  );
  const defaultRange = getDefaultRangeForTarget(target);
  return {
    id: createAutoId('tgt'),
    target,
    min: defaultRange.min,
    max: defaultRange.max,
  };
};

const sanitizeAutomization = (raw: any, fallbackIndex: number): SidebarAutomization => {
  const safeIndex = fallbackIndex + 1;
  const rawId = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const rawName = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const sourceTarget = sanitizeTarget(raw?.sourceTarget, DEFAULT_AUTOMIZATION_SOURCE_TARGET);
  const sourceDefaultRange = getDefaultRangeForTarget(sourceTarget);
  const parsedResponseMs = Number(raw?.responseMs);
  const parsedDeadband = Number(raw?.deadband);

  const resolvedTargetItems = (() => {
    if (Array.isArray(raw?.targetItems) && raw.targetItems.length > 0) {
      const seenTargetIds = new Set<string>();
      const normalized = raw.targetItems.map((item: any, index: number) => {
        const target = sanitizeTarget(item?.target, createDefaultAutomizationTargetItem(index).target);
        const range = getDefaultRangeForTarget(target);
        let id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : createAutoId('tgt');
        while (seenTargetIds.has(id)) {
          id = createAutoId('tgt');
        }
        seenTargetIds.add(id);
        return {
          id,
          target,
          min: typeof item?.min === 'string' ? item.min : range.min,
          max: typeof item?.max === 'string' ? item.max : range.max,
        };
      });
      return normalized.slice(0, MAX_AUTOMIZATION_TARGETS);
    }

    const parsedTargets = Number(raw?.targets);
    const fallbackCount = Number.isFinite(parsedTargets)
      ? Math.max(1, Math.min(MAX_AUTOMIZATION_TARGETS, Math.round(parsedTargets)))
      : 1;
    return Array.from({ length: fallbackCount }, (_, i) => createDefaultAutomizationTargetItem(i + 1));
  })();

  return {
    id: rawId || createAutoId('auto'),
    name: rawName || `Automation ${safeIndex}`,
    enabled: raw?.enabled === true,
    mode: raw?.mode === 'direct' ? 'direct' : 'inverse',
    sourceTarget,
    sourceMin: typeof raw?.sourceMin === 'string' ? raw.sourceMin : sourceDefaultRange.min,
    sourceMax: typeof raw?.sourceMax === 'string' ? raw.sourceMax : sourceDefaultRange.max,
    targetItems: resolvedTargetItems,
    deadband: Number.isFinite(parsedDeadband) ? String(Math.max(0, parsedDeadband)) : '0.1',
    responseMs: Number.isFinite(parsedResponseMs)
      ? Math.max(20, Math.min(2000, Math.round(parsedResponseMs)))
      : 50,
    source: typeof raw?.source === 'string' ? raw.source : undefined,
    targets: Number.isFinite(Number(raw?.targets)) ? Number(raw.targets) : undefined,
  };
};

const parseAutomizationsPayload = (rawContent: string): SidebarAutomization[] => {
  const parsed = JSON.parse(rawContent);
  const rawItems = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
  const seenIds = new Set<string>();

  return rawItems.slice(0, MAX_AUTOMIZATIONS).map((item: any, index: number) => {
    const normalized = sanitizeAutomization(item, index);
    let dedupedId = normalized.id;
    while (seenIds.has(dedupedId)) {
      dedupedId = `${dedupedId}_${index + 1}`;
    }
    seenIds.add(dedupedId);
    return dedupedId === normalized.id ? normalized : { ...normalized, id: dedupedId };
  });
};

const sanitizeAppPresetsPayload = (raw: any): { items: AppPreset[]; loadedPresetId: string | null } => {
  const rawItems = Array.isArray(raw?.items) ? raw.items.slice(0, MAX_APP_PRESETS) : [];
  const seenIds = new Set<string>();
  const items: AppPreset[] = rawItems.flatMap((item: any, index: number): AppPreset[] => {
    if (!item || typeof item !== 'object') return [];
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : `Show Preset ${index + 1}`;
    let id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : `preset_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
    while (seenIds.has(id)) id = `${id}_${index + 1}`;
    seenIds.add(id);
    const scopes: AppPresetScope = {
      macros: item?.scopes?.macros === true,
      automizations: item?.scopes?.automizations === true,
      ha: item?.scopes?.ha === true,
    };
    if (!scopes.macros && !scopes.automizations && !scopes.ha) return [];
    return [{
      id,
      name,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      isRecovery: item.isRecovery === true,
      scopes,
      ...(scopes.macros ? { macros: (Array.isArray(item.macros) ? item.macros : []).slice(0, MAX_MACROS) } : {}),
      ...(scopes.automizations
        ? { automizations: (Array.isArray(item.automizations) ? item.automizations : []).slice(0, MAX_AUTOMIZATIONS).map(sanitizeAutomization) }
        : {}),
      ...(scopes.ha ? { haPairs: (Array.isArray(item.haPairs) ? item.haPairs : []).slice(0, MAX_HA_PAIRS) } : {}),
    }];
  });
  const requestedLoadedId = typeof raw?.loadedPresetId === 'string' ? raw.loadedPresetId : null;
  return {
    items,
    loadedPresetId: items.some((item) => item.id === requestedLoadedId) ? requestedLoadedId : null,
  };
};

const sanitizeCustomMeterGroupsPayload = (raw: any): CustomMeterGroup[] => {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const seenIds = new Set<string>();
  return rawItems.slice(0, MAX_CUSTOM_METER_GROUPS).flatMap((item: any, index: number): CustomMeterGroup[] => {
    if (!item || typeof item !== 'object') return [];
    const addresses = Array.from(new Set(
      (Array.isArray(item.addresses) ? item.addresses : [])
        .filter((address: any) => typeof address === 'string' && address.startsWith('/meters/'))
    )).slice(0, MAX_CUSTOM_METER_GROUP_ADDRESSES) as string[];
    let id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : createAutoId('meter_group');
    while (seenIds.has(id)) id = `${id}_${index + 1}`;
    seenIds.add(id);
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : `Custom Meters ${index + 1}`;
    if (addresses.length === 0 && /^Custom Meters \d+$/i.test(name)) {
      return [];
    }
    const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now();
    const updatedAt = Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : createdAt;
    return [{ id, name, addresses, createdAt, updatedAt }];
  });
};

const normalizeCustomMeterGroupName = (value: any, fallback: string): string => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, MAX_CUSTOM_METER_GROUP_NAME_LENGTH);
};

function TargetEditor({
  target,
  onChange,
  label,
  uiFontFamily,
  uiTextScale = 1,
  consoleModel,
  consoleFamily,
  meterUiUpdateIntervalMs = 16,
}: {
  target: any,
  onChange: (t: Target) => void,
  label?: string,
  uiFontFamily?: string,
  uiTextScale?: number,
  consoleModel?: string,
  consoleFamily?: string,
  meterUiUpdateIntervalMs?: number,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [objectGridModalVisible, setObjectGridModalVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [subCategory, setSubCategory] = useState<TargetSubCategory>('mix');
  const [selectorMeterMap, setSelectorMeterMap] = useState<Record<string, number>>({});
  const selectorMeterScopeRef = useRef(`target_selector_preview_${Math.floor(Math.random() * 1000000)}`);

  const t: Target = useMemo(() => typeof target === 'string' || !target ? {
    ...DEFAULT_UNSELECTED_TARGET,
    customAddress: typeof target === 'string' ? target : ''
  } : target, [target]);

  const setField = useCallback((key: keyof Target, val: any) => {
    onChange({ ...t, [key]: val });
  }, [onChange, t]);

  const isX32Family = consoleFamily === 'x32-family';

  const getSelectedIds = (idsStr: string): number[] => {
    if (!idsStr) return [];
    const result: number[] = [];
    const parts = idsStr.split(',');
    parts.forEach(part => {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr);
        const end = parseInt(endStr);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            result.push(i);
          }
        }
      } else {
        const num = parseInt(trimmed);
        if (!isNaN(num)) {
          result.push(num);
        }
      }
    });
    return Array.from(new Set(result)).sort((a, b) => a - b);
  };

  const toggleId = (id: number, currentIdsStr: string) => {
    const activeIds = getSelectedIds(currentIdsStr);
    let nextActive: number[];
    if (activeIds.includes(id)) {
      nextActive = activeIds.filter(x => x !== id);
    } else {
      nextActive = [...activeIds, id];
    }
    const formatted = nextActive.sort((a, b) => a - b).join(', ');
    setField('ids', formatted);
  };
  const selectedIds = getSelectedIds(t.ids);
  const scaledText = (baseStyle: any, _fallback = 11) => {
    return [
      baseStyle,
      uiFontFamily ? { fontFamily: uiFontFamily } : null,
    ];
  };

  const availableCategoryGroups = getAvailableCategoryGroups(consoleFamily);
  const availableCategoryKeys = getAvailableCategoryKeys(consoleFamily);
  const categoryConfig = getCategoryConfig(t.category, { consoleFamily, consoleModel });
  const isMixChannel = isMixCategory(t.category);
  const subCategoryOptions = getAvailableSubCategories({
    consoleFamily,
    targetType: t.type,
    category: t.category,
  });
  const effectiveSubCategory = subCategoryOptions.includes(subCategory)
    ? subCategory
    : (subCategoryOptions[0] || 'mix');
  const paramsToShow = getParameterOptionsForTarget({
    consoleFamily,
    targetType: t.type,
    category: t.category,
    subCategory: effectiveSubCategory,
  });
  const categoryIsSupported = availableCategoryKeys.has(t.category);
  const selectorMeterEntries = useMemo(
    () => getSignalMeterEntries(t, selectorMeterMap),
    [selectorMeterMap, t],
  );
  useEffect(() => {
    const meterProbeTarget = {
      ...t,
      ids: objectGridModalVisible || selectedIds.length === 0 ? `1-${categoryConfig.count}` : t.ids,
      parameter: isMeterParameter(t.parameter) ? t.parameter : 'meter',
    };
    const meterAddresses = (MacroEngine.resolveAddresses(meterProbeTarget) || [])
      .filter((addr: string) => typeof addr === 'string' && addr.startsWith('/meters/'));
    const scope = selectorMeterScopeRef.current;
    if (meterAddresses.length === 0) {
      setSelectorMeterMap({});
      OscManager.setWatchedAddresses([], scope);
      return () => OscManager.setWatchedAddresses([], scope);
    }

    const initialMap: Record<string, number> = {};
    meterAddresses.forEach((address: string) => {
      const cache = OscManager.stateCache.get(address);
      if (cache && cache.length > 0) {
        const numeric = Number(cache.length >= 3 ? cache[2] : cache[0]);
        if (Number.isFinite(numeric)) initialMap[address] = numeric;
      }
    });
    setSelectorMeterMap(initialMap);
    OscManager.setWatchedAddresses(meterAddresses, scope);
    const meterAddressSet = new Set(meterAddresses);
    const meterBatcher = createNumericMapBatcher(setSelectorMeterMap, meterUiUpdateIntervalMs);

    const handleStateUpdate = (evt: any) => {
      if (!meterAddressSet.has(evt.address)) return;
      const numeric = getOscEventNumericValue(evt);
      if (numeric === null) return;
      meterBatcher.push(evt.address, numeric);
    };

    const unsubscribe = subscribeOscCompat('wing_state', handleStateUpdate);
    return () => {
      unsubscribe();
      meterBatcher.cancel();
      OscManager.setWatchedAddresses([], scope);
    };
  }, [categoryConfig.count, meterUiUpdateIntervalMs, objectGridModalVisible, selectedIds.length, t]);

  // Auto-corrective hook to prevent incoherent parameters when changing categories
  useEffect(() => {
    const availableSubCategories = getAvailableSubCategories({
      consoleFamily,
      targetType: t.type,
      category: t.category,
    });
    if (availableSubCategories.length > 0 && !availableSubCategories.includes(subCategory)) {
      setSubCategory(availableSubCategories[0]);
      return;
    }
    const resolvedSubCategory = availableSubCategories.includes(subCategory)
      ? subCategory
      : (availableSubCategories[0] || 'mix');
    const validKeys = getParameterOptionsForTarget({
      consoleFamily,
      targetType: t.type,
      category: t.category,
      subCategory: resolvedSubCategory,
    }).map((param) => param.key);
    if (!validKeys.includes(t.parameter) && validKeys.length > 0) {
      setField('parameter', validKeys[0]);
      return;
    }
    if (isX32Family && !categoryIsSupported) {
      setField('category', 'ch');
      setField('ids', '');
      return;
    }
    if (t.type === 'fixed') {
      const maxCount = getCategoryConfig(t.category, { consoleFamily, consoleModel }).count;
      const normalizedIds = getSelectedIds(t.ids).filter((id) => id <= maxCount);
      const normalized = normalizedIds.join(', ');
      if (normalized !== t.ids) {
        setField('ids', normalized);
      }
    }
  }, [
    categoryIsSupported,
    consoleFamily,
    consoleModel,
    isX32Family,
    setField,
    subCategory,
    t.category,
    t.ids,
    t.parameter,
    t.type,
  ]);

  const renderObjectSelector = () => {
    const config = categoryConfig;
    return (
      <>
        <Text style={scaledText(styles.modalSubLabel, 10)}>OBJECTS</Text>
        <View style={styles.selectionSummaryRow}>
          <Text style={scaledText(styles.selectionSummaryText, 10.5)}>
            {selectedIds.length === 0
              ? 'No targets selected.'
              : `${selectedIds.length} selected of ${config.count}.`}
          </Text>
          <TouchableOpacity
            style={styles.gridToggleBtn}
            onPress={() => setObjectGridModalVisible(true)}
          >
            <Text style={scaledText(styles.gridToggleBtnText, 11)}>
              {selectedIds.length > 0 ? 'EDIT TARGETS' : 'SELECT TARGETS'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.gridHelpersRow}>
          <TouchableOpacity
            style={styles.gridHelperBtn}
            onPress={() => {
              const all = Array.from({ length: config.count }, (_, i) => i + 1).join(', ');
              setField('ids', all);
            }}
          >
            <Text style={scaledText(styles.gridHelperBtnText, 11)}>ALL</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridHelperBtn}
            onPress={() => setField('ids', '')}
          >
            <Text style={scaledText(styles.gridHelperBtnText, 11)}>NONE</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridHelperBtn}
            onPress={() => {
              const odds = Array.from({ length: config.count }, (_, i) => i + 1)
                .filter((x) => x % 2 !== 0)
                .join(', ');
              setField('ids', odds);
            }}
          >
            <Text style={scaledText(styles.gridHelperBtnText, 11)}>ODD</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridHelperBtn}
            onPress={() => {
              const evens = Array.from({ length: config.count }, (_, i) => i + 1)
                .filter((x) => x % 2 === 0)
                .join(', ');
              setField('ids', evens);
            }}
          >
            <Text style={scaledText(styles.gridHelperBtnText, 11)}>EVEN</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inlineMeterContainer}>
          <View style={styles.inlineMeterHeader}>
            <Text style={styles.vuMeterLabel}>INLINE METERS</Text>
            <Text style={styles.inlineMeterMeta}>{`${selectorMeterEntries.length} signal${selectorMeterEntries.length === 1 ? '' : 's'}`}</Text>
          </View>
          <MeterRows
            entries={selectorMeterEntries}
            maxRows={Math.min(8, Math.max(4, selectedIds.length || 4))}
            emptyText="Select objects to see their meters here."
            waitingText="Waiting for meter packets for the current selection..."
          />
        </View>

        <Modal
          visible={objectGridModalVisible}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setObjectGridModalVisible(false)}
        >
          <View style={styles.modalBg}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setObjectGridModalVisible(false)} />
            <View style={styles.objectGridModalCard}>
              <View style={styles.objectGridModalHeader}>
                <Text style={scaledText(styles.objectGridModalTitle, 13)}>
                  Select {config.label} Objects
                </Text>
                <TouchableOpacity onPress={() => setObjectGridModalVisible(false)} style={styles.categorySelectorModalCloseBtn}>
                  <Text style={scaledText(styles.categorySelectorModalCloseBtnText, 12)}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.objectGridScroll}
                contentContainerStyle={styles.objectGridContainer}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
              >
                {Array.from({ length: config.count }, (_, i) => i + 1).map((idx) => {
                  const isSelected = selectedIds.includes(idx);
                  const label = `${config.prefix} ${String(idx).padStart(2, '0')}`;
                  const objectTarget = { ...t, ids: String(idx), parameter: isMeterParameter(t.parameter) ? t.parameter : 'meter' };
                  const meterAddress = (MacroEngine.resolveAddresses(objectTarget) || [])
                    .find((address: string) => typeof address === 'string' && address.startsWith('/meters/'));
                  const meterValue = typeof meterAddress === 'string' && typeof selectorMeterMap[meterAddress] === 'number'
                    ? selectorMeterMap[meterAddress]
                    : null;
                  const normalizedDb = meterValue === null ? null : clampNumber(meterValue, METER_DB_MIN, METER_DB_MAX);
                  const meterFillPercent = normalizedDb === null ? 0 : meterDbToFillPercent(normalizedDb);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.objectGridBadge, styles.objectGridMeterBadge, isSelected && styles.objectGridBadgeActive]}
                      onPress={() => toggleId(idx, t.ids)}
                    >
                      <Text style={[...scaledText(styles.objectGridBadgeText, 10), isSelected && styles.objectGridBadgeTextActive]}>
                        {label}
                      </Text>
                      <View style={styles.objectGridMeterTrack}>
                        <View
                          style={[
                            styles.objectGridMeterFill,
                            {
                              width: `${Math.min(Math.max(meterFillPercent, 0), 100)}%`,
                              backgroundColor: getMeterFillColor(normalizedDb),
                            },
                          ]}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={styles.objectGridModalFooter}>
                <TouchableOpacity style={[styles.workspaceSaveBtn, styles.modalApplyBtn]} onPress={() => setObjectGridModalVisible(false)}>
                  <Text style={scaledText(styles.workspaceSaveBtnText, 11)}>APPLY OBJECT SELECTION</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  };

  return (
    <View style={styles.targetEditorCard}>
      {label && <Text style={scaledText(styles.targetEditorLabel, 11)}>{label}</Text>}

      {t.type === 'fixed' && (
        <View style={{ marginTop: 10, gap: 10 }}>
          {/* Category with Elegant Modal Dropdown */}
          <View style={styles.targetPickerHeaderPanel}>
            <View style={styles.targetPickerHeaderCopy}>
              <Text style={scaledText(styles.targetPickerEyebrow, 10)}>TARGET SELECTOR</Text>
              <Text style={scaledText(styles.targetPickerTitle, 14)} numberOfLines={1}>
                {selectedIds.length > 0 ? `${selectedIds.length} ${categoryConfig.prefix}` : 'No objects selected'}
              </Text>
              <Text style={scaledText(styles.targetPickerSubtitle, 11)} numberOfLines={1}>
                {categoryConfig.label} | {describeTarget(t)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.targetPickerCategoryBtn}
              onPress={() => setCategoryModalVisible(true)}
            >
              <View style={[styles.colorBadge, { backgroundColor: categoryConfig.groupColor }]} />
              <Text style={scaledText(styles.targetPickerCategoryBtnText, 11)} numberOfLines={1}>
                {categoryConfig.label}
              </Text>
              <Text style={scaledText(styles.dropdownSelectorChevron, 10)}>▼</Text>
            </TouchableOpacity>
          </View>

          {/* Visual Patchbay Grouped Modal */}
          <Modal visible={categoryModalVisible} animationType="fade" transparent={true} onRequestClose={() => setCategoryModalVisible(false)}>
            <View style={styles.modalBg}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCategoryModalVisible(false)} />
              <View style={styles.categorySelectorModalContent}>
              <View style={styles.categorySelectorModalHeader}>
                  <Text style={scaledText(styles.categorySelectorModalTitle, 14)}>{isX32Family ? 'X32 / M32 OBJECT PATCHBAY' : 'WING ROUTING PATCHBAY'}</Text>
                  <TouchableOpacity onPress={() => setCategoryModalVisible(false)} style={styles.categorySelectorModalCloseBtn}>
                    <Text style={scaledText(styles.categorySelectorModalCloseBtnText, 12)}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={styles.categorySelectorScrollContainer}>
                  {availableCategoryGroups.map((group) => (
                    <View key={group.title} style={styles.categoryGroupCard}>
                      <Text style={[...scaledText(styles.categoryGroupTitle, 11), { color: group.color }]}>{group.title}</Text>
                      <View style={styles.categoryGroupGrid}>
                        {group.items.map((item) => {
                          const isSelected = t.category === item.key;
                          const itemCount = getCategoryConfig(item.key, { consoleFamily, consoleModel }).count;
                          return (
                            <TouchableOpacity
                              key={item.key}
                              style={[
                                styles.categoryGridCardBtn,
                                isSelected && { borderColor: group.color, backgroundColor: 'rgba(255, 255, 255, 0.04)' }
                              ]}
                              onPress={() => {
                                setField('category', item.key);
                                setCategoryModalVisible(false);
                              }}
                            >
                              <Text style={[...scaledText(styles.categoryGridCardBtnText, 11), isSelected && { color: group.color, fontWeight: '800' }]}>
                                {item.label}
                              </Text>
                              <Text style={scaledText(styles.categoryGridCardBtnCount, 9)}>
                                {itemCount} CH
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {renderObjectSelector()}

          {/* Audio Sub-Categories Slider (Only if MixChannel) */}
          {isMixChannel && (
            <>
              <Text style={scaledText(styles.modalSubLabel, 10)}>AUDIO SUB-CATEGORY</Text>
              <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subCategoryScroller}>
                {subCategoryOptions.map((catKey) => (
                  <TouchableOpacity
                    key={catKey}
                    style={[styles.subCatBtn, effectiveSubCategory === catKey && styles.subCatBtnActive]}
                    onPress={() => setSubCategory(catKey)}
                  >
                    <Text style={scaledText(styles.subCatBtnText, 9.5)}>{catKey.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* Filtered Dynamic Parameters Grid */}
          <Text style={scaledText(styles.modalSubLabel, 10)}>PARAMETER</Text>
          <View style={styles.gridContainer}>
            {paramsToShow.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.gridBtn, t.parameter === opt.key && styles.gridBtnActive]}
                onPress={() => setField('parameter', opt.key)}
              >
                <Text style={scaledText(styles.gridBtnText, 10.5)}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Additional Bus Send Selector if 'send_level' or 'send_on' */}
          {(t.parameter === 'send_level' || t.parameter === 'send_on') && (
            <View style={{ marginTop: 5 }}>
              <Text style={scaledText(styles.modalSubLabel, 10)}>TARGET MIX BUS ID (1-16)</Text>
              <TextInput
                style={styles.modalInput}
                value={t.sendId || '1'}
                onChangeText={(val) => setField('sendId', val)}
                placeholder="e.g. 1 (for Mix Bus 1)"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
            </View>
          )}

          {/* Optional manual override for range selectors */}
          <Text style={scaledText(styles.modalSubLabel, 10)}>MANUAL OVERRIDE / CUSTOM ID STRING</Text>
          <TextInput
            style={styles.modalInput}
            value={t.ids}
            onChangeText={(val) => setField('ids', val)}
            placeholder="1, 2, 5 or 1-4"
            placeholderTextColor="#555"
          />
        </View>
      )}

      {t.type === 'custom' && (
        <View style={{ marginTop: 10 }}>
          <Text style={scaledText(styles.modalSubLabel, 10)}>MANUAL OSC ADDR (Developer mode)</Text>
          <TextInput
            style={styles.modalInput}
            value={t.customAddress}
            onChangeText={(val) => setField('customAddress', val)}
            placeholder="/fx/1/delay"
            placeholderTextColor="#555"
          />
          <Text style={[
            styles.customOscHintText,
            String(t.customAddress || '').trim() && !String(t.customAddress || '').trim().startsWith('/') && styles.customOscHintTextError,
          ]}>
            {String(t.customAddress || '').trim()
              ? (String(t.customAddress || '').trim().startsWith('/') ? 'Custom OSC address will be sent exactly as entered.' : 'Custom OSC address must start with "/".')
              : 'Enter a full OSC path, for example /ch/01/mix/on.'}
          </Text>
        </View>
      )}

      {/* Discrete Developer Mode Switch at the Bottom */}
      <View style={styles.devSwitchRow}>
        <Text style={scaledText(styles.devSwitchText, 11)}>Developer Custom OSC Mode</Text>
        <Switch
          value={showAdvanced || t.type === 'custom'}
          onValueChange={(val) => {
            setShowAdvanced(val);
            if (!val && t.type === 'custom') {
              setField('type', 'fixed');
            }
          }}
          trackColor={{ false: '#2A2A2A', true: 'rgba(255, 179, 87, 0.2)' }}
          thumbColor={showAdvanced ? accentPrimary : '#555'}
        />
      </View>
    </View>
  );
}

const SmartValueEditor = ({ target, value, onChange }: { target: Target | null, value: string, onChange: (val: string) => void }) => {
  if (!target) return null;
  const descriptor = getParameterDescriptor(target);
  
  if (descriptor.kind === 'boolean') {
    const isEnabled = value === '1' || value === '1.0' || value === 'true';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
        <Text style={{ color: textPrimary, fontSize: 13, fontWeight: '700' }}>{isEnabled ? 'ON (1.0)' : 'OFF (0.0)'}</Text>
        <Switch 
          value={isEnabled} 
          onValueChange={(val) => onChange(val ? '1' : '0')}
          trackColor={{ false: '#3A3A3C', true: accentPrimary }}
          thumbColor="#FFF"
        />
      </View>
    );
  }

  if (descriptor.kind === 'pan') {
    const rawPan = parseFloat(value);
    const panValue = Number.isNaN(rawPan)
      ? 0
      : clampNumber(rawPan >= 0 && rawPan <= 1 ? (rawPan - 0.5) * 200 : rawPan, PAN_MIN, PAN_MAX);
    return (
      <View style={{ paddingVertical: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
          <Text style={{ color: textMuted, fontSize: 11 }}>L</Text>
          <Text style={{ color: accentPrimary, fontSize: 12, fontWeight: '700' }}>
            {panValue < 0 ? `L${Math.abs(Math.round(panValue))}` : panValue > 0 ? `R${Math.round(panValue)}` : 'C'}
          </Text>
          <Text style={{ color: textMuted, fontSize: 11 }}>R</Text>
        </View>
        <Slider
          style={{ width: '100%', height: 40 }}
          minimumValue={PAN_MIN}
          maximumValue={PAN_MAX}
          step={1}
          value={panValue}
          onValueChange={(val) => onChange(String(Math.round(val)))}
          minimumTrackTintColor={accentPrimary}
          maximumTrackTintColor="#3A3A3C"
          thumbTintColor="#FFF"
        />
        <View style={styles.manualValueBlock}>
          <Text style={styles.manualValueLabel}>{descriptor.manualLabel}</Text>
          <TextInput
            style={[styles.modalInput, styles.manualValueInput]}
            value={value}
            onChangeText={onChange}
            keyboardType="numeric"
            placeholder={descriptor.placeholder}
            placeholderTextColor="#555"
          />
        </View>
      </View>
    );
  }

  if (descriptor.kind === 'fader') {
    const rawVal = parseFloat(value);
    const targetDb = Number.isNaN(rawVal)
      ? -10.0
      : clampNumber(rawVal >= 0.0 && rawVal <= 1.0 ? faderFloatToDb(rawVal) : rawVal, descriptor.min ?? FADER_DB_MIN, descriptor.max ?? FADER_DB_MAX);
    const sliderVal = mapDbToScaledFader(targetDb);
    const fVal = dbToFaderFloat(targetDb);
    const dbVal = targetDb;

    return (
      <View style={{ paddingVertical: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
          <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.minLabel ?? '-oo dB'}</Text>
          <Text style={{ color: accentPrimary, fontSize: 12, fontWeight: '700' }}>
            {formatFaderDbValue(dbVal)} (Fader: {(fVal * 100).toFixed(0)}%)
          </Text>
          <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.maxLabel ?? '+10 dB'}</Text>
        </View>
        <Slider
          style={{ width: '100%', height: 40 }}
          minimumValue={0}
          maximumValue={1}
          step={0}
          value={sliderVal}
          onValueChange={(val) => onChange(mapScaledFaderToDb(val).toFixed(1))}
          minimumTrackTintColor={accentPrimary}
          maximumTrackTintColor="#3A3A3C"
          thumbTintColor="#FFF"
        />
        <View style={styles.manualValueBlock}>
          <Text style={styles.manualValueLabel}>{descriptor.manualLabel}</Text>
          <TextInput
            style={[styles.modalInput, styles.manualValueInput]}
            value={value}
            onChangeText={onChange}
            keyboardType="numeric"
            placeholder={descriptor.placeholder}
            placeholderTextColor="#555"
          />
        </View>
      </View>
    );
  }

  if (descriptor.kind === 'meter') {
    const parsedValue = parseFloat(value);
    const dbValue = Number.isNaN(parsedValue)
      ? -18
      : clampNumber(parsedValue, descriptor.min ?? METER_DB_MIN, descriptor.max ?? METER_DB_MAX);
    const sliderValue = mapDbToScaledMeter(dbValue);

    return (
      <View style={{ paddingVertical: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.minLabel}</Text>
          <Text style={{ color: accentPrimary, fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'center' }}>
            Trigger at {formatDbValue(dbValue)}
          </Text>
          <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.maxLabel}</Text>
        </View>
        <Slider
          style={{ width: '100%', height: 40 }}
          minimumValue={0}
          maximumValue={1}
          step={0}
          value={sliderValue}
          onValueChange={(val) => onChange(mapScaledMeterToDb(val).toFixed(1))}
          minimumTrackTintColor={accentPrimary}
          maximumTrackTintColor="#3A3A3C"
          thumbTintColor="#FFF"
        />
        <View style={styles.manualValueBlock}>
          <Text style={styles.manualValueLabel}>{descriptor.manualLabel}</Text>
          <TextInput
            style={[styles.modalInput, styles.manualValueInput]}
            value={value}
            onChangeText={onChange}
            keyboardType="numeric"
            placeholder={descriptor.placeholder}
            placeholderTextColor="#555"
          />
        </View>
      </View>
    );
  }

  if (descriptor.kind === 'text') {
    return (
      <View style={{ paddingVertical: 10 }}>
        <View style={styles.manualValueBlock}>
          <Text style={styles.manualValueLabel}>{descriptor.manualLabel}</Text>
          <TextInput
            style={[styles.modalInput, styles.manualValueInput, { textAlign: 'left' }]}
            value={value}
            onChangeText={onChange}
            placeholder={descriptor.placeholder}
            placeholderTextColor="#555"
          />
        </View>
      </View>
    );
  }

  const parsedValue = parseFloat(value);
  const min = descriptor.min ?? 0;
  const max = descriptor.max ?? 1;
  const step = descriptor.step ?? 0.001;
  const numericValue = Number.isNaN(parsedValue) ? min : clampNumber(parsedValue, min, max);
  const usesLogSlider = descriptor.kind === 'frequency';
  const sliderValue = usesLogSlider ? frequencyToSliderValue(numericValue, min, max) : numericValue;
  const displayValue = (() => {
    if (descriptor.kind === 'db') return formatDbValue(numericValue);
    if (descriptor.kind === 'frequency') return formatFrequencyValue(numericValue);
    if (descriptor.kind === 'ms') return formatMillisecondsValue(numericValue);
    if (descriptor.kind === 'percent') return formatPercentValue(numericValue);
    if (descriptor.kind === 'ratio') return formatRatioValue(numericValue);
    if (descriptor.kind === 'q') return formatQValue(numericValue);
    if (descriptor.kind === 'integer') return `${Math.round(numericValue)}`;
    return numericValue.toFixed(3);
  })();

  return (
    <View style={{ paddingVertical: 10, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.minLabel ?? `${min}`}</Text>
        <Text style={{ color: accentPrimary, fontSize: 12, fontWeight: '700' }}>{displayValue}</Text>
        <Text style={{ color: textMuted, fontSize: 11 }}>{descriptor.maxLabel ?? `${max}`}</Text>
      </View>
      <Slider
        style={{ width: '100%', height: 40 }}
        minimumValue={usesLogSlider ? 0 : min}
        maximumValue={usesLogSlider ? 1 : max}
        step={usesLogSlider ? 0 : step}
        value={sliderValue}
        onValueChange={(val) => {
          if (descriptor.kind === 'frequency') {
            const frequency = sliderValueToFrequency(val, min, max);
            onChange(String(Math.round(frequency)));
            return;
          }
          if (descriptor.kind === 'integer') {
            onChange(String(Math.round(val)));
            return;
          }
          if (descriptor.kind === 'percent') {
            onChange(String(Math.round(val)));
            return;
          }
          const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
          onChange(val.toFixed(precision));
        }}
        minimumTrackTintColor={accentPrimary}
        maximumTrackTintColor="#3A3A3C"
        thumbTintColor="#FFF"
      />
      <View style={styles.manualValueBlock}>
        <Text style={styles.manualValueLabel}>{descriptor.manualLabel}</Text>
        <TextInput
          style={[styles.modalInput, styles.manualValueInput]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder={descriptor.placeholder}
          placeholderTextColor="#555"
        />
      </View>
    </View>
  );
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const useStackedMacroModal = width < 1100 || height < 760;
  const modalBottomInset = Math.max(insets.bottom, 28);
  const modalTopInset = Math.max(insets.top, 10);
  const modalCardHeight = Math.max(380, height - modalTopInset - modalBottomInset - 20);

  const [ip, setIp] = useState(DEFAULT_UI_SETTINGS.connectionIp);
  const [wingOnline, setWingOnline] = useState(false);
  const [macroStatus, setMacroStatus] = useState('System ready');
  const [macros, setMacros] = useState<MacroRecord[]>([]);
  const [macrosLoaded, setMacrosLoaded] = useState(false);
  const [macroPersistenceBlocked, setMacroPersistenceBlocked] = useState(false);
  const [macroRuntimeMap, setMacroRuntimeMap] = useState<Record<string, any>>({});
  const [uncoveredMacroTriggerAddresses, setUncoveredMacroTriggerAddresses] = useState<string[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [diagnosticsModalVisible, setDiagnosticsModalVisible] = useState(false);
  const [uiSettingsVisible, setUiSettingsVisible] = useState(false);
  const [presetsVisible, setPresetsVisible] = useState(false);
  const [consoleSearchVisible, setConsoleSearchVisible] = useState(false);
  const [consoleSearchRunning, setConsoleSearchRunning] = useState(false);
  const [consoleSearchResults, setConsoleSearchResults] = useState<any[]>([]);
  const [appPresets, setAppPresets] = useState<AppPreset[]>([]);
  const [appPresetsLoaded, setAppPresetsLoaded] = useState(false);
  const [appPresetsPersistenceBlocked, setAppPresetsPersistenceBlocked] = useState(false);
  const [loadedAppPresetId, setLoadedAppPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetScope, setPresetScope] = useState<AppPresetScope>({ macros: true, automizations: true, ha: true });
  const [presetExportFileName, setPresetExportFileName] = useState('wing_show_presets_export');
  const [selectedPresetExportIds, setSelectedPresetExportIds] = useState<string[]>([]);
  const [macroLibraryVisible, setMacroLibraryVisible] = useState(false);
  const [automizationLibraryVisible, setAutomizationLibraryVisible] = useState(false);
  const [haLibraryVisible, setHaLibraryVisible] = useState(false);
  const [macroLibraryEditMode, setMacroLibraryEditMode] = useState(false);
  const [automizationLibraryEditMode, setAutomizationLibraryEditMode] = useState(false);
  const [haLibraryEditMode, setHaLibraryEditMode] = useState(false);
  const [selectedMacroLibraryIds, setSelectedMacroLibraryIds] = useState<string[]>([]);
  const [selectedAutomizationLibraryIds, setSelectedAutomizationLibraryIds] = useState<string[]>([]);
  const [selectedHaLibraryIds, setSelectedHaLibraryIds] = useState<string[]>([]);
  const [textScaleKey, setTextScaleKey] = useState<UiTextScaleKey>(DEFAULT_UI_SETTINGS.textScaleKey);
  const [typographyKey, setTypographyKey] = useState<UiTypographyKey>(DEFAULT_UI_SETTINGS.typographyKey);
  const [densityKey, setDensityKey] = useState<UiDensityKey>(DEFAULT_UI_SETTINGS.densityKey);
  const [showInlineGuides, setShowInlineGuides] = useState(DEFAULT_UI_SETTINGS.showInlineGuides);
  const [meterUiRateKey, setMeterUiRateKey] = useState<MeterUiRateKey>(DEFAULT_UI_SETTINGS.meterUiRateKey);
  const [meterPreviewRows, setMeterPreviewRows] = useState<(typeof METER_PREVIEW_OPTIONS)[number]>(DEFAULT_UI_SETTINGS.meterPreviewRows);
  const [showDiagnostics, setShowDiagnostics] = useState(DEFAULT_UI_SETTINGS.showDiagnostics);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [uiSettingsLoaded, setUiSettingsLoaded] = useState(false);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [pendingWorkspaceRestore, setPendingWorkspaceRestore] = useState<WorkspaceStatePayload | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<any>(() =>
    typeof (OscManager as any).getRuntimeStatus === 'function'
      ? (OscManager as any).getRuntimeStatus()
      : {
          wingOnline: false,
          routeConfigured: false,
          localSocketBound: false,
          connected: false,
          nativeListenPort: 0,
          nativeBinaryReady: false,
          watchedMeterAddressCount: 0,
          activeMeterGroupCount: 0,
          consoleFamily: 'unknown',
          consoleSupportLevel: 'unknown',
          consoleCapabilities: {},
          driverMode: 'unsupported',
        }
  );
  const meterUiUpdateIntervalMs = useMemo(
    () => getMeterUiRateIntervalMs(meterUiRateKey),
    [meterUiRateKey],
  );

  const [macroName, setMacroName] = useState('');
  
  // Paso 1: WHEN (Trigger)
  const [triggerType] = useState<'console'>('console');
  
  // Console Trigger Target
  const [triggerTarget, setTriggerTarget] = useState<Target>(DEFAULT_UNSELECTED_TARGET);
  const [triggerOperator, setTriggerOperator] = useState<'==' | '!=' | '>' | '<'>('==');
  const [triggerEdgeMode, setTriggerEdgeMode] = useState<'on' | 'off' | 'on_off'>('on');
  const [triggerValue, setTriggerValue] = useState('1');
  const [triggerMeterMode, setTriggerMeterMode] = useState<TriggerMeterMode>(DEFAULT_TRIGGER_METER_MODE);
  const [triggerMeterCooldownMs, setTriggerMeterCooldownMs] = useState(String(DEFAULT_TRIGGER_METER_COOLDOWN_MS));
  const [triggerMeterRearmDb, setTriggerMeterRearmDb] = useState(String(DEFAULT_TRIGGER_METER_REARM_DB));
  const [triggerMeterDwellMs, setTriggerMeterDwellMs] = useState(String(DEFAULT_TRIGGER_METER_DWELL_MS));
  const [triggerMeterStaleAfterMs, setTriggerMeterStaleAfterMs] = useState(String(DEFAULT_TRIGGER_METER_STALE_AFTER_MS));
  const [macroOverlapStrategy, setMacroOverlapStrategy] = useState<MacroOverlapStrategy>(DEFAULT_MACRO_OVERLAP_STRATEGY);

  // Paso 2: IF (Conditions)
  const [macroOperator, setMacroOperator] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<any[]>([]);
  
  // Paso 3: THEN (Actions)
  const [actions, setActions] = useState<any[]>([]);

  // Expansion states & dB VU Meter
  const [expandedConditionIndex, setExpandedConditionIndex] = useState<number | null>(null);
  const [expandedActionIndex, setExpandedActionIndex] = useState<number | null>(null);
  const [showAddActionPicker, setShowAddActionPicker] = useState(false);
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [liveMeterVal, setLiveMeterVal] = useState<number | null>(null);
  const [liveSignalMeterMap, setLiveSignalMeterMap] = useState<Record<string, number>>({});
  const [meterWorkspaceOpen, setMeterWorkspaceOpen] = useState(false);
  const [selectedMeterGroupKey, setSelectedMeterGroupKey] = useState('all');
  const [meterGroupModalVisible, setMeterGroupModalVisible] = useState(false);
  const [meterWorkspaceMap, setMeterWorkspaceMap] = useState<Record<string, number>>({});
  const [customMeterGroups, setCustomMeterGroups] = useState<CustomMeterGroup[]>([]);
  const [customMeterGroupsLoaded, setCustomMeterGroupsLoaded] = useState(false);
  const [customMeterGroupsPersistenceBlocked, setCustomMeterGroupsPersistenceBlocked] = useState(false);
  const [selectedCustomMeterGroupId, setSelectedCustomMeterGroupId] = useState<string | null>(null);
  const [customMeterNameModalVisible, setCustomMeterNameModalVisible] = useState(false);
  const [customMeterNameDraft, setCustomMeterNameDraft] = useState('');
  const [customMeterNameSeedAddresses, setCustomMeterNameSeedAddresses] = useState<string[]>([]);
  const [customMeterNameEditingId, setCustomMeterNameEditingId] = useState<string | null>(null);
  const [meterSelectionMode, setMeterSelectionMode] = useState(false);
  const [meterSelectedDraftAddresses, setMeterSelectedDraftAddresses] = useState<string[]>([]);
  const [overviewFocus, setOverviewFocus] = useState<OverviewFocusKind>('global');

  // Split-Screen Workspace States
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);
  const [automizations, setAutomizations] = useState<SidebarAutomization[]>([]);
  const [selectedAutomizationId, setSelectedAutomizationId] = useState<string | null>(null);
  const [selectedHaPairId, setSelectedHaPairId] = useState<string | null>(null);
  const [haSnapshot, setHaSnapshot] = useState<any>({
    loaded: false,
    activePairId: null,
    pairs: [],
    runtimes: {},
  });
  const [haRangeDraft, setHaRangeDraft] = useState<HaRangeDraft>(DEFAULT_HA_RANGE_DRAFT);
  const [automizationsLoaded, setAutomizationsLoaded] = useState(false);
  const [automizationsPersistenceBlocked, setAutomizationsPersistenceBlocked] = useState(false);
  const [automizationLiveValueMap, setAutomizationLiveValueMap] = useState<Record<string, number | null>>({});
  const [automizationDispatchCountMap, setAutomizationDispatchCountMap] = useState<Record<string, number>>({});
  const automizationDispatchRef = useRef<Record<string, { at: number; val: number | string }>>({});
  const persistedAutomizationsRef = useRef<SidebarAutomization[]>([]);
  const haPersistenceAlertRef = useRef(0);
  const haStorageBlockedAlertRef = useRef(false);
  const restoredMacroDraftIdRef = useRef<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const debugLogBufferRef = useRef<string[]>([]);
  const diagnosticLogBufferRef = useRef<string[]>([]);
  const showDiagnosticsRef = useRef(showDiagnostics);
  const diagnosticsModalVisibleRef = useRef(diagnosticsModalVisible);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const macroDraft = {
    name: macroName,
    triggerType,
    triggerTarget,
    triggerOperator,
    triggerEdgeMode,
    triggerValue,
    triggerMeterMode,
    triggerMeterCooldownMs,
    triggerMeterRearmDb,
    triggerMeterDwellMs,
    triggerMeterStaleAfterMs,
    macroOverlapStrategy,
    macroOperator,
    conditions,
    actions,
  };
  const macroPreflight = buildMacroPreflight(macroDraft, runtimeStatus);
  const parsedTriggerThreshold = parseFloat(triggerValue);
  const triggerSignalEntries = getSignalMeterEntries(triggerTarget, liveSignalMeterMap);
  const meterHealth = getMeterHealthDescriptor(runtimeStatus);
  const consoleFamilyDetected = Boolean(runtimeStatus?.consoleFamily && runtimeStatus.consoleFamily !== 'unknown');
  const nativeMetersUnavailableForDetectedConsole = Boolean(
    consoleFamilyDetected && !runtimeStatus?.consoleCapabilities?.nativeMetersV3,
  );
  const triggerMatchState = (() => {
    if (!(selectedMacroId && triggerType === 'console')) return null;
    if (isMeterParameter(triggerTarget?.parameter)) {
      if (Number.isNaN(parsedTriggerThreshold)) return null;
      const values = triggerSignalEntries
        .map((entry) => entry.value)
        .filter((value): value is number => value !== null && value !== undefined && !Number.isNaN(value));
      if (values.length === 0) {
        if (liveMeterVal === null || liveMeterVal === undefined || Number.isNaN(liveMeterVal)) return null;
        return compareLiveValues(triggerTarget?.parameter, liveMeterVal, parsedTriggerThreshold, triggerOperator);
      }
      return values.some((value) => compareLiveValues(triggerTarget?.parameter, value, parsedTriggerThreshold, triggerOperator));
    }

    const currentValue = liveMeterVal;
    if (currentValue === null || currentValue === undefined || Number.isNaN(currentValue) || Number.isNaN(parsedTriggerThreshold)) {
      return null;
    }
    return compareLiveValues(triggerTarget?.parameter, currentValue, parsedTriggerThreshold, triggerOperator);
  })();
  const selectedTextScale = TEXT_SCALE_OPTIONS.find((opt) => opt.key === textScaleKey) ?? TEXT_SCALE_OPTIONS[1];
  const selectedTypography = TYPOGRAPHY_OPTIONS.find((opt) => opt.key === typographyKey) ?? TYPOGRAPHY_OPTIONS[1];
  const appFontFamily = selectedTypography.fontFamily;
  const uiIsCompact = densityKey === 'compact';
  const uiScale = Math.max(0.82, Math.min(selectedTextScale.multiplier, 1.35));
  const buildScaledTextStyle = (baseStyle: any, _fallback = 11) => {
    return [
      baseStyle,
      appFontFamily ? { fontFamily: appFontFamily } : null,
    ];
  };
  const enabledMacroCount = macros.filter((macro) => macro.enabled === true).length;
  const macroPreviewItems = macros;
  const getMacroRuntime = (macro: MacroRecord | null | undefined) => {
    const key = getMacroIdentity(macro);
    return key ? macroRuntimeMap[key] : null;
  };
  const automizationFleetPreflight = useMemo(
    () => buildAutomationFleetPreflight(automizations, (target: Target) => MacroEngine.resolveAddresses(target)),
    [automizations],
  ) as { errorsById: Record<string, string[]> };
  const runnableAutomizations = automizations.filter(
    (item) => item.enabled
      && buildAutomizationPreflight(item).errors.length === 0
      && (automizationFleetPreflight.errorsById[item.id] || []).length === 0
  );
  const enabledAutomizationCount = runnableAutomizations.length;
  const automizationPreviewItems = automizations;
  const selectedAutomization = automizations.find((item) => item.id === selectedAutomizationId) || null;
  const selectedAutomizationLocalPreflight = buildAutomizationPreflight(selectedAutomization);
  const selectedAutomizationPreflight = {
    errors: [
      ...selectedAutomizationLocalPreflight.errors,
      ...(selectedAutomization ? automizationFleetPreflight.errorsById[selectedAutomization.id] || [] : []),
    ],
    warnings: selectedAutomizationLocalPreflight.warnings,
  };
  const selectedAutomizationSourceMin = selectedAutomization
    ? toAutomationNumericValue(selectedAutomization.sourceTarget, selectedAutomization.sourceMin)
    : null;
  const selectedAutomizationSourceMax = selectedAutomization
    ? toAutomationNumericValue(selectedAutomization.sourceTarget, selectedAutomization.sourceMax)
    : null;
  const selectedAutomizationLiveValue = selectedAutomization
    ? automizationLiveValueMap[selectedAutomization.id]
    : null;
  const selectedAutomizationLiveRatio = (() => {
    if (!selectedAutomization || selectedAutomizationSourceMin === null || selectedAutomizationSourceMax === null) return null;
    const live = Number(selectedAutomizationLiveValue);
    if (!Number.isFinite(live)) return null;
    const span = selectedAutomizationSourceMax - selectedAutomizationSourceMin;
    if (Math.abs(span) < 0.0001) return null;
    const directRatio = clampNumber((live - selectedAutomizationSourceMin) / span, 0, 1);
    return selectedAutomization.mode === 'inverse' ? 1 - directRatio : directRatio;
  })();
  const selectedAutomizationFirstTarget = selectedAutomization?.targetItems?.[0] || null;
  const selectedAutomizationPreviewValue = selectedAutomization && selectedAutomizationFirstTarget && selectedAutomizationLiveRatio !== null
    ? mapAutomizationTargetValue(
        selectedAutomizationFirstTarget.target,
        selectedAutomizationFirstTarget.min,
        selectedAutomizationFirstTarget.max,
        selectedAutomizationLiveRatio,
      )
    : null;
  const automizationReadinessCards = selectedAutomization ? [
    {
      key: 'source',
      label: 'Source',
      value: describeTarget(selectedAutomization.sourceTarget),
      detail: `${formatParameterValue(selectedAutomization.sourceTarget, selectedAutomization.sourceMin)} -> ${formatParameterValue(selectedAutomization.sourceTarget, selectedAutomization.sourceMax)}`,
      tone: selectedAutomizationPreflight.errors.some((error) => error.toLowerCase().includes('source')) ? danger : '#FF9500',
    },
    {
      key: 'mode',
      label: 'Mapping',
      value: selectedAutomization.mode === 'inverse' ? 'Inverse' : 'Direct',
      detail: selectedAutomizationLiveRatio === null
        ? `Response ${selectedAutomization.responseMs} ms | deadband ${selectedAutomization.deadband}`
        : `Live ratio ${(selectedAutomizationLiveRatio * 100).toFixed(0)}% | response ${selectedAutomization.responseMs} ms`,
      tone: accentPrimary,
    },
    {
      key: 'targets',
      label: 'Targets',
      value: `${selectedAutomization.targetItems.length} target${selectedAutomization.targetItems.length === 1 ? '' : 's'}`,
      detail: selectedAutomizationFirstTarget
        ? `${describeTarget(selectedAutomizationFirstTarget.target)}${selectedAutomizationPreviewValue !== null ? ` -> ${formatParameterValue(selectedAutomizationFirstTarget.target, selectedAutomizationPreviewValue)}` : ''}`
        : 'No targets configured',
      tone: selectedAutomization.targetItems.length > 0 ? success : danger,
    },
    {
      key: 'preflight',
      label: 'Preflight',
      value: selectedAutomizationPreflight.errors.length > 0
        ? `${selectedAutomizationPreflight.errors.length} error${selectedAutomizationPreflight.errors.length === 1 ? '' : 's'}`
        : selectedAutomizationPreflight.warnings.length > 0
          ? `${selectedAutomizationPreflight.warnings.length} warning${selectedAutomizationPreflight.warnings.length === 1 ? '' : 's'}`
          : 'Ready',
      detail: selectedAutomizationPreflight.errors[0] || selectedAutomizationPreflight.warnings[0] || 'Mapping can run when enabled and source updates arrive',
      tone: selectedAutomizationPreflight.errors.length > 0 ? danger : selectedAutomizationPreflight.warnings.length > 0 ? '#FF9500' : success,
    },
  ] : [];
  const haPairs: HaPair[] = useMemo(
    () => Array.isArray(haSnapshot?.pairs) ? haSnapshot.pairs : [],
    [haSnapshot?.pairs],
  );
  const storageRecoveryRequired = macroPersistenceBlocked
    || automizationsPersistenceBlocked
    || appPresetsPersistenceBlocked
    || haSnapshot?.persistenceBlocked === true;
  const enabledHaPairCount = haPairs.filter((item) => item.enabled !== false).length;
  const haPreviewItems = haPairs;
  const selectedHaPair: HaPair | null = haPairs.find((item) => item.id === selectedHaPairId) || null;
  const selectedHaRuntime = selectedHaPairId ? haSnapshot?.runtimes?.[selectedHaPairId] : null;
  const currentConsoleFamilyForHa = normalizeHaConsoleFamily(runtimeStatus?.consoleFamily);
  const currentConsoleSupportsHa = runtimeStatus?.consoleCapabilities?.haCompensation === true && isHaCompatibleConsoleFamily(currentConsoleFamilyForHa);
  const selectedHaOwnerConsoleFamily: HaConsoleFamily = selectedHaPair
    ? normalizeHaConsoleFamily(selectedHaRuntime?.endpoints?.[selectedHaPair.haOwner]?.consoleFamily)
    : 'unknown';
  const selectedHaEndpointConsoleFamilies = {
    a: normalizeHaConsoleFamily(selectedHaRuntime?.endpoints?.a?.consoleFamily),
    b: normalizeHaConsoleFamily(selectedHaRuntime?.endpoints?.b?.consoleFamily),
  };
  const selectedHaSourceFamilyOptions = getHaSourceFamilyOptions(selectedHaOwnerConsoleFamily);
  const haRangePlan = buildHaRangePlan(haRangeDraft, {
    ownerConsoleFamily: selectedHaOwnerConsoleFamily,
    endpointConsoleFamilies: selectedHaEndpointConsoleFamilies,
  });
  const selectedHaMappingViews = Array.isArray(selectedHaRuntime?.mappingViews) ? selectedHaRuntime.mappingViews : [];
  const selectedHaEventLog = Array.isArray(selectedHaRuntime?.eventLog) ? selectedHaRuntime.eventLog : [];
  const selectedHaControlState = getHaRuntimeControlState(selectedHaPair, selectedHaRuntime);
  const selectedHaStateVisual = getHaStateVisual(selectedHaRuntime?.pairState);
  const selectedHaFollowerEndpointId = selectedHaPair ? getHaFollowerEndpointId(selectedHaPair.haOwner) : 'b';
  const selectedHaEnabledMappingCount = selectedHaPair
    ? selectedHaPair.mappings.filter((mapping) => mapping.enabled !== false).length
    : 0;
  const selectedHaSaturationCount = summarizeHaSaturation(selectedHaRuntime).length;
  const selectedHaLatestEvent = selectedHaEventLog[0] || null;
  const selectedHaEndpointAVisual = selectedHaPair ? getHaEndpointStatusVisual(selectedHaPair, selectedHaRuntime, 'a') : null;
  const selectedHaEndpointBVisual = selectedHaPair ? getHaEndpointStatusVisual(selectedHaPair, selectedHaRuntime, 'b') : null;
  const selectedHaOperationalCards = selectedHaPair ? [
    {
      key: 'runtime',
      label: 'Runtime',
      value: selectedHaStateVisual.label,
      detail: selectedHaRuntime?.armed
        ? 'Armed and applying live compensation'
        : (selectedHaControlState.armReason || 'Disarmed and ready for preflight'),
      tone: selectedHaStateVisual.border,
    },
    {
      key: 'roles',
      label: 'Owner / Follower',
      value: `${describeHaOwner(selectedHaPair)} -> ${selectedHaPair.endpoints[selectedHaFollowerEndpointId].label}`,
      detail: `${formatHaConsoleFamily(selectedHaOwnerConsoleFamily)} owner | ${formatHaConsoleFamily(selectedHaEndpointConsoleFamilies[selectedHaFollowerEndpointId])} follower`,
      tone: accentPrimary,
    },
    {
      key: 'endpoints',
      label: 'Endpoints',
      value: getHaConnectivitySummary(selectedHaPair, selectedHaRuntime),
      detail: `A ${selectedHaEndpointAVisual?.label || '--'} | B ${selectedHaEndpointBVisual?.label || '--'}`,
      tone: selectedHaEndpointAVisual?.statusKey === 'online' && selectedHaEndpointBVisual?.statusKey === 'online' ? success : '#FF9500',
    },
    {
      key: 'links',
      label: 'Mappings',
      value: `${selectedHaEnabledMappingCount}/${selectedHaPair.mappings.length} enabled`,
      detail: selectedHaSaturationCount > 0
        ? `${selectedHaSaturationCount} saturation item${selectedHaSaturationCount === 1 ? '' : 's'} need attention`
        : (selectedHaLatestEvent ? `Last event: ${formatElapsedRuntime(selectedHaLatestEvent.at)}` : 'No runtime events yet'),
      tone: selectedHaSaturationCount > 0 ? '#FF9500' : selectedHaPair.mappings.length > 0 ? success : '#8E8E93',
    },
  ] : [];
  const activeHaPair: HaPair | null = haPairs.find((item) => item.id === haSnapshot?.activePairId) || null;

  useEffect(() => {
    setHaRangeDraft((prev) => {
      const validSourceOptions = getHaSourceFamilyOptions(selectedHaOwnerConsoleFamily);
      const fallbackSourceFamily = validSourceOptions.some((option) => option.key === prev.sourceFamily)
        ? prev.sourceFamily
        : (validSourceOptions[0]?.key || prev.sourceFamily);
      const next = {
        ...prev,
        sourceFamily: fallbackSourceFamily,
        sourceStart: String(clampHaSourceIndex(fallbackSourceFamily, prev.sourceStart, selectedHaOwnerConsoleFamily)),
        targetStartA: String(clampHaTargetIndex(prev.targetFamilyA, prev.targetStartA, selectedHaEndpointConsoleFamilies.a)),
        targetStartB: String(clampHaTargetIndex(prev.targetFamilyB, prev.targetStartB, selectedHaEndpointConsoleFamilies.b)),
      };
      if (
        next.sourceFamily === prev.sourceFamily
        && next.sourceStart === prev.sourceStart
        && next.targetStartA === prev.targetStartA
        && next.targetStartB === prev.targetStartB
      ) {
        return prev;
      }
      return next;
    });
  }, [selectedHaOwnerConsoleFamily, selectedHaEndpointConsoleFamilies.a, selectedHaEndpointConsoleFamilies.b]);
  const activeHaRuntime = activeHaPair ? haSnapshot?.runtimes?.[activeHaPair.id] : null;
  const currentWingRouteIp = String(((OscManager as any).wingIp || ip || '')).trim();
  const currentWingRoutePort = Number((OscManager as any).wingPort || 2223) || 2223;
  const consoleFamilyLabel = runtimeStatus?.consoleFamily === 'wing'
    ? 'WING'
    : runtimeStatus?.consoleFamily === 'x32-family'
      ? 'X32/M32-family'
      : 'Unknown';
  const consoleSupportLabel = runtimeStatus?.consoleSupportLevel === 'full'
    ? 'Supported'
    : runtimeStatus?.consoleSupportLevel === 'partial'
      ? 'Partial'
    : runtimeStatus?.consoleSupportLevel === 'unsupported'
      ? 'Unsupported'
      : 'Unknown';
  const sessionConnected = runtimeStatus?.connected === true;
  const routeConfigured = runtimeStatus?.routeConfigured === true;
  const localSocketBound = runtimeStatus?.localSocketBound === true || Number(runtimeStatus?.nativeListenPort || 0) > 0;
  const consoleDisplayName = runtimeStatus?.consoleDisplayName || runtimeStatus?.consoleModel || (wingOnline ? 'Console online' : 'Offline');
  const consoleUnsupported = (sessionConnected || wingOnline) && runtimeStatus?.consoleSupportLevel === 'unsupported';
  const consolePartial = (sessionConnected || wingOnline) && runtimeStatus?.consoleSupportLevel === 'partial';
  const macroActionCounts = actions.reduce((acc: Record<string, number>, action: any) => {
    const key = action?.type === 'delay'
      ? 'delay'
      : action?.type === 'fade'
        ? 'fade'
        : action?.type === 'automation_cue'
          ? 'automation'
          : action?.type === 'automization_control'
            ? 'control'
            : 'osc';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { osc: 0, delay: 0, fade: 0 });
  const macroReadinessCards = [
    {
      key: 'trigger',
      label: 'Trigger',
      value: 'Console telemetry',
      detail: `${describeTarget(triggerTarget)} ${triggerOperator} ${formatParameterValue(triggerTarget, triggerValue)}`,
      tone: accentPrimary,
    },
    {
      key: 'gates',
      label: 'IF Gates',
      value: conditions.length === 0 ? 'None' : `${conditions.length} rule${conditions.length === 1 ? '' : 's'}`,
      detail: conditions.length === 0 ? 'Trigger runs directly' : `${macroOperator}: ${conditions.length === 1 ? 'single gate' : 'gated evaluation'}`,
      tone: conditions.length === 0 ? '#8E8E93' : '#FFCC00',
    },
    {
      key: 'actions',
      label: 'THEN Timeline',
      value: `${actions.length} cue${actions.length === 1 ? '' : 's'}`,
      detail: `${macroActionCounts.osc || 0} OSC | ${macroActionCounts.delay || 0} wait | ${macroActionCounts.fade || 0} fade | ${macroActionCounts.automation || 0} automation | ${macroActionCounts.control || 0} control`,
      tone: actions.length > 0 ? success : danger,
    },
    {
      key: 'preflight',
      label: 'Preflight',
      value: macroPreflight.errors.length > 0
        ? `${macroPreflight.errors.length} error${macroPreflight.errors.length === 1 ? '' : 's'}`
        : macroPreflight.warnings.length > 0
          ? `${macroPreflight.warnings.length} warning${macroPreflight.warnings.length === 1 ? '' : 's'}`
          : 'Ready',
      detail: macroPreflight.errors[0] || macroPreflight.warnings[0] || 'Saveable when checks stay clear',
      tone: macroPreflight.errors.length > 0 ? danger : macroPreflight.warnings.length > 0 ? '#FF9500' : success,
    },
  ];
  const consoleConnectionTone = consoleUnsupported || consolePartial
    ? '#FF9500'
    : wingOnline
      ? success
      : sessionConnected
        ? '#FF9500'
        : routeConfigured ? '#8E8E93' : '#6F6F7E';
  const consoleConnectionBg = consoleUnsupported || consolePartial
    ? 'rgba(255, 149, 0, 0.12)'
    : wingOnline
      ? 'rgba(52, 199, 89, 0.12)'
      : sessionConnected
        ? 'rgba(255, 149, 0, 0.12)'
        : routeConfigured ? 'rgba(142, 142, 147, 0.08)' : 'rgba(111, 111, 126, 0.08)';
  const haAttentionCount = haPairs.filter((item) => {
    const state = haSnapshot?.runtimes?.[item.id]?.pairState;
    return state === 'needs_config' || state === 'needs_resync' || state === 'saturated';
  }).length;
  const homeMacroItems = [...macros].sort((a, b) => Number(b.enabled === true) - Number(a.enabled === true));
  const homeAutomizationItems = automizations;
  const homeHaItems = haPairs;
  const homePulseCards = [
    {
      key: 'connection',
      title: 'Connection',
      value: wingOnline ? consoleDisplayName : sessionConnected ? 'Awaiting Reply' : routeConfigured ? 'Route Ready' : 'No Route',
      sub: sessionConnected
        ? `${consoleFamilyLabel} | ${consoleSupportLabel} | Local UDP ${localSocketBound ? (runtimeStatus?.nativeListenPort || '--') : 'binding...'}` 
        : routeConfigured
          ? `Configured route ${currentWingRouteIp || '--'}:${currentWingRoutePort || '--'}`
          : 'No active route',
      tone: consoleConnectionTone,
      bg: consoleConnectionBg,
    },
    {
      key: 'ha',
      title: 'HA Live',
      value: activeHaPair ? activeHaPair.name : 'No armed pair',
      sub: activeHaPair
        ? `${getHaStateVisual(activeHaRuntime?.pairState).label} | Owner ${describeHaOwner(activeHaPair)} | ${getHaConnectivitySummary(activeHaPair, activeHaRuntime)}`
        : 'Compensation idle',
      tone: activeHaPair ? success : '#8E8E93',
      bg: activeHaPair ? 'rgba(52, 199, 89, 0.12)' : 'rgba(142, 142, 147, 0.08)',
    },
  ];
  const appVersionLabel = Constants.nativeAppVersion || Constants.expoConfig?.version || '1.0.113';
  const currentWorkspace: WorkspaceKind = selectedMacroId
    ? 'macro'
    : selectedAutomizationId
      ? 'automization'
      : selectedHaPairId
        ? 'ha'
        : meterWorkspaceOpen
          ? 'meters'
          : 'overview';
  const operationalStatusLabel = consoleUnsupported
    ? 'UNSUPPORTED FAMILY'
    : consolePartial
      ? 'PARTIAL COMPATIBILITY'
      : wingOnline
        ? 'CONSOLE ONLINE'
        : sessionConnected
          ? 'PROBING ROUTE'
          : routeConfigured
            ? 'ROUTE READY'
            : 'NO ROUTE';
  const operationalStatusText = consoleUnsupported
    ? `${consoleDisplayName} is detected, but this build will only probe it. Managed writes stay blocked.`
    : consolePartial
      ? `${consoleDisplayName} is detected with limited support. Use Diagnostics for driver and capability details.`
      : wingOnline
        ? `${consoleDisplayName} is replying. ${activeHaPair ? `Active HA setup: ${activeHaPair.name}.` : 'HA compensation is idle.'}`
        : sessionConnected
          ? `${localSocketBound ? 'Local UDP is bound' : 'Local UDP is initializing'}; waiting for a console reply on ${currentWingRouteIp || '--'}:${currentWingRoutePort || '--'}.`
          : routeConfigured
            ? `Route ${currentWingRouteIp || '--'}:${currentWingRoutePort || '--'} is configured. Press CONNECT to start probing.`
            : 'No console route is configured yet.';
  const loadedAppPreset = appPresets.find((preset) => preset.id === loadedAppPresetId) || null;
  const loadedAppPresetModified = useMemo(() => Boolean(loadedAppPreset && (
    (loadedAppPreset.scopes.macros && JSON.stringify(loadedAppPreset.macros || []) !== JSON.stringify(macros))
    || (loadedAppPreset.scopes.automizations && JSON.stringify(loadedAppPreset.automizations || []) !== JSON.stringify(automizations))
    || (loadedAppPreset.scopes.ha && JSON.stringify(loadedAppPreset.haPairs || []) !== JSON.stringify(haPairs))
  )), [automizations, haPairs, loadedAppPreset, macros]);
  const meterGroups = useMemo(
    () => buildMeterGroups(runtimeStatus?.consoleFamily, runtimeStatus?.consoleModel),
    [runtimeStatus?.consoleFamily, runtimeStatus?.consoleModel],
  );
  const customMeterViewGroups = useMemo(() => customMeterGroups.filter((group) =>
    group.addresses.length > 0 || `custom:${group.id}` === selectedMeterGroupKey
  ).map((group) => ({
    key: `custom:${group.id}`,
    label: group.name,
    prefix: 'CUSTOM',
    color: success,
    section: 'CUSTOM METER GROUPS',
    count: group.addresses.length,
    addresses: group.addresses,
    target: null,
    custom: true,
    customGroupId: group.id,
  })), [customMeterGroups, selectedMeterGroupKey]);
  const allMeterGroups = useMemo(
    () => [...customMeterViewGroups, ...meterGroups],
    [customMeterViewGroups, meterGroups],
  );
  const selectedMeterGroup = selectedMeterGroupKey === 'all'
    ? null
    : (allMeterGroups.find((group) => group.key === selectedMeterGroupKey) || null);
  const selectedMeterAddresses = useMemo(() => {
    if (selectedMeterGroup) return selectedMeterGroup.addresses;
    return getGlobalMeterOverviewAddresses(meterGroups);
  }, [meterGroups, selectedMeterGroup]);
  const totalMeterAddressCount = useMemo(
    () => Array.from(new Set(meterGroups.flatMap((group) => group.addresses))).length,
    [meterGroups],
  );
  const globalMeterOverviewAddressCount = useMemo(
    () => getGlobalMeterOverviewAddresses(meterGroups).length,
    [meterGroups],
  );
  const activeCustomMeterGroup = useMemo(
    () => customMeterGroups.find((group) => group.id === selectedCustomMeterGroupId) || customMeterGroups[0] || null,
    [customMeterGroups, selectedCustomMeterGroupId],
  );
  const meterWorkspaceEntries = useMemo(() => {
    if (selectedMeterGroup?.custom) return getMeterEntriesForAddresses(selectedMeterGroup.addresses, meterWorkspaceMap);
    if (selectedMeterGroup?.target) return getSignalMeterEntries(selectedMeterGroup.target, meterWorkspaceMap);
    return meterGroups.map((group) => {
      const values = group.addresses
        .map((address) => meterWorkspaceMap[address])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const peak = values.length > 0 ? Math.max(...values) : null;
      return {
        address: `group:${group.key}`,
        label: group.label,
        kind: 'db' as const,
        value: peak,
      };
    });
  }, [meterGroups, meterWorkspaceMap, selectedMeterGroup]);
  const meterSelectableAddresses = useMemo(
    () => meterWorkspaceEntries
      .map((entry) => entry.address)
      .filter((address) => address.startsWith('/meters/')),
    [meterWorkspaceEntries],
  );
  const meterSelectedDraftCount = meterSelectedDraftAddresses.length;
  const meterSelectionRangePresets = useMemo(() => {
    const chunks: { label: string; addresses: string[] }[] = [];
    const chunkSize = 8;
    const maxChunks = 6;
    for (let start = 0; start < meterSelectableAddresses.length && chunks.length < maxChunks; start += chunkSize) {
      const end = Math.min(start + chunkSize, meterSelectableAddresses.length);
      chunks.push({
        label: `${start + 1}-${end}`,
        addresses: meterSelectableAddresses.slice(start, end),
      });
    }
    return chunks;
  }, [meterSelectableAddresses]);
  const meterSelectionContextLabel = selectedMeterGroup
    ? selectedMeterGroup.label
    : 'VIEW';

  useEffect(() => {
    setMeterSelectionMode(false);
    setMeterSelectedDraftAddresses([]);
  }, [selectedMeterGroupKey]);

  const clearMeterSelection = useCallback(() => {
    setMeterSelectedDraftAddresses([]);
  }, []);

  const closeMeterSelectionMode = useCallback(() => {
    setMeterSelectionMode(false);
    setMeterSelectedDraftAddresses([]);
  }, []);

  const setAllMeterSelection = useCallback(() => {
    setMeterSelectedDraftAddresses(Array.from(new Set(meterSelectableAddresses)).slice(0, MAX_CUSTOM_METER_GROUP_ADDRESSES));
  }, [meterSelectableAddresses]);

  const applyMeterSelectionRange = useCallback((addresses: string[], selected: boolean) => {
    const normalized = addresses.filter((address) => address.startsWith('/meters/'));
    if (normalized.length === 0) return;
    setMeterSelectedDraftAddresses((prev) => {
      const next = new Set(prev);
      normalized.forEach((address) => {
        if (selected) {
          if (next.size < MAX_CUSTOM_METER_GROUP_ADDRESSES || next.has(address)) next.add(address);
        } else {
          next.delete(address);
        }
      });
      return Array.from(next);
    });
  }, []);

  const selectMeterRangePreset = useCallback((addresses: string[]) => {
    applyMeterSelectionRange(addresses, true);
  }, [applyMeterSelectionRange]);

  const createCustomMeterGroup = useCallback((seedAddresses: string[] = [], requestedName?: string) => {
    if (customMeterGroups.length >= MAX_CUSTOM_METER_GROUPS) {
      setMacroStatus(`Custom meter group limit reached (${MAX_CUSTOM_METER_GROUPS}).`);
      return;
    }
    const now = Date.now();
    const fallbackName = `Meter Group ${customMeterGroups.length + 1}`;
    const nextGroup: CustomMeterGroup = {
      id: createAutoId('meter_group'),
      name: normalizeCustomMeterGroupName(requestedName, fallbackName),
      addresses: Array.from(new Set(seedAddresses.filter((address) => address.startsWith('/meters/'))))
        .slice(0, MAX_CUSTOM_METER_GROUP_ADDRESSES),
      createdAt: now,
      updatedAt: now,
    };
    setCustomMeterGroups((prev) => [...prev, nextGroup]);
    setSelectedCustomMeterGroupId(nextGroup.id);
    setSelectedMeterGroupKey(`custom:${nextGroup.id}`);
    setMacroStatus(`${nextGroup.name} created.`);
  }, [customMeterGroups.length]);

  const openCustomMeterNameModal = useCallback((seedAddresses: string[] = [], editingGroupId: string | null = null) => {
    const editingGroup = editingGroupId
      ? customMeterGroups.find((group) => group.id === editingGroupId) || null
      : null;
    setCustomMeterNameEditingId(editingGroup?.id || null);
    setCustomMeterNameSeedAddresses(Array.from(new Set(seedAddresses.filter((address) => address.startsWith('/meters/')))));
    setCustomMeterNameDraft(editingGroup?.name || `Meter Group ${customMeterGroups.length + 1}`);
    setCustomMeterNameModalVisible(true);
  }, [customMeterGroups]);

  const saveCustomMeterNameModal = useCallback(() => {
    const name = normalizeCustomMeterGroupName(customMeterNameDraft, `Meter Group ${customMeterGroups.length + 1}`);
    const seedAddresses = customMeterNameSeedAddresses;
    const editingId = customMeterNameEditingId;

    if (editingId) {
      setCustomMeterGroups((prev) => prev.map((group) => (
        group.id === editingId
          ? { ...group, name, updatedAt: Date.now() }
          : group
      )));
      setMacroStatus(`${name} renamed.`);
    } else {
      createCustomMeterGroup(seedAddresses, name);
      closeMeterSelectionMode();
    }

    setCustomMeterNameModalVisible(false);
    setCustomMeterNameDraft('');
    setCustomMeterNameSeedAddresses([]);
    setCustomMeterNameEditingId(null);
  }, [closeMeterSelectionMode, createCustomMeterGroup, customMeterGroups.length, customMeterNameDraft, customMeterNameEditingId, customMeterNameSeedAddresses]);

  const addAddressesToCustomMeterGroup = useCallback((groupId: string | null | undefined, addresses: string[]) => {
    const normalized = Array.from(new Set(addresses.filter((address) => address.startsWith('/meters/'))));
    if (!groupId || normalized.length === 0) return;
    let addedCount = 0;
    setCustomMeterGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const nextAddresses = Array.from(new Set([...group.addresses, ...normalized]))
        .slice(0, MAX_CUSTOM_METER_GROUP_ADDRESSES);
      addedCount = Math.max(0, nextAddresses.length - group.addresses.length);
      return { ...group, addresses: nextAddresses, updatedAt: Date.now() };
    }));
    setMacroStatus(addedCount > 0
      ? `Added ${addedCount} meter${addedCount === 1 ? '' : 's'} to custom group.`
      : 'Those meters are already in the active custom group.');
  }, []);

  const duplicateCustomMeterGroup = useCallback((groupId: string | null | undefined) => {
    if (!groupId) return;
    if (customMeterGroups.length >= MAX_CUSTOM_METER_GROUPS) {
      setMacroStatus(`Custom meter group limit reached (${MAX_CUSTOM_METER_GROUPS}).`);
      return;
    }
    const sourceGroup = customMeterGroups.find((group) => group.id === groupId);
    if (!sourceGroup) return;
    const now = Date.now();
    const nextGroup: CustomMeterGroup = {
      id: createAutoId('meter_group'),
      name: normalizeCustomMeterGroupName(`${sourceGroup.name} Copy`, `Meter Group ${customMeterGroups.length + 1}`),
      addresses: sourceGroup.addresses.slice(0, MAX_CUSTOM_METER_GROUP_ADDRESSES),
      createdAt: now,
      updatedAt: now,
    };
    setCustomMeterGroups((prev) => [...prev, nextGroup]);
    setSelectedCustomMeterGroupId(nextGroup.id);
    setSelectedMeterGroupKey(`custom:${nextGroup.id}`);
    setMacroStatus(`${nextGroup.name} duplicated.`);
  }, [customMeterGroups]);

  const removeAddressFromCustomMeterGroup = useCallback((groupId: string | null | undefined, address: string) => {
    if (!groupId || !address) return;
    setCustomMeterGroups((prev) => prev.map((group) => (
      group.id === groupId
        ? { ...group, addresses: group.addresses.filter((candidate) => candidate !== address), updatedAt: Date.now() }
        : group
    )));
  }, []);

  const removeAddressesFromCustomMeterGroup = useCallback((groupId: string | null | undefined, addresses: string[]) => {
    const normalized = new Set(addresses.filter((address) => address.startsWith('/meters/')));
    if (!groupId || normalized.size === 0) return;
    let removedCount = 0;
    setCustomMeterGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const nextAddresses = group.addresses.filter((candidate) => !normalized.has(candidate));
      removedCount = Math.max(0, group.addresses.length - nextAddresses.length);
      return { ...group, addresses: nextAddresses, updatedAt: Date.now() };
    }));
    setMacroStatus(removedCount > 0
      ? `Removed ${removedCount} meter${removedCount === 1 ? '' : 's'} from custom group.`
      : 'No selected meters were in this custom group.');
  }, []);

  const moveSelectedCustomMeterGroupAddresses = useCallback((groupId: string | null | undefined, addresses: string[], direction: 'up' | 'down') => {
    const selected = new Set(addresses.filter((address) => address.startsWith('/meters/')));
    if (!groupId || selected.size === 0) return;
    let moved = false;
    setCustomMeterGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const nextAddresses = [...group.addresses];
      if (direction === 'up') {
        for (let index = 1; index < nextAddresses.length; index += 1) {
          if (selected.has(nextAddresses[index]) && !selected.has(nextAddresses[index - 1])) {
            [nextAddresses[index - 1], nextAddresses[index]] = [nextAddresses[index], nextAddresses[index - 1]];
            moved = true;
          }
        }
      } else {
        for (let index = nextAddresses.length - 2; index >= 0; index -= 1) {
          if (selected.has(nextAddresses[index]) && !selected.has(nextAddresses[index + 1])) {
            [nextAddresses[index], nextAddresses[index + 1]] = [nextAddresses[index + 1], nextAddresses[index]];
            moved = true;
          }
        }
      }
      return moved ? { ...group, addresses: nextAddresses, updatedAt: Date.now() } : group;
    }));
    setMacroStatus(moved
      ? `Moved selected meters ${direction}.`
      : `Selected meters are already at the ${direction === 'up' ? 'top' : 'bottom'}.`);
  }, []);

  const deleteCustomMeterGroup = useCallback((groupId: string | null | undefined) => {
    if (!groupId) return;
    setCustomMeterGroups((prev) => prev.filter((group) => group.id !== groupId));
    setSelectedMeterGroupKey('all');
    setSelectedCustomMeterGroupId((current) => (current === groupId ? null : current));
    setMacroStatus('Custom meter group deleted.');
  }, []);

  const openOverviewWorkspace = () => {
    setMeterWorkspaceOpen(false);
    setSelectedMacroId(null);
    setSelectedAutomizationId(null);
    setSelectedHaPairId(null);
  };

  const openMacroWorkspace = (id: string | null) => {
    setMeterWorkspaceOpen(false);
    setSelectedAutomizationId(null);
    setSelectedHaPairId(null);
    setSelectedMacroId(id);
  };

  const openAutomizationWorkspace = (id: string | null) => {
    setMeterWorkspaceOpen(false);
    setSelectedMacroId(null);
    setSelectedHaPairId(null);
    setSelectedAutomizationId(id);
  };

  const openHaWorkspace = (id: string | null) => {
    setMeterWorkspaceOpen(false);
    setSelectedMacroId(null);
    setSelectedAutomizationId(null);
    setSelectedHaPairId(id);
  };

  const openMetersWorkspace = () => {
    setSelectedMacroId(null);
    setSelectedAutomizationId(null);
    setSelectedHaPairId(null);
    setMeterWorkspaceOpen(true);
  };

  const buildCurrentWorkspaceStatePayload = useCallback((): WorkspaceStatePayload => {
    const selectedMacroForPersist = currentWorkspace === 'macro'
      ? macros.find((item) => item.id === selectedMacroId)
        || macros.find((item) => item.name === selectedMacroId)
      : null;
    return {
      schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspace: currentWorkspace,
      macroId: currentWorkspace === 'macro' ? selectedMacroId : null,
      macroName: currentWorkspace === 'macro' ? selectedMacroForPersist?.name || macroName || null : null,
      automizationId: currentWorkspace === 'automization' ? selectedAutomizationId : null,
      haPairId: currentWorkspace === 'ha' ? selectedHaPairId : null,
      macroDraft: currentWorkspace === 'macro'
        ? {
            name: macroName,
            triggerTarget,
            triggerOperator,
            triggerEdgeMode,
            triggerValue,
            triggerMeterMode,
            triggerMeterCooldownMs,
            triggerMeterRearmDb,
            triggerMeterDwellMs,
            triggerMeterStaleAfterMs,
            macroOverlapStrategy,
            macroOperator,
            conditions,
            actions,
          }
        : undefined,
    };
  }, [
    actions,
    conditions,
    currentWorkspace,
    macroName,
    macroOperator,
    macros,
    selectedAutomizationId,
    selectedHaPairId,
    selectedMacroId,
    triggerEdgeMode,
    triggerMeterCooldownMs,
    triggerMeterDwellMs,
    triggerMeterMode,
    triggerMeterRearmDb,
    triggerMeterStaleAfterMs,
    triggerOperator,
    triggerTarget,
    triggerValue,
    macroOverlapStrategy,
  ]);

  const applyMacroDraft = useCallback((draft: any, macroId: string | null = null) => {
    if (!draft || typeof draft !== 'object') return;
    restoredMacroDraftIdRef.current = macroId;
    setMacroName(typeof draft.name === 'string' ? draft.name : '');
    setTriggerTarget(sanitizeTarget(draft.triggerTarget, DEFAULT_UNSELECTED_TARGET));
    setTriggerOperator(normalizeOperatorForTarget(draft.triggerTarget, draft.triggerOperator || '=='));
    setTriggerEdgeMode(draft.triggerEdgeMode === 'off' || draft.triggerEdgeMode === 'on_off' ? draft.triggerEdgeMode : 'on');
    setTriggerValue(typeof draft.triggerValue === 'string' ? draft.triggerValue : getDefaultUiValueForTarget(draft.triggerTarget));
    setTriggerMeterMode(draft.triggerMeterMode === 'transient' ? 'transient' : DEFAULT_TRIGGER_METER_MODE);
    setTriggerMeterCooldownMs(String(clampNumber(Number(draft.triggerMeterCooldownMs) || DEFAULT_TRIGGER_METER_COOLDOWN_MS, 0, 2000)));
    setTriggerMeterRearmDb(String(clampNumber(Number(draft.triggerMeterRearmDb) || DEFAULT_TRIGGER_METER_REARM_DB, 0.1, 24)));
    setTriggerMeterDwellMs(String(clampNumber(Number(draft.triggerMeterDwellMs) || DEFAULT_TRIGGER_METER_DWELL_MS, 0, 1000)));
    setTriggerMeterStaleAfterMs(String(clampNumber(Number(draft.triggerMeterStaleAfterMs) || DEFAULT_TRIGGER_METER_STALE_AFTER_MS, 250, 10000)));
    setMacroOverlapStrategy(['drop', 'restart', 'queue_one', 'queue_many', 'concurrent'].includes(String(draft.macroOverlapStrategy || draft.executionPolicy?.overlapStrategy))
      ? String(draft.macroOverlapStrategy || draft.executionPolicy?.overlapStrategy) as MacroOverlapStrategy
      : DEFAULT_MACRO_OVERLAP_STRATEGY);
    setMacroOperator(draft.macroOperator === 'OR' ? 'OR' : 'AND');
    setConditions(Array.isArray(draft.conditions) ? draft.conditions.slice(0, MAX_MACRO_CONDITIONS) : []);
    setActions(Array.isArray(draft.actions) ? draft.actions.slice(0, MAX_MACRO_ACTIONS) : []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadUiSettings = async () => {
      try {
        const content = await readJsonTextWithBackup(
          UI_SETTINGS_FILE,
          (payload) => Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)),
        );
        if (content === null || cancelled) return;
        const parsed = JSON.parse(content);
        const normalized = sanitizeUiSettings(parsed);
        setTypographyKey(normalized.typographyKey);
        setTextScaleKey(normalized.textScaleKey);
        setDensityKey(normalized.densityKey);
        setShowInlineGuides(normalized.showInlineGuides);
        setMeterUiRateKey(normalized.meterUiRateKey);
        setMeterPreviewRows(normalized.meterPreviewRows);
        setShowDiagnostics(normalized.showDiagnostics);
        setIp(normalized.connectionIp);
      } catch (error) {
        console.warn('[UI Settings] Failed to load UI settings. Using defaults.', error);
      } finally {
        if (!cancelled) setUiSettingsLoaded(true);
      }
    };

    loadUiSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!uiSettingsLoaded || sessionConnected || !isValidIpv4Address(ip)) return;
    if ((OscManager as any).configureRoute?.(ip.trim(), 2223) === true) {
      setRuntimeStatus((OscManager as any).getRuntimeStatus());
    }
  }, [ip, sessionConnected, uiSettingsLoaded]);

  useEffect(() => {
    (OscManager as any).setMeterVisualPublishIntervalMs?.(meterUiUpdateIntervalMs);
    if (typeof (OscManager as any).getRuntimeStatus === 'function') {
      setRuntimeStatus((OscManager as any).getRuntimeStatus());
    }
  }, [meterUiUpdateIntervalMs]);

  useEffect(() => {
    let cancelled = false;
    const loadPresets = async () => {
      try {
        const content = await readJsonTextWithBackup(
          APP_PRESETS_FILE,
          isAppPresetStoragePayloadValid,
        );
        if (content === null || cancelled) return;
        const normalized = sanitizeAppPresetsPayload(JSON.parse(content));
        if (!cancelled) {
          setAppPresets(normalized.items);
          setLoadedAppPresetId(normalized.loadedPresetId);
        }
      } catch (error) {
        console.warn('[App Presets] Failed to load presets.', error);
        setAppPresetsPersistenceBlocked(true);
        Alert.alert('Show Presets recovery required', 'Saved Show Presets could not be recovered safely. Automatic saves are blocked until a Complete Backup is restored.');
      } finally {
        if (!cancelled) setAppPresetsLoaded(true);
      }
    };
    loadPresets();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!appPresetsLoaded || appPresetsPersistenceBlocked) return;
    safeWriteJson(APP_PRESETS_FILE, {
      schemaVersion: APP_PRESET_SCHEMA_VERSION,
      loadedPresetId: loadedAppPresetId,
      items: appPresets,
    }).catch((error) => console.warn('[App Presets] Failed to save presets.', error));
  }, [appPresets, appPresetsLoaded, appPresetsPersistenceBlocked, loadedAppPresetId]);

  useEffect(() => {
    let cancelled = false;
    const loadCustomMeterGroups = async () => {
      try {
        const content = await readJsonTextWithBackup(
          CUSTOM_METER_GROUPS_FILE,
          isCustomMeterGroupsStoragePayloadValid,
        );
        if (content === null || cancelled) return;
        const normalized = sanitizeCustomMeterGroupsPayload(JSON.parse(content));
        if (!cancelled) {
          setCustomMeterGroups(normalized);
          setSelectedCustomMeterGroupId((current) => current || normalized[0]?.id || null);
        }
      } catch (error) {
        console.warn('[Custom Meter Groups] Failed to load groups.', error);
        setCustomMeterGroupsPersistenceBlocked(true);
        Alert.alert('Meter group recovery required', 'Saved custom meter groups could not be recovered safely. Automatic saves are blocked until the meter groups file is repaired.');
      } finally {
        if (!cancelled) setCustomMeterGroupsLoaded(true);
      }
    };
    loadCustomMeterGroups();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!customMeterGroupsLoaded || customMeterGroupsPersistenceBlocked) return;
    safeWriteJson(CUSTOM_METER_GROUPS_FILE, {
      schemaVersion: CUSTOM_METER_GROUPS_SCHEMA_VERSION,
      items: customMeterGroups,
    }).catch((error) => console.warn('[Custom Meter Groups] Failed to save groups.', error));
  }, [customMeterGroups, customMeterGroupsLoaded, customMeterGroupsPersistenceBlocked]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaceState = async () => {
      try {
        const content = await readJsonTextWithBackup(
          WORKSPACE_STATE_FILE,
          (payload) => Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)),
        );
        if (content === null || cancelled) return;
        const parsed = JSON.parse(content);
        setPendingWorkspaceRestore(sanitizeWorkspaceState(parsed));
      } catch (error) {
        console.warn('[Workspace State] Failed to load workspace state.', error);
      } finally {
        if (!cancelled) {
          setWorkspaceStateLoaded(true);
        }
      }
    };

    loadWorkspaceState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!uiSettingsLoaded) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const payload: UiSettingsPayload = {
          schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
          typographyKey,
          textScaleKey,
          densityKey,
          showInlineGuides,
          meterUiRateKey,
          meterPreviewRows,
          showDiagnostics,
          connectionIp: ip.trim(),
        };
        await safeWriteJson(UI_SETTINGS_FILE, payload);
      } catch (error) {
        if (!cancelled) {
          console.warn('[UI Settings] Failed to save settings.', error);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [densityKey, ip, meterPreviewRows, meterUiRateKey, showDiagnostics, showInlineGuides, textScaleKey, typographyKey, uiSettingsLoaded]);

  useEffect(() => {
    let cancelled = false;

    const loadAutomizations = async () => {
      try {
        const content = await readJsonTextWithBackup(
          AUTOMIZATIONS_FILE,
          isAutomizationStoragePayloadValid,
        );
        if (content === null || cancelled) return;
        const loadedAutomizations = parseAutomizationsPayload(content);
        persistedAutomizationsRef.current = JSON.parse(JSON.stringify(loadedAutomizations));
        setAutomizations(loadedAutomizations);
      } catch (error) {
        console.warn('[Automizations] Failed to load automizations file, starting empty.', error);
        setAutomizationsPersistenceBlocked(true);
        Alert.alert('Automation recovery required', 'Saved automations could not be recovered safely. Automatic saves are blocked until a Complete Backup is restored.');
      } finally {
        if (!cancelled) {
          setAutomizationsLoaded(true);
        }
      }
    };

    loadAutomizations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!automizationsLoaded || automizationsPersistenceBlocked) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const payload = {
          schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
          items: automizations,
        };
        await safeWriteJson(AUTOMIZATIONS_FILE, payload);
        persistedAutomizationsRef.current = JSON.parse(JSON.stringify(automizations));
      } catch (error) {
        if (!cancelled) {
          console.warn('[Automizations] Failed to save automizations.', error);
          setAutomizations(JSON.parse(JSON.stringify(persistedAutomizationsRef.current)));
          Alert.alert('Automation change not saved', 'The previous verified automation list was restored.');
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [automizations, automizationsLoaded, automizationsPersistenceBlocked]);

  useEffect(() => {
    (MacroEngine as any).setAutomationActionHandler?.(({ automizationId, mode }: { automizationId?: string; mode?: string }) => {
      const requestedId = String(automizationId || '').trim();
      if (!requestedId || automizationsPersistenceBlocked) return;

      setAutomizations((prev) => {
        const current = prev.find((item) => item.id === requestedId);
        if (!current) {
          setMacroStatus(`Macro automation action skipped: automation not found.`);
          return prev;
        }
        const nextEnabled = mode === 'enable'
          ? true
          : mode === 'disable'
            ? false
            : !current.enabled;
        const candidateList = prev.map((item) => (item.id === requestedId ? { ...item, enabled: nextEnabled } : item));
        if (nextEnabled) {
          const candidate = candidateList.find((item) => item.id === requestedId) || null;
          const localPreflight = buildAutomizationPreflight(candidate);
          const fleetPreflight = buildAutomationFleetPreflight(
            candidateList,
            (target: Target) => MacroEngine.resolveAddresses(target),
          ) as { errorsById: Record<string, string[]> };
          const errors = [...localPreflight.errors, ...(fleetPreflight.errorsById[requestedId] || [])];
          if (errors.length > 0) {
            setMacroStatus(`Macro automation action blocked: ${errors[0]}`);
            return prev;
          }
        }
        setMacroStatus(`Macro ${mode || 'toggle'} automation: ${current.name} ${nextEnabled ? 'enabled' : 'disabled'}.`);
        return candidateList;
      });
    });
    return () => {
      (MacroEngine as any).setAutomationActionHandler?.(null);
    };
  }, [automizationsPersistenceBlocked]);

  useEffect(() => {
    (MacroEngine as any).setRuntimeSuspended?.(AppState.currentState !== 'active', 'app not active');
    const subscription = AppState.addEventListener('change', (nextState) => {
      const nextActive = nextState === 'active';
      setAppIsActive(nextActive);
      (MacroEngine as any).setRuntimeSuspended?.(!nextActive, 'app moved to background');
      if (nextActive) return;
      const activeHaPairId = (HaCompensationEngine as any).getSnapshot?.()?.activePairId;
      if (activeHaPairId) (HaCompensationEngine as any).disarmPair?.(activeHaPairId);
      OscManager.setWatchedAddresses([], 'meters_workspace');
      OscManager.setWatchedAddresses([], 'ui_preview');
      OscManager.setWatchedAddresses([], 'automization');
      const workspaceSaveTask = safeWriteJson(WORKSPACE_STATE_FILE, buildCurrentWorkspaceStatePayload());
      if (!appPresetsLoaded || !automizationsLoaded || !macrosLoaded || !haSnapshot?.loaded) {
        void workspaceSaveTask;
        return;
      }
      const saveTasks = [
        (MacroEngine as any).saveMacros(),
        (HaCompensationEngine as any).savePairs(),
        workspaceSaveTask,
        ...(!automizationsPersistenceBlocked ? [safeWriteJson(AUTOMIZATIONS_FILE, {
          schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
          items: automizations,
        })] : []),
        ...(!appPresetsPersistenceBlocked ? [safeWriteJson(APP_PRESETS_FILE, {
          schemaVersion: APP_PRESET_SCHEMA_VERSION,
          loadedPresetId: loadedAppPresetId,
          items: appPresets,
        })] : []),
      ];
      void Promise.allSettled(saveTasks);
    });
    return () => subscription.remove();
  }, [appPresets, appPresetsLoaded, appPresetsPersistenceBlocked, automizations, automizationsLoaded, automizationsPersistenceBlocked, buildCurrentWorkspaceStatePayload, haSnapshot?.loaded, loadedAppPresetId, macrosLoaded]);

  useEffect(() => {
    if (!pendingWorkspaceRestore) return;

    if (pendingWorkspaceRestore.workspace === 'overview') {
      openOverviewWorkspace();
      setPendingWorkspaceRestore(null);
      return;
    }

    if (pendingWorkspaceRestore.workspace === 'meters') {
      openOverviewWorkspace();
      setPendingWorkspaceRestore(null);
      return;
    }

    if (pendingWorkspaceRestore.workspace === 'macro') {
      if (pendingWorkspaceRestore.macroId === NEW_MACRO_WORKSPACE_ID) {
        openMacroWorkspace(NEW_MACRO_WORKSPACE_ID);
        applyMacroDraft(pendingWorkspaceRestore.macroDraft, NEW_MACRO_WORKSPACE_ID);
        setPendingWorkspaceRestore(null);
        return;
      }
      if (!macrosLoaded) return;
      if (
        pendingWorkspaceRestore.macroId
        && macros.some((item) => item.id === pendingWorkspaceRestore.macroId)
      ) {
        openMacroWorkspace(pendingWorkspaceRestore.macroId);
        applyMacroDraft(pendingWorkspaceRestore.macroDraft, pendingWorkspaceRestore.macroId);
      } else if (pendingWorkspaceRestore.macroName) {
        const restoredMacro = macros.find((item) => item.name === pendingWorkspaceRestore.macroName);
        if (restoredMacro) {
          const restoredId = getMacroIdentity(restoredMacro);
          openMacroWorkspace(restoredId);
          applyMacroDraft(pendingWorkspaceRestore.macroDraft, restoredId);
        } else {
          openOverviewWorkspace();
        }
      } else {
        openOverviewWorkspace();
      }
      setPendingWorkspaceRestore(null);
      return;
    }

    if (pendingWorkspaceRestore.workspace === 'automization') {
      if (!automizationsLoaded) return;
      if (
        pendingWorkspaceRestore.automizationId
        && automizations.some((item) => item.id === pendingWorkspaceRestore.automizationId)
      ) {
        openAutomizationWorkspace(pendingWorkspaceRestore.automizationId);
      } else {
        openOverviewWorkspace();
      }
      setPendingWorkspaceRestore(null);
      return;
    }

    if (!haSnapshot?.loaded) return;
    if (
      pendingWorkspaceRestore.haPairId
      && haPairs.some((item) => item.id === pendingWorkspaceRestore.haPairId)
    ) {
      openHaWorkspace(pendingWorkspaceRestore.haPairId);
    } else {
      openOverviewWorkspace();
    }
    setPendingWorkspaceRestore(null);
  }, [
    automizations,
    automizationsLoaded,
    applyMacroDraft,
    haPairs,
    haSnapshot?.loaded,
    macros,
    macrosLoaded,
    pendingWorkspaceRestore,
  ]);

  useEffect(() => {
    if (!workspaceStateLoaded || pendingWorkspaceRestore) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await safeWriteJson(WORKSPACE_STATE_FILE, buildCurrentWorkspaceStatePayload());
      } catch (error) {
        if (!cancelled) {
          console.warn('[Workspace State] Failed to save workspace state.', error);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    buildCurrentWorkspaceStatePayload,
    pendingWorkspaceRestore,
    workspaceStateLoaded,
  ]);

  useEffect(() => {
    if (!macrosLoaded || !selectedMacroId || selectedMacroId === NEW_MACRO_WORKSPACE_ID) return;
    const exists = macros.some((item) => getMacroIdentity(item) === selectedMacroId);
    if (!exists) {
      setSelectedMacroId(null);
    }
  }, [macros, macrosLoaded, selectedMacroId]);

  useEffect(() => {
    if (!automizationsLoaded || !selectedAutomizationId) return;
    const exists = automizations.some((item) => item.id === selectedAutomizationId);
    if (!exists) {
      setSelectedAutomizationId(null);
    }
  }, [automizations, automizationsLoaded, selectedAutomizationId]);

  useEffect(() => {
    if (!haSnapshot?.loaded || !selectedHaPairId) return;
    const exists = haPairs.some((item) => item.id === selectedHaPairId);
    if (!exists) {
      setSelectedHaPairId(null);
    }
  }, [haPairs, haSnapshot?.loaded, selectedHaPairId]);

  useEffect(() => {
    const unsubscribe = (HaCompensationEngine as any).onChange((snapshot: any) => {
      setHaSnapshot(snapshot);
      const errorAt = Number(snapshot?.lastPersistenceError?.at || 0);
      if (errorAt > haPersistenceAlertRef.current) {
        haPersistenceAlertRef.current = errorAt;
        Alert.alert('HA change not saved', snapshot.lastPersistenceError.message);
      }
      if (snapshot?.persistenceBlocked === true && !haStorageBlockedAlertRef.current) {
        haStorageBlockedAlertRef.current = true;
        Alert.alert('HA recovery required', 'Saved HA setups could not be recovered safely. HA edits are blocked until a Complete Backup is restored.');
      } else if (snapshot?.persistenceBlocked !== true) {
        haStorageBlockedAlertRef.current = false;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    (HaCompensationEngine as any).setFocusedPair?.(
      appIsActive ? selectedHaPairId : null,
    );
  }, [appIsActive, selectedHaPairId]);

  useEffect(() => {
    const normalizedOperator = normalizeOperatorForTarget(triggerTarget, triggerOperator);
    if (normalizedOperator !== triggerOperator) {
      setTriggerOperator(normalizedOperator);
    }
  }, [triggerTarget, triggerOperator]);

  // Load macro data into the editor when selected from the sidebar
  useEffect(() => {
    if (selectedMacroId && selectedMacroId !== NEW_MACRO_WORKSPACE_ID) {
      if (restoredMacroDraftIdRef.current === selectedMacroId) {
        restoredMacroDraftIdRef.current = null;
        return;
      }
      const macro = macros.find((item) => getMacroIdentity(item) === selectedMacroId);
      if (macro) {
        setMacroName(macro.name);
        setEditingMacroId(macro.id || null);
        setTriggerTarget(sanitizeTarget(macro.triggerTarget, {
          ...DEFAULT_UNSELECTED_TARGET,
        }));
        setTriggerOperator(normalizeOperatorForTarget(macro.triggerTarget, macro.triggerOperator || '=='));
        setTriggerEdgeMode(macro.triggerEdgeMode || 'on');
        setTriggerMeterMode(macro.triggerMeterMode === 'transient' ? 'transient' : DEFAULT_TRIGGER_METER_MODE);
        setTriggerMeterCooldownMs(String(clampNumber(Number(macro.triggerMeterCooldownMs) || DEFAULT_TRIGGER_METER_COOLDOWN_MS, 0, 2000)));
        setTriggerMeterRearmDb(String(clampNumber(Number(macro.triggerMeterRearmDb) || DEFAULT_TRIGGER_METER_REARM_DB, 0.1, 24)));
        setTriggerMeterDwellMs(String(clampNumber(Number(macro.triggerMeterDwellMs) || DEFAULT_TRIGGER_METER_DWELL_MS, 0, 1000)));
        setTriggerMeterStaleAfterMs(String(clampNumber(Number(macro.triggerMeterStaleAfterMs) || DEFAULT_TRIGGER_METER_STALE_AFTER_MS, 250, 10000)));
        setMacroOverlapStrategy(['drop', 'restart', 'queue_one', 'queue_many', 'concurrent'].includes(String(macro.executionPolicy?.overlapStrategy))
          ? String(macro.executionPolicy.overlapStrategy) as MacroOverlapStrategy
          : DEFAULT_MACRO_OVERLAP_STRATEGY);
        const loadedTriggerTarget = macro.triggerTarget || {
          ...DEFAULT_UNSELECTED_TARGET,
        };
        setTriggerValue(toUiValueString(loadedTriggerTarget, macro.triggerValue !== undefined ? macro.triggerValue : '1'));
        setMacroOperator(macro.logicalOperator || 'AND');
        setConditions((macro.conditions || []).map((cond: any) => ({
          ...cond,
          value: toUiValueString(cond?.target, cond?.value),
        })));
        
        // Normalize database format to UI format
        setActions(macro.actions?.map((a: any) => {
          if (a.type === 'delay') {
            return {
              type: 'delay',
              ms: String(a.ms),
              target: DEFAULT_UNSELECTED_TARGET,
            };
          } else if (a.type === 'fade') {
            return {
              type: 'fade',
              target: a.target,
              endVal: toUiValueString(a.target, a.endVal),
              durationSec: String(a.durationSec)
            };
          } else if (a.type === 'automation_cue') {
            return {
              type: 'automation_cue',
              target: a.target,
              startMode: a.startMode === 'fixed' ? 'fixed' : 'current',
              startVal: toUiValueString(a.target, a.startVal !== undefined ? a.startVal : getDefaultUiValueForTarget(a.target)),
              endVal: toUiValueString(a.target, a.endVal),
              durationMs: String(a.durationMs || Math.round((Number(a.durationSec) || 1) * 1000)),
              curve: ['linear', 'smooth', 'ease_in', 'ease_out'].includes(String(a.curve)) ? a.curve : 'linear',
            };
          } else if (a.type === 'automization_control') {
            return {
              type: 'automization_control',
              target: DEFAULT_UNSELECTED_TARGET,
              automizationId: String(a.automizationId || ''),
              mode: ['enable', 'disable', 'toggle'].includes(String(a.mode)) ? a.mode : 'toggle',
            };
          } else {
            return {
              type: 'osc',
              target: a.target,
              valStr: toUiValueString(a.target, a.args?.[0] !== undefined ? a.args[0] : '0')
            };
          }
        }) || []);
      }
    } else if (!selectedMacroId) {
      setMacroName('');
      setEditingMacroId(null);
      setTriggerTarget(DEFAULT_UNSELECTED_TARGET);
      setTriggerOperator('==');
      setTriggerEdgeMode('on');
      setTriggerValue('1');
      setTriggerMeterMode(DEFAULT_TRIGGER_METER_MODE);
      setTriggerMeterCooldownMs(String(DEFAULT_TRIGGER_METER_COOLDOWN_MS));
      setTriggerMeterRearmDb(String(DEFAULT_TRIGGER_METER_REARM_DB));
      setTriggerMeterDwellMs(String(DEFAULT_TRIGGER_METER_DWELL_MS));
      setTriggerMeterStaleAfterMs(String(DEFAULT_TRIGGER_METER_STALE_AFTER_MS));
      setMacroOverlapStrategy(DEFAULT_MACRO_OVERLAP_STRATEGY);
      setMacroOperator('AND');
      setConditions([]);
      setActions([]);
    }
  }, [selectedMacroId, macros]);

  // Real-time reactive listener for the dynamic VU meter
  useEffect(() => {
    const handleDebugLog = (logs: string[]) => {
      debugLogBufferRef.current = [...logs];
      if (showDiagnosticsRef.current) setDebugLogs([...logs]);
    };
    const unsubscribe = subscribeOscCompat('wing_debug_log', handleDebugLog);
    return unsubscribe;
  }, []);

  useEffect(() => {
    showDiagnosticsRef.current = showDiagnostics;
    if (showDiagnostics) setDebugLogs([...debugLogBufferRef.current]);
  }, [showDiagnostics]);

  useEffect(() => {
    diagnosticsModalVisibleRef.current = diagnosticsModalVisible;
    if (diagnosticsModalVisible) setDiagnosticLogs([...diagnosticLogBufferRef.current]);
  }, [diagnosticsModalVisible]);

  useEffect(() => {
    if (selectedMacroId && triggerType === 'console') {
      const resolvedAddr = MacroEngine.resolveAddresses(triggerTarget)[0];
      if (resolvedAddr) {
        // Initialize with the cached value if it exists
        const cache = OscManager.stateCache.get(resolvedAddr);
        if (cache && cache.length > 0) {
          const val = cache.length >= 3 ? cache[2] : cache[0];
          setLiveMeterVal(Number(val));
        } else {
          // Poll the WING for the initial value
          OscManager.sendToWing(resolvedAddr);
        }

        const handleStateUpdate = (evt: any) => {
          if (evt.address === resolvedAddr) {
            const val = evt.args.length >= 3 ? evt.args[2] : evt.args[0];
            setLiveMeterVal(Number(val));
          }
        };

        const unsubscribe = subscribeOscCompat('wing_state', handleStateUpdate);
        return unsubscribe;
      }
    } else {
      setLiveMeterVal(null);
    }
  }, [selectedMacroId, triggerType, triggerTarget]);

  useEffect(() => {
    if (!(appIsActive && selectedMacroId && triggerType === 'console')) {
      setLiveSignalMeterMap({});
      OscManager.setWatchedAddresses([], 'ui_preview');
      return;
    }

    const probeTarget = isMeterParameter(triggerTarget?.parameter)
      ? triggerTarget
      : { ...triggerTarget, parameter: 'meter' };
    const meterAddresses = (MacroEngine.resolveAddresses(probeTarget) || [])
      .filter((addr: string) => typeof addr === 'string' && addr.startsWith('/meters/'));
    if (meterAddresses.length === 0) {
      setLiveSignalMeterMap({});
      OscManager.setWatchedAddresses([], 'ui_preview');
      return;
    }

    const initialMap: Record<string, number> = {};
    meterAddresses.forEach((address: string) => {
      const cache = OscManager.stateCache.get(address);
      if (cache && cache.length > 0) {
        const val = cache.length >= 3 ? cache[2] : cache[0];
        initialMap[address] = Number(val);
      }
    });
    setLiveSignalMeterMap(initialMap);
    OscManager.setWatchedAddresses(meterAddresses, 'ui_preview');
    const meterAddressSet = new Set(meterAddresses);
    const meterBatcher = createNumericMapBatcher(setLiveSignalMeterMap, meterUiUpdateIntervalMs);

    const handleStateUpdate = (evt: any) => {
      if (!meterAddressSet.has(evt.address)) return;
      const val = evt.args.length >= 3 ? evt.args[2] : evt.args[0];
      const numeric = Number(val);
      if (!Number.isFinite(numeric)) return;
      meterBatcher.push(evt.address, numeric);
    };

    const unsubscribe = subscribeOscCompat('wing_state', handleStateUpdate);
    return () => {
      unsubscribe();
      meterBatcher.cancel();
      OscManager.setWatchedAddresses([], 'ui_preview');
    };
  }, [appIsActive, meterUiUpdateIntervalMs, selectedMacroId, triggerType, triggerTarget]);

  useEffect(() => {
    const scope = 'meters_workspace';
    if (!appIsActive || !meterWorkspaceOpen || selectedMeterAddresses.length === 0) {
      setMeterWorkspaceMap({});
      OscManager.setWatchedAddresses([], scope);
      return () => OscManager.setWatchedAddresses([], scope);
    }

    const initialMap: Record<string, number> = {};
    selectedMeterAddresses.forEach((address: string) => {
      const cache = OscManager.stateCache.get(address);
      if (cache && cache.length > 0) {
        const numeric = Number(cache.length >= 3 ? cache[2] : cache[0]);
        if (Number.isFinite(numeric)) initialMap[address] = numeric;
      }
    });
    setMeterWorkspaceMap(initialMap);
    OscManager.setWatchedAddresses(selectedMeterAddresses, scope);
    const meterAddressSet = new Set(selectedMeterAddresses);
    const meterBatcher = createNumericMapBatcher(setMeterWorkspaceMap, meterUiUpdateIntervalMs);

    const handleStateUpdate = (evt: any) => {
      if (!meterAddressSet.has(evt.address)) return;
      const numeric = getOscEventNumericValue(evt);
      if (numeric === null) return;
      meterBatcher.push(evt.address, numeric);
    };

    const unsubscribe = subscribeOscCompat('wing_state', handleStateUpdate);
    return () => {
      unsubscribe();
      meterBatcher.cancel();
      OscManager.setWatchedAddresses([], scope);
    };
  }, [appIsActive, meterUiUpdateIntervalMs, meterWorkspaceOpen, selectedMeterAddresses]);

  useEffect(() => {
    if (!appIsActive || !sessionConnected || !wingOnline) {
      OscManager.setWatchedAddresses([], 'automization');
      return;
    }

    const fleetPreflight = buildAutomationFleetPreflight(
      automizations,
      (target: Target) => MacroEngine.resolveAddresses(target),
    ) as { errorsById: Record<string, string[]> };
    const enabledAutomizations = automizations.filter(
      (item) => item.enabled === true
        && buildAutomizationPreflight(item).errors.length === 0
        && (fleetPreflight.errorsById[item.id] || []).length === 0
    );
    if (enabledAutomizations.length === 0) {
      OscManager.setWatchedAddresses([], 'automization');
      return;
    }

    const pendingDispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const liveValueBatcher = createNumericMapBatcher(setAutomizationLiveValueMap, 50);
    const dispatchCountBatcher = createCounterMapBatcher(setAutomizationDispatchCountMap, 200);

    const addressToAutomizationIds: Record<string, string[]> = {};
    const autoById = new Map<string, SidebarAutomization>();
    const watchedAddressSet = new Set<string>();

    enabledAutomizations.forEach((automization) => {
      autoById.set(automization.id, automization);
      const addresses = (MacroEngine.resolveAddresses(automization.sourceTarget) || [])
        .filter((address: string) => typeof address === 'string' && address.length > 0);
      addresses.forEach((address: string) => {
        watchedAddressSet.add(address);
        if (!addressToAutomizationIds[address]) {
          addressToAutomizationIds[address] = [];
        }
        addressToAutomizationIds[address].push(automization.id);
      });
    });

    const watchedAddresses = Array.from(watchedAddressSet);
    OscManager.setWatchedAddresses(watchedAddresses, 'automization');
    watchedAddresses.forEach((address) => {
      if (!address.startsWith('/meters/')) {
        OscManager.sendToWing(address);
      }
    });

    const handleAutomizationState = (evt: any) => {
      const impactedAutomizations = addressToAutomizationIds[evt?.address];
      if (!impactedAutomizations || impactedAutomizations.length === 0) return;
      const sourceRaw = evt?.args?.length >= 3 ? evt.args[2] : evt?.args?.[0];

      impactedAutomizations.forEach((automizationId) => {
        const automization = autoById.get(automizationId);
        if (!automization || automization.enabled === false) return;

        const sourceNumeric = toAutomationNumericValue(automization.sourceTarget, sourceRaw);
        if (sourceNumeric === null || Number.isNaN(sourceNumeric)) return;

        liveValueBatcher.push(automization.id, sourceNumeric);

        const sourceMin = toAutomationNumericValue(automization.sourceTarget, automization.sourceMin);
        const sourceMax = toAutomationNumericValue(automization.sourceTarget, automization.sourceMax);
        if (sourceMin === null || sourceMax === null || Math.abs(sourceMax - sourceMin) < 0.0001) return;

        let ratio = clampNumber((sourceNumeric - sourceMin) / (sourceMax - sourceMin), 0, 1);
        if (automization.mode === 'inverse') {
          ratio = 1 - ratio;
        }

        const responseMs = Math.max(20, Math.min(2000, Number(automization.responseMs) || 50));
        const deadband = Math.max(0, Number(automization.deadband) || 0);
        let dispatchedForAutomation = false;

        automization.targetItems.slice(0, MAX_AUTOMIZATION_TARGETS).forEach((targetItem) => {
          const mappedValue = mapAutomizationTargetValue(targetItem.target, targetItem.min, targetItem.max, ratio);
          if (mappedValue === null || mappedValue === undefined) return;

          const resolvedAddresses = (MacroEngine.resolveAddresses(targetItem.target) || [])
            .filter((address: string) => typeof address === 'string' && address.length > 0 && !address.startsWith('/meters/'));

          resolvedAddresses.forEach((address: string) => {
            if (address === evt.address) return;
            const dispatchKey = `${automization.id}:${targetItem.id}:${address}`;
            const now = Date.now();
            const previous = automizationDispatchRef.current[dispatchKey];
            const mappedNumeric = typeof mappedValue === 'number' ? mappedValue : Number(mappedValue);
            const numericComparable = !Number.isNaN(mappedNumeric);

            if (
              deadband > 0 &&
              numericComparable &&
              previous &&
              typeof previous.val === 'number' &&
              Math.abs(previous.val - mappedNumeric) < deadband
            ) {
              return;
            }

            if (previous && now - previous.at < responseMs) {
              const existingTimer = pendingDispatchTimers.get(dispatchKey);
              if (existingTimer) clearTimeout(existingTimer);
              const trailingDelayMs = Math.max(1, responseMs - (now - previous.at));
              const trailingTimer = setTimeout(() => {
                pendingDispatchTimers.delete(dispatchKey);
                const sent = OscManager.sendToWing(address, [mappedValue]);
                if (sent !== true) return;
                automizationDispatchRef.current[dispatchKey] = {
                  at: Date.now(),
                  val: numericComparable ? mappedNumeric : String(mappedValue),
                };
                dispatchCountBatcher.increment(automization.id);
              }, trailingDelayMs);
              pendingDispatchTimers.set(dispatchKey, trailingTimer);
              return;
            }

            const sent = OscManager.sendToWing(address, [mappedValue]);
            if (sent !== true) return;
            automizationDispatchRef.current[dispatchKey] = {
              at: now,
              val: numericComparable ? mappedNumeric : String(mappedValue),
            };
            dispatchedForAutomation = true;
          });
        });

        if (dispatchedForAutomation) {
          dispatchCountBatcher.increment(automization.id);
        }
      });
    };

    const unsubscribe = subscribeOscCompat('wing_state', handleAutomizationState);
    return () => {
      unsubscribe();
      pendingDispatchTimers.forEach((timer) => clearTimeout(timer));
      pendingDispatchTimers.clear();
      liveValueBatcher.cancel();
      dispatchCountBatcher.cancel();
      OscManager.setWatchedAddresses([], 'automization');
    };
  }, [appIsActive, automizations, sessionConnected, wingOnline]);

  // Reactive subscription to the macro engine
  useEffect(() => {
    const unsubscribe = MacroEngine.onChange((updatedMacros: any[], state?: { loaded?: boolean; persistenceBlocked?: boolean; macroRuntime?: Record<string, any>; uncoveredTriggerAddresses?: string[] }) => {
      setMacros(updatedMacros);
      setMacrosLoaded(state?.loaded === true);
      setMacroPersistenceBlocked(state?.persistenceBlocked === true);
      setMacroRuntimeMap(state?.macroRuntime && typeof state.macroRuntime === 'object' ? state.macroRuntime : {});
      setUncoveredMacroTriggerAddresses(
        Array.isArray(state?.uncoveredTriggerAddresses) ? state.uncoveredTriggerAddresses : [],
      );
      if (state?.persistenceBlocked === true) {
        Alert.alert('Macro recovery required', 'Saved macros could not be recovered safely. Automatic saves are blocked until macros are imported or a Complete Backup is restored.');
      }
    });
    // Register the online status listener
    const handleOnlineStatus = (status: boolean) => {
      setWingOnline(status);
      if (typeof (OscManager as any).getRuntimeStatus === 'function') {
        const nextStatus = (OscManager as any).getRuntimeStatus();
        setRuntimeStatus(nextStatus);
      }
      if (status) {
        setMacroStatus('Console connection established. Live telemetry active.');
      } else {
        setMacroStatus('Console offline. Route is still armed; verify network path and console response.');
      }
    };
    const handleConsoleIdentity = () => {
      if (typeof (OscManager as any).getRuntimeStatus !== 'function') return;
      const nextStatus = (OscManager as any).getRuntimeStatus();
      setRuntimeStatus(nextStatus);
      if (nextStatus?.consoleSupportLevel === 'unsupported') {
        setMacroStatus(
          `${nextStatus?.consoleDisplayName || 'Detected console'} is not supported in this build. Probe-only mode is active.`,
        );
      } else if (nextStatus?.consoleSupportLevel === 'partial') {
        setMacroStatus(
          `${nextStatus?.consoleDisplayName || 'Detected console'} is running with a limited feature set in this build.`,
        );
      }
    };
    const handleDiagnosticLog = (logStr: string) => {
      diagnosticLogBufferRef.current = [logStr, ...diagnosticLogBufferRef.current].slice(0, 15);
      if (diagnosticsModalVisibleRef.current) {
        setDiagnosticLogs([...diagnosticLogBufferRef.current]);
      }
    };

    const unsubscribeOnline = subscribeOscCompat('wing_online_status', handleOnlineStatus);
    const unsubscribeIdentity = subscribeOscCompat('console_identity', handleConsoleIdentity);
    const unsubscribeDiagnostic = subscribeOscCompat('diagnostic_log', handleDiagnosticLog);

    return () => {
      unsubscribe();
      unsubscribeOnline();
      unsubscribeIdentity();
      unsubscribeDiagnostic();
    };
  }, []);

  useEffect(() => {
    const pullRuntime = () => {
      if (typeof (OscManager as any).getRuntimeStatus === 'function') {
        const nextStatus = (OscManager as any).getRuntimeStatus();
        setRuntimeStatus(nextStatus);
        setWingOnline(Boolean(nextStatus?.wingOnline));
      }
    };
    pullRuntime();
    const timer = setInterval(pullRuntime, 1200);
    return () => clearInterval(timer);
  }, []);

  const handleConnect = () => {
    try {
      if (sessionConnected) {
        (MacroEngine as any).stopAllExecutions?.('console disconnected');
        OscManager.disconnect();
        setWingOnline(false);
        setMacroStatus('Disconnected.');
        return;
      }
      if (!ip.trim()) {
        Alert.alert('Console route required', 'Enter or discover a console IP before connecting.');
        setMacroStatus('No console route configured.');
        return;
      }
      OscManager.connect(ip);
      if (typeof (OscManager as any).getRuntimeStatus === 'function') {
        const nextStatus = (OscManager as any).getRuntimeStatus();
        setRuntimeStatus(nextStatus);
      }
      setMacroStatus(
        'Route armed. Probing console identity and waiting for live replies.'
      );
    } catch {
      setMacroStatus('Connection failed.');
    }
  };

  const handleSearchConsoles = async () => {
    const parts = String(ip || '').trim().split('.');
    const prefix = parts.length === 4 && parts.slice(0, 3).every((part) => /^\d{1,3}$/.test(part))
      ? parts.slice(0, 3).join('.')
      : '192.168.1';
    setConsoleSearchVisible(true);
    setConsoleSearchRunning(true);
    setConsoleSearchResults([]);
    setMacroStatus(`Searching ${prefix}.0/24 for WING consoles...`);
    try {
      const results = await (OscManager as any).discoverConsoles(prefix);
      setConsoleSearchResults(results);
      setMacroStatus(results.length > 0
        ? `Found ${results.length} console${results.length === 1 ? '' : 's'}.`
        : `No WING consoles replied on ${prefix}.0/24.`);
    } catch {
      setMacroStatus('Console search failed. Check the IP/subnet hint and Wi-Fi route.');
    } finally {
      setConsoleSearchRunning(false);
    }
  };

  const persistAppPresetList = async (
    items: AppPreset[],
    activePresetId = loadedAppPresetId,
    options: { allowRecovery?: boolean } = {},
  ) => {
    if (appPresetsPersistenceBlocked && options.allowRecovery !== true) {
      throw new Error('Show Preset storage is blocked until explicit recovery.');
    }
    const payload = {
      schemaVersion: APP_PRESET_SCHEMA_VERSION,
      loadedPresetId: activePresetId,
      items,
    };
    if (!isAppPresetStoragePayloadValid(payload)) {
      throw new Error(`Show Preset list is invalid or exceeds the ${MAX_APP_PRESETS} preset limit.`);
    }
    await safeWriteJson(APP_PRESETS_FILE, payload);
    setAppPresetsPersistenceBlocked(false);
  };

  const handleSaveAppPreset = async () => {
    if (appPresets.length >= MAX_APP_PRESETS) {
      Alert.alert('Show Preset limit reached', `Delete or export a Show Preset before creating another. The limit is ${MAX_APP_PRESETS}.`);
      return;
    }
    const name = presetName.trim();
    if (!name) {
      Alert.alert('Preset name required', 'Enter a name for this show preset.');
      return;
    }
    if (!presetScope.macros && !presetScope.automizations && !presetScope.ha) {
      Alert.alert('Choose preset scope', 'Select at least one section to save.');
      return;
    }
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    const preset: AppPreset = {
      id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: Date.now(),
      scopes: { ...presetScope },
      ...(presetScope.macros ? { macros: clone(macros) } : {}),
      ...(presetScope.automizations ? { automizations: clone(automizations) } : {}),
      ...(presetScope.ha ? { haPairs: clone(haPairs) } : {}),
    };
    const nextPresets = [preset, ...appPresets];
    try {
      await persistAppPresetList(nextPresets);
      setAppPresets(nextPresets);
      setPresetName('');
      setMacroStatus(`App preset "${name}" saved and verified.`);
    } catch (error) {
      console.error('[App Presets] Failed to save preset.', error);
      Alert.alert('Preset not saved', 'The preset could not be verified on disk. Your current show has not been changed.');
    }
  };

  const handleSaveBlankAppPreset = async () => {
    if (appPresets.length >= MAX_APP_PRESETS) {
      Alert.alert('Show Preset limit reached', `Delete or export a Show Preset before creating another. The limit is ${MAX_APP_PRESETS}.`);
      return;
    }
    const name = presetName.trim();
    if (!name) {
      Alert.alert('Preset name required', 'Enter a name for this blank show preset.');
      return;
    }
    if (!presetScope.macros && !presetScope.automizations && !presetScope.ha) {
      Alert.alert('Choose preset scope', 'Select at least one section to include.');
      return;
    }
    const preset: AppPreset = {
      id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: Date.now(),
      scopes: { ...presetScope },
      ...(presetScope.macros ? { macros: [] } : {}),
      ...(presetScope.automizations ? { automizations: [] } : {}),
      ...(presetScope.ha ? { haPairs: [] } : {}),
    };
    const nextPresets = [preset, ...appPresets];
    try {
      await persistAppPresetList(nextPresets);
      setAppPresets(nextPresets);
      setPresetName('');
      setMacroStatus(`Blank app preset "${name}" saved and verified.`);
    } catch (error) {
      console.error('[App Presets] Failed to save blank preset.', error);
      Alert.alert('Preset not saved', 'The blank preset could not be verified on disk.');
    }
  };

  const buildAppPresetSnapshot = (preset: AppPreset): AppPreset => {
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    return {
      ...preset,
      scopes: { ...preset.scopes },
      ...(preset.scopes.macros ? { macros: clone(macros) } : {}),
      ...(preset.scopes.automizations ? { automizations: clone(automizations) } : {}),
      ...(preset.scopes.ha ? { haPairs: clone(haPairs) } : {}),
    };
  };

  const sanitizeExportFileName = (rawName: string, fallback: string) => {
    const normalized = String(rawName || '')
      .trim()
      .replace(/\.json$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || fallback;
  };

  const handleUpdateAppPreset = (preset: AppPreset) => {
    Alert.alert(
      'Update App Preset',
      `Replace the saved sections in "${preset.name}" with the current app state?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            const nextPresets = appPresets.map((item) => item.id === preset.id ? buildAppPresetSnapshot(item) : item);
            try {
              await persistAppPresetList(nextPresets);
              setAppPresets(nextPresets);
              setMacroStatus(`App preset "${preset.name}" updated and verified.`);
            } catch (error) {
              console.error('[App Presets] Failed to update preset.', error);
              Alert.alert('Preset not updated', 'The existing saved preset was kept unchanged.');
            }
          },
        },
      ],
    );
  };

  const handleDuplicateAppPreset = async (preset: AppPreset) => {
    if (appPresets.length >= MAX_APP_PRESETS) {
      Alert.alert('Show Preset limit reached', `Delete or export a Show Preset before duplicating another. The limit is ${MAX_APP_PRESETS}.`);
      return;
    }
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    let candidateName = `${preset.name} Copy`;
    let suffix = 2;
    while (appPresets.some((item) => item.name === candidateName)) {
      candidateName = `${preset.name} Copy ${suffix}`;
      suffix += 1;
    }
    const duplicate: AppPreset = {
      ...clone(preset),
      id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: candidateName,
      createdAt: Date.now(),
      isRecovery: false,
    };
    const nextPresets = [duplicate, ...appPresets];
    try {
      await persistAppPresetList(nextPresets);
      setAppPresets(nextPresets);
      setMacroStatus(`App preset "${preset.name}" duplicated and verified.`);
    } catch (error) {
      console.error('[App Presets] Failed to duplicate preset.', error);
      Alert.alert('Preset not duplicated', 'The duplicate could not be verified on disk.');
    }
  };

  const handleExportAppPresets = async () => {
    try {
      const selectedItems = selectedPresetExportIds.length > 0
        ? appPresets.filter((preset) => selectedPresetExportIds.includes(preset.id))
        : appPresets;
      if (selectedItems.length === 0) {
        Alert.alert('No presets to export', 'Save or select at least one Show Preset first.');
        return;
      }
      const fileName = sanitizeExportFileName(
        presetExportFileName,
        selectedPresetExportIds.length > 0 ? 'wing_show_presets_selected' : 'wing_show_presets_export',
      );
      const exportPath = `${FileSystem.cacheDirectory}${fileName}.json`;
      await safeWriteJson(exportPath, {
        schemaVersion: APP_PRESET_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        exportMode: selectedPresetExportIds.length > 0 ? 'selected' : 'all',
        items: selectedItems,
      });
      if (!await Sharing.isAvailableAsync()) {
        Alert.alert('Export unavailable', 'This device does not provide a local share or save destination.');
        return;
      }
      await Sharing.shareAsync(exportPath, {
        mimeType: 'application/json',
        dialogTitle: selectedPresetExportIds.length > 0 ? 'Export Selected WING Show Presets' : 'Export WING Show Presets',
        UTI: 'public.json',
      });
    } catch (error) {
      console.error('[App Presets] Failed to export presets.', error);
      Alert.alert('Export failed', 'Show presets could not be exported.');
    }
  };

  const handleExportCompleteBackup = async () => {
    try {
      const exportPath = `${FileSystem.cacheDirectory}wing_controller_complete_backup.json`;
      await safeWriteJson(exportPath, {
        backupType: 'wing-controller-complete',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: Constants.expoConfig?.version || null,
        currentShow: {
          macros,
          automizations,
          haPairs,
          loadedPresetId: loadedAppPresetId,
        },
        connection: {
          ip,
          port: runtimeStatus?.wingPort || 2223,
        },
        showPresets: appPresets,
        uiSettings: {
          typographyKey,
          textScaleKey,
          densityKey,
          showInlineGuides,
          meterUiRateKey,
          meterPreviewRows,
          showDiagnostics,
          connectionIp: ip,
        },
      });
      if (!await Sharing.isAvailableAsync()) {
        Alert.alert('Export unavailable', 'This device does not provide a local share or save destination.');
        return;
      }
      await Sharing.shareAsync(exportPath, {
        mimeType: 'application/json',
        dialogTitle: 'Export Complete WING Controller Backup',
        UTI: 'public.json',
      });
    } catch (error) {
      console.error('[Complete Backup] Export failed.', error);
      Alert.alert('Backup export failed', 'The complete backup could not be generated.');
    }
  };

  const restoreCompleteBackup = async (parsed: any) => {
    if (sessionConnected) {
      Alert.alert('Disconnect before restore', 'A complete restore is blocked while a console route is armed.');
      return;
    }

    const previous = {
      macros: JSON.parse(JSON.stringify(macros)),
      automizations: JSON.parse(JSON.stringify(automizations)),
      haPairs: JSON.parse(JSON.stringify(haPairs)),
      appPresets: JSON.parse(JSON.stringify(appPresets)),
      loadedPresetId: loadedAppPresetId,
      uiSettings: {
        typographyKey,
        textScaleKey,
        densityKey,
      showInlineGuides,
      meterUiRateKey,
      meterPreviewRows,
      showDiagnostics,
        connectionIp: ip,
      },
    };
    const nextMacros = Array.isArray(parsed?.currentShow?.macros) ? parsed.currentShow.macros : [];
    const nextAutomizations = (Array.isArray(parsed?.currentShow?.automizations) ? parsed.currentShow.automizations : [])
      .slice(0, MAX_AUTOMIZATIONS)
      .map(sanitizeAutomization);
    const nextHaPairs = Array.isArray(parsed?.currentShow?.haPairs) ? parsed.currentShow.haPairs : [];
    const normalizedPresets = sanitizeAppPresetsPayload({ items: parsed?.showPresets || [] });
    const requestedLoadedPresetId = typeof parsed?.currentShow?.loadedPresetId === 'string'
      ? parsed.currentShow.loadedPresetId
      : null;
    const nextLoadedPresetId = normalizedPresets.items.some((item) => item.id === requestedLoadedPresetId)
      ? requestedLoadedPresetId
      : null;
    const nextUiSettings = sanitizeUiSettings({
      ...(parsed?.uiSettings || {}),
      connectionIp: parsed?.connection?.ip || parsed?.uiSettings?.connectionIp,
    });

    try {
      (MacroEngine as any).stopAllExecutions?.('complete backup restore');
      const activeHaPairId = (HaCompensationEngine as any).getSnapshot?.()?.activePairId;
      if (activeHaPairId) (HaCompensationEngine as any).disarmPair?.(activeHaPairId);
      await (MacroEngine as any).replaceMacros(nextMacros);
      await safeWriteJson(AUTOMIZATIONS_FILE, {
        schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
        items: nextAutomizations,
      });
      setAutomizationsPersistenceBlocked(false);
      setAutomizations(nextAutomizations);
      await (HaCompensationEngine as any).replacePairs(nextHaPairs);
      await persistAppPresetList(normalizedPresets.items, nextLoadedPresetId, { allowRecovery: true });
      await safeWriteJson(UI_SETTINGS_FILE, nextUiSettings);
      setAppPresets(normalizedPresets.items);
      setLoadedAppPresetId(nextLoadedPresetId);
      setTypographyKey(nextUiSettings.typographyKey);
      setTextScaleKey(nextUiSettings.textScaleKey);
      setDensityKey(nextUiSettings.densityKey);
      setShowInlineGuides(nextUiSettings.showInlineGuides);
      setMeterUiRateKey(nextUiSettings.meterUiRateKey);
      setMeterPreviewRows(nextUiSettings.meterPreviewRows);
      setShowDiagnostics(nextUiSettings.showDiagnostics);
      setIp(nextUiSettings.connectionIp);
      openOverviewWorkspace();
      setMacroStatus('Complete backup restored and verified. Macros and automations retain their saved enabled states.');
      Alert.alert('Complete backup restored', 'Show data, Show Presets, connection route, and UI settings were restored. HA remains disarmed.');
    } catch (error) {
      console.error('[Complete Backup] Restore failed. Rolling back.', error);
      try {
        await (MacroEngine as any).replaceMacros(previous.macros);
        await safeWriteJson(AUTOMIZATIONS_FILE, {
          schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
          items: previous.automizations,
        });
        setAutomizations(previous.automizations);
        await (HaCompensationEngine as any).replacePairs(previous.haPairs);
        await persistAppPresetList(previous.appPresets, previous.loadedPresetId, { allowRecovery: true });
        await safeWriteJson(UI_SETTINGS_FILE, previous.uiSettings);
        setAppPresets(previous.appPresets);
        setLoadedAppPresetId(previous.loadedPresetId);
        setTypographyKey(previous.uiSettings.typographyKey);
        setTextScaleKey(previous.uiSettings.textScaleKey);
        setDensityKey(previous.uiSettings.densityKey);
        setShowInlineGuides(previous.uiSettings.showInlineGuides);
        setMeterUiRateKey(previous.uiSettings.meterUiRateKey);
        setMeterPreviewRows(previous.uiSettings.meterPreviewRows);
        setShowDiagnostics(previous.uiSettings.showDiagnostics);
        setIp(previous.uiSettings.connectionIp);
        Alert.alert('Restore cancelled safely', 'The complete backup could not be restored, so the previous verified app state was restored.');
      } catch (rollbackError) {
        console.error('[Complete Backup] Rollback failed.', rollbackError);
        Alert.alert('Restore interrupted', 'Restore and automatic rollback both failed. Do not continue until a verified Show Preset or backup is loaded.');
      }
    }
  };

  const mergeImportedAppPresets = (incoming: AppPreset[]) => {
    const existingIds = new Set(appPresets.map((item) => item.id));
    const existingNames = new Set(appPresets.map((item) => item.name));
    return incoming.map((item) => {
      let id = item.id;
      while (existingIds.has(id)) {
        id = `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      }
      existingIds.add(id);
      let name = item.name;
      let suffix = 2;
      while (existingNames.has(name)) {
        name = `${item.name} (Imported ${suffix})`;
        suffix += 1;
      }
      existingNames.add(name);
      return { ...item, id, name, isRecovery: false };
    });
  };

  const mergeCompleteBackupImport = async (parsed: any) => {
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    const previous = {
      macros: clone(macros),
      automizations: clone(automizations),
      haPairs: clone(haPairs),
      appPresets: clone(appPresets),
      loadedPresetId: loadedAppPresetId,
    };

    const uniqueName = (baseName: string, existingNames: Set<string>) => {
      let name = baseName || 'Imported';
      let suffix = 2;
      while (existingNames.has(name)) {
        name = `${baseName || 'Imported'} (Imported ${suffix})`;
        suffix += 1;
      }
      existingNames.add(name);
      return name;
    };

    const macroIds = new Set(macros.map((macro) => getMacroIdentity(macro)).filter(Boolean));
    const macroNames = new Set(macros.map((macro) => macro.name).filter(Boolean));
    const importedMacros = (Array.isArray(parsed?.currentShow?.macros) ? parsed.currentShow.macros : [])
      .slice(0, Math.max(0, MAX_MACROS - macros.length))
      .map((macro: any, index: number) => {
        const copied = clone(macro);
        let id = getMacroIdentity(copied) || createAutoId('macro_import');
        while (macroIds.has(id)) id = createAutoId('macro_import');
        macroIds.add(id);
        copied.id = id;
        copied.name = uniqueName(copied.name || `Imported Macro ${index + 1}`, macroNames);
        copied.enabled = false;
        return copied;
      });

    const automationIds = new Set(automizations.map((item) => item.id));
    const automationNames = new Set(automizations.map((item) => item.name));
    const importedAutomizations = (Array.isArray(parsed?.currentShow?.automizations) ? parsed.currentShow.automizations : [])
      .slice(0, Math.max(0, MAX_AUTOMIZATIONS - automizations.length))
      .map((item: any, index: number) => {
        const normalized = sanitizeAutomization(item, automizations.length + index);
        let id = normalized.id;
        while (automationIds.has(id)) id = createAutoId('auto_import');
        automationIds.add(id);
        return {
          ...normalized,
          id,
          name: uniqueName(normalized.name || `Imported Automation ${index + 1}`, automationNames),
          enabled: false,
        };
      });

    const haIds = new Set(haPairs.map((pair) => pair.id));
    const haNames = new Set(haPairs.map((pair) => pair.name));
    const importedHaPairs = (Array.isArray(parsed?.currentShow?.haPairs) ? parsed.currentShow.haPairs : [])
      .slice(0, Math.max(0, MAX_HA_PAIRS - haPairs.length))
      .map((pair: any, index: number) => {
        const copied = clone(pair);
        let id = typeof copied.id === 'string' && copied.id.trim() ? copied.id.trim() : createAutoId('ha_import');
        while (haIds.has(id)) id = createAutoId('ha_import');
        haIds.add(id);
        copied.id = id;
        copied.name = uniqueName(copied.name || `Imported HA Setup ${index + 1}`, haNames);
        copied.enabled = false;
        return copied;
      });

    const normalizedPresets = sanitizeAppPresetsPayload({ items: parsed?.showPresets || [] }).items;
    const mergedPresets = mergeImportedAppPresets(normalizedPresets);
    if (mergedPresets.length + appPresets.length > MAX_APP_PRESETS) {
      throw new Error(`Import would exceed the ${MAX_APP_PRESETS} Show Preset limit.`);
    }

    try {
      if (importedMacros.length > 0) {
        await (MacroEngine as any).replaceMacros([...macros, ...importedMacros]);
      }
      if (importedAutomizations.length > 0) {
        const nextAutomizations = [...automizations, ...importedAutomizations];
        await safeWriteJson(AUTOMIZATIONS_FILE, {
          schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
          items: nextAutomizations,
        });
        setAutomizationsPersistenceBlocked(false);
        setAutomizations(nextAutomizations);
      }
      if (importedHaPairs.length > 0) {
        await (HaCompensationEngine as any).replacePairs([...haPairs, ...importedHaPairs]);
      }
      if (mergedPresets.length > 0) {
        const nextPresets = [...mergedPresets, ...appPresets];
        await persistAppPresetList(nextPresets, loadedAppPresetId, { allowRecovery: true });
        setAppPresets(nextPresets);
      }
      setMacroStatus(`Backup imported additively: ${importedMacros.length} macros, ${importedAutomizations.length} automations, ${importedHaPairs.length} HA setups, ${mergedPresets.length} presets.`);
      Alert.alert('Backup imported', 'Backup contents were added to the current app state. Existing loaded show data was kept.');
    } catch (error) {
      console.error('[Complete Backup] Merge import failed. Rolling back.', error);
      await (MacroEngine as any).replaceMacros(previous.macros);
      await safeWriteJson(AUTOMIZATIONS_FILE, {
        schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
        items: previous.automizations,
      });
      setAutomizations(previous.automizations);
      await (HaCompensationEngine as any).replacePairs(previous.haPairs);
      await persistAppPresetList(previous.appPresets, previous.loadedPresetId, { allowRecovery: true });
      setAppPresets(previous.appPresets);
      setLoadedAppPresetId(previous.loadedPresetId);
      throw error;
    }
  };

  const handleImportAppPresets = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      if (content.length > MAX_IMPORT_BYTES) {
        throw new Error('The selected file exceeds the safe 2 MB import limit.');
      }
      const parsed = JSON.parse(content);
      if (parsed?.backupType === 'wing-controller-complete') {
        if (!isCompleteBackupPayloadValid(parsed)) {
          throw new Error('The complete backup is incomplete, malformed, or exceeds safe list limits.');
        }
        Alert.alert(
          'Import Complete Backup',
          'Choose additive import, or replace the complete app state exactly. Exact restore requires the console to be disconnected.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Import Additively',
              onPress: () => {
                void mergeCompleteBackupImport(parsed).catch(() => {
                  Alert.alert('Import failed', 'Backup contents could not be added safely, so the previous verified app state was restored.');
                });
              },
            },
            {
              text: 'Replace All',
              style: 'destructive',
              onPress: () => {
                void restoreCompleteBackup(parsed);
              },
            },
          ],
        );
        return;
      }
      if (!isAppPresetStoragePayloadValid(parsed)) {
        throw new Error('The selected file is not a valid Show Preset export or exceeds safe list limits.');
      }
      const imported = sanitizeAppPresetsPayload(parsed).items;
      if (imported.length === 0) {
        Alert.alert('No presets imported', 'The selected file contains no valid Show Presets.');
        return;
      }
      const mergedItems = mergeImportedAppPresets(imported);
      if (mergedItems.length + appPresets.length > MAX_APP_PRESETS) {
        throw new Error(`Import would exceed the ${MAX_APP_PRESETS} Show Preset limit.`);
      }
      const nextPresets = [...mergedItems, ...appPresets];
      await persistAppPresetList(nextPresets, loadedAppPresetId, { allowRecovery: true });
      setAppPresets(nextPresets);
      setMacroStatus(`${mergedItems.length} Show Preset${mergedItems.length === 1 ? '' : 's'} imported and verified.`);
    } catch (error) {
      console.error('[App Presets] Failed to import presets.', error);
      Alert.alert('Import failed', 'The selected file is invalid or could not be saved safely.');
    }
  };

  const handleLoadAppPreset = (preset: AppPreset) => {
    if (storageRecoveryRequired) {
      Alert.alert('Storage recovery required', 'Loading Show Presets is blocked until the damaged storage section is recovered from a verified Complete Backup or import.');
      return;
    }
    if (sessionConnected) {
      Alert.alert('Disconnect before loading', 'Show Preset loading is blocked while the console route is armed.');
      return;
    }
    Alert.alert(
      'Load App Preset',
      `Load "${preset.name}"? Included sections will replace the current ${[
        preset.scopes.macros ? 'macros' : '',
        preset.scopes.automizations ? 'automations' : '',
        preset.scopes.ha ? 'HA setups' : '',
      ].filter(Boolean).join(', ')} lists.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: async () => {
            const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
            const previousShow = {
              macros: clone(macros),
              automizations: clone(automizations),
              haPairs: clone(haPairs),
              loadedPresetId: loadedAppPresetId,
            };
            const recoveryPreset: AppPreset = {
              id: `preset_recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
              name: `Recovery before ${preset.name}`,
              createdAt: Date.now(),
              isRecovery: true,
              scopes: { macros: true, automizations: true, ha: true },
              macros: clone(macros),
              automizations: clone(automizations),
              haPairs: clone(haPairs),
            };
            const standardPresets = appPresets.filter((item) => !item.isRecovery);
            const availableRecoverySlots = MAX_APP_PRESETS - standardPresets.length - 1;
            if (availableRecoverySlots < 0) {
              Alert.alert(
                'Recovery snapshot space required',
                'Loading is blocked because there is no room for the required recovery snapshot. Export or delete a Show Preset first.',
              );
              return;
            }
            const nextPresets = [
              recoveryPreset,
              ...standardPresets,
              ...appPresets.filter((item) => item.isRecovery).slice(0, Math.min(4, availableRecoverySlots)),
            ];
            try {
              const activeHaPairId = (HaCompensationEngine as any).getSnapshot?.()?.activePairId;
              if (activeHaPairId) (HaCompensationEngine as any).disarmPair?.(activeHaPairId);
              await safeWriteJson(APP_PRESETS_FILE, {
                schemaVersion: APP_PRESET_SCHEMA_VERSION,
                loadedPresetId: loadedAppPresetId,
                items: nextPresets,
              });
              setAppPresets(nextPresets);
              (MacroEngine as any).stopAllExecutions?.(`loading show preset "${preset.name}"`);
              openOverviewWorkspace();
              if (preset.scopes.macros) await (MacroEngine as any).replaceMacros(preset.macros || []);
              if (preset.scopes.automizations) {
                const nextAutomizations = (preset.automizations || []).slice(0, MAX_AUTOMIZATIONS).map(sanitizeAutomization);
                await safeWriteJson(AUTOMIZATIONS_FILE, {
                  schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
                  items: nextAutomizations,
                });
                setAutomizations(nextAutomizations);
              }
              if (preset.scopes.ha) await (HaCompensationEngine as any).replacePairs(preset.haPairs || []);
              await persistAppPresetList(nextPresets, preset.id);
              setLoadedAppPresetId(preset.id);
              setMacroStatus(`App preset "${preset.name}" loaded. Recovery snapshot saved.`);
              setPresetsVisible(false);
            } catch (error) {
              console.error('[App Presets] Failed to load preset safely.', error);
              let restored = false;
              try {
                await (MacroEngine as any).replaceMacros(previousShow.macros);
                await safeWriteJson(AUTOMIZATIONS_FILE, {
                  schemaVersion: AUTOMIZATION_SCHEMA_VERSION,
                  items: previousShow.automizations,
                });
                setAutomizations(previousShow.automizations);
                await (HaCompensationEngine as any).replacePairs(previousShow.haPairs);
                await persistAppPresetList(nextPresets, previousShow.loadedPresetId);
                setLoadedAppPresetId(previousShow.loadedPresetId);
                restored = true;
              } catch (restoreError) {
                console.error('[App Presets] Automatic rollback failed.', restoreError);
              }
              setMacroStatus(restored
                ? `Preset load interrupted. Previous saved lists restored; HA remains disarmed.`
                : `Preset load interrupted. Use "${recoveryPreset.name}" to restore the previous show.`);
              Alert.alert(
                restored ? 'Preset load cancelled safely' : 'Preset load interrupted',
                restored
                  ? 'A section failed to load, so the previous saved lists were restored. HA remains disarmed and pending macro executions were stopped.'
                  : `Automatic rollback failed. Load "${recoveryPreset.name}" before continuing.`,
              );
            }
          },
        },
      ],
    );
  };

  const handleDeleteAppPreset = (preset: AppPreset) => {
    Alert.alert('Delete App Preset', `Delete "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const nextPresets = appPresets.filter((item) => item.id !== preset.id);
          const nextLoadedId = loadedAppPresetId === preset.id ? null : loadedAppPresetId;
          try {
            await persistAppPresetList(nextPresets, nextLoadedId);
            setAppPresets(nextPresets);
            if (loadedAppPresetId === preset.id) setLoadedAppPresetId(null);
          } catch (error) {
            console.error('[App Presets] Failed to delete preset.', error);
            Alert.alert('Preset not deleted', 'The saved preset was kept because the change could not be verified on disk.');
          }
        },
      },
    ]);
  };

  const handleAddNewMacro = () => {
    if (macros.length >= MAX_MACROS) {
      Alert.alert('Macro limit reached', `Delete or export a macro before creating another. The limit is ${MAX_MACROS}.`);
      return;
    }
    setMacroName(`New Macro ${macros.length + 1}`);
    setEditingMacroId(null);
    setTriggerTarget(DEFAULT_UNSELECTED_TARGET);
    setTriggerOperator('==');
    setTriggerEdgeMode('on');
    setTriggerValue('1');
    setTriggerMeterMode(DEFAULT_TRIGGER_METER_MODE);
    setTriggerMeterCooldownMs(String(DEFAULT_TRIGGER_METER_COOLDOWN_MS));
    setTriggerMeterRearmDb(String(DEFAULT_TRIGGER_METER_REARM_DB));
    setTriggerMeterDwellMs(String(DEFAULT_TRIGGER_METER_DWELL_MS));
    setTriggerMeterStaleAfterMs(String(DEFAULT_TRIGGER_METER_STALE_AFTER_MS));
    setMacroOverlapStrategy(DEFAULT_MACRO_OVERLAP_STRATEGY);
    setMacroOperator('AND');
    setConditions([]);
    setActions([]);
    openMacroWorkspace(NEW_MACRO_WORKSPACE_ID);
    setMacroStatus('Creating new macro draft.');
  };

  const ensureAutomationStorageWritable = () => {
    if (!automizationsPersistenceBlocked) return true;
    Alert.alert('Automation recovery required', 'Automation edits are blocked until a verified Complete Backup restores the damaged automation storage.');
    return false;
  };

  const handleAddAutomization = () => {
    if (!ensureAutomationStorageWritable()) return;
    if (automizations.length >= MAX_AUTOMIZATIONS) {
      Alert.alert('Automation limit reached', `Delete an automation before creating another. The limit is ${MAX_AUTOMIZATIONS}.`);
      return;
    }
    const id = createAutoId('auto');
    const defaultSourceTarget = { ...DEFAULT_AUTOMIZATION_SOURCE_TARGET };
    const sourceRange = getDefaultRangeForTarget(defaultSourceTarget);
    const created: SidebarAutomization = {
      id,
      name: `Automization ${automizations.length + 1}`,
      enabled: false,
      mode: 'inverse',
      sourceTarget: defaultSourceTarget,
      sourceMin: sourceRange.min,
      sourceMax: sourceRange.max,
      targetItems: [createDefaultAutomizationTargetItem(1)],
      deadband: '0.1',
      responseMs: 50,
    };
    setAutomizations((prev) => [created, ...prev]);
    openAutomizationWorkspace(id);
    setMacroStatus(`Automation "${created.name}" created disabled. Review it before enabling.`);
  };

  const handleToggleAutomization = (id: string, enabled: boolean) => {
    if (!ensureAutomationStorageWritable()) return;
    if (enabled) {
      const candidateList = automizations.map((item) => (item.id === id ? { ...item, enabled: true } : item));
      const candidate = candidateList.find((item) => item.id === id) || null;
      const localPreflight = buildAutomizationPreflight(candidate);
      const fleetPreflight = buildAutomationFleetPreflight(
        candidateList,
        (target: Target) => MacroEngine.resolveAddresses(target),
      ) as { errorsById: Record<string, string[]> };
      const errors = [...localPreflight.errors, ...(fleetPreflight.errorsById[id] || [])];
      if (errors.length > 0) {
        Alert.alert('Automation cannot be enabled', errors[0]);
        setMacroStatus(`Automation blocked: ${errors[0]}`);
        return;
      }
    }
    setAutomizations((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled } : item))
    );
  };

  const handleDuplicateAutomization = (automization: SidebarAutomization) => {
    if (!ensureAutomationStorageWritable()) return;
    if (automizations.length >= MAX_AUTOMIZATIONS) {
      Alert.alert('Automation limit reached', `Delete an automation before duplicating another. The limit is ${MAX_AUTOMIZATIONS}.`);
      return;
    }
    const clone = JSON.parse(JSON.stringify(automization)) as SidebarAutomization;
    let candidateName = `${automization.name} (Copy)`;
    let suffix = 2;
    while (automizations.some((item) => item.name === candidateName)) {
      candidateName = `${automization.name} (Copy ${suffix})`;
      suffix += 1;
    }
    clone.id = createAutoId('auto');
    clone.name = candidateName;
    clone.enabled = false;
    clone.targetItems = clone.targetItems.map((item) => ({ ...item, id: createAutoId('target') }));
    setAutomizations((prev) => [clone, ...prev]);
    setMacroStatus(`Automation "${clone.name}" duplicated and disabled.`);
  };

  const handleUpdateAutomization = (id: string, patch: Partial<SidebarAutomization>) => {
    if (!ensureAutomationStorageWritable()) return;
    setAutomizations((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          name: typeof patch.name === 'string' ? patch.name : item.name,
          mode: patch.mode === 'direct' ? 'direct' : (patch.mode === 'inverse' ? 'inverse' : item.mode),
          enabled: typeof patch.enabled === 'boolean' ? patch.enabled : item.enabled,
          sourceMin: typeof patch.sourceMin === 'string' ? patch.sourceMin : item.sourceMin,
          sourceMax: typeof patch.sourceMax === 'string' ? patch.sourceMax : item.sourceMax,
          deadband: typeof patch.deadband === 'string' ? patch.deadband : item.deadband,
          responseMs: Number.isFinite(Number(patch.responseMs))
            ? Math.max(20, Math.min(2000, Math.round(Number(patch.responseMs))))
            : item.responseMs,
        };
      })
    );
  };

  const handleUpdateAutomizationSourceTarget = (id: string, sourceTarget: Target) => {
    if (!ensureAutomationStorageWritable()) return;
    setAutomizations((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const normalized = sanitizeTarget(sourceTarget, DEFAULT_AUTOMIZATION_SOURCE_TARGET);
        const sourceRange = getDefaultRangeForTarget(normalized);
        return {
          ...item,
          sourceTarget: normalized,
          sourceMin: sourceRange.min,
          sourceMax: sourceRange.max,
        };
      })
    );
  };

  const handleAddAutomizationTarget = (automizationId: string) => {
    if (!ensureAutomationStorageWritable()) return;
    setAutomizations((prev) =>
      prev.map((item) => {
        if (item.id !== automizationId) return item;
        if (item.targetItems.length >= MAX_AUTOMIZATION_TARGETS) return item;
        return {
          ...item,
          targetItems: [
            ...item.targetItems,
            createDefaultAutomizationTargetItem(item.targetItems.length + 1),
          ],
        };
      })
    );
  };

  const handleRemoveAutomizationTarget = (automizationId: string, targetId: string) => {
    if (!ensureAutomationStorageWritable()) return;
    setAutomizations((prev) =>
      prev.map((item) => {
        if (item.id !== automizationId) return item;
        const filtered = item.targetItems.filter((targetItem) => targetItem.id !== targetId);
        return {
          ...item,
          targetItems: filtered.length > 0 ? filtered : [createDefaultAutomizationTargetItem(1)],
        };
      })
    );
  };

  const handleUpdateAutomizationTarget = (
    automizationId: string,
    targetId: string,
    patch: Partial<{ target: Target; min: string; max: string }>
  ) => {
    if (!ensureAutomationStorageWritable()) return;
    setAutomizations((prev) =>
      prev.map((item) => {
        if (item.id !== automizationId) return item;
        return {
          ...item,
          targetItems: item.targetItems.map((targetItem) => {
            if (targetItem.id !== targetId) return targetItem;
            const nextTarget = patch.target ? sanitizeTarget(patch.target, targetItem.target) : targetItem.target;
            const nextRangeDefaults = getDefaultRangeForTarget(nextTarget);
            return {
              ...targetItem,
              target: nextTarget,
              min: typeof patch.min === 'string'
                ? patch.min
                : (patch.target ? nextRangeDefaults.min : targetItem.min),
              max: typeof patch.max === 'string'
                ? patch.max
                : (patch.target ? nextRangeDefaults.max : targetItem.max),
            };
          }),
        };
      })
    );
  };

  const toggleLibrarySelection = (
    id: string,
    setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const confirmDeleteSelectedAutomizations = () => {
    if (!ensureAutomationStorageWritable()) return;
    const selectedIds = selectedAutomizationLibraryIds.filter((id) => automizations.some((item) => item.id === id));
    if (selectedIds.length === 0) return;
    Alert.alert(
      'Delete Automations',
      `Delete ${selectedIds.length} selected automation${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete (${selectedIds.length})`,
          style: 'destructive',
          onPress: () => {
            setAutomizations((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
            if (selectedAutomizationId && selectedIds.includes(selectedAutomizationId)) {
              openOverviewWorkspace();
            }
            setSelectedAutomizationLibraryIds([]);
            setAutomizationLibraryEditMode(false);
            setMacroStatus(`${selectedIds.length} automation${selectedIds.length === 1 ? '' : 's'} deleted.`);
          },
        },
      ],
    );
  };

  const ensureHaStorageWritable = () => {
    if (haSnapshot?.persistenceBlocked !== true) return true;
    Alert.alert('HA recovery required', 'HA edits are blocked until a verified Complete Backup restores the damaged HA storage.');
    return false;
  };

  const handleAddHaPair = () => {
    if (!ensureHaStorageWritable()) return;
    if (haPairs.length >= MAX_HA_PAIRS) {
      Alert.alert('HA setup limit reached', `Delete an HA setup before creating another. The limit is ${MAX_HA_PAIRS}.`);
      return;
    }
    const canSeedPrimaryRoute = (sessionConnected || wingOnline)
      && currentConsoleSupportsHa
      && isValidIpv4Address(currentWingRouteIp);
    const id = (HaCompensationEngine as any).createPair(
      canSeedPrimaryRoute
        ? {
            endpoints: {
              a: { ip: currentWingRouteIp, oscPort: currentWingRoutePort },
            },
          }
        : undefined,
    );
    if (!id) {
      Alert.alert('HA setup not created', 'The setup could not be added safely.');
      return;
    }
    openHaWorkspace(id);
    setMacroStatus(
      canSeedPrimaryRoute
        ? `HA setup created. Console A seeded from current console route ${currentWingRouteIp}:${currentWingRoutePort}.`
        : runtimeStatus?.consoleFamily && !currentConsoleSupportsHa
          ? 'HA setup created. Current console route was not seeded because that console family is not valid for HA compensation.'
        : 'HA setup created.',
    );
  };

  const runAfterLibraryClose = (closeLibrary: () => void, next: () => void) => {
    closeLibrary();
    setTimeout(() => {
      next();
    }, LIBRARY_NAV_DELAY_MS);
  };

  const handleCreateMacroFromLibrary = () => {
    runAfterLibraryClose(() => setMacroLibraryVisible(false), handleAddNewMacro);
  };

  const handleCreateAutomizationFromLibrary = () => {
    runAfterLibraryClose(() => setAutomizationLibraryVisible(false), handleAddAutomization);
  };

  const handleCreateHaSetupFromLibrary = () => {
    runAfterLibraryClose(() => setHaLibraryVisible(false), handleAddHaPair);
  };

  const handleSelectMacroFromLibrary = (macroId: string) => {
    if (!macroId) return;
    runAfterLibraryClose(() => setMacroLibraryVisible(false), () => openMacroWorkspace(macroId));
  };

  const handleSelectAutomizationFromLibrary = (automizationId: string) => {
    runAfterLibraryClose(() => setAutomizationLibraryVisible(false), () => openAutomizationWorkspace(automizationId));
  };

  const handleSelectHaPairFromLibrary = (pairId: string) => {
    runAfterLibraryClose(() => setHaLibraryVisible(false), () => openHaWorkspace(pairId));
  };

  const handleToggleHaPair = (id: string, enabled: boolean) => {
    if (!ensureHaStorageWritable()) return;
    (HaCompensationEngine as any).updatePair(id, { enabled });
  };

  const handleDuplicateHaPair = (pair: HaPair) => {
    if (!ensureHaStorageWritable()) return null;
    if (haPairs.length >= MAX_HA_PAIRS) {
      Alert.alert('HA setup limit reached', `Delete an HA setup before duplicating another. The limit is ${MAX_HA_PAIRS}.`);
      return null;
    }
    let candidateName = `${pair.name} (Copy)`;
    let suffix = 2;
    while (haPairs.some((item) => item.name === candidateName)) {
      candidateName = `${pair.name} (Copy ${suffix})`;
      suffix += 1;
    }
    const id = (HaCompensationEngine as any).createPair({
      name: candidateName,
      haOwner: pair.haOwner,
      endpoints: JSON.parse(JSON.stringify(pair.endpoints)),
      mappings: JSON.parse(JSON.stringify(pair.mappings)),
    });
    if (!id) {
      Alert.alert('HA setup not duplicated', 'The duplicate could not be added safely.');
      return null;
    }
    (HaCompensationEngine as any).updatePair(id, { enabled: false });
    setMacroStatus(`HA setup "${candidateName}" duplicated and disabled.`);
    return id;
  };

  const handleUpdateHaPair = (id: string, patchOrUpdater: any) => {
    if (!ensureHaStorageWritable()) return;
    (HaCompensationEngine as any).updatePair(id, patchOrUpdater);
  };

  const handleUseCurrentWingForHaEndpoint = (pairId: string, endpointId: 'a' | 'b') => {
    if (runtimeStatus?.consoleFamily && !currentConsoleSupportsHa) {
      setMacroStatus('Current console family is not valid for HA endpoint seeding.');
      return;
    }
    if (!isValidIpv4Address(currentWingRouteIp)) {
      setMacroStatus('Current console route is not a valid IPv4 address.');
      return;
    }
    handleUpdateHaPair(pairId, (pair: HaPair) => ({
      ...pair,
      endpoints: {
        ...pair.endpoints,
        [endpointId]: {
          ...pair.endpoints[endpointId],
          ip: currentWingRouteIp,
          oscPort: currentWingRoutePort,
        },
      },
    }));
    setMacroStatus(`Console ${endpointId.toUpperCase()} now targets ${currentWingRouteIp}:${currentWingRoutePort}.`);
  };

  const handleClearHaEndpoint = (pairId: string, endpointId: 'a' | 'b') => {
    handleUpdateHaPair(pairId, (pair: HaPair) => ({
      ...pair,
      endpoints: {
        ...pair.endpoints,
        [endpointId]: {
          ...pair.endpoints[endpointId],
          ip: '',
        },
      },
    }));
    setMacroStatus(`Console ${endpointId.toUpperCase()} route cleared.`);
  };

  const confirmDeleteSelectedHaPairs = () => {
    if (!ensureHaStorageWritable()) return;
    const selectedIds = selectedHaLibraryIds.filter((id) => haPairs.some((item) => item.id === id));
    if (selectedIds.length === 0) return;
    Alert.alert(
      'Delete HA Setups',
      `Delete ${selectedIds.length} selected HA setup${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete (${selectedIds.length})`,
          style: 'destructive',
          onPress: () => {
            selectedIds.forEach((id) => (HaCompensationEngine as any).deletePair(id));
            if (selectedHaPairId && selectedIds.includes(selectedHaPairId)) {
              openOverviewWorkspace();
            }
            setSelectedHaLibraryIds([]);
            setHaLibraryEditMode(false);
            setMacroStatus(`${selectedIds.length} HA setup${selectedIds.length === 1 ? '' : 's'} deleted.`);
          },
        },
      ],
    );
  };

  const handleAddHaMapping = (pairId: string) => {
    const pair = haPairs.find((item) => item.id === pairId);
    if (pair && pair.mappings.length >= MAX_HA_MAPPINGS) {
      Alert.alert('HA mapping limit reached', `Delete a mapping before creating another. The limit is ${MAX_HA_MAPPINGS} per setup.`);
      return;
    }
    handleUpdateHaPair(pairId, (pair: HaPair) => ({
      ...pair,
      mappings: [
        ...pair.mappings,
        {
          id: createAutoId('ha_map'),
          name: `HA Link ${pair.mappings.length + 1}`,
          enabled: true,
          source: {
            family: 'aes50a',
            index: 1,
          },
          targetsByEndpoint: {
            a: [{ family: 'ch', index: 1 }],
            b: [{ family: 'ch', index: 1 }],
          },
        },
      ],
    }));
  };

  const handleRemoveHaMapping = (pairId: string, mappingId: string) => {
    handleUpdateHaPair(pairId, (pair: HaPair) => {
      const filtered = pair.mappings.filter((mapping) => mapping.id !== mappingId);
      return {
        ...pair,
        mappings: filtered.length > 0 ? filtered : pair.mappings,
      };
    });
  };

  const handleUpdateHaMapping = (pairId: string, mappingId: string, updater: (mapping: HaMapping) => HaMapping) => {
    handleUpdateHaPair(pairId, (pair: HaPair) => ({
      ...pair,
      mappings: pair.mappings.map((mapping) => (mapping.id === mappingId ? updater(mapping) : mapping)),
    }));
  };

  const handleAddHaTarget = (pairId: string, mappingId: string, endpointId: 'a' | 'b') => {
    const pair = haPairs.find((item) => item.id === pairId);
    const mapping = pair?.mappings.find((item) => item.id === mappingId);
    if ((mapping?.targetsByEndpoint?.[endpointId] || []).length >= MAX_HA_TARGETS_PER_ENDPOINT) {
      Alert.alert('HA target limit reached', `Delete a target before creating another. The limit is ${MAX_HA_TARGETS_PER_ENDPOINT} per endpoint.`);
      return;
    }
    handleUpdateHaMapping(pairId, mappingId, (mapping) => ({
      ...mapping,
      targetsByEndpoint: {
        ...mapping.targetsByEndpoint,
        [endpointId]: [
          ...(mapping.targetsByEndpoint[endpointId] || []),
          { family: 'ch', index: 1 },
        ],
      },
    }));
  };

  const handleRemoveHaTarget = (pairId: string, mappingId: string, endpointId: 'a' | 'b', targetIndex: number) => {
    handleUpdateHaMapping(pairId, mappingId, (mapping) => ({
      ...mapping,
      targetsByEndpoint: {
        ...mapping.targetsByEndpoint,
        [endpointId]: (mapping.targetsByEndpoint[endpointId] || []).filter((_, idx) => idx !== targetIndex),
      },
    }));
  };

  const handleUpdateHaTarget = (
    pairId: string,
    mappingId: string,
    endpointId: 'a' | 'b',
    targetIndex: number,
    patch: Partial<HaTargetRef>,
  ) => {
    handleUpdateHaMapping(pairId, mappingId, (mapping) => ({
      ...mapping,
      targetsByEndpoint: {
        ...mapping.targetsByEndpoint,
        [endpointId]: (mapping.targetsByEndpoint[endpointId] || []).map((target, idx) => {
          if (idx !== targetIndex) return target;
          const nextFamily = patch.family === 'aux' ? 'aux' : (patch.family === 'ch' ? 'ch' : target.family);
          const nextIndex = clampHaTargetIndex(
            nextFamily,
            patch.index ?? target.index,
            selectedHaEndpointConsoleFamilies[endpointId],
          );
          return {
            family: nextFamily,
            index: nextIndex,
          };
        }),
      },
    }));
  };

  const handleFlipHaOwner = (pair: HaPair) => {
    if (!ensureHaStorageWritable()) return;
    const nextOwner = pair.haOwner === 'a' ? 'b' : 'a';
    (HaCompensationEngine as any).setOwner(pair.id, nextOwner);
    setMacroStatus(`HA owner moved to ${pair.endpoints[nextOwner].label}. Resync required.`);
  };

  const handleArmHaPair = async (pairId: string) => {
    const ok = await (HaCompensationEngine as any).armPair(pairId);
    setMacroStatus(ok ? 'HA compensation armed.' : 'HA compensation could not arm. Check preflight.');
  };

  const handleResyncHaPair = async (pairId: string) => {
    const ok = await (HaCompensationEngine as any).resyncPair(pairId);
    setMacroStatus(ok ? 'HA compensation resynced.' : 'HA compensation resync failed.');
  };

  const handleDisarmHaPair = (pairId: string) => {
    (HaCompensationEngine as any).disarmPair(pairId);
    setMacroStatus('HA compensation disarmed.');
  };

  const handleCaptureHaBaseline = async (pairId: string) => {
    const ok = await (HaCompensationEngine as any).captureCurrentBaseline(pairId);
    setMacroStatus(ok ? 'HA baseline captured from current gain/trim state.' : 'HA baseline capture failed.');
  };

  const handleClearHaEventLog = (pairId: string) => {
    (HaCompensationEngine as any).clearEventLog(pairId);
    setMacroStatus('HA event log cleared.');
  };

  const handleUpdateHaRangeDraft = (patch: Partial<HaRangeDraft>) => {
    setHaRangeDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleAppendHaRangeMappings = (pairId: string) => {
    const { items, plan } = buildHaRangeMappings(haRangeDraft, selectedHaPair?.mappings?.length || 0, {
      ownerConsoleFamily: selectedHaOwnerConsoleFamily,
      endpointConsoleFamilies: selectedHaEndpointConsoleFamilies,
    });
    handleUpdateHaPair(pairId, (pair: HaPair) => ({
      ...pair,
      mappings: [...pair.mappings, ...items],
    }));
    setMacroStatus(
      plan.truncated
        ? `Generated ${items.length} HA links. Range was truncated to fit source/target limits.`
        : `Generated ${items.length} HA links.`,
    );
  };

  const handleReplaceHaRangeMappings = (pairId: string) => {
    const { items, plan } = buildHaRangeMappings(haRangeDraft, 0, {
      ownerConsoleFamily: selectedHaOwnerConsoleFamily,
      endpointConsoleFamilies: selectedHaEndpointConsoleFamilies,
    });
    Alert.alert(
      'Replace HA Mappings',
      `Replace all current mappings with ${items.length} generated 1:1 links?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            handleUpdateHaPair(pairId, (pair: HaPair) => ({
              ...pair,
              mappings: items,
            }));
            setMacroStatus(
              plan.truncated
                ? `Rebuilt HA mappings with ${items.length} generated links. Range was truncated to fit limits.`
                : `Rebuilt HA mappings with ${items.length} generated links.`,
            );
          },
        },
      ],
    );
  };

  const handleSaveMacro = async () => {
    const preflight = buildMacroPreflight({
      name: macroName,
      triggerType,
      triggerTarget,
      triggerOperator,
      triggerEdgeMode,
      triggerValue,
      triggerMeterMode,
      triggerMeterCooldownMs,
      triggerMeterRearmDb,
      triggerMeterDwellMs,
      triggerMeterStaleAfterMs,
      macroOverlapStrategy,
      macroOperator,
      conditions,
      actions,
    }, runtimeStatus);

    if (preflight.errors.length > 0) {
      Alert.alert(
        'Validation Errors',
        preflight.errors.slice(0, 4).join('\n')
      );
      return;
    }

    const formattedConditions = conditions.map(c => {
      const parsedVal = normalizeValueForTarget(c.target, c.value);
      return {
        target: c.target,
        operator: normalizeOperatorForTarget(c.target, c.operator || '=='),
        value: parsedVal
      };
    });

    const formattedActions = actions.map(a => {
      if (a.type === 'delay') {
        return {
          type: 'delay',
          ms: Math.max(1, parseInt(a.ms) || 100)
        };
      } else if (a.type === 'fade') {
        return {
          type: 'fade',
          target: a.target,
          endVal: normalizeValueForTarget(a.target, a.endVal),
          durationSec: Math.max(0.05, parseFloat(a.durationSec) || 1)
        };
      } else if (a.type === 'automation_cue') {
        return {
          type: 'automation_cue',
          target: a.target,
          startMode: a.startMode === 'fixed' ? 'fixed' : 'current',
          startVal: a.startMode === 'fixed' ? normalizeValueForTarget(a.target, a.startVal) : a.startVal,
          endVal: normalizeValueForTarget(a.target, a.endVal),
          durationMs: Math.max(10, Math.round(Number(a.durationMs) || ((parseFloat(a.durationSec) || 1) * 1000))),
          curve: ['linear', 'smooth', 'ease_in', 'ease_out'].includes(String(a.curve)) ? a.curve : 'linear',
        };
      } else if (a.type === 'automization_control') {
        return {
          type: 'automization_control',
          automizationId: String(a.automizationId || ''),
          mode: ['enable', 'disable', 'toggle'].includes(String(a.mode)) ? a.mode : 'toggle',
        };
      } else {
        const parsedArg = normalizeValueForTarget(a.target, a.valStr);
        return {
          type: 'osc',
          target: a.target,
          args: [parsedArg]
        };
      }
    });

    const parsedTriggerValue = normalizeValueForTarget(triggerTarget, triggerValue);
    const isMeterTriggerTarget = isMeterParameter(triggerTarget?.parameter);
    const cooldownInput = Number(triggerMeterCooldownMs);
    const rearmInput = Number(triggerMeterRearmDb);
    const dwellInput = Number(triggerMeterDwellMs);
    const staleAfterInput = Number(triggerMeterStaleAfterMs);
    const normalizedTriggerMeterCooldownMs = Math.round(clampNumber(
      Number.isNaN(cooldownInput) ? DEFAULT_TRIGGER_METER_COOLDOWN_MS : cooldownInput,
      0,
      2000,
    ));
    const normalizedTriggerMeterRearmDb = clampNumber(
      Number.isNaN(rearmInput) ? DEFAULT_TRIGGER_METER_REARM_DB : rearmInput,
      0.1,
      24,
    );
    const normalizedTriggerMeterDwellMs = Math.round(clampNumber(
      Number.isNaN(dwellInput) ? DEFAULT_TRIGGER_METER_DWELL_MS : dwellInput,
      0,
      1000,
    ));
    const normalizedTriggerMeterStaleAfterMs = Math.round(clampNumber(
      Number.isNaN(staleAfterInput) ? DEFAULT_TRIGGER_METER_STALE_AFTER_MS : staleAfterInput,
      250,
      10000,
    ));
    const normalizedMacroOverlapStrategy = ['drop', 'restart', 'queue_one', 'queue_many', 'concurrent'].includes(macroOverlapStrategy)
      ? macroOverlapStrategy
      : DEFAULT_MACRO_OVERLAP_STRATEGY;

    const macroIdForSave = editingMacroId
      || (selectedMacroId && selectedMacroId !== NEW_MACRO_WORKSPACE_ID ? selectedMacroId : undefined);

    const newMacro = {
      id: macroIdForSave,
      name: macroName,
      triggerType,
      triggerTarget,
      triggerOperator: normalizeOperatorForTarget(triggerTarget, triggerOperator),
      triggerEdgeMode,
      triggerValue: parsedTriggerValue,
      triggerMeterMode: isMeterTriggerTarget ? triggerMeterMode : DEFAULT_TRIGGER_METER_MODE,
      triggerMeterCooldownMs: normalizedTriggerMeterCooldownMs,
      triggerMeterRearmDb: normalizedTriggerMeterRearmDb,
      triggerMeterDwellMs: normalizedTriggerMeterDwellMs,
      triggerMeterStaleAfterMs: normalizedTriggerMeterStaleAfterMs,
      executionPolicy: {
        cooldownMs: isMeterTriggerTarget ? normalizedTriggerMeterCooldownMs : 0,
        overlapStrategy: normalizedMacroOverlapStrategy,
        maxQueueDepth: DEFAULT_MACRO_MAX_QUEUE_DEPTH,
        onDisconnect: 'abort',
      },
      logicalOperator: macroOperator,
      conditions: formattedConditions,
      actions: formattedActions
    };

    try {
      const savedMacro = await MacroEngine.registerMacro(newMacro);
      const savedMacroId = getMacroIdentity(savedMacro as unknown as MacroRecord);
      if (savedMacroId) {
        setEditingMacroId(savedMacroId);
        openMacroWorkspace(savedMacroId);
      }
      setMacroStatus(
        preflight.warnings.length > 0
          ? `Macro "${macroName}" saved with warnings: ${preflight.warnings[0]}`
          : `Macro "${macroName}" saved successfully!`
      );
    } catch (error) {
      console.error('[Macro] Save failed.', error);
      Alert.alert('Macro not saved', 'The previous verified macro list was restored.');
    }
  };

  const handleToggleMacro = async (macro: MacroRecord, enabled: boolean) => {
    const identity = getMacroIdentity(macro);
    if (!identity) return;
    if (enabled) {
      const preflight = buildMacroPreflight(macro, runtimeStatus);
      if (preflight.errors.length > 0) {
        Alert.alert('Macro cannot be enabled', preflight.errors[0]);
        setMacroStatus(`Macro blocked: ${preflight.errors[0]}`);
        return;
      }
    }
    try {
      await MacroEngine.toggleMacro(identity, enabled);
      setMacroStatus(`Macro "${macro.name}" ${enabled ? 'enabled' : 'disabled'}.`);
    } catch {
      Alert.alert('Macro change not saved', 'The previous verified macro state was restored.');
    }
  };

  const handleMoveMacro = async (identity: string, direction: 'up' | 'down') => {
    try {
      await MacroEngine.moveMacro(identity, direction);
    } catch {
      Alert.alert('Macro order not saved', 'The previous verified macro order was restored.');
    }
  };

  const handleDuplicateMacro = async (identity: string) => {
    try {
      await MacroEngine.duplicateMacro(identity);
    } catch {
      Alert.alert('Macro not duplicated', 'The duplicate could not be verified on disk.');
    }
  };

  const confirmDeleteSelectedMacros = () => {
    const selectedIds = selectedMacroLibraryIds.filter((id) => macros.some((macro) => getMacroIdentity(macro) === id));
    if (selectedIds.length === 0) return;
    Alert.alert(
      'Delete Macros',
      `Delete ${selectedIds.length} selected macro${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete (${selectedIds.length})`,
          style: 'destructive',
          onPress: async () => {
            try {
              await (MacroEngine as any).replaceMacros(macros.filter((macro) => !selectedIds.includes(getMacroIdentity(macro))));
              if (selectedMacroId && selectedIds.includes(selectedMacroId)) {
                openOverviewWorkspace();
              }
              setSelectedMacroLibraryIds([]);
              setMacroLibraryEditMode(false);
              setMacroStatus(`${selectedIds.length} macro${selectedIds.length === 1 ? '' : 's'} deleted.`);
            } catch {
              Alert.alert('Macros not deleted', 'The verified macro list was kept unchanged.');
            }
          },
        },
      ],
    );
  };

  const handleTriggerMacro = (macro: any) => {
    const started = MacroEngine.executeMacro(macro);
    setMacroStatus(started
      ? `Manually running: ${macro.name}`
      : `Macro "${macro.name}" did not run. It is disabled or its conditions are not met.`);
  };

  const addCondition = () => {
    if (conditions.length >= MAX_MACRO_CONDITIONS) {
      Alert.alert('Condition limit reached', `Macros support at most ${MAX_MACRO_CONDITIONS} conditions.`);
      return;
    }
    const defaultTarget: Target = { ...DEFAULT_UNSELECTED_TARGET };
    setConditions([...conditions, {
      target: defaultTarget,
      operator: '==', 
      value: getDefaultUiValueForTarget(defaultTarget)
    }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateConditionTarget = (index: number, newTarget: Target) => {
    const updated = [...conditions];
    updated[index].target = newTarget;
    updated[index].operator = normalizeOperatorForTarget(newTarget, updated[index].operator || '==');
    updated[index].value = getDefaultUiValueForTarget(newTarget);
    setConditions(updated);
  };

  const updateConditionValue = (index: number, key: string, val: any) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [key]: val };
    setConditions(updated);
  };

  const addActionWithType = (type: 'osc' | 'delay' | 'fade' | 'automation_cue' | 'automization_control') => {
    if (actions.length >= MAX_MACRO_ACTIONS) {
      Alert.alert('Action limit reached', `Macros support at most ${MAX_MACRO_ACTIONS} actions.`);
      return;
    }
    const defaultTarget: Target = { ...DEFAULT_UNSELECTED_TARGET, parameter: (type === 'fade' || type === 'automation_cue') ? 'fader' : 'mute' };
    const newAction = {
      type,
      target: defaultTarget,
      valStr: type === 'osc' ? '0' : '-10',
      ms: '100',
      startMode: 'current',
      startVal: getDefaultUiValueForTarget(defaultTarget),
      endVal: getDefaultUiValueForTarget(defaultTarget),
      durationSec: '2.0',
      durationMs: '800',
      curve: type === 'automation_cue' ? 'linear' : 'smooth',
      automizationId: automizations[0]?.id || '',
      mode: 'toggle',
    };
    setActions([...actions, newAction]);
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
    if (expandedActionIndex === index) {
      setExpandedActionIndex(null);
    }
  };

  const duplicateAction = (index: number) => {
    const original = actions[index];
    const dupe = JSON.parse(JSON.stringify(original));
    const updated = [...actions];
    updated.splice(index + 1, 0, dupe);
    setActions(updated);
  };

  const moveAction = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= actions.length) return;
    const updated = [...actions];
    const temp = updated[newIndex];
    updated[newIndex] = updated[index];
    updated[index] = temp;
    setActions(updated);
  };

  const updateActionTarget = (index: number, newTarget: Target) => {
    const updated = [...actions];
    updated[index].target = newTarget;
    if (updated[index].type === 'fade') {
      updated[index].endVal = getDefaultUiValueForTarget(newTarget);
    } else if (updated[index].type === 'automation_cue') {
      updated[index].startVal = getDefaultUiValueForTarget(newTarget);
      updated[index].endVal = getDefaultUiValueForTarget(newTarget);
    } else if (updated[index].type === 'osc') {
      updated[index].valStr = isBooleanParameter(newTarget.parameter) ? '0' : getDefaultUiValueForTarget(newTarget);
    }
    setActions(updated);
  };

  const updateActionValue = (index: number, key: string, val: any) => {
    const updated = [...actions];
    updated[index] = { ...updated[index], [key]: val };
    setActions(updated);
  };

  const handleResetUiSettings = () => {
    setTypographyKey(DEFAULT_UI_SETTINGS.typographyKey);
    setTextScaleKey(DEFAULT_UI_SETTINGS.textScaleKey);
    setDensityKey(DEFAULT_UI_SETTINGS.densityKey);
    setShowInlineGuides(DEFAULT_UI_SETTINGS.showInlineGuides);
    setMeterUiRateKey(DEFAULT_UI_SETTINGS.meterUiRateKey);
    setMeterPreviewRows(DEFAULT_UI_SETTINGS.meterPreviewRows);
    setShowDiagnostics(DEFAULT_UI_SETTINGS.showDiagnostics);
  };

  const handleClearSavedRoute = () => {
    if (sessionConnected) {
      Alert.alert('Disconnect first', 'The saved route cannot be cleared while it is armed.');
      return;
    }
    setIp('');
    setMacroStatus('Saved console route cleared.');
  };

  const homeModuleCards = [
    {
      key: 'macros',
      title: 'Macros',
      subtitle: 'Discrete trigger-to-timeline automation with conditions and cue stacks.',
      accent: accentMacro,
      accentBg: 'rgba(242, 180, 93, 0.12)',
      meta: `${enabledMacroCount}/${macros.length} active`,
      buttonLabel: 'Open library',
      createLabel: 'New macro',
      onOpen: () => setMacroLibraryVisible(true),
      onCreate: handleAddNewMacro,
      items: homeMacroItems.map((macro) => ({
        key: getMacroIdentity(macro),
        title: macro.name,
        subtitle: `${macro.enabled === true ? 'Enabled timeline' : 'Disabled timeline'} | ${formatMacroRuntimeSummary(getMacroRuntime(macro))}`,
        tone: macro.enabled === true ? accentPrimary : '#8E8E93',
        onPress: () => openMacroWorkspace(getMacroIdentity(macro)),
      })),
      emptyText: 'No macros created yet.',
    },
    {
      key: 'automizations',
      title: 'Automations',
      subtitle: 'Realtime parameter mapping engine for inverse or direct source-to-target control.',
      accent: accentAutomation,
      accentBg: 'rgba(85, 214, 190, 0.12)',
      meta: `${enabledAutomizationCount}/${automizations.length} enabled`,
      buttonLabel: 'Open library',
      createLabel: 'New automation',
      onOpen: () => setAutomizationLibraryVisible(true),
      onCreate: handleAddAutomization,
      items: homeAutomizationItems.map((item) => ({
        key: item.id,
        title: item.name,
        subtitle: `${item.mode.toUpperCase()} | ${item.targetItems.length} target(s)`,
        tone: item.enabled ? accentAutomation : '#8E8E93',
        onPress: () => openAutomizationWorkspace(item.id),
      })),
      emptyText: 'No automations configured yet.',
    },
    {
      key: 'ha',
      title: 'HA Setups',
      subtitle: 'Dual-WING shared headamp control with follower trim compensation and resync guardrails.',
      accent: accentHa,
      accentBg: 'rgba(157, 183, 255, 0.12)',
      meta: `${enabledHaPairCount}/${haPairs.length} enabled | ${haAttentionCount} attention`,
      buttonLabel: 'Open library',
      createLabel: 'New HA setup',
      onOpen: () => setHaLibraryVisible(true),
      onCreate: handleAddHaPair,
      items: homeHaItems.map((pair) => {
        const runtime = haSnapshot?.runtimes?.[pair.id];
        return {
          key: pair.id,
          title: pair.name,
          subtitle: `${getHaStateVisual(runtime?.pairState).label} | ${getHaConnectivitySummary(pair, runtime)}`,
          tone: pair.enabled !== false ? accentHa : '#8E8E93',
          onPress: () => openHaWorkspace(pair.id),
        };
      }),
      emptyText: 'No HA setups configured yet.',
    },
  ];
  const overviewFocusOptions: { key: OverviewFocusKind; label: string; count: string; tone: string }[] = [
    { key: 'global', label: 'Overview', count: `${enabledMacroCount + enabledAutomizationCount + enabledHaPairCount} live`, tone: accentPrimary },
    { key: 'macros', label: 'Macros', count: `${enabledMacroCount}/${macros.length}`, tone: accentMacro },
    { key: 'automizations', label: 'Automations', count: `${enabledAutomizationCount}/${automizations.length}`, tone: accentAutomation },
    { key: 'ha', label: 'HA setups', count: `${enabledHaPairCount}/${haPairs.length}`, tone: accentHa },
  ];
  const macroMonitorItems = macros
    .map((macro) => {
      const identity = getMacroIdentity(macro);
      const preflight = buildMacroPreflight(macro, runtimeStatus);
      const enabled = macro.enabled === true;
      const hasIssues = preflight.errors.length > 0;
      return {
        key: identity || macro.name,
        title: macro.name || 'Unnamed macro',
        status: hasIssues ? 'CHECK' : enabled ? 'ACTIVE' : 'DISABLED',
        statusTone: hasIssues ? danger : enabled ? accentPrimary : '#8E8E93',
        detail: `When ${describeTarget(macro.triggerTarget)} ${macro.triggerOperator || '=='} ${formatParameterValue(macro.triggerTarget, macro.triggerValue)}`,
        meta: `IF ${macro.conditions?.length || 0} ${macro.logicalOperator || 'AND'} | THEN ${macro.actions?.length || 0} step${(macro.actions?.length || 0) === 1 ? '' : 's'}`,
        onPress: () => identity && openMacroWorkspace(identity),
      };
    })
    .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || a.title.localeCompare(b.title));
  const automizationMonitorItems = automizations
    .map((item) => {
      const localPreflight = buildAutomizationPreflight(item);
      const fleetErrors = automizationFleetPreflight.errorsById[item.id] || [];
      const runnable = item.enabled && localPreflight.errors.length === 0 && fleetErrors.length === 0;
      const blocked = localPreflight.errors.length > 0 || fleetErrors.length > 0;
      const liveValue = automizationLiveValueMap[item.id];
      const dispatchCount = Number(automizationDispatchCountMap[item.id] || 0);
      return {
        key: item.id,
        title: item.name,
        status: blocked ? 'CHECK' : runnable ? 'RUNNING' : 'DISABLED',
        statusTone: blocked ? danger : runnable ? accentAutomation : '#8E8E93',
        detail: `${item.mode.toUpperCase()} from ${describeTarget(item.sourceTarget)} to ${item.targetItems.length} target${item.targetItems.length === 1 ? '' : 's'}`,
        meta: `Live ${liveValue === null || liveValue === undefined ? '--' : formatParameterValue(item.sourceTarget, liveValue)} | Writes ${dispatchCount}`,
        onPress: () => openAutomizationWorkspace(item.id),
      };
    })
    .sort((a, b) => Number(b.status === 'RUNNING') - Number(a.status === 'RUNNING') || Number(a.status === 'CHECK') - Number(b.status === 'CHECK') || a.title.localeCompare(b.title));
  const haMonitorItems = haPairs
    .map((pair) => {
      const runtime = haSnapshot?.runtimes?.[pair.id];
      const visual = getHaStateVisual(runtime?.pairState);
      const mappingCount = Array.isArray(pair.mappings) ? pair.mappings.length : 0;
      const attention = runtime?.pairState === 'needs_config' || runtime?.pairState === 'needs_resync' || runtime?.pairState === 'saturated';
      return {
        key: pair.id,
        title: pair.name,
        status: runtime?.armed ? 'ARMED' : pair.enabled !== false ? visual.label : 'DISABLED',
        statusTone: pair.enabled !== false ? visual.border : '#8E8E93',
        attention,
        detail: `Owner ${describeHaOwner(pair)} | ${getHaConnectivitySummary(pair, runtime)}`,
        meta: `${mappingCount} mapping${mappingCount === 1 ? '' : 's'} | Last ${formatElapsedRuntime(runtime?.eventLog?.[0]?.at)}`,
        onPress: () => openHaWorkspace(pair.id),
      };
    })
    .sort((a, b) => Number(b.attention) - Number(a.attention) || Number(b.status === 'ARMED') - Number(a.status === 'ARMED') || a.title.localeCompare(b.title));
  const overviewFocusedItems = overviewFocus === 'macros'
    ? macroMonitorItems
    : overviewFocus === 'automizations'
      ? automizationMonitorItems
      : overviewFocus === 'ha'
        ? haMonitorItems
        : [];
  const overviewFocusedEmptyText = overviewFocus === 'macros'
    ? 'No macros created yet.'
    : overviewFocus === 'automizations'
      ? 'No automations configured yet.'
      : 'No HA setups configured yet.';
  const overviewFocusedTitle = overviewFocusOptions.find((option) => option.key === overviewFocus)?.label || 'GLOBAL';
  const overviewFocusedTone = overviewFocusOptions.find((option) => option.key === overviewFocus)?.tone || accentPrimary;
  const sidebarNavigationItems = [
    {
      key: 'overview',
      label: 'Overview',
      meta: operationalStatusLabel,
      icon: LayoutDashboard,
      tone: accentPrimary,
      active: currentWorkspace === 'overview',
      onPress: openOverviewWorkspace,
    },
    {
      key: 'meters',
      label: 'Meters',
      meta: wingOnline ? meterHealth.label : 'Offline map',
      icon: AudioLines,
      tone: success,
      active: currentWorkspace === 'meters',
      onPress: openMetersWorkspace,
    },
    {
      key: 'macros',
      label: 'Macros',
      meta: `${enabledMacroCount} active / ${macros.length}`,
      icon: Zap,
      tone: accentMacro,
      active: currentWorkspace === 'macro' || macroLibraryVisible,
      onPress: () => setMacroLibraryVisible(true),
    },
    {
      key: 'automizations',
      label: 'Automations',
      meta: `${enabledAutomizationCount} active / ${automizations.length}`,
      icon: Waypoints,
      tone: accentAutomation,
      active: currentWorkspace === 'automization' || automizationLibraryVisible,
      onPress: () => setAutomizationLibraryVisible(true),
    },
    {
      key: 'ha',
      label: 'HA setups',
      meta: `${enabledHaPairCount} enabled / ${haPairs.length}`,
      icon: ShieldCheck,
      tone: accentHa,
      active: currentWorkspace === 'ha' || haLibraryVisible,
      onPress: () => setHaLibraryVisible(true),
    },
  ];

  return (
    <UiTypographyContext.Provider value={{ fontFamily: appFontFamily, textScale: uiScale }}>
      <SafeAreaView style={styles.container}>
      <View style={[styles.splitScreenContainer, !uiIsCompact && styles.splitScreenContainerComfortable]}>
        {/* LEFT COLUMN: PRIMARY NAVIGATION AND CURRENT SHOW CONTEXT */}
        <View style={[styles.sidebarColumn, !uiIsCompact && styles.sidebarColumnComfortable]}>
          <View style={[styles.sidebarTopPane, !uiIsCompact && styles.sidebarTopPaneComfortable]}>
            <View style={styles.headerRow}>
              <View style={styles.sidebarBrandMark}>
                <Image source={require('../../assets/images/icon.png')} style={styles.sidebarBrandImage} contentFit="cover" />
              </View>
              <View style={styles.brandHeaderBlock}>
                <View style={styles.brandTitleRow}>
                  <Text style={styles.title}>Mármoles Wing Tools</Text>
                </View>
                <View style={styles.subtitleRow}>
                  <Text style={styles.subtitle}>SHOW CONTROL</Text>
                  <Text style={styles.versionBadge}>{appVersionLabel}</Text>
                </View>
              </View>
            </View>

            <View style={styles.sidebarPrimaryNav}>
              {sidebarNavigationItems.map((item) => {
                const NavIcon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.sidebarNavItem,
                      item.active && { backgroundColor: `${item.tone}14`, borderColor: `${item.tone}66` },
                    ]}
                    onPress={item.onPress}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.label}`}
                  >
                    <View style={[styles.sidebarNavIconBox, item.active && { backgroundColor: `${item.tone}1F` }]}>
                      <NavIcon size={17} color={item.active ? item.tone : textMuted} strokeWidth={2.1} />
                    </View>
                    <View style={styles.sidebarNavCopy}>
                      <Text style={[styles.sidebarNavLabel, item.active && { color: textPrimary }]}>{item.label}</Text>
                      <Text style={[styles.sidebarNavMeta, item.active && { color: item.tone }]} numberOfLines={1}>{item.meta}</Text>
                    </View>
                    <ChevronRight size={15} color={item.active ? item.tone : border2} strokeWidth={2} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.sidebarUtilityRow}>
              <TouchableOpacity style={styles.sidebarUtilityBtn} onPress={() => setPresetsVisible(true)} accessibilityLabel="Open show presets">
                <Database size={15} color={textSecondary} />
                <Text style={styles.sidebarUtilityText}>Shows</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sidebarUtilityBtn} onPress={() => setDiagnosticsModalVisible(true)} accessibilityLabel="Open diagnostics">
                <Activity size={15} color={textSecondary} />
                <Text style={styles.sidebarUtilityText}>Diagnostics</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sidebarUtilityBtn} onPress={() => setShowManual(true)} accessibilityLabel="Open guide">
                <CircleHelp size={15} color={textSecondary} />
                <Text style={styles.sidebarUtilityText}>Guide</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sidebarUtilityBtn} onPress={() => setUiSettingsVisible(true)} accessibilityLabel="Open settings">
                <Settings2 size={15} color={textSecondary} />
                <Text style={styles.sidebarUtilityText}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.sidebarListsPane}
            contentContainerStyle={[
              styles.sidebarListsPaneContent,
              !uiIsCompact && styles.sidebarListsPaneContentComfortable,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sidebarConnectionPanel}>
              <View style={styles.sidebarConnectionHeader}>
                <Text style={styles.sidebarPanelEyebrow}>Console</Text>
                <View style={[
                  styles.sidebarConnectionBadge,
                  { backgroundColor: wingOnline ? 'rgba(72, 209, 122, 0.12)' : sessionConnected ? 'rgba(244, 201, 93, 0.12)' : surface3 },
                ]}>
                  <View style={[styles.sidebarFooterStatusDot, (consoleUnsupported || consolePartial) ? styles.dotOrange : wingOnline ? styles.dotGreen : styles.dotRed]} />
                  <Text style={[styles.sidebarConnectionBadgeText, wingOnline && { color: success }]}>
                    {consoleUnsupported ? 'Unsupported' : consolePartial ? 'Limited' : wingOnline ? 'Online' : sessionConnected ? 'Probing' : 'Offline'}
                  </Text>
                </View>
              </View>

              <View style={styles.row}>
                {!sessionConnected && (
                  <TextInput
                    style={[styles.input, styles.sidebarIpInput]}
                    value={ip}
                    onChangeText={setIp}
                    placeholder="Console IP"
                    placeholderTextColor={textMuted}
                    keyboardType="numeric"
                  />
                )}
                <TouchableOpacity
                  style={[styles.connectButton, sessionConnected && styles.connectedButton, sessionConnected && { flex: 1 }]}
                  onPress={handleConnect}
                  accessibilityLabel={sessionConnected ? 'Disconnect console' : 'Connect console'}
                >
                  {sessionConnected
                    ? <WifiOff size={15} color={textPrimary} />
                    : <Wifi size={15} color={textPrimary} />}
                  <Text style={styles.connectButtonText}>{sessionConnected ? 'Disconnect' : 'Connect'}</Text>
                </TouchableOpacity>
              </View>

              {!sessionConnected && (
                <TouchableOpacity
                  style={styles.searchConsoleBtn}
                  onPress={handleSearchConsoles}
                  accessibilityLabel="Find console on network"
                >
                  <Search size={14} color={textSecondary} />
                  <Text style={styles.searchConsoleBtnText}>Find console</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.sidebarConnectionDetail} numberOfLines={2}>
                {wingOnline
                  ? `${consoleDisplayName} at ${currentWingRouteIp || ip}`
                  : sessionConnected
                    ? (localSocketBound ? 'Waiting for console reply' : 'Opening local socket')
                    : routeConfigured
                      ? `Ready to connect to ${ip}`
                      : 'No console route configured'}
              </Text>
            </View>

            <TouchableOpacity style={styles.sidebarShowPanel} onPress={() => setPresetsVisible(true)} activeOpacity={0.82}>
              <View style={styles.sidebarShowIcon}>
                <Database size={16} color={loadedAppPreset ? accentPrimary : textMuted} />
              </View>
              <View style={styles.sidebarShowCopy}>
                <Text style={styles.sidebarPanelEyebrow}>Active show</Text>
                <Text style={styles.sidebarShowName} numberOfLines={1}>
                  {loadedAppPreset ? `${loadedAppPreset.name}${loadedAppPresetModified ? ' · Modified' : ''}` : 'No show loaded'}
                </Text>
              </View>
              <ChevronRight size={15} color={border2} />
            </TouchableOpacity>

            {currentWorkspace === 'macro' && (
              <View style={[styles.sidebarContextPanel, { borderTopColor: accentMacro }]}>
                <View style={styles.sidebarContextHeader}>
                  <Text style={styles.sidebarContextTitle}>Macro library</Text>
                  <Text style={styles.sidebarSectionMetaText}>{`${enabledMacroCount}/${macros.length}`}</Text>
                </View>
                {macros.length === 0 ? (
                  <Text style={styles.sidebarContextEmpty}>No saved macros</Text>
                ) : (
                  <View style={styles.sidebarQuickList}>
                    {macroPreviewItems.map((macro, idx) => {
                      const isEnabled = macro.enabled === true;
                      const macroIdentity = getMacroIdentity(macro);
                      const isSelected = selectedMacroId === macroIdentity;
                      return (
                        <View key={macroIdentity || `${macro.name}-${idx}`} style={[styles.sidebarQuickRow, isSelected && styles.sidebarQuickRowActive, !isEnabled && styles.sidebarQuickRowMuted]}>
                          <TouchableOpacity style={styles.sidebarQuickRowSelectable} onPress={() => openMacroWorkspace(macroIdentity)} activeOpacity={0.85}>
                            <View style={[styles.sidebarQuickDot, isEnabled && { backgroundColor: accentMacro }]} />
                            <Text numberOfLines={1} style={styles.sidebarQuickLabel}>{macro.name}</Text>
                          </TouchableOpacity>
                          <Switch value={isEnabled} onValueChange={(val) => handleToggleMacro(macro, val)} trackColor={{ false: border1, true: 'rgba(242, 180, 93, 0.32)' }} thumbColor={isEnabled ? accentMacro : textMuted} style={styles.sidebarQuickSwitch} />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {currentWorkspace === 'automization' && (
              <View style={[styles.sidebarContextPanel, { borderTopColor: accentAutomation }]}>
                <View style={styles.sidebarContextHeader}>
                  <Text style={styles.sidebarContextTitle}>Automation library</Text>
                  <Text style={styles.sidebarSectionMetaText}>{`${enabledAutomizationCount}/${automizations.length}`}</Text>
                </View>
                <View style={styles.sidebarQuickList}>
                  {automizationPreviewItems.map((automization) => (
                    <View key={automization.id} style={[styles.sidebarQuickRow, selectedAutomizationId === automization.id && styles.sidebarQuickRowAltActive, !automization.enabled && styles.sidebarQuickRowMuted]}>
                      <TouchableOpacity style={styles.sidebarQuickRowSelectable} onPress={() => openAutomizationWorkspace(automization.id)} activeOpacity={0.85}>
                        <View style={[styles.sidebarQuickDot, automization.enabled && { backgroundColor: accentAutomation }]} />
                        <Text numberOfLines={1} style={styles.sidebarQuickLabel}>{automization.name}</Text>
                      </TouchableOpacity>
                      <Switch value={automization.enabled} onValueChange={(val) => handleToggleAutomization(automization.id, val)} trackColor={{ false: border1, true: 'rgba(85, 214, 190, 0.32)' }} thumbColor={automization.enabled ? accentAutomation : textMuted} style={styles.sidebarQuickSwitch} />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {currentWorkspace === 'ha' && (
              <View style={[styles.sidebarContextPanel, { borderTopColor: accentHa }]}>
                <View style={styles.sidebarContextHeader}>
                  <Text style={styles.sidebarContextTitle}>HA library</Text>
                  <Text style={styles.sidebarSectionMetaText}>{`${enabledHaPairCount}/${haPairs.length}`}</Text>
                </View>
                <View style={styles.sidebarQuickList}>
                  {haPreviewItems.map((pair) => {
                    const runtime = haSnapshot?.runtimes?.[pair.id];
                    const visual = getHaStateVisual(runtime?.pairState);
                    return (
                      <View key={pair.id} style={[styles.sidebarQuickRow, selectedHaPairId === pair.id && styles.sidebarQuickRowHaActive, !pair.enabled && styles.sidebarQuickRowMuted]}>
                        <TouchableOpacity style={styles.sidebarQuickRowSelectable} onPress={() => openHaWorkspace(pair.id)} activeOpacity={0.85}>
                          <View style={[styles.sidebarQuickDot, pair.enabled && { backgroundColor: accentHa }]} />
                          <View style={styles.sidebarQuickRowMetaBlock}>
                            <Text numberOfLines={1} style={styles.sidebarQuickLabel}>{pair.name}</Text>
                            <Text numberOfLines={1} style={styles.sidebarQuickSubHa}>{visual.label}</Text>
                          </View>
                        </TouchableOpacity>
                        <Switch value={pair.enabled !== false} onValueChange={(val) => handleToggleHaPair(pair.id, val)} trackColor={{ false: border1, true: 'rgba(157, 183, 255, 0.32)' }} thumbColor={pair.enabled !== false ? accentHa : textMuted} style={styles.sidebarQuickSwitch} />
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </ScrollView>

          <View style={[styles.sidebarFooter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={styles.sidebarFooterStatus}>
              <View style={[styles.sidebarFooterStatusDot, (consoleUnsupported || consolePartial) ? styles.dotOrange : wingOnline ? styles.dotGreen : styles.dotRed]} />
              <Text style={styles.sidebarFooterStatusText}>
                {consoleUnsupported ? 'UNSUPPORTED' : consolePartial ? 'PARTIAL' : wingOnline ? 'ONLINE' : 'OFFLINE'}
              </Text>
            </View>
            <Text style={styles.sidebarFooterStatusText}>{currentWorkspace === 'automization' ? 'AUTOMATION' : currentWorkspace.toUpperCase()}</Text>
          </View>
        </View>

        {/* RIGHT COLUMN: AUTOMATION STUDIO (ACTIVE WORKSPACE) */}
        <View style={styles.workspaceColumn}>
          {selectedMacroId ? (
            <View style={{ flex: 1 }}>
              
              {/* Workspace Header */}
              <View style={[styles.workspaceHeader, !uiIsCompact && styles.workspaceHeaderComfortable]}>
                <View style={styles.workspaceHeaderPrimary}>
                  <Text style={styles.workspaceHeaderTitle}>
                    {macroName || (selectedMacroId === NEW_MACRO_WORKSPACE_ID ? 'New macro' : 'Macro')}
                  </Text>
                  <Text style={[
                    styles.workspaceHeaderBadge, 
                    selectedMacroId === NEW_MACRO_WORKSPACE_ID 
                      ? { backgroundColor: 'rgba(48, 209, 88, 0.15)', color: '#30D158' }
                      : { backgroundColor: 'rgba(242, 180, 93, 0.14)', color: accentMacro }
                  ]}>
                    {selectedMacroId === NEW_MACRO_WORKSPACE_ID ? 'New' : 'Editing'}
                  </Text>
                </View>
                
                <View style={[styles.workspaceHeaderActions, uiIsCompact && styles.workspaceHeaderActionsCompact]}>
                  {selectedMacroId !== NEW_MACRO_WORKSPACE_ID && (
                    <TouchableOpacity 
                      style={styles.workspaceRunBtn} 
                      onPress={() => {
                        const macro = macros.find((item) => getMacroIdentity(item) === selectedMacroId);
                        if (macro) handleTriggerMacro(macro);
                      }}
                    >
                      <Play size={14} color={success} fill={success} />
                      <Text style={styles.workspaceRunBtnText}>Run now</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.workspaceSaveBtn} onPress={handleSaveMacro}>
                    <Save size={14} color="#071014" />
                    <Text style={styles.workspaceSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.workspaceCloseBtn} onPress={openOverviewWorkspace}>
                    <ArrowLeft size={14} color={textSecondary} />
                    <Text style={styles.workspaceCloseBtnText}>Overview</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Workspace Scroller */}
              <ScrollView
                style={styles.workspaceScroll}
                contentContainerStyle={[styles.workspaceScrollContent, !uiIsCompact && styles.workspaceScrollContentComfortable]}
                showsVerticalScrollIndicator={false}
              >
                <View style={[styles.macroReadinessPanel, styles.macroReadinessPanelMacro]}>
                  <View style={styles.macroReadinessHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.macroReadinessTitle}>Macro summary</Text>
                    </View>
                    <View
                      style={[
                        styles.macroReadinessStatusBadge,
                        {
                          borderColor: macroPreflight.errors.length > 0 ? danger : macroPreflight.warnings.length > 0 ? '#FF9500' : success,
                          backgroundColor: macroPreflight.errors.length > 0
                            ? 'rgba(255, 59, 48, 0.12)'
                            : macroPreflight.warnings.length > 0
                              ? 'rgba(255, 149, 0, 0.12)'
                              : 'rgba(52, 199, 89, 0.12)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.macroReadinessStatusText,
                          { color: macroPreflight.errors.length > 0 ? '#FF9F9A' : macroPreflight.warnings.length > 0 ? '#FFD28A' : '#B8F7C9' },
                        ]}
                      >
                        {macroPreflight.errors.length > 0 ? 'BLOCKED' : macroPreflight.warnings.length > 0 ? 'CHECK' : 'READY'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.macroReadinessGrid, width < 1320 && { flexDirection: 'column' }]}>
                    {macroReadinessCards.map((card) => (
                      <View key={card.key} style={[styles.macroReadinessCard, { borderColor: `${card.tone}44` }]}>
                        <Text style={styles.macroReadinessLabel}>{card.label}</Text>
                        <Text style={[styles.macroReadinessValue, { color: card.tone }]} numberOfLines={1}>
                          {card.value}
                        </Text>
                        <Text style={styles.macroReadinessDetail} numberOfLines={2}>
                          {card.detail}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* SECTION 1: GENERAL INFO & TRIGGER SOURCE */}
                <View style={styles.dashboardSection}>
                  <Text style={styles.dashboardSectionTitle}>1. TRIGGER AND IDENTITY</Text>
                  
                      <Text style={styles.modalLabel}>MACRO NAME</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={macroName}
                    onChangeText={setMacroName}
                    placeholder="e.g. Dynamic Auto-Ducker"
                    placeholderTextColor="#666"
                  />

                  <Text style={styles.modalLabel}>TRIGGER SOURCE</Text>
                  <TouchableOpacity
                      style={[
                        styles.stepSubCard,
                        triggerMatchState === true && styles.triggerStateCardMatched,
                        triggerMatchState === false && styles.triggerStateCardIdle,
                      ]} 
                      onPress={() => setIsTriggerModalOpen(true)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.modalSubLabel}>CONSOLE SIGNAL STATE SOURCE</Text>
                      <View style={{ padding: 12, backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 8, marginBottom: 12 }}>
                        <View style={styles.triggerStateHeaderRow}>
                          <Text style={styles.triggerStateHeaderLabel}>LIVE TRIGGER STATE</Text>
                          <View
                            style={[
                              styles.triggerStateBadge,
                              triggerMatchState === true
                                ? styles.triggerStateBadgeMatched
                                : triggerMatchState === false
                                  ? styles.triggerStateBadgeIdle
                                  : styles.triggerStateBadgeUnknown,
                            ]}
                          >
                            <Text style={styles.triggerStateBadgeText}>
                              {triggerMatchState === true ? 'MATCH' : triggerMatchState === false ? 'IDLE' : 'WAITING'}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                          Inspect parameter: <Text style={{ color: accentPrimary, fontWeight: '700' }}>{describeTarget(triggerTarget)}</Text>
                        </Text>
                        <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                          Trigger condition: <Text style={{ color: accentPrimary, fontWeight: '700' }}>
                            {triggerOperator} {formatParameterValue(triggerTarget, triggerValue)}
                          </Text>
                        </Text>
                        <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                          Edge mode: <Text style={{ color: accentPrimary, fontWeight: '700' }}>
                            {triggerEdgeMode === 'on' ? 'ON' : triggerEdgeMode === 'off' ? 'OFF' : 'ON/OFF'}
                          </Text>
                        </Text>
                        {isMeterParameter(triggerTarget?.parameter) && (
                          <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                            Meter profile: <Text style={{ color: accentPrimary, fontWeight: '700' }}>
                              {triggerMeterMode === 'transient' ? `FAST | ${triggerMeterCooldownMs} ms | ${triggerMeterRearmDb} dB | stale ${triggerMeterStaleAfterMs} ms` : 'LEVEL'}
                            </Text>
                          </Text>
                        )}
                        <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                          Overlap policy: <Text style={{ color: accentPrimary, fontWeight: '700' }}>
                            {macroOverlapStrategy.toUpperCase().replace('_', ' ')}
                          </Text>
                        </Text>
                        {selectedMacroId && selectedMacroId !== NEW_MACRO_WORKSPACE_ID && (
                          <Text style={{ color: textPrimary, fontSize: 13, marginBottom: 4 }}>
                            Runtime: <Text style={{ color: accentPrimary, fontWeight: '700' }}>
                              {formatMacroRuntimeSummary(macroRuntimeMap[selectedMacroId])}
                            </Text>
                          </Text>
                        )}
                        {liveMeterVal !== null && (
                          <Text style={{ color: textMuted, fontSize: 11, marginTop: 4 }}>
                            Live value: {formatParameterValue(triggerTarget, liveMeterVal)}
                          </Text>
                        )}
                      </View>
                      <Text style={{ color: accentPrimary, fontSize: 11, fontWeight: '700', alignSelf: 'flex-start' }}>
                        OPEN TRIGGER CONFIGURATION
                      </Text>
                    </TouchableOpacity>

                  {(macroPreflight.errors.length > 0 || macroPreflight.warnings.length > 0) && (
                    <View style={styles.preflightCard}>
                      <Text style={styles.preflightTitle}>MACRO PREFLIGHT</Text>
                      {macroPreflight.errors.map((err, idx) => (
                        <Text key={`err-${idx}`} style={styles.preflightErrorText}>ERROR: {err}</Text>
                      ))}
                      {macroPreflight.warnings.map((warn, idx) => (
                        <Text key={`warn-${idx}`} style={styles.preflightWarningText}>WARNING: {warn}</Text>
                      ))}
                    </View>
                  )}
                </View>

                {/* SECTION 2: SENSOR GATES (IF CONDITIONAL MULTI-STATE) */}
                <View style={styles.dashboardSection}>
                  <View style={styles.rowJustified}>
                    <Text style={styles.dashboardSectionTitle}>2. OPTIONAL IF GATES</Text>
                    <TouchableOpacity style={styles.addButtonMini} onPress={addCondition}>
                      <Text style={styles.addButtonMiniText}>+ ADD RULE</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalSubLabel}>LOGICAL OPERATOR TO BIND GATES</Text>
                  <View style={styles.toggleRowCompact}>
                    <TouchableOpacity 
                      style={[styles.toggleBtnCompact, macroOperator === 'AND' && styles.toggleBtnCompactActive]}
                      onPress={() => setMacroOperator('AND')}
                    >
                      <Text style={styles.toggleBtnCompactText}>AND (All rules must match)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.toggleBtnCompact, macroOperator === 'OR' && styles.toggleBtnCompactActive]}
                      onPress={() => setMacroOperator('OR')}
                    >
                      <Text style={styles.toggleBtnCompactText}>OR (Any rule can match)</Text>
                    </TouchableOpacity>
                  </View>

                  {conditions.length === 0 ? (
                    <View style={styles.emptySubCard}>
                      <Text style={styles.emptyStateText}>No additional conditional gates. Always triggers directly!</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 12, marginTop: 10 }}>
                      {conditions.map((cond, index) => {
                        return (
                          <TouchableOpacity 
                            key={index} 
                            style={styles.conditionCard}
                            onPress={() => setExpandedConditionIndex(index)}
                            activeOpacity={0.85}
                          >
                            <View style={styles.conditionCardHeader}>
                              <Text style={styles.conditionCardHeaderTitle}>
                                {`Rule #${index + 1}: ${describeTarget(cond.target)} ${cond.operator} ${formatParameterValue(cond.target, cond.value)}`}
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={styles.timelineExpandIcon}>EDIT</Text>
                                <TouchableOpacity style={styles.cardDeleteBtn} onPress={() => removeCondition(index)}>
                                  <Text style={styles.cardDeleteBtnText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* SECTION 3: ACTION TIMELINE (THEN MULTI-STEP WITH SEQUENCER) */}
                <View style={styles.dashboardSection}>
                  <Text style={styles.dashboardSectionTitle}>3. ACTIONS</Text>
                  <Text style={styles.sectionHelperText}>
                    When the trigger fires, the macro runs these steps in order — the commands it sends to the console.
                  </Text>

                  <TouchableOpacity
                    style={styles.addActionPrimaryBtn}
                    onPress={() => setShowAddActionPicker((v) => !v)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.addActionPrimaryBtnText}>{showAddActionPicker ? '✕  CLOSE' : '+  ADD ACTION'}</Text>
                  </TouchableOpacity>

                  {showAddActionPicker && (
                    <View style={styles.actionPicker}>
                      <TouchableOpacity style={styles.actionPickerOption} activeOpacity={0.85} onPress={() => { addActionWithType('osc'); setShowAddActionPicker(false); }}>
                        <Text style={[styles.actionPickerOptionTitle, { color: accentPrimary }]}>Send command</Text>
                        <Text style={styles.actionPickerOptionDesc}>Set a console parameter to a value (fader, mute, gain…).</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPickerOption} activeOpacity={0.85} onPress={() => { addActionWithType('delay'); setShowAddActionPicker(false); }}>
                        <Text style={[styles.actionPickerOptionTitle, { color: '#FF9800' }]}>Wait</Text>
                        <Text style={styles.actionPickerOptionDesc}>Pause before the next step (in milliseconds).</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPickerOption} activeOpacity={0.85} onPress={() => { addActionWithType('fade'); setShowAddActionPicker(false); }}>
                        <Text style={[styles.actionPickerOptionTitle, { color: '#E91E63' }]}>Fade</Text>
                        <Text style={styles.actionPickerOptionDesc}>Change a value gradually over a duration.</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPickerOption} activeOpacity={0.85} onPress={() => { addActionWithType('automation_cue'); setShowAddActionPicker(false); }}>
                        <Text style={[styles.actionPickerOptionTitle, { color: '#8ED6FF' }]}>Automation cue</Text>
                        <Text style={styles.actionPickerOptionDesc}>Ramp any parameter precisely from current or fixed value to a target value.</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPickerOption} activeOpacity={0.85} onPress={() => { addActionWithType('automization_control'); setShowAddActionPicker(false); }}>
                        <Text style={[styles.actionPickerOptionTitle, { color: accentAutomation }]}>Control automation</Text>
                        <Text style={styles.actionPickerOptionDesc}>Enable, disable, or toggle a saved automation from this macro timeline.</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {actions.length === 0 ? (
                    <View style={styles.emptySubCard}>
                      <Text style={styles.emptyStateText}>No actions yet.</Text>
                      <Text style={[styles.sectionHelperText, { textAlign: 'center', marginTop: 4, marginBottom: 0 }]}>Tap “+ ADD ACTION” to add the first command this macro sends to the console.</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 12, marginTop: 10 }}>
                      {actions.map((act, index) => {
                        let cardColor = accentPrimary;
                        if (act.type === 'delay') {
                          cardColor = '#FF9800';
                        } else if (act.type === 'fade') {
                          cardColor = '#E91E63';
                        } else if (act.type === 'automation_cue') {
                          cardColor = '#8ED6FF';
                        } else if (act.type === 'automization_control') {
                          cardColor = accentAutomation;
                        }
                        const controlledAutomation = act.type === 'automization_control'
                          ? automizations.find((item) => item.id === act.automizationId)
                          : null;

                        return (
                          <View
                            key={index} 
                            style={[
                              styles.timelineCard, 
                              { borderLeftWidth: 4, borderLeftColor: cardColor }
                            ]}
                          >
                            <View style={styles.timelineCardHeader}>
                              <Text style={styles.cueNumberBadge}>STEP {String(index + 1).padStart(2, '0')}</Text>
                              <Text style={styles.timelineCardHeaderTitle}>
                                {act.type === 'delay' ? (
                                  `Delay: ${act.ms} ms`
                                ) : (
                                  act.type === 'fade' ? (
                                    `Fade ${describeTarget(act.target)} to ${formatParameterValue(act.target, act.endVal)} over ${act.durationSec}s`
                                  ) : act.type === 'automation_cue' ? (
                                    `Automate ${describeTarget(act.target)} ${act.startMode === 'fixed' ? `from ${formatParameterValue(act.target, act.startVal)}` : 'from current'} to ${formatParameterValue(act.target, act.endVal)} over ${act.durationMs || Math.round((Number(act.durationSec) || 1) * 1000)}ms`
                                  ) : act.type === 'automization_control' ? (
                                    `${String(act.mode || 'toggle').toUpperCase()} automation: ${controlledAutomation?.name || 'Select automation'}`
                                  ) : (
                                    `Set ${describeTarget(act.target)} -> ${formatParameterValue(act.target, act.valStr)}`
                                  )
                                )}
                              </Text>
                              
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <TouchableOpacity style={styles.cardToolBtn} onPress={() => moveAction(index, 'up')}>
                                  <Text style={styles.cardToolBtnText}>UP</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.cardToolBtn} onPress={() => moveAction(index, 'down')}>
                                  <Text style={styles.cardToolBtnText}>DOWN</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.cardToolBtn} onPress={() => duplicateAction(index)}>
                                  <Text style={styles.cardToolBtnText}>COPY</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.cardToolBtn} onPress={() => setExpandedActionIndex(index)}>
                                  <Text style={styles.cardToolBtnText}>EDIT</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.cardDeleteBtn} onPress={() => removeAction(index)}>
                                  <Text style={styles.cardDeleteBtnText}>DELETE</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
                {showDiagnostics && (
                  <View style={{ marginTop: 20, marginBottom: 40, padding: 15, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12, borderWidth: 1, borderColor: border1 }}>
                    <Text style={{ color: textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 10, letterSpacing: 0.5 }}>WING OSC LIVE EVENT LOG (LAST 10)</Text>
                    {debugLogs.length === 0 ? (
                      <Text style={{ color: textMuted, fontSize: 11, fontStyle: 'italic' }}>No incoming OSC events yet. Move a fader on the WING!</Text>
                    ) : (
                      debugLogs.map((log, i) => (
                        <Text key={i} style={{ color: textSecondary, fontSize: 11, fontFamily: 'monospace', marginBottom: 2 }}>{log}</Text>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          ) : selectedHaPairId ? (
            <View style={{ flex: 1 }}>
              <View style={[styles.workspaceHeader, !uiIsCompact && styles.workspaceHeaderComfortable]}>
                <View style={styles.workspaceHeaderPrimary}>
                  <Text style={styles.workspaceHeaderTitle}>
                    {selectedHaPair?.name || 'HA setup'}
                  </Text>
                  <Text style={[styles.workspaceHeaderBadge, { backgroundColor: 'rgba(157, 183, 255, 0.14)', color: accentHa }]}>
                    HA setup
                  </Text>
                </View>

                <View style={[styles.workspaceHeaderActions, uiIsCompact && styles.workspaceHeaderActionsCompact]}>
                  <TouchableOpacity style={styles.workspaceCloseBtn} onPress={openOverviewWorkspace}>
                    <ArrowLeft size={14} color={textSecondary} />
                    <Text style={styles.workspaceCloseBtnText}>Overview</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={styles.workspaceScroll}
                contentContainerStyle={[styles.workspaceScrollContent, !uiIsCompact && styles.workspaceScrollContentComfortable]}
                showsVerticalScrollIndicator={false}
              >
                {!selectedHaPair ? (
                  <View style={styles.dashboardSection}>
                    <Text style={styles.dashboardSectionTitle}>HA SETUP</Text>
                    <Text style={[styles.emptyStateText, { textAlign: 'left', color: textSecondary, fontSize: 12.5, lineHeight: 18 }]}>
                      Select an HA setup from the sidebar to configure owner/follower headamp compensation.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={[styles.macroReadinessPanel, styles.macroReadinessPanelHa]}>
                      <View style={styles.macroReadinessHeader}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.macroReadinessTitle}>HA status</Text>
                        </View>
                        <View
                          style={[
                            styles.macroReadinessStatusBadge,
                            {
                              borderColor: selectedHaStateVisual.border,
                              backgroundColor: selectedHaStateVisual.bg,
                            },
                          ]}
                        >
                          <Text style={[styles.macroReadinessStatusText, { color: selectedHaStateVisual.text }]}>
                            {selectedHaRuntime?.armed ? 'ARMED' : selectedHaStateVisual.label}
                          </Text>
                        </View>
                      </View>

                      <View style={[styles.macroReadinessGrid, width < 1320 && { flexDirection: 'column' }]}>
                        {selectedHaOperationalCards.map((card) => (
                          <View key={card.key} style={[styles.macroReadinessCard, { borderColor: `${card.tone}44` }]}>
                            <Text style={styles.macroReadinessLabel}>{card.label}</Text>
                            <Text style={[styles.macroReadinessValue, { color: card.tone }]} numberOfLines={1}>
                              {card.value}
                            </Text>
                            <Text style={styles.macroReadinessDetail} numberOfLines={2}>
                              {card.detail}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    <View style={[styles.dashboardSection, styles.dashboardSectionConfig]}>
                      <Text style={styles.dashboardSectionTitle}>1. SETUP IDENTITY AND ENDPOINTS</Text>
                      <Text style={styles.modalLabel}>SETUP NAME</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={selectedHaPair.name}
                        onChangeText={(value) => handleUpdateHaPair(selectedHaPair.id, { name: value })}
                        placeholder="PA / MON shared stagebox"
                        placeholderTextColor="#666"
                      />

                      <View style={[styles.rowJustified, { marginTop: 12 }]}>
                        <Text style={styles.modalLabel}>SETUP ENABLED</Text>
                        <Switch
                          value={selectedHaPair.enabled !== false}
                          onValueChange={(value) => handleToggleHaPair(selectedHaPair.id, value)}
                          trackColor={{ false: '#2A2A2A', true: 'rgba(224, 163, 62, 0.3)' }}
                          thumbColor={selectedHaPair.enabled !== false ? accentHa : '#555'}
                        />
                      </View>

                      <View style={{ flexDirection: width < 1200 ? 'column' : 'row', gap: 12, marginTop: 10 }}>
                        {(['a', 'b'] as const).map((endpointId) => {
                          const endpoint = selectedHaPair.endpoints[endpointId];
                          const endpointRuntime = selectedHaRuntime?.endpoints?.[endpointId];
                          const endpointVisual = getHaEndpointStatusVisual(selectedHaPair, selectedHaRuntime, endpointId);
                          const runtimeRole = selectedHaPair.haOwner === endpointId ? 'OWNER' : 'FOLLOWER';
                          const runtimeFamilyLabel = endpointRuntime?.consoleFamily === 'wing'
                            ? 'WING'
                            : endpointRuntime?.consoleFamily === 'x32-family'
                              ? 'X32/M32-family'
                              : 'Unknown';
                          const transportState = endpointRuntime?.sessionConnected
                            ? (endpointRuntime?.localSocketBound ? 'PROBING' : 'SOCKET INIT')
                            : (endpointRuntime?.routeConfigured ? 'ROUTE READY' : 'IDLE');
                          return (
                            <View key={endpointId} style={[styles.conditionCard, { flex: 1, borderLeftColor: accentHa, borderLeftWidth: 3 }]}>
                              <View style={styles.conditionCardHeader}>
                                <Text style={styles.conditionCardHeaderTitle}>{`CONSOLE ${endpointId.toUpperCase()} • ${runtimeRole}`}</Text>
                                <View style={[styles.triggerStateBadge, { backgroundColor: endpointVisual.bg, borderColor: endpointVisual.border }]}>
                                  <Text style={[styles.triggerStateBadgeText, { color: endpointVisual.text }]}>{endpointVisual.label}</Text>
                                </View>
                              </View>

                              <View style={styles.haEndpointBody}>
                              <Text style={styles.modalSubLabel}>LABEL</Text>
                              <TextInput
                                style={styles.modalInput}
                                value={endpoint.label}
                                onChangeText={(value) => handleUpdateHaPair(selectedHaPair.id, (pair: HaPair) => ({
                                  ...pair,
                                  endpoints: {
                                    ...pair.endpoints,
                                    [endpointId]: {
                                      ...pair.endpoints[endpointId],
                                      label: value,
                                    },
                                  },
                                }))}
                                placeholder={endpointId === 'a' ? 'PA' : 'MON'}
                                placeholderTextColor="#666"
                              />

                              <Text style={styles.modalSubLabel}>IP ADDRESS</Text>
                              <TextInput
                                style={[styles.modalInput, styles.haEndpointInput, { borderColor: endpointVisual.inputBorder }]}
                                value={endpoint.ip}
                                onChangeText={(value) => handleUpdateHaPair(selectedHaPair.id, (pair: HaPair) => ({
                                  ...pair,
                                  endpoints: {
                                    ...pair.endpoints,
                                    [endpointId]: {
                                      ...pair.endpoints[endpointId],
                                      ip: value,
                                    },
                                  },
                                }))}
                                keyboardType="numbers-and-punctuation"
                                autoCapitalize="none"
                                placeholder={`Set ${endpoint.label || `Console ${endpointId.toUpperCase()}`} IP`}
                                placeholderTextColor="#5F6876"
                              />
                              <Text style={[styles.haEndpointHintText, { color: endpointVisual.detailColor }]}>{endpointVisual.detail}</Text>

                              <View style={styles.haEndpointActionRow}>
                                <TouchableOpacity
                                  style={styles.haEndpointActionBtn}
                                  onPress={() => handleUseCurrentWingForHaEndpoint(selectedHaPair.id, endpointId)}
                                >
                                  <Text style={styles.haEndpointActionBtnText}>USE CURRENT CONSOLE</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.haEndpointActionBtn, styles.haEndpointActionBtnGhost]}
                                  onPress={() => handleClearHaEndpoint(selectedHaPair.id, endpointId)}
                                >
                                  <Text style={[styles.haEndpointActionBtnText, styles.haEndpointActionBtnGhostText]}>CLEAR</Text>
                                </TouchableOpacity>
                              </View>

                              <Disclosure title="ADVANCED">
                                <Text style={styles.modalSubLabel}>PREFERRED OSC PORT</Text>
                                <TextInput
                                  style={styles.modalInput}
                                  value={String(endpoint.oscPort || 2223)}
                                  onChangeText={(value) => handleUpdateHaPair(selectedHaPair.id, (pair: HaPair) => ({
                                    ...pair,
                                    endpoints: {
                                      ...pair.endpoints,
                                      [endpointId]: {
                                        ...pair.endpoints[endpointId],
                                        oscPort: parseInt(value, 10) || 2223,
                                      },
                                    },
                                  }))}
                                  keyboardType="numeric"
                                  placeholder="2223 or 10023"
                                  placeholderTextColor="#666"
                                />
                                <Text style={[styles.haEndpointHintText, { color: textMuted }]}>
                                  Initial route hint only — the app also probes WING `2223` and X32/M32 `10023` automatically.
                                </Text>
                              </Disclosure>

                              <Disclosure title="STATUS DETAILS">
                                <Text style={styles.haEndpointDiagText}>
                                  {`Route hint: ${endpoint.ip || '--'}:${formatHaPort(endpoint.oscPort || 2223)} | Session: ${transportState} | Driver: ${String(endpointRuntime?.driverMode || '--').toUpperCase()}`}
                                </Text>
                                <Text style={styles.haEndpointDiagText}>
                                  {`Active port: ${formatHaPort(endpointRuntime?.activeOscPort || endpointRuntime?.lastConsoleReplyPort || endpoint.oscPort || 2223)} | Family: ${runtimeFamilyLabel} | Model: ${endpointRuntime?.consoleDisplayName || endpointRuntime?.consoleModel || 'unknown'} | Last seen: ${formatElapsedRuntime(endpointRuntime?.lastSeenAt)}`}
                                </Text>
                              </Disclosure>
                              </View>
                            </View>
                          );
                        })}
                      </View>

                      {(selectedHaRuntime?.diagnostics?.errors?.length > 0 || selectedHaRuntime?.diagnostics?.warnings?.length > 0) && (
                        <View style={styles.preflightCard}>
                          <Text style={styles.preflightTitle}>HA PREFLIGHT</Text>
                          {(selectedHaRuntime?.diagnostics?.errors || []).map((err: string, idx: number) => (
                            <Text key={`ha-err-${idx}`} style={styles.preflightErrorText}>ERROR: {err}</Text>
                          ))}
                          {(selectedHaRuntime?.diagnostics?.warnings || []).map((warn: string, idx: number) => (
                            <Text key={`ha-warn-${idx}`} style={styles.preflightWarningText}>WARNING: {warn}</Text>
                          ))}
                        </View>
                      )}
                    </View>

                    <View style={[styles.dashboardSection, styles.dashboardSectionConfig]}>
                      <Text style={styles.dashboardSectionTitle}>2. HA OWNERSHIP</Text>
                      <Text style={styles.modalLabel}>WHO CONTROLS THE HEADAMP?</Text>
                      <View style={styles.toggleRowCompact}>
                        {(['a', 'b'] as const).map((endpointId) => (
                          <TouchableOpacity
                            key={endpointId}
                            style={[styles.toggleBtnCompact, selectedHaPair.haOwner === endpointId && styles.toggleBtnCompactActive]}
                            onPress={() => {
                              if (!ensureHaStorageWritable()) return;
                              (HaCompensationEngine as any).setOwner(selectedHaPair.id, endpointId);
                            }}
                          >
                            <Text style={styles.toggleBtnCompactText}>{`${selectedHaPair.endpoints[endpointId].label} OWNS HA`}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 12 }]}>
                        {`Current owner: ${describeHaOwner(selectedHaPair)} | Current follower: ${selectedHaPair.endpoints[getHaFollowerEndpointId(selectedHaPair.haOwner)].label}`}
                      </Text>
                      <Text style={styles.sidebarAutomationCardSummary}>
                        {getHaConnectivitySummary(selectedHaPair, selectedHaRuntime)}
                      </Text>
                    </View>

                    <View style={[styles.dashboardSection, styles.dashboardSectionMapping]}>
                      <View style={styles.rowJustified}>
                        <Text style={styles.dashboardSectionTitle}>3. SOURCE-TO-TRIM MAPPINGS</Text>
                        <TouchableOpacity style={styles.addButtonMini} onPress={() => handleAddHaMapping(selectedHaPair.id)}>
                          <Text style={styles.addButtonMiniText}>+ ADD LINK</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={[styles.conditionCard, { borderLeftColor: accentPrimary, borderLeftWidth: 3, marginBottom: 14 }]}>
                        <View style={styles.conditionCardHeader}>
                          <Text style={styles.conditionCardHeaderTitle}>1:1 RANGE GENERATOR</Text>
                          <Text style={[styles.sidebarHaCardSub, { marginTop: 0 }]}>
                            {`Will create ${haRangePlan.count} mapping(s)${haRangePlan.truncated ? ' (truncated to fit limits)' : ''}`}
                          </Text>
                        </View>
                        <Text style={styles.haGuideText}>
                          Use the range generator for predictable stagebox-style runs. Append preserves existing links; replace rebuilds this setup&apos;s link list.
                        </Text>

                        <Text style={styles.modalLabel}>SOURCE RANGE</Text>
                        <View style={{ flexDirection: width < 1200 ? 'column' : 'row', gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <View style={styles.toggleRowCompact}>
                              {selectedHaSourceFamilyOptions.map((option) => (
                                <TouchableOpacity
                                  key={`bulk-source-${option.key}`}
                                  style={[styles.toggleBtnCompact, haRangeDraft.sourceFamily === option.key && styles.toggleBtnCompactActive]}
                                  onPress={() => handleUpdateHaRangeDraft({
                                    sourceFamily: option.key,
                                    sourceStart: String(clampHaSourceIndex(option.key, haRangeDraft.sourceStart, selectedHaOwnerConsoleFamily)),
                                  })}
                                >
                                  <Text style={styles.toggleBtnCompactText}>{option.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                          <View style={{ width: width < 1200 ? '100%' : 120 }}>
                            <Text style={styles.modalSubLabel}>START</Text>
                            <TextInput
                              style={styles.modalInput}
                              value={haRangeDraft.sourceStart}
                              onChangeText={(value) => handleUpdateHaRangeDraft({ sourceStart: value })}
                              keyboardType="numeric"
                              placeholder="1"
                              placeholderTextColor="#666"
                            />
                          </View>
                          <View style={{ width: width < 1200 ? '100%' : 120 }}>
                            <Text style={styles.modalSubLabel}>COUNT</Text>
                            <TextInput
                              style={styles.modalInput}
                              value={haRangeDraft.count}
                              onChangeText={(value) => handleUpdateHaRangeDraft({ count: value })}
                              keyboardType="numeric"
                              placeholder="8"
                              placeholderTextColor="#666"
                            />
                          </View>
                        </View>

                        <View style={{ flexDirection: width < 1200 ? 'column' : 'row', gap: 12, marginTop: 14 }}>
                          {([
                            { endpointId: 'a', label: selectedHaPair.endpoints.a.label, family: haRangeDraft.targetFamilyA, start: haRangeDraft.targetStartA },
                            { endpointId: 'b', label: selectedHaPair.endpoints.b.label, family: haRangeDraft.targetFamilyB, start: haRangeDraft.targetStartB },
                          ] as const).map((entry) => (
                            <View key={`bulk-${entry.endpointId}`} style={[styles.conditionCard, { flex: 1, marginBottom: 0, backgroundColor: surface1 }]}>
                              <View style={styles.conditionCardHeader}>
                                <Text style={styles.conditionCardHeaderTitle}>{`${entry.label} GENERATED TARGETS`}</Text>
                              </View>
                              <View style={styles.toggleRowCompact}>
                                {HA_TARGET_FAMILY_OPTIONS.map((option) => (
                                  <TouchableOpacity
                                    key={`bulk-target-${entry.endpointId}-${option.key}`}
                                    style={[styles.toggleBtnCompact, entry.family === option.key && styles.toggleBtnCompactActive]}
                                    onPress={() => handleUpdateHaRangeDraft(
                                      entry.endpointId === 'a'
                                        ? {
                                            targetFamilyA: option.key,
                                            targetStartA: String(clampHaTargetIndex(option.key, haRangeDraft.targetStartA, selectedHaEndpointConsoleFamilies.a)),
                                          }
                                        : {
                                            targetFamilyB: option.key,
                                            targetStartB: String(clampHaTargetIndex(option.key, haRangeDraft.targetStartB, selectedHaEndpointConsoleFamilies.b)),
                                          },
                                    )}
                                  >
                                    <Text style={styles.toggleBtnCompactText}>{option.label}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                              <Text style={[styles.modalSubLabel, { marginTop: 10 }]}>START</Text>
                              <TextInput
                                style={styles.modalInput}
                                value={entry.start}
                                onChangeText={(value) => handleUpdateHaRangeDraft(entry.endpointId === 'a' ? { targetStartA: value } : { targetStartB: value })}
                                keyboardType="numeric"
                                placeholder="1"
                                placeholderTextColor="#666"
                              />
                            </View>
                          ))}
                        </View>

                        <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 12 }]}>
                          {`Preview: ${describeHaSource({ family: haRangeDraft.sourceFamily, index: haRangePlan.sourceStart })}..${describeHaSource({ family: haRangeDraft.sourceFamily, index: haRangePlan.sourceStart + haRangePlan.count - 1 })} | ${selectedHaPair.endpoints.a.label}: ${haRangeDraft.targetFamilyA.toUpperCase()} ${haRangePlan.targetStartA}-${haRangePlan.targetStartA + haRangePlan.count - 1} | ${selectedHaPair.endpoints.b.label}: ${haRangeDraft.targetFamilyB.toUpperCase()} ${haRangePlan.targetStartB}-${haRangePlan.targetStartB + haRangePlan.count - 1}`}
                        </Text>

                        <View style={[styles.toggleRowCompact, { marginTop: 12 }]}>
                          <TouchableOpacity style={[styles.toggleBtnCompact, { borderColor: success }]} onPress={() => handleAppendHaRangeMappings(selectedHaPair.id)}>
                            <Text style={styles.toggleBtnCompactText}>APPEND RANGE</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.toggleBtnCompact, { borderColor: '#FF9500' }]} onPress={() => handleReplaceHaRangeMappings(selectedHaPair.id)}>
                            <Text style={styles.toggleBtnCompactText}>REPLACE ALL</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={{ gap: 12 }}>
                        {selectedHaPair.mappings.map((mapping, mappingIndex) => (
                          <View key={mapping.id} style={[styles.conditionCard, { borderLeftColor: success, borderLeftWidth: 3 }]}>
                            <View style={styles.conditionCardHeader}>
                              <Text style={styles.conditionCardHeaderTitle}>{`LINK #${mappingIndex + 1}`}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Switch
                                  value={mapping.enabled}
                                  onValueChange={(value) => handleUpdateHaMapping(selectedHaPair.id, mapping.id, (current) => ({ ...current, enabled: value }))}
                                  trackColor={{ false: '#2A2A2A', true: 'rgba(224, 163, 62, 0.3)' }}
                                  thumbColor={mapping.enabled ? accentHa : '#555'}
                                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                />
                                <TouchableOpacity style={styles.cardDeleteBtn} onPress={() => handleRemoveHaMapping(selectedHaPair.id, mapping.id)}>
                                  <Text style={styles.cardDeleteBtnText}>DEL</Text>
                                </TouchableOpacity>
                              </View>
                            </View>

                            <Text style={styles.modalSubLabel}>LINK NAME</Text>
                            <TextInput
                              style={styles.modalInput}
                              value={mapping.name}
                              onChangeText={(value) => handleUpdateHaMapping(selectedHaPair.id, mapping.id, (current) => ({ ...current, name: value }))}
                              placeholder={`HA Link ${mappingIndex + 1}`}
                              placeholderTextColor="#666"
                            />

                            <Text style={styles.modalLabel}>OWNER SOURCE PREAMP</Text>
                            <View style={{ flexDirection: width < 1200 ? 'column' : 'row', gap: 10 }}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.toggleRowCompact}>
                                  {selectedHaSourceFamilyOptions.map((option) => (
                                    <TouchableOpacity
                                      key={option.key}
                                      style={[styles.toggleBtnCompact, mapping.source.family === option.key && styles.toggleBtnCompactActive]}
                                      onPress={() => handleUpdateHaMapping(selectedHaPair.id, mapping.id, (current) => ({
                                        ...current,
                                        source: {
                                          family: option.key,
                                          index: clampHaSourceIndex(option.key, current.source.index, selectedHaOwnerConsoleFamily),
                                        },
                                      }))}
                                    >
                                      <Text style={styles.toggleBtnCompactText}>{option.label}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </View>
                              <View style={{ width: width < 1200 ? '100%' : 120 }}>
                                <Text style={styles.modalSubLabel}>SOURCE INDEX</Text>
                                <TextInput
                                    style={styles.modalInput}
                                    value={String(mapping.source.index)}
                                    onChangeText={(value) => handleUpdateHaMapping(selectedHaPair.id, mapping.id, (current) => ({
                                      ...current,
                                      source: {
                                        ...current.source,
                                        index: clampHaSourceIndex(current.source.family, parseInt(value, 10), selectedHaOwnerConsoleFamily),
                                      },
                                    }))}
                                  keyboardType="numeric"
                                  placeholder="1"
                                  placeholderTextColor="#666"
                                />
                              </View>
                            </View>

                            <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 10 }]}>
                              {`Source path: ${describeHaSource(mapping.source)}`}
                            </Text>

                            <View style={{ flexDirection: width < 1200 ? 'column' : 'row', gap: 12, marginTop: 14 }}>
                              {(['a', 'b'] as const).map((endpointId) => (
                                <View key={endpointId} style={[styles.conditionCard, { flex: 1, marginBottom: 0, backgroundColor: surface1 }]}>
                                  <View style={styles.conditionCardHeader}>
                                    <Text style={styles.conditionCardHeaderTitle}>{`${selectedHaPair.endpoints[endpointId].label} FOLLOWER TARGETS`}</Text>
                                    <TouchableOpacity
                                      style={styles.addButtonMini}
                                      onPress={() => handleAddHaTarget(selectedHaPair.id, mapping.id, endpointId)}
                                    >
                                      <Text style={styles.addButtonMiniText}>+ TARGET</Text>
                                    </TouchableOpacity>
                                  </View>

                                  {(mapping.targetsByEndpoint[endpointId] || []).length === 0 ? (
                                    <Text style={[styles.emptyStateText, { textAlign: 'left', fontSize: 11.5, color: textMuted }]}>
                                      No trims assigned on this console.
                                    </Text>
                                  ) : (
                                    <View style={{ gap: 8 }}>
                                      {(mapping.targetsByEndpoint[endpointId] || []).map((target, targetIndex) => (
                                        <View key={`${endpointId}-${mapping.id}-${targetIndex}`} style={styles.builderRow}>
                                          <View style={{ flexDirection: 'row', gap: 6 }}>
                                            {HA_TARGET_FAMILY_OPTIONS.map((option) => (
                                              <TouchableOpacity
                                                key={option.key}
                                                style={[styles.opSegmentBtn, target.family === option.key && styles.opSegmentBtnActive]}
                                                onPress={() => handleUpdateHaTarget(selectedHaPair.id, mapping.id, endpointId, targetIndex, { family: option.key })}
                                              >
                                                <Text style={styles.operatorButtonText}>{option.label}</Text>
                                              </TouchableOpacity>
                                            ))}
                                          </View>

                                          <TextInput
                                            style={[styles.builderInput, { flex: 1 }]}
                                            value={String(target.index)}
                                            onChangeText={(value) => handleUpdateHaTarget(
                                              selectedHaPair.id,
                                              mapping.id,
                                              endpointId,
                                              targetIndex,
                                              { index: parseInt(value, 10) },
                                            )}
                                            keyboardType="numeric"
                                            placeholder="1"
                                            placeholderTextColor="#666"
                                          />

                                          <Text style={[styles.sidebarHaCardSub, { flex: 1, marginTop: 0 }]}>
                                            {describeHaTarget(target)}
                                          </Text>

                                          <TouchableOpacity
                                            style={styles.cardDeleteBtn}
                                            onPress={() => handleRemoveHaTarget(selectedHaPair.id, mapping.id, endpointId, targetIndex)}
                                          >
                                            <Text style={styles.cardDeleteBtnText}>✕</Text>
                                          </TouchableOpacity>
                                        </View>
                                      ))}
                                    </View>
                                  )}
                                </View>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>

                    <View style={[styles.dashboardSection, styles.dashboardSectionRuntime]}>
                      <Text style={styles.dashboardSectionTitle}>4. RUNTIME, ARMING, AND DIAGNOSTICS</Text>
                      <Text style={styles.haGuideText}>
                        Runtime controls are gated by endpoint state, mapping validity, and owner/follower readiness.
                      </Text>
                      <View style={styles.triggerStateHeaderRow}>
                        <Text style={styles.modalLabel}>SETUP STATE</Text>
                        {(() => {
                          const visual = getHaStateVisual(selectedHaRuntime?.pairState);
                          return (
                            <View style={[styles.triggerStateBadge, { backgroundColor: visual.bg, borderColor: visual.border }]}>
                              <Text style={[styles.triggerStateBadgeText, { color: visual.text }]}>{visual.label}</Text>
                            </View>
                          );
                        })()}
                      </View>

                      <View style={styles.toggleRowCompact}>
                        <TouchableOpacity
                          style={[
                            styles.toggleBtnCompact,
                            { borderColor: success },
                            !selectedHaControlState.canArm && styles.toggleBtnDisabled,
                          ]}
                          disabled={!selectedHaControlState.canArm}
                          onPress={() => handleArmHaPair(selectedHaPair.id)}
                        >
                          <Text style={styles.toggleBtnCompactText}>ARM</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleBtnCompact, !selectedHaControlState.canDisarm && styles.toggleBtnDisabled]}
                          disabled={!selectedHaControlState.canDisarm}
                          onPress={() => handleDisarmHaPair(selectedHaPair.id)}
                        >
                          <Text style={styles.toggleBtnCompactText}>DISARM</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleBtnCompact, !selectedHaControlState.canResync && styles.toggleBtnDisabled]}
                          disabled={!selectedHaControlState.canResync}
                          onPress={() => handleResyncHaPair(selectedHaPair.id)}
                        >
                          <Text style={styles.toggleBtnCompactText}>RESYNC</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.toggleBtnCompact} onPress={() => handleFlipHaOwner(selectedHaPair)}>
                          <Text style={styles.toggleBtnCompactText}>FLIP OWNER</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={[styles.toggleRowCompact, { marginTop: 8 }]}>
                        <TouchableOpacity
                          style={[
                            styles.toggleBtnCompact,
                            { borderColor: accentPrimary },
                            !selectedHaControlState.canCaptureBaseline && styles.toggleBtnDisabled,
                          ]}
                          disabled={!selectedHaControlState.canCaptureBaseline}
                          onPress={() => handleCaptureHaBaseline(selectedHaPair.id)}
                        >
                          <Text style={styles.toggleBtnCompactText}>CAPTURE BASELINE</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.toggleBtnCompact}
                          onPress={() => handleClearHaEventLog(selectedHaPair.id)}
                        >
                          <Text style={styles.toggleBtnCompactText}>CLEAR LOG</Text>
                        </TouchableOpacity>
                      </View>

                      {(!selectedHaControlState.canArm && selectedHaControlState.armReason) ? (
                        <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 10, color: '#FFBE70' }]}>
                          {`ARM blocked: ${selectedHaControlState.armReason}`}
                        </Text>
                      ) : null}
                      {(selectedHaControlState.canArm && !selectedHaControlState.canResync && selectedHaControlState.resyncReason) ? (
                        <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 6, color: '#FFBE70' }]}>
                          {`RESYNC blocked: ${selectedHaControlState.resyncReason}`}
                        </Text>
                      ) : null}
                      {(!selectedHaControlState.canCaptureBaseline && selectedHaControlState.captureReason && selectedHaRuntime?.armed !== true) ? (
                        <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 6, color: textMuted }]}>
                          {selectedHaControlState.captureReason}
                        </Text>
                      ) : null}

                      <Text style={[styles.sidebarAutomationCardSummary, { marginTop: 12 }]}>
                        {`Owner: ${describeHaOwner(selectedHaPair)} | Follower: ${selectedHaPair.endpoints[getHaFollowerEndpointId(selectedHaPair.haOwner)].label} | Armed: ${selectedHaRuntime?.armed ? 'YES' : 'NO'}`}
                      </Text>
                      <Text style={styles.sidebarAutomationCardSummary}>
                        {`${getHaConnectivitySummary(selectedHaPair, selectedHaRuntime)} | A: ${selectedHaRuntime?.endpoints?.a?.consoleDisplayName || selectedHaRuntime?.endpoints?.a?.consoleModel || 'unknown'} | B: ${selectedHaRuntime?.endpoints?.b?.consoleDisplayName || selectedHaRuntime?.endpoints?.b?.consoleModel || 'unknown'}`}
                      </Text>

                      {selectedHaRuntime?.lastError ? (
                        <View style={styles.warningChip}>
                          <Text style={styles.warningChipText}>{selectedHaRuntime.lastError}</Text>
                        </View>
                      ) : null}

                      {summarizeHaSaturation(selectedHaRuntime).length > 0 && (
                        <View style={styles.preflightCard}>
                          <Text style={styles.preflightTitle}>TRIM SATURATION</Text>
                          {summarizeHaSaturation(selectedHaRuntime).map((item, idx) => (
                            <Text key={`ha-sat-${idx}`} style={styles.preflightWarningText}>
                              {`SAT +${item.overshoot.toFixed(1)} dB over trim range on ${item.targetKey.toUpperCase()}`}
                            </Text>
                          ))}
                        </View>
                      )}

                      {selectedHaMappingViews.length > 0 && (
                        <View style={[styles.preflightCard, { marginTop: 14 }]}>
                          <Text style={styles.preflightTitle}>LIVE COMPENSATION TABLE</Text>
                          <View style={{ gap: 12 }}>
                            {selectedHaMappingViews.map((mappingView: any, mappingIndex: number) => (
                              <View
                                key={`ha-runtime-${mappingView.id}`}
                                style={[
                                  styles.conditionCard,
                                  {
                                    marginBottom: 0,
                                    backgroundColor: surface1,
                                    borderLeftColor: mappingView.hasCollision ? danger : (mappingView.enabled ? success : '#636366'),
                                    borderLeftWidth: 3,
                                  },
                                ]}
                              >
                                <View style={styles.conditionCardHeader}>
                                  <Text style={styles.conditionCardHeaderTitle}>{`RUNTIME LINK #${mappingIndex + 1}`}</Text>
                                  <View style={[styles.triggerStateBadge, mappingView.enabled ? styles.triggerStateBadgeMatched : styles.triggerStateBadgeIdle]}>
                                    <Text style={styles.triggerStateBadgeText}>{mappingView.enabled ? 'ENABLED' : 'DISABLED'}</Text>
                                  </View>
                                </View>

                                <Text style={[styles.sidebarAutomationCardTitle, { marginBottom: 4 }]}>{mappingView.name}</Text>
                                <Text style={styles.sidebarAutomationCardSummary}>
                                  {`Source: ${describeHaSource(mappingView.source)} | Owner: ${mappingView.ownerEndpointLabel} | Follower: ${mappingView.followerEndpointLabel}`}
                                </Text>
                                <Text style={styles.sidebarAutomationCardSummary}>
                                  {`Owner baseline: ${formatHaDb(mappingView.ownerGainBaseline)} | Owner current: ${formatHaDb(mappingView.currentOwnerGain)} | Delta: ${formatHaDb(mappingView.delta)}`}
                                </Text>

                                {(mappingView.targetRows || []).length === 0 ? (
                                  <Text style={[styles.emptyStateText, { textAlign: 'left', color: textMuted, fontSize: 11.5, marginTop: 8 }]}>
                                    No targets on the current follower side.
                                  </Text>
                                ) : (
                                  <View style={{ gap: 8, marginTop: 10 }}>
                                    {(mappingView.targetRows || []).map((targetRow: any) => (
                                      <View
                                        key={`ha-runtime-target-${mappingView.id}-${targetRow.targetKey}`}
                                        style={{
                                          borderRadius: 10,
                                          borderWidth: 1,
                                          borderColor: targetRow.collision ? danger : '#2A2A3A',
                                          backgroundColor: targetRow.collision ? 'rgba(255, 59, 48, 0.08)' : '#0F0F17',
                                          padding: 10,
                                          gap: 4,
                                        }}
                                      >
                                        <Text style={[styles.sidebarAutomationCardTitle, { fontSize: 12 }]}>
                                          {`${targetRow.targetLabel}${targetRow.collision ? '  •  COLLISION' : ''}${targetRow.saturated ? '  •  SAT' : ''}`}
                                        </Text>
                                        <Text style={styles.sidebarAutomationCardSummary}>
                                          {`Baseline trim: ${formatHaDb(targetRow.baselineTrim)} | Current trim: ${formatHaDb(targetRow.currentTrim)} | Desired trim: ${formatHaDb(targetRow.desiredTrim)}`}
                                        </Text>
                                        <Text style={styles.sidebarAutomationCardSummary}>
                                          {`Headroom owner +: ${formatHaDb(targetRow.headroomUp)} | Headroom owner -: ${formatHaDb(targetRow.headroomDown)} | Overshoot: ${formatHaDb(targetRow.overshoot)}`}
                                        </Text>
                                        {targetRow.lastCommandedTrim !== null && (
                                          <Text style={styles.sidebarHaCardSub}>
                                            {`Last write: ${formatHaDb(targetRow.lastCommandedTrim)} at ${formatElapsedRuntime(targetRow.lastCommandedAt)}`}
                                          </Text>
                                        )}
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      <View style={[styles.preflightCard, { marginTop: 14 }]}>
                        <View style={styles.conditionCardHeader}>
                          <Text style={styles.preflightTitle}>EVENT LOG</Text>
                          <Text style={styles.sidebarSectionMetaText}>{`${selectedHaEventLog.length} item(s)`}</Text>
                        </View>
                        {selectedHaEventLog.length === 0 ? (
                          <Text style={[styles.emptyStateText, { textAlign: 'left', color: textMuted, fontSize: 11.5 }]}>
                            No HA runtime events yet. Arm the setup, move headamp gain, or capture a new baseline to populate this log.
                          </Text>
                        ) : (
                          <View style={{ gap: 8 }}>
                            {selectedHaEventLog.slice(0, 10).map((entry: any) => {
                              const visual = getHaEventVisual(entry?.level);
                              return (
                                <View
                                  key={entry?.id || `${entry?.at}-${entry?.message}`}
                                  style={[styles.eventLogRow, { borderColor: visual.border, backgroundColor: visual.bg }]}
                                >
                                  <View style={styles.conditionCardHeader}>
                                    <Text style={[styles.sidebarAutomationCardTitle, { fontSize: 11.5, color: visual.tone }]}>
                                      {visual.label}
                                    </Text>
                                    <Text style={styles.sidebarHaCardSub}>{formatElapsedRuntime(entry?.at)}</Text>
                                  </View>
                                  <Text style={[styles.sidebarAutomationCardSummary, { color: textPrimary }]}>
                                    {String(entry?.message || '').trim() || 'Unnamed HA event'}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          ) : meterWorkspaceOpen ? (
            <View style={{ flex: 1 }}>
              <View style={[styles.workspaceHeader, !uiIsCompact && styles.workspaceHeaderComfortable]}>
                <View style={styles.workspaceHeaderPrimary}>
                  <Text style={styles.workspaceHeaderTitle}>Meters</Text>
                  <Text
                    style={[
                      styles.workspaceHeaderBadge,
                      {
                        backgroundColor: consoleFamilyDetected ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 149, 0, 0.15)',
                        color: consoleFamilyDetected ? success : '#FF9500',
                      },
                    ]}
                  >
                    {consoleFamilyDetected ? 'Live signals' : 'Offline map'}
                  </Text>
                </View>

                <View style={[styles.workspaceHeaderActions, uiIsCompact && styles.workspaceHeaderActionsCompact]}>
                  <TouchableOpacity style={styles.workspaceCloseBtn} onPress={openOverviewWorkspace}>
                    <ArrowLeft size={14} color={textSecondary} />
                    <Text style={styles.workspaceCloseBtnText}>Overview</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={styles.workspaceScroll}
                contentContainerStyle={[styles.workspaceScrollContent, !uiIsCompact && styles.workspaceScrollContentComfortable]}
                showsVerticalScrollIndicator={false}
              >
                <View
                  style={[
                    styles.macroReadinessPanel,
                    styles.metersOverviewPanel,
                    { borderTopColor: meterHealth.color },
                  ]}
                >
                  <View style={styles.macroReadinessHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.macroReadinessTitle}>Meter map</Text>
                      <Text style={styles.macroReadinessSubtitle}>
                        {selectedMeterGroup
                          ? `${selectedMeterGroup.label}: ${selectedMeterGroup.addresses.length} live address${selectedMeterGroup.addresses.length === 1 ? '' : 'es'}`
                          : `${globalMeterOverviewAddressCount} sampled live address${globalMeterOverviewAddressCount === 1 ? '' : 'es'} across ${totalMeterAddressCount} mapped meters`}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.macroReadinessStatusBadge,
                        {
                          borderColor: meterHealth.color,
                          backgroundColor: runtimeStatus?.consoleCapabilities?.nativeMetersV3
                            ? 'rgba(52, 199, 89, 0.12)'
                            : 'rgba(255, 149, 0, 0.12)',
                        },
                      ]}
                    >
                      <Text style={[styles.macroReadinessStatusText, { color: meterHealth.color }]}>
                        {meterHealth.label}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.meterToolbarRow}>
                    <TouchableOpacity
                      style={styles.meterGroupDropdownBtn}
                      onPress={() => setMeterGroupModalVisible(true)}
                    >
                      <Text style={styles.meterGroupDropdownLabel}>VIEW</Text>
                      <Text style={styles.meterGroupDropdownValue} numberOfLines={1}>
                        {selectedMeterGroup ? selectedMeterGroup.label : 'SAFE OVERVIEW SAMPLE'}
                      </Text>
                      <Text style={styles.dropdownSelectorChevron}>▼</Text>
                    </TouchableOpacity>
                    <View style={styles.meterHealthMiniCard}>
                      <Text style={styles.meterHealthMiniLabel}>WATCHED</Text>
                      <Text style={styles.meterHealthMiniValue}>{runtimeStatus?.watchedMeterAddressCount ?? selectedMeterAddresses.length}</Text>
                    </View>
                    <View style={styles.meterHealthMiniCard}>
                      <Text style={styles.meterHealthMiniLabel}>LAST RX</Text>
                      <Text style={styles.meterHealthMiniValue}>{formatElapsedRuntime(runtimeStatus?.lastMeterRxAt)}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.meterActionBtn}
                      onPress={() => openCustomMeterNameModal()}
                    >
                      <Plus size={14} color={accentPrimary} />
                      <Text style={styles.meterActionBtnText}>New group</Text>
                    </TouchableOpacity>
                    {activeCustomMeterGroup ? (
                      <TouchableOpacity
                        style={styles.meterActionBtn}
                        onPress={() => setSelectedMeterGroupKey(`custom:${activeCustomMeterGroup.id}`)}
                      >
                        <Text style={styles.meterActionBtnLabel}>CUSTOM GROUP</Text>
                        <Text style={styles.meterActionBtnText} numberOfLines={1}>{activeCustomMeterGroup.name}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <View style={styles.dashboardSection}>
                  <Text style={styles.dashboardSectionTitle}>
                    {selectedMeterGroup ? `${selectedMeterGroup.label} meters` : 'Global sources and targets'}
                  </Text>

                  {nativeMetersUnavailableForDetectedConsole ? (
                    <View style={styles.preflightCard}>
                      <Text style={styles.preflightWarningText}>
                        Native WING meters are not available for the detected console family.
                      </Text>
                    </View>
                  ) : null}

                  {selectedMeterGroup ? (
                    <View style={styles.meterDetailCard}>
                      <View style={styles.inlineMeterHeader}>
                        <Text style={styles.vuMeterLabel}>{selectedMeterGroup.section}</Text>
                        <Text style={styles.inlineMeterMeta}>{`${selectedMeterGroup.addresses.length} meter${selectedMeterGroup.addresses.length === 1 ? '' : 's'}`}</Text>
                      </View>
                      <View style={styles.meterDetailActionsRow}>
                        <TouchableOpacity
                          style={[styles.meterActionBtn, meterSelectionMode && styles.meterSelectionModeBtn]}
                          onPress={() => {
                            if (meterSelectionMode) {
                              closeMeterSelectionMode();
                            } else {
                              setMeterSelectionMode(true);
                              clearMeterSelection();
                            }
                          }}
                        >
                          <Text style={styles.meterActionBtnText}>{meterSelectionMode ? 'CANCEL SELECT' : 'SELECT'}</Text>
                        </TouchableOpacity>
                        {meterSelectionMode ? (
                          <>
                            <View style={styles.meterSelectionSummary}>
                              <Text style={styles.meterSelectionSummaryValue}>{meterSelectedDraftCount}</Text>
                              <Text style={styles.meterSelectionSummaryLabel} numberOfLines={1}>
                                {`SELECTED FROM ${meterSelectionContextLabel}`}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[styles.meterActionBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                              disabled={meterSelectedDraftCount === 0}
                              onPress={clearMeterSelection}
                            >
                              <Text style={styles.meterActionBtnText}>CLEAR</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.meterActionBtn}
                              onPress={setAllMeterSelection}
                            >
                              <Text style={styles.meterActionBtnText}>ALL</Text>
                            </TouchableOpacity>
                            {meterSelectionRangePresets.length > 1 ? (
                              <View style={styles.meterRangePresetRow}>
                                {meterSelectionRangePresets.map((preset) => (
                                  <TouchableOpacity
                                    key={preset.label}
                                    style={styles.meterRangePresetBtn}
                                    onPress={() => selectMeterRangePreset(preset.addresses)}
                                  >
                                    <Text style={styles.meterRangePresetBtnText}>{preset.label}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            ) : null}
                            {selectedMeterGroup.custom ? (
                              <>
                                <TouchableOpacity
                                  style={[styles.meterActionBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                                  disabled={meterSelectedDraftCount === 0}
                                  onPress={() => moveSelectedCustomMeterGroupAddresses(selectedMeterGroup.customGroupId, meterSelectedDraftAddresses, 'up')}
                                >
                                  <Text style={styles.meterActionBtnText}>MOVE UP</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.meterActionBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                                  disabled={meterSelectedDraftCount === 0}
                                  onPress={() => moveSelectedCustomMeterGroupAddresses(selectedMeterGroup.customGroupId, meterSelectedDraftAddresses, 'down')}
                                >
                                  <Text style={styles.meterActionBtnText}>MOVE DOWN</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.meterActionBtn, styles.meterDangerBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                                  disabled={meterSelectedDraftCount === 0}
                                  onPress={() => {
                                    removeAddressesFromCustomMeterGroup(selectedMeterGroup.customGroupId, meterSelectedDraftAddresses);
                                    closeMeterSelectionMode();
                                  }}
                                >
                                  <Text style={[styles.meterActionBtnText, { color: danger }]}>REMOVE SELECTED</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <>
                                {activeCustomMeterGroup ? (
                                  <TouchableOpacity
                                    style={[styles.meterActionBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                                    disabled={meterSelectedDraftCount === 0}
                                    onPress={() => {
                                      addAddressesToCustomMeterGroup(activeCustomMeterGroup.id, meterSelectedDraftAddresses);
                                      closeMeterSelectionMode();
                                    }}
                                  >
                                    <Text style={styles.meterActionBtnLabel}>ADD SELECTED TO</Text>
                                    <Text style={styles.meterActionBtnText} numberOfLines={1}>{activeCustomMeterGroup.name}</Text>
                                  </TouchableOpacity>
                                ) : null}
                                <TouchableOpacity
                                  style={[styles.meterActionBtn, meterSelectedDraftCount === 0 && styles.modeBtnDisabled]}
                                  disabled={meterSelectedDraftCount === 0}
                                  onPress={() => openCustomMeterNameModal(meterSelectedDraftAddresses)}
                                >
                                  <Text style={styles.meterActionBtnText}>NEW GROUP</Text>
                                </TouchableOpacity>
                              </>
                            )}
                          </>
                        ) : selectedMeterGroup.custom ? (
                          <>
                            <TouchableOpacity
                              style={styles.meterActionBtn}
                              onPress={() => openCustomMeterNameModal([], selectedMeterGroup.customGroupId)}
                            >
                              <Text style={styles.meterActionBtnText}>RENAME</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.meterActionBtn}
                              onPress={() => duplicateCustomMeterGroup(selectedMeterGroup.customGroupId)}
                            >
                              <Text style={styles.meterActionBtnText}>DUPLICATE</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.meterActionBtn, styles.meterDangerBtn]}
                              onPress={() => deleteCustomMeterGroup(selectedMeterGroup.customGroupId)}
                            >
                              <Text style={[styles.meterActionBtnText, { color: danger }]}>DELETE GROUP</Text>
                            </TouchableOpacity>
                          </>
                        ) : activeCustomMeterGroup ? (
                          <TouchableOpacity
                            style={styles.meterActionBtn}
                            onPress={() => addAddressesToCustomMeterGroup(activeCustomMeterGroup.id, selectedMeterGroup.addresses)}
                          >
                            <Text style={styles.meterActionBtnLabel}>ADD ALL TO</Text>
                            <Text style={styles.meterActionBtnText} numberOfLines={1}>{activeCustomMeterGroup.name}</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={styles.meterActionBtn}
                            onPress={() => openCustomMeterNameModal(selectedMeterGroup.addresses)}
                          >
                            <Text style={styles.meterActionBtnText}>CREATE FROM VIEW</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <MeterRows
                        entries={meterWorkspaceEntries}
                        maxRows={selectedMeterGroup.addresses.length}
                        emptyText="This group does not expose meter addresses."
                        waitingText="Waiting for meter packets for this group..."
                        getActionLabel={(entry) => {
                          if (selectedMeterGroup.custom) return 'REMOVE';
                          if (!activeCustomMeterGroup) return 'ADD';
                          return activeCustomMeterGroup.addresses.includes(entry.address) ? 'ADDED' : 'ADD';
                        }}
                        onActionPress={(entry) => {
                          if (selectedMeterGroup.custom) {
                            removeAddressFromCustomMeterGroup(selectedMeterGroup.customGroupId, entry.address);
                            return;
                          }
                          if (activeCustomMeterGroup && !activeCustomMeterGroup.addresses.includes(entry.address)) {
                            addAddressesToCustomMeterGroup(activeCustomMeterGroup.id, [entry.address]);
                            return;
                          }
                          if (!activeCustomMeterGroup) {
                            openCustomMeterNameModal([entry.address]);
                          }
                        }}
                        selectionMode={meterSelectionMode}
                        selectedAddresses={meterSelectedDraftAddresses}
                        onSelectionRangeChange={applyMeterSelectionRange}
                      />
                    </View>
                  ) : (
                    <View style={styles.meterGroupGrid}>
                      {allMeterGroups.map((group) => {
                        const values = group.addresses
                          .map((address) => meterWorkspaceMap[address])
                          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
                        const peak = values.length > 0 ? Math.max(...values) : null;
                        const peakFill = peak === null ? 0 : meterDbToFillPercent(clampNumber(peak, METER_DB_MIN, METER_DB_MAX));
                        return (
                          <TouchableOpacity
                            key={group.key}
                            style={[styles.meterGroupCard, { borderLeftColor: group.color }]}
                            onPress={() => setSelectedMeterGroupKey(group.key)}
                            activeOpacity={0.85}
                          >
                            <View style={styles.meterGroupCardHeader}>
                              <View style={[styles.colorBadge, { backgroundColor: group.color }]} />
                              <Text style={styles.meterGroupCardTitle} numberOfLines={1}>{group.label}</Text>
                            </View>
                            <Text style={styles.meterGroupCardMeta}>{`${group.addresses.length} meter${group.addresses.length === 1 ? '' : 's'} | ${values.length} live`}</Text>
                            <View style={styles.vuMeterTrack}>
                              <View
                                style={[
                                  styles.vuMeterFill,
                                  {
                                    width: `${Math.min(Math.max(peakFill, 0), 100)}%`,
                                    backgroundColor: getMeterFillColor(peak),
                                  },
                                ]}
                              />
                            </View>
                            <Text style={styles.meterGroupCardValue}>{formatDbValue(peak)}</Text>
                          </TouchableOpacity>
                        );
                        })}
                    </View>
                  )}
                </View>

                <Modal visible={meterGroupModalVisible} animationType="fade" transparent={true} onRequestClose={() => setMeterGroupModalVisible(false)}>
                  <View style={styles.modalBg}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMeterGroupModalVisible(false)} />
                    <View style={styles.categorySelectorModalContent}>
                      <View style={styles.categorySelectorModalHeader}>
                        <Text style={styles.categorySelectorModalTitle}>METER VIEW</Text>
                        <TouchableOpacity onPress={() => setMeterGroupModalVisible(false)} style={styles.categorySelectorModalCloseBtn}>
                          <Text style={styles.categorySelectorModalCloseBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      <ScrollView contentContainerStyle={styles.categorySelectorScrollContainer}>
                        <TouchableOpacity
                          style={[
                            styles.categoryGridCardBtn,
                            selectedMeterGroupKey === 'all' && { borderColor: success, backgroundColor: 'rgba(52, 199, 89, 0.08)' },
                          ]}
                          onPress={() => {
                            setSelectedMeterGroupKey('all');
                            setMeterGroupModalVisible(false);
                          }}
                        >
                          <Text style={[styles.categoryGridCardBtnText, selectedMeterGroupKey === 'all' && { color: success, fontWeight: '800' }]}>
                            SAFE OVERVIEW SAMPLE
                          </Text>
                          <Text style={styles.categoryGridCardBtnCount}>{globalMeterOverviewAddressCount}/{totalMeterAddressCount} MTR</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.categoryGridCardBtn, { borderColor: success }]}
                          onPress={() => {
                            setMeterGroupModalVisible(false);
                            openCustomMeterNameModal();
                          }}
                        >
                          <Text style={[styles.categoryGridCardBtnText, { color: success, fontWeight: '800' }]}>
                            NEW GROUP
                          </Text>
                          <Text style={styles.categoryGridCardBtnCount}>{customMeterGroups.length}/{MAX_CUSTOM_METER_GROUPS}</Text>
                        </TouchableOpacity>

                        {customMeterGroups.length > 0 ? (
                          <View style={styles.categoryGroupCard}>
                            <Text style={[styles.categoryGroupTitle, { color: success }]}>CUSTOM METER GROUPS</Text>
                            <View style={styles.categoryGroupGrid}>
                              {customMeterGroups.map((group) => {
                                const groupKey = `custom:${group.id}`;
                                const isSelected = selectedMeterGroupKey === groupKey;
                                return (
                                  <TouchableOpacity
                                    key={group.id}
                                    style={[
                                      styles.categoryGridCardBtn,
                                      isSelected && { borderColor: success, backgroundColor: 'rgba(52, 199, 89, 0.08)' },
                                    ]}
                                    onPress={() => {
                                      setSelectedMeterGroupKey(groupKey);
                                      setSelectedCustomMeterGroupId(group.id);
                                      setMeterGroupModalVisible(false);
                                    }}
                                  >
                                    <Text style={[styles.categoryGridCardBtnText, isSelected && { color: success, fontWeight: '800' }]}>
                                      {group.name}
                                    </Text>
                                    <Text style={styles.categoryGridCardBtnCount}>{group.addresses.length} MTR</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}

                        {getAvailableCategoryGroups(runtimeStatus?.consoleFamily).map((section) => {
                          const sectionGroups = meterGroups.filter((group) => group.section === section.title);
                          if (sectionGroups.length === 0) return null;
                          return (
                            <View key={section.title} style={styles.categoryGroupCard}>
                              <Text style={[styles.categoryGroupTitle, { color: section.color }]}>{section.title}</Text>
                              <View style={styles.categoryGroupGrid}>
                                {sectionGroups.map((group) => {
                                  const isSelected = selectedMeterGroupKey === group.key;
                                  return (
                                    <TouchableOpacity
                                      key={group.key}
                                      style={[
                                        styles.categoryGridCardBtn,
                                        isSelected && { borderColor: group.color, backgroundColor: 'rgba(255, 255, 255, 0.04)' },
                                      ]}
                                      onPress={() => {
                                        setSelectedMeterGroupKey(group.key);
                                        setMeterGroupModalVisible(false);
                                      }}
                                    >
                                      <Text style={[styles.categoryGridCardBtnText, isSelected && { color: group.color, fontWeight: '800' }]}>
                                        {group.label}
                                      </Text>
                                      <Text style={styles.categoryGridCardBtnCount}>{group.addresses.length} MTR</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          );
                        })}
                      </ScrollView>
                    </View>
                  </View>
                </Modal>

                <Modal visible={customMeterNameModalVisible} animationType="fade" transparent={true} onRequestClose={() => setCustomMeterNameModalVisible(false)}>
                  <View style={styles.modalBg}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCustomMeterNameModalVisible(false)} />
                    <View style={styles.categorySelectorModalContent}>
                      <View style={styles.categorySelectorModalHeader}>
                        <Text style={styles.categorySelectorModalTitle}>
                          {customMeterNameEditingId ? 'RENAME METER GROUP' : 'NEW METER GROUP'}
                        </Text>
                        <TouchableOpacity onPress={() => setCustomMeterNameModalVisible(false)} style={styles.categorySelectorModalCloseBtn}>
                          <Text style={styles.categorySelectorModalCloseBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.modalLabel}>GROUP NAME</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={customMeterNameDraft}
                        onChangeText={setCustomMeterNameDraft}
                        maxLength={MAX_CUSTOM_METER_GROUP_NAME_LENGTH}
                        autoCapitalize="words"
                        selectTextOnFocus={true}
                      />
                      <View style={styles.meterNameModalMetaRow}>
                        <Text style={styles.categoryGridCardBtnCount}>
                          {customMeterNameEditingId ? 'RENAME' : `${customMeterNameSeedAddresses.length} MTR`}
                        </Text>
                        <Text style={styles.categoryGridCardBtnCount}>
                          {customMeterGroups.length}/{MAX_CUSTOM_METER_GROUPS}
                        </Text>
                      </View>
                      <View style={styles.modalFooterRow}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => setCustomMeterNameModalVisible(false)}>
                          <Text style={styles.cancelBtnText}>CANCEL</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.saveBtn} onPress={saveCustomMeterNameModal}>
                          <Text style={styles.saveBtnText}>{customMeterNameEditingId ? 'SAVE' : 'CREATE'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              </ScrollView>
            </View>
          ) : selectedAutomizationId ? (
            <View style={{ flex: 1 }}>
              <View style={[styles.workspaceHeader, !uiIsCompact && styles.workspaceHeaderComfortable]}>
                <View style={styles.workspaceHeaderPrimary}>
                  <Text style={styles.workspaceHeaderTitle}>
                    {selectedAutomization?.name || 'Automation'}
                  </Text>
                  <Text style={[styles.workspaceHeaderBadge, { backgroundColor: 'rgba(85, 214, 190, 0.14)', color: accentAutomation }]}>
                    Automation
                  </Text>
                </View>

                <View style={[styles.workspaceHeaderActions, uiIsCompact && styles.workspaceHeaderActionsCompact]}>
                  <TouchableOpacity style={styles.workspaceCloseBtn} onPress={openOverviewWorkspace}>
                    <ArrowLeft size={14} color={textSecondary} />
                    <Text style={styles.workspaceCloseBtnText}>Overview</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={styles.workspaceScroll}
                contentContainerStyle={[styles.workspaceScrollContent, !uiIsCompact && styles.workspaceScrollContentComfortable]}
                showsVerticalScrollIndicator={false}
              >
                {selectedAutomization && (
                  <View style={[styles.macroReadinessPanel, styles.macroReadinessPanelAutomization]}>
                    <View style={styles.macroReadinessHeader}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.macroReadinessTitle}>Automation summary</Text>
                      </View>
                      <View
                        style={[
                          styles.macroReadinessStatusBadge,
                          {
                            borderColor: selectedAutomizationPreflight.errors.length > 0 ? danger : selectedAutomizationPreflight.warnings.length > 0 ? '#FF9500' : success,
                            backgroundColor: selectedAutomizationPreflight.errors.length > 0
                              ? 'rgba(255, 59, 48, 0.12)'
                              : selectedAutomizationPreflight.warnings.length > 0
                                ? 'rgba(255, 149, 0, 0.12)'
                                : 'rgba(52, 199, 89, 0.12)',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.macroReadinessStatusText,
                            { color: selectedAutomizationPreflight.errors.length > 0 ? '#FF9F9A' : selectedAutomizationPreflight.warnings.length > 0 ? '#FFD28A' : '#B8F7C9' },
                          ]}
                        >
                          {selectedAutomizationPreflight.errors.length > 0 ? 'BLOCKED' : selectedAutomizationPreflight.warnings.length > 0 ? 'CHECK' : 'READY'}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.macroReadinessGrid, width < 1320 && { flexDirection: 'column' }]}>
                      {automizationReadinessCards.map((card) => (
                        <View key={card.key} style={[styles.macroReadinessCard, { borderColor: `${card.tone}44` }]}>
                          <Text style={styles.macroReadinessLabel}>{card.label}</Text>
                          <Text style={[styles.macroReadinessValue, { color: card.tone }]} numberOfLines={1}>
                            {card.value}
                          </Text>
                          <Text style={styles.macroReadinessDetail} numberOfLines={2}>
                            {card.detail}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <View style={styles.dashboardSection}>
                  <Text style={styles.dashboardSectionTitle}>1. ENGINE AND MAP MODE</Text>
                  {!selectedAutomization ? (
                    <Text style={[styles.emptyStateText, { textAlign: 'left', color: textSecondary, fontSize: 12.5, lineHeight: 18 }]}>
                      No automation selected.
                    </Text>
                  ) : (
                    <View style={{ gap: 12 }}>
                      <Text style={styles.modalLabel}>AUTOMATION NAME</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={selectedAutomization.name}
                        onChangeText={(value) => handleUpdateAutomization(selectedAutomization.id, { name: value })}
                        placeholder="Automation name"
                        placeholderTextColor="#666"
                      />

                      <View style={styles.rowJustified}>
                        <Text style={styles.modalLabel}>ENGINE STATUS</Text>
                        <Switch
                          value={selectedAutomization.enabled}
                          onValueChange={(val) => handleToggleAutomization(selectedAutomization.id, val)}
                          trackColor={{ false: '#2A2A2A', true: 'rgba(255, 149, 0, 0.3)' }}
                          thumbColor={selectedAutomization.enabled ? '#FF9500' : '#555'}
                        />
                      </View>

                      <Text style={styles.modalLabel}>MAP MODE</Text>
                      <View style={styles.toggleRowCompact}>
                        <TouchableOpacity
                          style={[styles.toggleBtnCompact, selectedAutomization.mode === 'inverse' && styles.toggleBtnCompactActive]}
                          onPress={() => handleUpdateAutomization(selectedAutomization.id, { mode: 'inverse' })}
                        >
                          <Text style={styles.toggleBtnCompactText}>{'INVERSE (source up => target down)'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleBtnCompact, selectedAutomization.mode === 'direct' && styles.toggleBtnCompactActive]}
                          onPress={() => handleUpdateAutomization(selectedAutomization.id, { mode: 'direct' })}
                        >
                          <Text style={styles.toggleBtnCompactText}>{'DIRECT (source up => target up)'}</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalSubLabel}>RESPONSE TIME (ms)</Text>
                          <TextInput
                            style={styles.modalInput}
                            value={String(selectedAutomization.responseMs)}
                            onChangeText={(value) => handleUpdateAutomization(selectedAutomization.id, { responseMs: Number(value) })}
                            keyboardType="numeric"
                            placeholder="50"
                            placeholderTextColor="#666"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalSubLabel}>DEADBAND</Text>
                          <TextInput
                            style={styles.modalInput}
                            value={selectedAutomization.deadband}
                            onChangeText={(value) => handleUpdateAutomization(selectedAutomization.id, { deadband: value })}
                            keyboardType="numeric"
                            placeholder="0.1"
                            placeholderTextColor="#666"
                          />
                        </View>
                      </View>

                      <Text style={{ color: textMuted, fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                        {`LIVE: ${formatParameterValue(selectedAutomization.sourceTarget, automizationLiveValueMap[selectedAutomization.id])} | dispatches ${automizationDispatchCountMap[selectedAutomization.id] || 0} | targets ${selectedAutomization.targetItems.length}`}
                      </Text>

                      {(selectedAutomizationPreflight.errors.length > 0 || selectedAutomizationPreflight.warnings.length > 0) && (
                        <View style={styles.preflightCard}>
                          <Text style={styles.preflightTitle}>AUTOMATION PREFLIGHT</Text>
                          {selectedAutomizationPreflight.errors.map((err, idx) => (
                            <Text key={`auto-err-${idx}`} style={styles.preflightErrorText}>ERROR: {err}</Text>
                          ))}
                          {selectedAutomizationPreflight.warnings.map((warn, idx) => (
                            <Text key={`auto-warn-${idx}`} style={styles.preflightWarningText}>WARNING: {warn}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={styles.dashboardSection}>
                  <Text style={styles.dashboardSectionTitle}>2. SOURCE RANGE</Text>
                  {!selectedAutomization ? (
                    <Text style={[styles.emptyStateText, { textAlign: 'left', color: textSecondary, fontSize: 12.5, lineHeight: 18 }]}>
                      Select an automation to configure source mapping.
                    </Text>
                  ) : (
                    <View style={{ gap: 12 }}>
                      <Text style={styles.automizationGuideText}>
                        Source changes are normalized between MIN and MAX, then mapped into each target range.
                      </Text>
                      <TargetEditor
                        target={selectedAutomization.sourceTarget}
                        onChange={(nextTarget) => handleUpdateAutomizationSourceTarget(selectedAutomization.id, nextTarget)}
                        label="SOURCE PARAMETER"
                        uiFontFamily={appFontFamily}
                        uiTextScale={uiScale}
                        consoleModel={runtimeStatus?.consoleModel}
                        consoleFamily={runtimeStatus?.consoleFamily}
                        meterUiUpdateIntervalMs={meterUiUpdateIntervalMs}
                      />

                      <Text style={styles.modalLabel}>SOURCE RANGE</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1, backgroundColor: surface1, borderRadius: 10, borderWidth: 1, borderColor: border1, padding: 8 }}>
                          <Text style={styles.modalSubLabel}>MIN SOURCE</Text>
                          <SmartValueEditor
                            target={selectedAutomization.sourceTarget}
                            value={selectedAutomization.sourceMin}
                            onChange={(value) => handleUpdateAutomization(selectedAutomization.id, { sourceMin: value })}
                          />
                        </View>
                        <View style={{ flex: 1, backgroundColor: surface1, borderRadius: 10, borderWidth: 1, borderColor: border1, padding: 8 }}>
                          <Text style={styles.modalSubLabel}>MAX SOURCE</Text>
                          <SmartValueEditor
                            target={selectedAutomization.sourceTarget}
                            value={selectedAutomization.sourceMax}
                            onChange={(value) => handleUpdateAutomization(selectedAutomization.id, { sourceMax: value })}
                          />
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                <View style={styles.dashboardSection}>
                  <View style={styles.rowJustified}>
                    <Text style={styles.dashboardSectionTitle}>3. TARGET RANGES</Text>
                    {selectedAutomization && (
                      <TouchableOpacity
                        style={styles.addButtonMini}
                        onPress={() => handleAddAutomizationTarget(selectedAutomization.id)}
                      >
                        <Text style={styles.addButtonMiniText}>+ ADD TARGET</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!selectedAutomization ? (
                    <Text style={[styles.emptyStateText, { textAlign: 'left', color: textSecondary, fontSize: 12.5, lineHeight: 18 }]}>
                      Select an automation to configure targets.
                    </Text>
                  ) : (
                    <View style={{ gap: 12 }}>
                      {selectedAutomization.targetItems.map((targetItem, targetIndex) => (
                        <View key={targetItem.id} style={[styles.conditionCard, { borderLeftColor: '#FF9500', borderLeftWidth: 3 }]}>
                          <View style={styles.conditionCardHeader}>
                            <Text style={styles.conditionCardHeaderTitle}>
                              {`TARGET #${targetIndex + 1}: ${describeTarget(targetItem.target)}`}
                            </Text>
                            <TouchableOpacity
                              style={styles.cardDeleteBtn}
                              onPress={() => handleRemoveAutomizationTarget(selectedAutomization.id, targetItem.id)}
                            >
                              <Text style={styles.cardDeleteBtnText}>DEL</Text>
                            </TouchableOpacity>
                          </View>

                          <TargetEditor
                            target={targetItem.target}
                            onChange={(nextTarget) => handleUpdateAutomizationTarget(selectedAutomization.id, targetItem.id, { target: nextTarget })}
                            label="TARGET OBJECT"
                            uiFontFamily={appFontFamily}
                            uiTextScale={uiScale}
                            consoleModel={runtimeStatus?.consoleModel}
                            consoleFamily={runtimeStatus?.consoleFamily}
                            meterUiUpdateIntervalMs={meterUiUpdateIntervalMs}
                          />

                          <Text style={styles.modalLabel}>TARGET RANGE</Text>
                          <Text style={styles.automizationGuideText}>
                            This target receives the mapped source ratio inside its own MIN/MAX range.
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 10 }}>
                            <View style={{ flex: 1, backgroundColor: surface1, borderRadius: 10, borderWidth: 1, borderColor: border1, padding: 8 }}>
                              <Text style={styles.modalSubLabel}>MIN TARGET</Text>
                              <SmartValueEditor
                                target={targetItem.target}
                                value={targetItem.min}
                                onChange={(value) => handleUpdateAutomizationTarget(selectedAutomization.id, targetItem.id, { min: value })}
                              />
                            </View>
                            <View style={{ flex: 1, backgroundColor: surface1, borderRadius: 10, borderWidth: 1, borderColor: border1, padding: 8 }}>
                              <Text style={styles.modalSubLabel}>MAX TARGET</Text>
                              <SmartValueEditor
                                target={targetItem.target}
                                value={targetItem.max}
                                onChange={(value) => handleUpdateAutomizationTarget(selectedAutomization.id, targetItem.id, { max: value })}
                              />
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <View style={[styles.workspaceHeader, !uiIsCompact && styles.workspaceHeaderComfortable]}>
                <View style={styles.workspaceHeaderPrimary}>
                  <Text style={styles.workspaceHeaderTitle}>Overview</Text>
                  <TouchableOpacity style={styles.workspaceHeaderShowPreset} onPress={() => setPresetsVisible(true)}>
                    <Text style={styles.workspaceHeaderShowPresetLabel}>Active show</Text>
                    <Text style={[styles.workspaceHeaderShowPresetName, !loadedAppPreset && styles.workspaceHeaderShowPresetNameEmpty]} numberOfLines={1}>
                      {loadedAppPreset ? `${loadedAppPreset.name}${loadedAppPresetModified ? ' · Modified' : ''}` : 'No show loaded'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.workspaceHeaderActions, uiIsCompact && styles.workspaceHeaderActionsCompact]}>
                  {activeHaPair ? (
                    <TouchableOpacity
                      style={[styles.workspaceRunBtn, { backgroundColor: 'rgba(52, 199, 89, 0.14)', borderColor: success }]}
                      onPress={() => openHaWorkspace(activeHaPair.id)}
                    >
                      <ShieldCheck size={14} color={success} />
                      <Text style={[styles.workspaceRunBtnText, { color: success }]}>Open active HA</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <ScrollView
                style={styles.workspaceScroll}
                contentContainerStyle={[styles.workspaceScrollContent, !uiIsCompact && styles.workspaceScrollContentComfortable]}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.controlHeroCard}>
                  <View style={styles.controlHeroTopRow}>
                    <View style={styles.controlHeroCopyBlock}>
                      <Text style={styles.controlHeroEyebrow}>At a glance</Text>
                      <Text style={styles.controlHeroTitle}>
                        {wingOnline ? consoleDisplayName : loadedAppPreset ? loadedAppPreset.name : 'Ready for a show'}
                      </Text>
                      <Text style={styles.controlHeroBody}>
                        {`${enabledMacroCount} macro${enabledMacroCount !== 1 ? 's' : ''} active, ${enabledAutomizationCount} automation${enabledAutomizationCount !== 1 ? 's' : ''} running, ${enabledHaPairCount} HA setup${enabledHaPairCount !== 1 ? 's' : ''} armed.`}
                      </Text>
                    </View>

                  </View>

                  <View style={styles.controlStatusStrip}>
                    <View style={[styles.controlStatusPill, { borderColor: (consoleUnsupported || consolePartial) ? '#FF9500' : wingOnline ? success : '#3A3A46', backgroundColor: (consoleUnsupported || consolePartial) ? 'rgba(255, 149, 0, 0.12)' : wingOnline ? 'rgba(52, 199, 89, 0.12)' : 'rgba(255,255,255,0.05)' }]}>
                      <Text style={[styles.controlStatusPillText, { color: (consoleUnsupported || consolePartial) ? '#FFD4A3' : wingOnline ? '#D9FFE5' : '#D7D7DD' }]}>
                        {consoleUnsupported ? 'Console unsupported' : consolePartial ? 'Limited console support' : wingOnline ? 'Console online' : 'Console offline'}
                      </Text>
                    </View>
                    <View style={[styles.controlStatusPill, { borderColor: activeHaPair ? success : '#3A3A46', backgroundColor: activeHaPair ? 'rgba(52, 199, 89, 0.12)' : 'rgba(255,255,255,0.05)' }]}>
                      <Text style={[styles.controlStatusPillText, { color: activeHaPair ? '#D9FFE5' : '#D7D7DD' }]}>
                        {activeHaPair ? `HA armed · ${activeHaPair.name}` : 'HA idle'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.controlStatusPill, { borderColor: loadedAppPreset ? accentPrimary : '#3A3A46', backgroundColor: loadedAppPreset ? 'rgba(255, 179, 87, 0.12)' : 'rgba(255,255,255,0.05)' }]}
                      onPress={() => setPresetsVisible(true)}
                    >
                      <Text style={[styles.controlStatusPillText, { color: loadedAppPreset ? '#FFE1BA' : '#D7D7DD' }]} numberOfLines={1}>
                        {loadedAppPreset ? `Show · ${loadedAppPreset.name}${loadedAppPresetModified ? ' · Modified' : ''}` : 'No show loaded'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: textSecondary, fontSize: 11, marginTop: 8 }} numberOfLines={2}>
                    {macroStatus}
                  </Text>

                  <View style={styles.overviewFocusRail}>
                    {overviewFocusOptions.map((option) => {
                      const active = overviewFocus === option.key;
                      return (
                        <TouchableOpacity
                          key={option.key}
                          style={[
                            styles.overviewFocusBtn,
                            active && { borderColor: option.tone, backgroundColor: `${option.tone}20` },
                          ]}
                          onPress={() => setOverviewFocus(option.key)}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.overviewFocusLabel, active && { color: option.tone }]}>{option.label}</Text>
                          <Text style={styles.overviewFocusCount}>{option.count}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {overviewFocus === 'global' ? (
                    <>
                      <View style={[styles.controlOverviewGrid, width < 880 && { flexDirection: 'column' }]}>
                        {homePulseCards.map((card) => (
                          <View key={card.key} style={[styles.controlOverviewCard, { backgroundColor: card.bg, borderColor: `${card.tone}33` }]}>
                            <Text style={styles.controlOverviewCardTitle}>{card.title}</Text>
                            <Text style={[styles.controlOverviewCardValue, { color: card.tone }]} numberOfLines={1}>
                              {card.value}
                            </Text>
                            <Text style={styles.controlOverviewCardSub}>{card.sub}</Text>
                          </View>
                        ))}
                      </View>

                      {(consoleUnsupported || consolePartial) ? (
                        <View style={[styles.controlStatusBanner, { borderColor: 'rgba(255, 149, 0, 0.36)', backgroundColor: 'rgba(255, 149, 0, 0.08)' }]}>
                          <Text style={[styles.controlStatusBannerLabel, { color: '#FFB357' }]}>{consoleUnsupported ? 'UNSUPPORTED CONSOLE FAMILY' : 'PARTIAL COMPATIBILITY MODE'}</Text>
                          <Text style={[styles.controlStatusBannerText, { color: '#FFE7C2' }]}>
                            {consoleUnsupported
                              ? `${consoleDisplayName} was detected on ${currentWingRouteIp || '--'}:${runtimeStatus?.lastConsoleReplyPort || runtimeStatus?.wingPort || '--'}. This build stays in probe-only mode for that family: no WING actions, selected-strip sync, native meters, or HA control will run.`
                              : `${consoleDisplayName} was detected on ${currentWingRouteIp || '--'}:${runtimeStatus?.lastConsoleReplyPort || runtimeStatus?.wingPort || '--'}. Limited X32/M32 support is active in this build: mapped OSC control is available and HA compensation remains constrained to supported paths, while selected-strip sync and native metering stay unavailable.`}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.controlStatusBanner}>
                        <Text style={styles.controlStatusBannerLabel}>{operationalStatusLabel}</Text>
                        <Text style={styles.controlStatusBannerText}>{operationalStatusText}</Text>
                      </View>
                    </>
                  ) : (
                    <View style={[styles.overviewMonitorPanel, { borderColor: `${overviewFocusedTone}44` }]}>
                      <View style={styles.overviewMonitorHeader}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.overviewMonitorEyebrow, { color: overviewFocusedTone }]}>LIVE MONITOR</Text>
                          <Text style={styles.overviewMonitorTitle}>{overviewFocusedTitle}</Text>
                        </View>
                        <Text style={[styles.overviewMonitorCount, { color: overviewFocusedTone }]}>{overviewFocusedItems.length} total</Text>
                      </View>
                      {overviewFocusedItems.length === 0 ? (
                        <View style={styles.overviewMonitorEmpty}>
                          <Text style={styles.emptyStateText}>{overviewFocusedEmptyText}</Text>
                        </View>
                      ) : (
                        <View style={styles.overviewMonitorList}>
                          {overviewFocusedItems.map((item) => (
                            <TouchableOpacity
                              key={item.key}
                              style={styles.overviewMonitorRow}
                              onPress={item.onPress}
                              activeOpacity={0.85}
                            >
                              <View style={[styles.overviewMonitorStatusDot, { backgroundColor: item.statusTone }]} />
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <View style={styles.overviewMonitorRowTop}>
                                  <Text style={styles.overviewMonitorRowTitle} numberOfLines={1}>{item.title}</Text>
                                  <Text style={[styles.overviewMonitorStatusPill, { color: item.statusTone, borderColor: `${item.statusTone}66` }]}>{item.status}</Text>
                                </View>
                                <Text style={styles.overviewMonitorDetail} numberOfLines={1}>{item.detail}</Text>
                                <Text style={styles.overviewMonitorMeta} numberOfLines={1}>{item.meta}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {overviewFocus === 'global' && <View style={styles.dashboardSection}>
                  <View style={styles.rowJustified}>
                    <Text style={styles.dashboardSectionTitle}>Workspaces</Text>
                  </View>

                  <View style={[styles.controlModuleGrid, width < 1050 && { flexDirection: 'column' }]}>
                    {homeModuleCards.map((module) => (
                      <View
                        key={module.key}
                        style={[
                          styles.controlModuleCard,
                          { borderLeftColor: module.accent },
                        ]}
                      >
                        <View style={styles.controlModuleHeader}>
                          <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                            <Text style={styles.controlModuleTitle}>{module.title}</Text>
                          </View>
                          <Text style={[styles.controlModuleMetaPill, { color: module.accent, backgroundColor: surface3 }]}>
                            {module.meta}
                          </Text>
                        </View>

                        {module.items.length === 0 ? (
                          <View style={styles.controlModuleEmptyCard}>
                            <Text style={styles.controlModuleEmptyText}>{module.emptyText}</Text>
                          </View>
                        ) : (
                          <View style={styles.controlModulePreviewList}>
                            {module.items.map((item) => (
                              <TouchableOpacity
                                key={item.key}
                                style={styles.controlModulePreviewRow}
                                onPress={item.onPress}
                                activeOpacity={0.85}
                              >
                                <View style={[styles.controlModulePreviewDot, { backgroundColor: item.tone }]} />
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={styles.controlModulePreviewTitle} numberOfLines={1}>{item.title}</Text>
                                  <Text style={styles.controlModulePreviewSub} numberOfLines={1}>{item.subtitle}</Text>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

                        <View style={styles.controlModuleActions}>
                          <TouchableOpacity
                            style={[styles.controlModulePrimaryBtn, { borderColor: `${module.accent}70` }]}
                            onPress={module.onOpen}
                          >
                            <Text style={[styles.controlModulePrimaryBtnText, { color: module.accent }]}>{module.buttonLabel}</Text>
                            <ChevronRight size={15} color={module.accent} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.controlModuleSecondaryBtn} onPress={module.onCreate}>
                            <Plus size={15} color={textPrimary} />
                            <Text style={styles.controlModuleSecondaryBtnText}>{module.createLabel}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      {/* App Presets Modal */}
      <Modal visible={presetsVisible} animationType="fade" transparent={true} onRequestClose={() => setPresetsVisible(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPresetsVisible(false)} />
          <View style={[styles.modalWindowContent, styles.libraryModalCard, { height: Math.min(modalCardHeight, 700), maxWidth: 980 }]}>
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>SHOW PRESETS</Text>
              <TouchableOpacity onPress={() => setPresetsVisible(false)}><Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.libraryModalHintText}>Save different show configurations and choose exactly which lists each preset owns.</Text>
            <View style={styles.presetTransferActions}>
              <TouchableOpacity style={[styles.importExportBtn, styles.libraryModalToolbarBtn]} onPress={handleImportAppPresets}>
                <Text style={styles.importExportBtnText}>IMPORT FILE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.importExportBtn, styles.libraryModalToolbarBtn]} onPress={handleExportAppPresets}>
                <Text style={styles.importExportBtnText}>{selectedPresetExportIds.length > 0 ? 'EXPORT SELECTED' : 'EXPORT ALL'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.importExportBtn, styles.libraryModalToolbarBtn]} onPress={handleExportCompleteBackup}>
                <Text style={styles.importExportBtnText}>COMPLETE BACKUP</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.presetComposerCard}>
              <Text style={styles.modalSubLabel}>EXPORT FILE NAME</Text>
              <TextInput
                style={[styles.input, styles.presetNameInput]}
                value={presetExportFileName}
                onChangeText={setPresetExportFileName}
                placeholder="wing_show_presets_export"
                placeholderTextColor="#666"
                selectionColor={accentPrimary}
                cursorColor={accentPrimary}
                autoCapitalize="none"
              />
              <View style={styles.settingsChipsRow}>
                <TouchableOpacity
                  style={[styles.settingsChip, selectedPresetExportIds.length === 0 && styles.settingsChipActive]}
                  onPress={() => setSelectedPresetExportIds([])}
                >
                  <Text style={[styles.settingsChipText, selectedPresetExportIds.length === 0 && styles.settingsChipTextActive]}>ALL PRESETS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.settingsChip}
                  onPress={() => setSelectedPresetExportIds(appPresets.map((preset) => preset.id))}
                >
                  <Text style={styles.settingsChipText}>SELECT ALL</Text>
                </TouchableOpacity>
                <Text style={styles.sidebarSectionMetaText}>
                  {selectedPresetExportIds.length > 0 ? `${selectedPresetExportIds.length} selected` : `${appPresets.length} total`}
                </Text>
              </View>
            </View>
            <View style={styles.presetComposerCard}>
              <TextInput
                style={[styles.input, styles.presetNameInput]}
                value={presetName}
                onChangeText={setPresetName}
                placeholder="Preset name, e.g. Friday Show"
                placeholderTextColor="#666"
                selectionColor={accentPrimary}
                cursorColor={accentPrimary}
              />
              <View style={styles.settingsChipsRow}>
                {([
                  ['macros', 'MACROS'],
                  ['automizations', 'AUTOMATIONS'],
                  ['ha', 'HA SETUPS'],
                ] as const).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.settingsChip, presetScope[key] && styles.settingsChipActive]}
                    onPress={() => setPresetScope((prev) => ({ ...prev, [key]: !prev[key] }))}
                  >
                    <Text style={[styles.settingsChipText, presetScope[key] && styles.settingsChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.presetSaveActions}>
                <TouchableOpacity style={[styles.workspaceCreateBtnSidebar, styles.presetSaveActionBtn]} onPress={handleSaveAppPreset}>
                  <Text style={styles.workspaceCreateBtnSidebarText}>SAVE CURRENT AS PRESET</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.importExportBtn, styles.presetSaveActionBtn, styles.presetSaveBlankBtn]} onPress={handleSaveBlankAppPreset}>
                  <Text style={styles.importExportBtnText}>SAVE BLANK PRESET</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={[styles.modalEditorPane, { flex: 1 }]} contentContainerStyle={styles.libraryModalBodyContent}>
              {appPresets.length === 0 ? (
                <View style={styles.libraryEmptyStateCard}>
                  <Text style={styles.libraryEmptyStateTitle}>No show presets saved</Text>
                  <Text style={styles.libraryEmptyStateBody}>Choose scopes above and save the current app lists as your first preset.</Text>
                </View>
              ) : appPresets.map((preset) => (
                <View key={preset.id} style={styles.presetRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.presetTitleRow}>
                      <Text style={styles.sidebarMacroCardTitle}>{preset.name}</Text>
                      {loadedAppPresetId === preset.id ? <Text style={styles.loadedPresetBadge}>LOADED</Text> : null}
                      {preset.isRecovery ? <Text style={styles.recoveryPresetBadge}>RECOVERY</Text> : null}
                    </View>
                    <Text style={styles.sidebarMacroCardSub}>
                      {[preset.scopes.macros ? `${preset.macros?.length || 0} macros` : '', preset.scopes.automizations ? `${preset.automizations?.length || 0} automations` : '', preset.scopes.ha ? `${preset.haPairs?.length || 0} HA setups` : ''].filter(Boolean).join('  |  ')}
                    </Text>
                  </View>
                  <View style={styles.presetActions}>
                    <TouchableOpacity
                      style={[styles.importExportBtn, selectedPresetExportIds.includes(preset.id) && styles.settingsChipActive]}
                      onPress={() => setSelectedPresetExportIds((prev) => prev.includes(preset.id) ? prev.filter((id) => id !== preset.id) : [...prev, preset.id])}
                    >
                      <Text style={[styles.importExportBtnText, selectedPresetExportIds.includes(preset.id) && styles.settingsChipTextActive]}>
                        {selectedPresetExportIds.includes(preset.id) ? 'EXPORTING' : 'EXPORT'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.importExportBtn} onPress={() => handleLoadAppPreset(preset)}><Text style={styles.importExportBtnText}>LOAD</Text></TouchableOpacity>
                    {!preset.isRecovery ? (
                      <TouchableOpacity style={styles.importExportBtn} onPress={() => handleUpdateAppPreset(preset)}><Text style={styles.importExportBtnText}>UPDATE</Text></TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.importExportBtn} onPress={() => handleDuplicateAppPreset(preset)}><Text style={styles.importExportBtnText}>DUPLICATE</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.libraryDeleteSelectedBtn, styles.presetDeleteBtn]} onPress={() => handleDeleteAppPreset(preset)}><Text style={styles.libraryDeleteSelectedBtnText}>DELETE</Text></TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Console Search Modal */}
      <Modal visible={consoleSearchVisible} animationType="fade" transparent={true} onRequestClose={() => setConsoleSearchVisible(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setConsoleSearchVisible(false)} />
          <View style={[styles.modalWindowContent, styles.utilityModalCard, { height: Math.min(modalCardHeight, 520), maxWidth: 820 }]}>
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>SEARCH CONSOLE</Text>
              <TouchableOpacity onPress={() => setConsoleSearchVisible(false)}><Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.libraryModalHintText}>Searches the /24 subnet inferred from the IP field using WING discovery. Select a result to fill the connection IP.</Text>
            {consoleSearchRunning ? (
              <View style={styles.libraryEmptyStateCard}><Text style={styles.libraryEmptyStateTitle}>Searching network...</Text><Text style={styles.libraryEmptyStateBody}>This normally takes a few seconds.</Text></View>
            ) : consoleSearchResults.length === 0 ? (
              <View style={styles.libraryEmptyStateCard}><Text style={styles.libraryEmptyStateTitle}>No consoles found</Text><Text style={styles.libraryEmptyStateBody}>Check that the tablet and console are on the same subnet, then update the IP hint and search again.</Text></View>
            ) : consoleSearchResults.map((result) => (
              <TouchableOpacity
                key={result.ip}
                style={styles.presetRow}
                onPress={() => {
                  setIp(result.ip);
                  setConsoleSearchVisible(false);
                  setMacroStatus(`Console ${result.model} selected at ${result.ip}. Press CONNECT.`);
                }}
              >
                <View style={{ flex: 1 }}><Text style={styles.sidebarMacroCardTitle}>{result.model}</Text><Text style={styles.sidebarMacroCardSub}>{result.ip} | discovery reply UDP {result.replyPort}</Text></View>
                <Text style={styles.libraryRowOpenHint}>USE IP</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.searchConsoleBtn} disabled={consoleSearchRunning} onPress={handleSearchConsoles}>
              <Text style={styles.searchConsoleBtnText}>{consoleSearchRunning ? 'SEARCHING...' : 'SEARCH AGAIN'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Macro Library Modal */}
      <Modal visible={macroLibraryVisible} animationType="fade" transparent={true} onRequestClose={() => { setMacroLibraryVisible(false); setMacroLibraryEditMode(false); setSelectedMacroLibraryIds([]); }}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setMacroLibraryVisible(false); setMacroLibraryEditMode(false); setSelectedMacroLibraryIds([]); }} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              styles.libraryModalCard,
              { height: Math.min(modalCardHeight, 760), maxWidth: 980 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>MACRO LIBRARY</Text>
              <TouchableOpacity onPress={() => { setMacroLibraryVisible(false); setMacroLibraryEditMode(false); setSelectedMacroLibraryIds([]); }}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.libraryModalHintText}>
              Browse and select a row to open its workspace. Use create to start a new draft.
            </Text>

            <View style={styles.libraryModalToolbar}>
              <View style={styles.libraryModalToolbarLeft}>
                <TouchableOpacity style={[styles.importExportBtn, styles.libraryModalToolbarBtn]} onPress={async () => {
                  const n = await MacroEngine.importMacros();
                  setMacroStatus(`${n} macros imported.`);
                }}>
                  <Text style={styles.importExportBtnText}>IMPORT</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.importExportBtn, styles.libraryModalToolbarBtn]} onPress={() => MacroEngine.exportMacros()}>
                  <Text style={styles.importExportBtnText}>EXPORT</Text>
                </TouchableOpacity>
                {macros.length > 0 && (
                  <TouchableOpacity
                    style={[styles.importExportBtn, styles.libraryModalToolbarBtn, macroLibraryEditMode && styles.libraryEditModeBtnActive]}
                    onPress={() => {
                      setMacroLibraryEditMode((value) => !value);
                      setSelectedMacroLibraryIds([]);
                    }}
                  >
                    <Text style={styles.importExportBtnText}>{macroLibraryEditMode ? 'DONE' : 'EDIT'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {macroLibraryEditMode ? (
                <TouchableOpacity
                  style={[styles.libraryDeleteSelectedBtn, selectedMacroLibraryIds.length === 0 && styles.libraryDeleteSelectedBtnDisabled]}
                  disabled={selectedMacroLibraryIds.length === 0}
                  onPress={confirmDeleteSelectedMacros}
                >
                  <Text style={styles.libraryDeleteSelectedBtnText}>DELETE ({selectedMacroLibraryIds.length})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.workspaceCreateBtnSidebar} onPress={handleCreateMacroFromLibrary}>
                  <Text style={styles.workspaceCreateBtnSidebarText}>+ ADD MACRO</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, styles.libraryModalBody]}
              contentContainerStyle={styles.libraryModalBodyContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {macros.length === 0 ? (
                <View style={styles.libraryEmptyStateCard}>
                  <Text style={styles.libraryEmptyStateTitle}>No macros in library</Text>
                  <Text style={styles.libraryEmptyStateBody}>
                    This library is for fast browse/select. Create opens a fresh macro workspace.
                  </Text>
                  <TouchableOpacity style={[styles.workspaceCreateBtnSidebar, styles.libraryEmptyCreateBtn]} onPress={handleCreateMacroFromLibrary}>
                    <Text style={styles.workspaceCreateBtnSidebarText}>CREATE FIRST MACRO</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                macros.map((macro, idx) => {
                  const isEnabled = macro.enabled === true;
                  const macroIdentity = getMacroIdentity(macro);
                  const isSelected = selectedMacroId === macroIdentity;
                  const isMarkedForDelete = selectedMacroLibraryIds.includes(macroIdentity);
                  const macroRuntime = getMacroRuntime(macro);
                  return (
                    <TouchableOpacity
                      key={macroIdentity || idx}
                      style={[
                        styles.sidebarMacroCard,
                        !isEnabled && styles.sidebarMacroCardDisabled,
                        isSelected && styles.sidebarMacroCardActive,
                        isMarkedForDelete && styles.libraryRowMarkedForDelete,
                      ]}
                      onPress={() => macroLibraryEditMode
                        ? toggleLibrarySelection(macroIdentity, setSelectedMacroLibraryIds)
                        : handleSelectMacroFromLibrary(macroIdentity)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.sidebarMacroCardHeader}>
                        <View style={{ flex: 1, paddingRight: 4 }}>
                          <Text style={styles.sidebarMacroCardTitle}>{macro.name}</Text>
                          <Text style={styles.sidebarMacroCardSub}>
                            {`When: ${describeTarget(macro.triggerTarget)} ${macro.triggerOperator || '=='} ${formatParameterValue(macro.triggerTarget, macro.triggerValue)}`}
                          </Text>
                        </View>

                        {macroLibraryEditMode ? (
                          <View style={[styles.librarySelectionIndicator, isMarkedForDelete && styles.librarySelectionIndicatorActive]}>
                            <Text style={styles.librarySelectionIndicatorText}>{isMarkedForDelete ? '✓' : ''}</Text>
                          </View>
                        ) : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.libraryRowOpenHint}>OPEN</Text>
                          <Switch
                            value={isEnabled}
                            onValueChange={(val) => handleToggleMacro(macro, val)}
                            trackColor={{ false: '#2A2A2A', true: 'rgba(255, 179, 87, 0.3)' }}
                            thumbColor={isEnabled ? accentPrimary : '#555'}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                          />
                        </View>}
                      </View>

                      <Text style={styles.sidebarMacroCardSummary}>
                        {`IF: ${macro.conditions?.length || 0} (${macro.logicalOperator || 'AND'})  |  THEN: ${macro.actions?.length || 0} steps  |  ${formatMacroRuntimeSummary(macroRuntime)}`}
                      </Text>

                      {!macroLibraryEditMode && <View style={styles.sidebarMacroCardActions}>
                        <TouchableOpacity
                          style={styles.sidebarMacroMiniBtn}
                          onPress={() => handleMoveMacro(macroIdentity, 'up')}
                        >
                          <Text style={styles.sidebarMacroMiniBtnText}>▲ UP</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.sidebarMacroMiniBtn}
                          onPress={() => handleMoveMacro(macroIdentity, 'down')}
                        >
                          <Text style={styles.sidebarMacroMiniBtnText}>▼ DOWN</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sidebarMacroMiniBtn, { borderColor: '#FF9800' }]}
                          onPress={() => handleDuplicateMacro(macroIdentity)}
                        >
                          <Text style={[styles.sidebarMacroMiniBtnText, { color: '#FF9800' }]}>DUPLICATE</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sidebarMacroRunBtn, { flex: 1 }]}
                          onPress={() => handleTriggerMacro(macro)}
                        >
                          <Text style={styles.sidebarMacroRunBtnText}>▶ RUN</Text>
                        </TouchableOpacity>
                      </View>}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Automization Library Modal */}
      <Modal visible={automizationLibraryVisible} animationType="fade" transparent={true} onRequestClose={() => { setAutomizationLibraryVisible(false); setAutomizationLibraryEditMode(false); setSelectedAutomizationLibraryIds([]); }}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setAutomizationLibraryVisible(false); setAutomizationLibraryEditMode(false); setSelectedAutomizationLibraryIds([]); }} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              styles.libraryModalCard,
              { height: Math.min(modalCardHeight, 760), maxWidth: 980 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>AUTOMATION LIBRARY</Text>
              <TouchableOpacity onPress={() => { setAutomizationLibraryVisible(false); setAutomizationLibraryEditMode(false); setSelectedAutomizationLibraryIds([]); }}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.libraryModalHintText}>
              Browse mappings here and tap a row to open editor workspace. Create starts a new automation.
            </Text>

            <View style={styles.libraryModalToolbar}>
              {automizations.length > 0 ? (
                <TouchableOpacity
                  style={[styles.importExportBtn, styles.libraryModalToolbarBtn, automizationLibraryEditMode && styles.libraryEditModeBtnActive]}
                  onPress={() => {
                    setAutomizationLibraryEditMode((value) => !value);
                    setSelectedAutomizationLibraryIds([]);
                  }}
                >
                  <Text style={styles.importExportBtnText}>{automizationLibraryEditMode ? 'DONE' : 'EDIT'}</Text>
                </TouchableOpacity>
              ) : <View />}
              {automizationLibraryEditMode ? (
                <TouchableOpacity
                  style={[styles.libraryDeleteSelectedBtn, selectedAutomizationLibraryIds.length === 0 && styles.libraryDeleteSelectedBtnDisabled]}
                  disabled={selectedAutomizationLibraryIds.length === 0}
                  onPress={confirmDeleteSelectedAutomizations}
                >
                  <Text style={styles.libraryDeleteSelectedBtnText}>DELETE ({selectedAutomizationLibraryIds.length})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.workspaceCreateBtnSidebar, styles.workspaceCreateBtnSidebarAlt]} onPress={handleCreateAutomizationFromLibrary}>
                  <Text style={[styles.workspaceCreateBtnSidebarText, styles.workspaceCreateBtnSidebarAltText]}>+ ADD AUTOMATION</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, styles.libraryModalBody]}
              contentContainerStyle={styles.libraryModalBodyContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {automizations.length === 0 ? (
                <View style={styles.libraryEmptyStateCard}>
                  <Text style={styles.libraryEmptyStateTitle}>No automations in library</Text>
                  <Text style={styles.libraryEmptyStateBody}>
                    Use automations to map one source parameter to one or more targets with range scaling.
                  </Text>
                  <TouchableOpacity
                    style={[styles.workspaceCreateBtnSidebar, styles.workspaceCreateBtnSidebarAlt, styles.libraryEmptyCreateBtn]}
                    onPress={handleCreateAutomizationFromLibrary}
                  >
                    <Text style={[styles.workspaceCreateBtnSidebarText, styles.workspaceCreateBtnSidebarAltText]}>CREATE FIRST AUTOMATION</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                automizations.map((automization) => {
                  const isSelected = selectedAutomizationId === automization.id;
                  const isMarkedForDelete = selectedAutomizationLibraryIds.includes(automization.id);
                  return (
                    <TouchableOpacity
                      key={automization.id}
                      style={[
                        styles.sidebarAutomationCard,
                        !automization.enabled && styles.sidebarAutomationCardDisabled,
                        isSelected && styles.sidebarAutomationCardActive,
                        isMarkedForDelete && styles.libraryRowMarkedForDelete,
                      ]}
                      onPress={() => automizationLibraryEditMode
                        ? toggleLibrarySelection(automization.id, setSelectedAutomizationLibraryIds)
                        : handleSelectAutomizationFromLibrary(automization.id)}
                      activeOpacity={0.82}
                    >
                      <View style={styles.sidebarMacroCardHeader}>
                        <View style={{ flex: 1, paddingRight: 4 }}>
                          <Text style={styles.sidebarAutomationCardTitle}>{automization.name}</Text>
                          <Text style={styles.sidebarAutomationCardSub}>
                            Source: {describeTarget(automization.sourceTarget)}
                          </Text>
                        </View>
                        {automizationLibraryEditMode ? (
                          <View style={[styles.librarySelectionIndicator, isMarkedForDelete && styles.librarySelectionIndicatorActive]}>
                            <Text style={styles.librarySelectionIndicatorText}>{isMarkedForDelete ? '✓' : ''}</Text>
                          </View>
                        ) : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.libraryRowOpenHint, styles.libraryRowOpenHintAlt]}>OPEN</Text>
                          <Switch
                            value={automization.enabled}
                            onValueChange={(val) => handleToggleAutomization(automization.id, val)}
                            trackColor={{ false: '#2A2A2A', true: 'rgba(255, 149, 0, 0.3)' }}
                            thumbColor={automization.enabled ? '#FF9500' : '#555'}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                          />
                        </View>}
                      </View>
                      <Text style={styles.sidebarAutomationCardSummary}>
                        {`${automization.mode.toUpperCase()} map  |  ${automization.targetItems.length} target(s)  |  ${automization.responseMs}ms`}
                      </Text>
                      {!automizationLibraryEditMode && <View style={styles.sidebarMacroCardActions}>
                        <TouchableOpacity
                          style={[styles.sidebarMacroMiniBtn, styles.libraryDuplicateBtnAlt]}
                          onPress={() => handleDuplicateAutomization(automization)}
                        >
                          <Text style={[styles.sidebarMacroMiniBtnText, styles.libraryDuplicateBtnAltText]}>DUPLICATE</Text>
                        </TouchableOpacity>
                      </View>}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* HA Setup Library Modal */}
      <Modal visible={haLibraryVisible} animationType="fade" transparent={true} onRequestClose={() => { setHaLibraryVisible(false); setHaLibraryEditMode(false); setSelectedHaLibraryIds([]); }}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setHaLibraryVisible(false); setHaLibraryEditMode(false); setSelectedHaLibraryIds([]); }} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              styles.libraryModalCard,
              { height: Math.min(modalCardHeight, 760), maxWidth: 980 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>HA SETUPS</Text>
              <TouchableOpacity onPress={() => { setHaLibraryVisible(false); setHaLibraryEditMode(false); setSelectedHaLibraryIds([]); }}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.libraryModalHintText}>
              Select a setup to open runtime workspace. Create starts a new HA pair draft.
            </Text>

            <View style={styles.libraryModalToolbar}>
              {haPairs.length > 0 ? (
                <TouchableOpacity
                  style={[styles.importExportBtn, styles.libraryModalToolbarBtn, haLibraryEditMode && styles.libraryEditModeBtnActive]}
                  onPress={() => {
                    setHaLibraryEditMode((value) => !value);
                    setSelectedHaLibraryIds([]);
                  }}
                >
                  <Text style={styles.importExportBtnText}>{haLibraryEditMode ? 'DONE' : 'EDIT'}</Text>
                </TouchableOpacity>
              ) : <View />}
              {haLibraryEditMode ? (
                <TouchableOpacity
                  style={[styles.libraryDeleteSelectedBtn, selectedHaLibraryIds.length === 0 && styles.libraryDeleteSelectedBtnDisabled]}
                  disabled={selectedHaLibraryIds.length === 0}
                  onPress={confirmDeleteSelectedHaPairs}
                >
                  <Text style={styles.libraryDeleteSelectedBtnText}>DELETE ({selectedHaLibraryIds.length})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.workspaceCreateBtnSidebar, styles.workspaceCreateBtnSidebarHa]} onPress={handleCreateHaSetupFromLibrary}>
                  <Text style={[styles.workspaceCreateBtnSidebarText, styles.workspaceCreateBtnSidebarHaText]}>+ ADD HA SETUP</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, styles.libraryModalBody]}
              contentContainerStyle={styles.libraryModalBodyContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {haPairs.length === 0 ? (
                <View style={styles.libraryEmptyStateCard}>
                  <Text style={styles.libraryEmptyStateTitle}>No HA setups in library</Text>
                  <Text style={styles.libraryEmptyStateBody}>
                    Create an HA setup to link owner preamp gain changes to follower trim compensation.
                  </Text>
                  <TouchableOpacity
                    style={[styles.workspaceCreateBtnSidebar, styles.workspaceCreateBtnSidebarHa, styles.libraryEmptyCreateBtn]}
                    onPress={handleCreateHaSetupFromLibrary}
                  >
                    <Text style={[styles.workspaceCreateBtnSidebarText, styles.workspaceCreateBtnSidebarHaText]}>CREATE FIRST HA SETUP</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                haPairs.map((pair) => {
                  const runtime = haSnapshot?.runtimes?.[pair.id];
                  const isSelected = selectedHaPairId === pair.id;
                  const visual = getHaStateVisual(runtime?.pairState);
                  const mappingCount = Array.isArray(pair.mappings) ? pair.mappings.length : 0;
                  const isMarkedForDelete = selectedHaLibraryIds.includes(pair.id);
                  return (
                    <TouchableOpacity
                      key={pair.id}
                      style={[
                        styles.sidebarAutomationCard,
                        { backgroundColor: '#141B16' },
                        !pair.enabled && styles.sidebarAutomationCardDisabled,
                        isSelected && { borderColor: success, backgroundColor: '#16231A' },
                        { borderColor: isSelected ? success : visual.border },
                        isMarkedForDelete && styles.libraryRowMarkedForDelete,
                      ]}
                      onPress={() => haLibraryEditMode
                        ? toggleLibrarySelection(pair.id, setSelectedHaLibraryIds)
                        : handleSelectHaPairFromLibrary(pair.id)}
                      activeOpacity={0.82}
                    >
                      <View style={styles.sidebarMacroCardHeader}>
                        <View style={{ flex: 1, paddingRight: 4 }}>
                          <Text style={styles.sidebarAutomationCardTitle}>{pair.name}</Text>
                          <Text style={styles.sidebarHaCardSub}>
                            {`Owner: ${describeHaOwner(pair)} | ${getHaConnectivitySummary(pair, runtime)}`}
                          </Text>
                        </View>
                        {haLibraryEditMode ? (
                          <View style={[styles.librarySelectionIndicator, isMarkedForDelete && styles.librarySelectionIndicatorActive]}>
                            <Text style={styles.librarySelectionIndicatorText}>{isMarkedForDelete ? '✓' : ''}</Text>
                          </View>
                        ) : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.libraryRowOpenHint, styles.libraryRowOpenHintHa]}>OPEN</Text>
                          <Switch
                            value={pair.enabled !== false}
                            onValueChange={(val) => handleToggleHaPair(pair.id, val)}
                            trackColor={{ false: '#2A2A2A', true: 'rgba(224, 163, 62, 0.3)' }}
                            thumbColor={pair.enabled !== false ? accentHa : '#555'}
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                          />
                        </View>}
                      </View>
                      <Text style={styles.sidebarHaCardSummary}>
                        {`${pair.endpoints.a.label} ${pair.endpoints.a.ip || '--'}  |  ${pair.endpoints.b.label} ${pair.endpoints.b.ip || '--'}`}
                      </Text>
                      <Text style={styles.sidebarHaCardSummary}>
                        {`${visual.label}  |  ${mappingCount} mapping(s)  |  ${getHaConnectivitySummary(pair, runtime)}  |  Armed: ${runtime?.armed ? 'YES' : 'NO'}`}
                      </Text>
                      {!haLibraryEditMode && <View style={styles.sidebarMacroCardActions}>
                        <TouchableOpacity
                          style={[styles.sidebarMacroMiniBtn, styles.libraryDuplicateBtnHa]}
                          onPress={() => handleDuplicateHaPair(pair)}
                        >
                          <Text style={[styles.sidebarMacroMiniBtnText, styles.libraryDuplicateBtnHaText]}>DUPLICATE</Text>
                        </TouchableOpacity>
                      </View>}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Quick Guide Modal */}
      <Modal visible={showManual} animationType="fade" transparent={true} onRequestClose={() => setShowManual(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowManual(false)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              styles.utilityModalCard,
              { height: Math.min(modalCardHeight, 560), maxWidth: 860 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>QUICK GUIDE</Text>
              <TouchableOpacity onPress={() => setShowManual(false)}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, styles.utilityModalBody]}
              contentContainerStyle={styles.libraryModalBodyContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.utilityModalHint}>
                Operational checklist for preparing, protecting, and recalling a show.
              </Text>
              <View style={[styles.manualCard, styles.utilityGuideCard]}>
                <Text style={[styles.manualTitle, { fontSize: 12 }]}>BEFORE BUILDING A SHOW</Text>
                <Text style={[styles.manualText, { fontSize: 11 }]}>
                  1) Connect and confirm <Text style={styles.manualHighlight}>CONSOLE ONLINE</Text>.{"\n"}
                  2) Build and test Macros, Automations, and HA Setups individually.{"\n"}
                  3) Duplicate a working item before making substantial changes.
                </Text>
                <Text style={[styles.manualTitle, { fontSize: 12, marginTop: 12 }]}>PROTECT THE SHOW</Text>
                <Text style={[styles.manualText, { fontSize: 11 }]}>
                  1) Open <Text style={styles.manualHighlight}>SHOW PRESETS</Text>, choose the owned sections, and save the current show.{"\n"}
                  2) Use <Text style={styles.manualHighlight}>UPDATE</Text> after intentional changes. Use <Text style={styles.manualHighlight}>DUPLICATE</Text> before creating a variation.{"\n"}
                  3) Use <Text style={styles.manualHighlight}>SAVE BLANK PRESET</Text> only when loading it should intentionally clear its selected sections.{"\n"}
                  4) Loading a preset automatically creates a full <Text style={styles.manualHighlight}>RECOVERY</Text> snapshot first.
                </Text>
                <Text style={[styles.manualTitle, { fontSize: 12, marginTop: 12 }]}>BEFORE GOING LIVE</Text>
                <Text style={[styles.manualText, { fontSize: 11 }]}>
                  1) Load the intended Show Preset and confirm its name beside <Text style={styles.manualHighlight}>CONTROL CENTER</Text>.{"\n"}
                  2) Verify enabled states, console routes, HA ownership, and mappings.{"\n"}
                  3) Run critical macros manually once and inspect Diagnostics for connection warnings.{"\n"}
                  4) Use <Text style={styles.manualHighlight}>COMPLETE BACKUP</Text> and save it outside the tablet before important shows.
                </Text>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Diagnostics Modal */}
      <Modal visible={diagnosticsModalVisible} animationType="fade" transparent={true} onRequestClose={() => setDiagnosticsModalVisible(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDiagnosticsModalVisible(false)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              styles.utilityModalCard,
              { height: Math.min(modalCardHeight, 650), maxWidth: 980 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>DIAGNOSTICS PANEL</Text>
              <TouchableOpacity onPress={() => setDiagnosticsModalVisible(false)}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, styles.utilityModalBody]}
              contentContainerStyle={styles.libraryModalBodyContent}
              showsVerticalScrollIndicator={true}
            >
              {!showDiagnostics ? (
                <View style={styles.libraryEmptyStateCard}>
                  <Text style={styles.libraryEmptyStateTitle}>Diagnostics are disabled</Text>
                  <Text style={styles.libraryEmptyStateBody}>
                    Enable diagnostics in Settings to inspect runtime socket, identity probe, metering health, and raw logs.
                  </Text>
                </View>
              ) : (
                <View style={styles.sidebarDiagnosticsCard}>
                  <Text style={styles.sidebarDiagnosticsTitle}>DIAGNOSTIC CONNECTION PANEL</Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    UDP bind port: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.nativeListenPort || '--'}</Text> | Route port: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.wingPort || '--'}</Text> | Last reply port: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.lastConsoleReplyPort || '--'}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Family: <Text style={styles.sidebarDiagnosticsValue}>{consoleFamilyLabel}</Text> | Support: <Text style={[styles.sidebarDiagnosticsValue, { color: runtimeStatus?.consoleSupportLevel === 'full' ? success : '#FF9500' }]}>{consoleSupportLabel}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Driver: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.driverMode === 'unsupported' ? 'PROBE-ONLY' : runtimeStatus?.driverMode === 'x32' ? 'X32/M32' : 'WING'}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Detected console: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.consoleDisplayName || runtimeStatus?.consoleModel || 'unknown'}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Native meter socket: <Text style={[styles.sidebarDiagnosticsValue, { color: runtimeStatus?.consoleCapabilities?.nativeMetersV3 ? (runtimeStatus?.nativeBinaryReady ? success : '#FF9500') : '#8E8E93' }]}>{runtimeStatus?.consoleCapabilities?.nativeMetersV3 ? (runtimeStatus?.nativeBinaryReady ? 'READY' : 'PENDING') : 'N/A'}</Text> | Meter groups: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.activeMeterGroupCount ?? 0}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Meter health: <Text style={[styles.sidebarDiagnosticsValue, { color: meterHealth.color }]}>{meterHealth.label}</Text> | Last RX: <Text style={styles.sidebarDiagnosticsValue}>{formatElapsedRuntime(runtimeStatus?.lastMeterRxAt)}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Renew tick: <Text style={styles.sidebarDiagnosticsValue}>{formatElapsedRuntime(runtimeStatus?.lastMeterRenewAt)}</Text> | Jitter: <Text style={styles.sidebarDiagnosticsValue}>{Number.isFinite(Number(runtimeStatus?.renewJitterMs)) && Number(runtimeStatus?.renewJitterMs) > 0 ? `${Math.round(Number(runtimeStatus?.renewJitterMs))} ms` : '--'}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Source mode: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.sourceDeviceIndexMode || '--'}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Subscription: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.subscriptionMode || '--'}</Text> | Reconnect attempt: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.nativeReconnectAttempt ?? 0}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Meter coverage: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.activeMeterAddressCount ?? 0}/{runtimeStatus?.watchedMeterAddressCount ?? 0}</Text> | Dropped: <Text style={[styles.sidebarDiagnosticsValue, { color: Number(runtimeStatus?.droppedMeterAddressCount || 0) > 0 ? danger : success }]}>{runtimeStatus?.droppedMeterAddressCount ?? 0}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Meter values: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.activeMeterValueCount ?? 0}/{runtimeStatus?.meterRequestValueBudget ?? 0}</Text> | Visual: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.activeVisualMeterValueCount ?? 0}/{runtimeStatus?.visualMeterRequestValueBudget ?? 0}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Meter RX: <Text style={styles.sidebarDiagnosticsValue}>{formatPacketRate(runtimeStatus?.networkTraffic?.meterRxFramesPerSecond)} frame/s</Text> | <Text style={styles.sidebarDiagnosticsValue}>{formatByteRate(runtimeStatus?.networkTraffic?.meterRxBytesPerSecond)}</Text> | Control RX: <Text style={styles.sidebarDiagnosticsValue}>{formatPacketRate(runtimeStatus?.networkTraffic?.controlRxPacketsPerSecond)} pkt/s</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Network TX: <Text style={styles.sidebarDiagnosticsValue}>{formatPacketRate(runtimeStatus?.networkTraffic?.txPacketsPerSecond)} pkt/s</Text> | <Text style={styles.sidebarDiagnosticsValue}>{formatByteRate(runtimeStatus?.networkTraffic?.txBytesPerSecond)}</Text> | Refresh queue: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.watchedRefreshPendingCount ?? 0}/{runtimeStatus?.watchedRefreshTotalAddressCount ?? 0}</Text>
                  </Text>
                  <Text style={styles.sidebarDiagnosticsText}>
                    Commands admitted: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.commandStats?.admitted ?? 0}</Text> | Rejected: <Text style={[styles.sidebarDiagnosticsValue, { color: Number(runtimeStatus?.commandStats?.rejected || 0) > 0 ? danger : textPrimary }]}>{runtimeStatus?.commandStats?.rejected ?? 0}</Text> | Rate limited: <Text style={[styles.sidebarDiagnosticsValue, { color: Number(runtimeStatus?.commandStats?.rateLimited || 0) > 0 ? danger : textPrimary }]}>{runtimeStatus?.commandStats?.rateLimited ?? 0}</Text>
                  </Text>
                  <Text style={[styles.sidebarDiagnosticsText, { marginBottom: 5 }]}>
                    Uncovered macro triggers: <Text style={[styles.sidebarDiagnosticsValue, { color: uncoveredMacroTriggerAddresses.length > 0 ? danger : success }]}>{uncoveredMacroTriggerAddresses.length}</Text> | Cached states: <Text style={styles.sidebarDiagnosticsValue}>{runtimeStatus?.stateObservationCount ?? 0}</Text>
                  </Text>
                  <View style={styles.sidebarDiagnosticsLog}>
                    <ScrollView showsVerticalScrollIndicator={true}>
                      {diagnosticLogs.map((log, i) => (
                        <Text key={i} style={{ color: log.includes('Error') ? danger : log.includes('Rx BIN') ? '#8E8E93' : log.includes('Rx') ? success : accentPrimary, fontSize: 11, fontFamily: 'monospace', marginBottom: 2 }}>
                          {log}
                        </Text>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* UI Settings Modal */}
      <Modal visible={uiSettingsVisible} animationType="fade" transparent={true} onRequestClose={() => setUiSettingsVisible(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setUiSettingsVisible(false)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              { height: Math.min(modalCardHeight, 640), maxWidth: 860 },
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>APP SETTINGS</Text>
              <TouchableOpacity onPress={() => setUiSettingsVisible(false)}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: '#9A8E78', fontSize: 11, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 }}>
              {`App version v${appVersionLabel}`}
            </Text>

            <ScrollView
              style={[styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, { flex: 1 }]}
              contentContainerStyle={styles.settingsScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>TYPOGRAPHY</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>Font family used across workspace and modals.</Text>
                <View style={styles.settingsChipsRow}>
                  {TYPOGRAPHY_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.settingsChip, typographyKey === option.key && styles.settingsChipActive]}
                      onPress={() => setTypographyKey(option.key as UiTypographyKey)}
                    >
                      <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), typographyKey === option.key && styles.settingsChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>TEXT SIZE</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>Scales labels, buttons and value text globally.</Text>
                <View style={styles.settingsChipsRow}>
                  {TEXT_SCALE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.settingsChip, textScaleKey === option.key && styles.settingsChipActive]}
                      onPress={() => setTextScaleKey(option.key as UiTextScaleKey)}
                    >
                      <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), textScaleKey === option.key && styles.settingsChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>WORKSPACE DENSITY</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>Controls spacing and panel compactness for tablet screens.</Text>
                <View style={styles.settingsChipsRow}>
                  {DENSITY_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.settingsChip, densityKey === option.key && styles.settingsChipActive]}
                      onPress={() => setDensityKey(option.key as UiDensityKey)}
                    >
                      <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), densityKey === option.key && styles.settingsChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>TRIGGER PREVIEW</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>Rows shown in realtime meter preview when multiple channels are selected.</Text>
                <View style={styles.settingsChipsRow}>
                  {METER_PREVIEW_OPTIONS.map((count) => (
                    <TouchableOpacity
                      key={count}
                      style={[styles.settingsChip, meterPreviewRows === count && styles.settingsChipActive]}
                      onPress={() => setMeterPreviewRows(count)}
                    >
                      <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), meterPreviewRows === count && styles.settingsChipTextActive]}>
                        {count}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>METER UI RATE</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>Visual meter cadence for workspaces and selectors.</Text>
                <View style={styles.settingsChipsRow}>
                  {METER_UI_RATE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.settingsChip, meterUiRateKey === option.key && styles.settingsChipActive]}
                      onPress={() => setMeterUiRateKey(option.key)}
                    >
                      <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), meterUiRateKey === option.key && styles.settingsChipTextActive]}>
                        {`${option.label} ${Math.round(1000 / option.intervalMs)} FPS`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>ASSISTIVE UI</Text>
                <View style={styles.settingsChipsRow}>
                  <TouchableOpacity
                    style={[styles.settingsChip, showInlineGuides && styles.settingsChipActive]}
                    onPress={() => setShowInlineGuides(true)}
                  >
                    <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), showInlineGuides && styles.settingsChipTextActive]}>Guides ON</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.settingsChip, !showInlineGuides && styles.settingsChipActive]}
                    onPress={() => setShowInlineGuides(false)}
                  >
                    <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), !showInlineGuides && styles.settingsChipTextActive]}>Guides OFF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.settingsChip, showDiagnostics && styles.settingsChipActive]}
                    onPress={() => setShowDiagnostics(true)}
                  >
                    <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), showDiagnostics && styles.settingsChipTextActive]}>Diagnostics ON</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.settingsChip, !showDiagnostics && styles.settingsChipActive]}
                    onPress={() => setShowDiagnostics(false)}
                  >
                    <Text style={[...buildScaledTextStyle(styles.settingsChipText, 11), !showDiagnostics && styles.settingsChipTextActive]}>Diagnostics OFF</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>CONSOLE ROUTE</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>
                  Saved route: {ip.trim() || 'None'}. A route is only marked ready after CONNECT arms it.
                </Text>
                <View style={styles.settingsChipsRow}>
                  <TouchableOpacity style={styles.settingsChip} onPress={handleClearSavedRoute}>
                    <Text style={buildScaledTextStyle(styles.settingsChipText, 11)}>CLEAR SAVED ROUTE</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.settingsSectionCard}>
                <Text style={buildScaledTextStyle(styles.settingsSectionTitle, 12)}>DATA SAFETY</Text>
                <Text style={buildScaledTextStyle(styles.settingsSectionDescription, 11)}>
                  Always enabled. These protections cannot be disabled.
                </Text>
                {storageRecoveryRequired ? (
                  <Text style={[...buildScaledTextStyle(styles.settingsSafetyText, 11), { color: danger }]}>
                    STORAGE RECOVERY REQUIRED: AUTOMATIC WRITES ARE BLOCKED FOR THE AFFECTED SECTION
                  </Text>
                ) : null}
                <Text style={buildScaledTextStyle(styles.settingsSafetyText, 11)}>VERIFIED RECOVERABLE SAVES + VALIDATED LOCAL BACKUP</Text>
                <Text style={buildScaledTextStyle(styles.settingsSafetyText, 11)}>VERIFIED SHOW PRESET LOAD + RECOVERY SNAPSHOTS</Text>
                <Text style={buildScaledTextStyle(styles.settingsSafetyText, 11)}>NEW MACROS AND AUTOMATIONS START DISABLED; INVALID AUTOMATIONS CANNOT RUN</Text>
                <Text style={buildScaledTextStyle(styles.settingsSafetyText, 11)}>PENDING MACRO EXECUTIONS STOP ON DISCONNECT, PRESET LOAD, AND BACKGROUND</Text>
                <Text style={buildScaledTextStyle(styles.settingsSafetyText, 11)}>BEST-EFFORT FINAL SAVE WHEN THE APP MOVES TO BACKGROUND</Text>
              </View>
            </ScrollView>

            <View style={[styles.modalWindowFooter, { paddingBottom: modalBottomInset }]}>
              <View style={styles.settingsFooterButtons}>
                <TouchableOpacity style={[styles.workspaceCloseBtn, styles.modalApplyBtn, styles.settingsResetBtn]} onPress={handleResetUiSettings}>
                  <RotateCcw size={14} color={textSecondary} />
                  <Text style={buildScaledTextStyle(styles.settingsResetBtnText, 11)}>Reset defaults</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 1. Telemetry Trigger Configuration Modal */}
      <Modal visible={isTriggerModalOpen} animationType="slide" transparent={true} onRequestClose={() => setIsTriggerModalOpen(false)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setIsTriggerModalOpen(false)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              { height: modalCardHeight },
              !useStackedMacroModal && styles.modalWindowContentWide,
            ]}
          >
            <View style={styles.modalWindowHeader}>
              <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>CONFIGURE CONSOLE TRIGGER</Text>
              <TouchableOpacity onPress={() => setIsTriggerModalOpen(false)}>
                <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.modalSplitRow, useStackedMacroModal && styles.modalSplitRowStacked]}>
              {/* Left Column: Target Parameter Selector */}
              <ScrollView
                style={[styles.modalSplitColLeft, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                contentContainerStyle={styles.modalEditorPaneContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={buildScaledTextStyle(styles.modalSubLabel, 11)}>CONSOLE SIGNAL STATE SOURCE</Text>
                <TargetEditor 
                  target={triggerTarget} 
                  onChange={(nextTarget) => {
                    setTriggerTarget(nextTarget);
                    setTriggerValue(getDefaultUiValueForTarget(nextTarget));
                  }}
                  label="Inspect physical parameter state:"
                  uiFontFamily={appFontFamily}
                  uiTextScale={selectedTextScale.multiplier}
                  consoleModel={runtimeStatus?.consoleModel}
                  consoleFamily={runtimeStatus?.consoleFamily}
                  meterUiUpdateIntervalMs={meterUiUpdateIntervalMs}
                />
              </ScrollView>

              {/* Right Column: Conditions, Guide, VU Meter */}
              <ScrollView
                style={[styles.modalSplitColRight, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                contentContainerStyle={styles.modalEditorPaneContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.triggerStateHeaderRow}>
                  <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>LIVE TRIGGER STATE</Text>
                  <View
                    style={[
                      styles.triggerStateBadge,
                      triggerMatchState === true
                        ? styles.triggerStateBadgeMatched
                        : triggerMatchState === false
                          ? styles.triggerStateBadgeIdle
                          : styles.triggerStateBadgeUnknown,
                    ]}
                  >
                    <Text style={buildScaledTextStyle(styles.triggerStateBadgeText, 11)}>
                      {triggerMatchState === true ? 'MATCH' : triggerMatchState === false ? 'IDLE' : 'WAITING'}
                    </Text>
                  </View>
                </View>
                <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>TRIGGER CONDITION OPERATOR & VALUE</Text>
                <View style={styles.triggerValueRow}>
                  <View style={styles.operatorContainer}>
                    {getAllowedOperatorsForTarget(triggerTarget).map((op) => (
                      <TouchableOpacity
                        key={op}
                        style={[styles.operatorButton, triggerOperator === op && styles.operatorButtonActive]}
                        onPress={() => setTriggerOperator(op)}
                      >
                        <Text style={styles.operatorButtonText}>{op}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  
                  <View style={{ flex: 1, backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}>
                    <SmartValueEditor 
                      target={triggerTarget}
                      value={triggerValue}
                      onChange={setTriggerValue}
                    />
                  </View>
                </View>

                <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>TRIGGER EDGE MODE</Text>
                <View style={styles.toggleRowCompact}>
                  <TouchableOpacity
                    style={[styles.toggleBtnCompact, triggerEdgeMode === 'on' && styles.toggleBtnCompactActive]}
                    onPress={() => setTriggerEdgeMode('on')}
                  >
                    <Text style={styles.toggleBtnCompactText}>ON</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleBtnCompact, triggerEdgeMode === 'off' && styles.toggleBtnCompactActive]}
                    onPress={() => setTriggerEdgeMode('off')}
                  >
                    <Text style={styles.toggleBtnCompactText}>OFF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleBtnCompact, triggerEdgeMode === 'on_off' && styles.toggleBtnCompactActive]}
                    onPress={() => setTriggerEdgeMode('on_off')}
                  >
                    <Text style={styles.toggleBtnCompactText}>ON/OFF</Text>
                  </TouchableOpacity>
                </View>

                {isMeterParameter(triggerTarget?.parameter) && (
                  <View style={styles.meterTriggerPanel}>
                    <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>METER RESPONSE PROFILE</Text>
                    <View style={styles.toggleRowCompact}>
                      <TouchableOpacity
                        style={[styles.toggleBtnCompact, triggerMeterMode === 'level' && styles.toggleBtnCompactActive]}
                        onPress={() => setTriggerMeterMode('level')}
                      >
                        <Text style={styles.toggleBtnCompactText}>LEVEL</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggleBtnCompact, triggerMeterMode === 'transient' && styles.toggleBtnCompactActive]}
                        onPress={() => setTriggerMeterMode('transient')}
                      >
                        <Text style={styles.toggleBtnCompactText}>FAST</Text>
                      </TouchableOpacity>
                    </View>
                    {triggerMeterMode === 'transient' && (
                      <>
                        <View style={styles.meterTriggerTuningRow}>
                          <View style={styles.meterTriggerTuningField}>
                            <Text style={styles.meterTriggerTuningLabel}>COOLDOWN MS</Text>
                            <TextInput
                              style={[styles.modalInput, styles.meterTriggerTuningInput]}
                              value={triggerMeterCooldownMs}
                              onChangeText={setTriggerMeterCooldownMs}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.meterTriggerTuningField}>
                            <Text style={styles.meterTriggerTuningLabel}>REARM DB</Text>
                            <TextInput
                              style={[styles.modalInput, styles.meterTriggerTuningInput]}
                              value={triggerMeterRearmDb}
                              onChangeText={setTriggerMeterRearmDb}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.meterTriggerTuningField}>
                            <Text style={styles.meterTriggerTuningLabel}>DWELL MS</Text>
                            <TextInput
                              style={[styles.modalInput, styles.meterTriggerTuningInput]}
                              value={triggerMeterDwellMs}
                              onChangeText={setTriggerMeterDwellMs}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={styles.meterTriggerTuningField}>
                            <Text style={styles.meterTriggerTuningLabel}>STALE MS</Text>
                            <TextInput
                              style={[styles.modalInput, styles.meterTriggerTuningInput]}
                              value={triggerMeterStaleAfterMs}
                              onChangeText={setTriggerMeterStaleAfterMs}
                              keyboardType="numeric"
                            />
                          </View>
                        </View>
                      </>
                    )}
                  </View>
                )}

                <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>OVERLAP POLICY</Text>
                <View style={styles.toggleRowCompact}>
                  {([
                    ['drop', 'DROP'],
                    ['restart', 'RESTART'],
                    ['queue_one', 'QUEUE 1'],
                    ['concurrent', 'PARALLEL'],
                  ] as const).map(([key, label]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.toggleBtnCompact, macroOverlapStrategy === key && styles.toggleBtnCompactActive]}
                      onPress={() => setMacroOverlapStrategy(key)}
                    >
                      <Text style={styles.toggleBtnCompactText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {showInlineGuides && (
                  <View style={styles.operatorGuideGrid}>
                    <Text style={styles.operatorGuideHeader}>OPERATOR QUICK GUIDE</Text>
                    <Text style={styles.operatorGuideTextSingle}>
                      Use `==` / `!=` for boolean states. Use `&gt;` / `&lt;` for continuous values like dB, Hz or ms.
                    </Text>
                  </View>
                )}

                {/* Dynamic realtime meter preview */}
                <View style={styles.vuMeterContainer}>
                  <Text style={styles.vuMeterLabel}>
                    {triggerTarget?.parameter === 'meter_v2_gate_led' || triggerTarget?.parameter === 'meter_v2_dyn_state'
                      ? 'REAL-TIME TRIGGER STATE'
                      : 'REAL-TIME SIGNAL METER (dB)'}
                  </Text>
                  {(() => {
                    const signalEntries = getSignalMeterEntries(triggerTarget, liveSignalMeterMap);
                    if (signalEntries.length === 0) {
                      return <Text style={styles.vuMeterOfflineText}>No meter-capable targets selected yet.</Text>;
                    }

                    const hasSignalData = signalEntries.some((entry) => entry.value !== null);
                    if (!hasSignalData) {
                      return <Text style={styles.vuMeterOfflineText}>Waiting for realtime meter packets from the WING...</Text>;
                    }

                    const visibleSignalEntries = signalEntries.slice(0, meterPreviewRows);
                    const hiddenSignalCount = Math.max(0, signalEntries.length - visibleSignalEntries.length);

                    return (
                      <View style={styles.vuMeterStack}>
                        {visibleSignalEntries.map((entry) => {
                          if (entry.kind === 'state') {
                            const rawState = entry.value;
                            const stateActive = rawState !== null && rawState >= 0.5;
                            return (
                              <View key={entry.address} style={styles.vuMeterRow}>
                                <Text style={styles.vuMeterChannelLabel}>{entry.label}</Text>
                                <View style={styles.stateMeterChipTrack}>
                                  <View style={[styles.stateMeterChip, stateActive ? styles.stateMeterChipOn : styles.stateMeterChipOff]}>
                                    <Text style={styles.stateMeterChipText}>{stateActive ? 'ON' : 'OFF'}</Text>
                                  </View>
                                </View>
                                <Text style={styles.vuMeterValue}>
                                  {rawState === null || rawState === undefined || Number.isNaN(rawState)
                                    ? '--'
                                    : `${Math.round(rawState)}`}
                                </Text>
                              </View>
                            );
                          }

                          const dbVal = entry.value;
                          const normalizedDb = dbVal === null ? null : clampNumber(dbVal, METER_DB_MIN, METER_DB_MAX);
                          const barWidthPercent = normalizedDb === null
                            ? 0
                            : meterDbToFillPercent(normalizedDb);
                          const barColor = normalizedDb === null || normalizedDb <= -84
                            ? '#636366'
                            : normalizedDb > -3
                              ? danger
                            : normalizedDb > -18
                              ? '#FFCC00'
                              : normalizedDb > -42
                                ? success
                                : '#6FA07D';

                          return (
                            <View key={entry.address} style={styles.vuMeterRow}>
                              <Text style={styles.vuMeterChannelLabel}>{entry.label}</Text>
                              <View style={styles.vuMeterTrack}>
                                <View
                                  style={[
                                    styles.vuMeterFill,
                                    {
                                      width: `${Math.min(Math.max(barWidthPercent, 0), 100)}%`,
                                      backgroundColor: barColor,
                                    },
                                  ]}
                                />
                              </View>
                              <Text style={styles.vuMeterValue}>{formatDbValue(normalizedDb)}</Text>
                            </View>
                          );
                        })}
                        {hiddenSignalCount > 0 && (
                          <Text style={styles.vuMeterOverflowText}>
                            +{hiddenSignalCount} more selected channels (refine ID selection for detailed view)
                          </Text>
                        )}
                      </View>
                    );
                  })()}
                </View>
              </ScrollView>
            </View>
            <View style={[styles.modalWindowFooter, { paddingBottom: modalBottomInset }]}>
              <TouchableOpacity 
                style={[styles.workspaceSaveBtn, styles.modalApplyBtn]} 
                onPress={() => setIsTriggerModalOpen(false)}
              >
                <Text style={buildScaledTextStyle(styles.workspaceSaveBtnText, 11)}>✓ APPLY TRIGGER CONFIGURATION</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 2. Condition / Rule Editor Modal */}
      <Modal visible={expandedConditionIndex !== null} animationType="slide" transparent={true} onRequestClose={() => setExpandedConditionIndex(null)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setExpandedConditionIndex(null)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              { height: modalCardHeight },
              !useStackedMacroModal && styles.modalWindowContentWide,
            ]}
          >
            {expandedConditionIndex !== null && (() => {
              const cond = conditions[expandedConditionIndex];
              if (!cond) return null;
              return (
                <>
                  <View style={styles.modalWindowHeader}>
                    <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>EDIT RULE #{expandedConditionIndex + 1}</Text>
                    <TouchableOpacity onPress={() => setExpandedConditionIndex(null)}>
                      <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.modalSplitRow, useStackedMacroModal && styles.modalSplitRowStacked]}>
                    {/* Left Column: Target Parameter Selector */}
                    <ScrollView
                      style={[styles.modalSplitColLeft, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                      contentContainerStyle={styles.modalEditorPaneContent}
                      showsVerticalScrollIndicator={false}
                    >
                      <Text style={buildScaledTextStyle(styles.modalSubLabel, 11)}>RULE CONDITION STATE SOURCE</Text>
                      <TargetEditor 
                        target={cond.target} 
                        onChange={(newTarget) => updateConditionTarget(expandedConditionIndex, newTarget)}
                        label="Inspect state of:"
                        uiFontFamily={appFontFamily}
                        uiTextScale={selectedTextScale.multiplier}
                        consoleModel={runtimeStatus?.consoleModel}
                        consoleFamily={runtimeStatus?.consoleFamily}
                        meterUiUpdateIntervalMs={meterUiUpdateIntervalMs}
                      />
                    </ScrollView>

                    {/* Right Column: Conditions, Operator, Value */}
                    <ScrollView
                      style={[styles.modalSplitColRight, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                      contentContainerStyle={styles.modalEditorPaneContent}
                      showsVerticalScrollIndicator={false}
                    >
                      <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>COMPARATOR OPERATOR & VALUE</Text>
                      <View style={styles.triggerValueRow}>
                        <View style={styles.operatorContainer}>
                          {getAllowedOperatorsForTarget(cond.target).map((op) => (
                            <TouchableOpacity
                              key={op}
                              style={[styles.operatorButton, cond.operator === op && styles.operatorButtonActive]}
                              onPress={() => updateConditionValue(expandedConditionIndex, 'operator', op)}
                            >
                              <Text style={styles.operatorButtonText}>{op}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        
                        <View style={{ flex: 1, backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}>
                          <SmartValueEditor 
                            target={cond.target}
                            value={String(cond.value)}
                            onChange={(val) => updateConditionValue(expandedConditionIndex, 'value', val)}
                          />
                        </View>
                      </View>

                      {showInlineGuides && (
                        <View style={styles.operatorGuideGrid}>
                          <Text style={styles.operatorGuideHeader}>OPERATOR QUICK GUIDE</Text>
                          <Text style={styles.operatorGuideTextSingle}>
                            Use `==` / `!=` for boolean states. Use `&gt;` / `&lt;` for continuous values like dB, Hz or ms.
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                  <View style={[styles.modalWindowFooter, { paddingBottom: modalBottomInset }]}>
                    <TouchableOpacity 
                      style={[styles.workspaceSaveBtn, styles.modalApplyBtn]} 
                      onPress={() => setExpandedConditionIndex(null)}
                    >
                      <Text style={buildScaledTextStyle(styles.workspaceSaveBtnText, 11)}>✓ APPLY RULE CHANGES</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </SafeAreaView>
      </Modal>

      {/* 3. Action / Cue Editor Modal */}
      <Modal visible={expandedActionIndex !== null} animationType="slide" transparent={true} onRequestClose={() => setExpandedActionIndex(null)}>
        <SafeAreaView style={styles.modalBg} edges={['top', 'right', 'bottom', 'left']}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setExpandedActionIndex(null)} />
          <View
            style={[
              styles.modalWindowContent,
              uiIsCompact && styles.modalWindowContentCompact,
              !uiIsCompact && styles.modalWindowContentComfortable,
              { height: modalCardHeight },
              !useStackedMacroModal && styles.modalWindowContentWide,
            ]}
          >
            {expandedActionIndex !== null && (() => {
              const act = actions[expandedActionIndex];
              if (!act) return null;
              
              let typeLabel = 'OSC COMMAND';
              if (act.type === 'delay') typeLabel = 'SEQUENCE DELAY';
              else if (act.type === 'fade') typeLabel = 'VOLUME/LPF FADE';
              else if (act.type === 'automation_cue') typeLabel = 'AUTOMATION CUE';
              else if (act.type === 'automization_control') typeLabel = 'CONTROL SAVED AUTOMATION';

              return (
                <>
                  <View style={styles.modalWindowHeader}>
                    <Text style={buildScaledTextStyle(styles.modalWindowTitle, 16)}>EDIT CUE #{expandedActionIndex + 1}</Text>
                    <TouchableOpacity onPress={() => setExpandedActionIndex(null)}>
                      <Text style={buildScaledTextStyle(styles.modalWindowCloseBtn, 20)}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.modalSplitRow, useStackedMacroModal && styles.modalSplitRowStacked]}>
                    {/* Left Column: Target Parameter (Only if not sequence delay!) */}
                    {act.type !== 'delay' && act.type !== 'automization_control' ? (
                      <ScrollView
                        style={[styles.modalSplitColLeft, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                        contentContainerStyle={styles.modalEditorPaneContent}
                        showsVerticalScrollIndicator={false}
                      >
                        <Text style={buildScaledTextStyle(styles.modalSubLabel, 11)}>STEP TYPE: {typeLabel}</Text>
                        <TargetEditor 
                          target={act.target} 
                          onChange={(newTarget) => updateActionTarget(expandedActionIndex, newTarget)}
                          label={act.type === 'automation_cue' ? "Automation Target Parameter:" : act.type === 'fade' ? "Fade Target Parameter:" : "Target Parameter to set:"}
                          uiFontFamily={appFontFamily}
                          uiTextScale={selectedTextScale.multiplier}
                          consoleModel={runtimeStatus?.consoleModel}
                          consoleFamily={runtimeStatus?.consoleFamily}
                          meterUiUpdateIntervalMs={meterUiUpdateIntervalMs}
                        />
                      </ScrollView>
                    ) : act.type === 'automization_control' ? (
                      <ScrollView
                        style={[styles.modalSplitColLeft, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                        contentContainerStyle={styles.modalEditorPaneContent}
                        showsVerticalScrollIndicator={false}
                      >
                        <Text style={buildScaledTextStyle(styles.modalSubLabel, 11)}>STEP TYPE: {typeLabel}</Text>
                        <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>SAVED AUTOMATION</Text>
                        {automizations.length === 0 ? (
                          <View style={styles.emptySubCard}>
                            <Text style={styles.emptyStateText}>No saved automations yet.</Text>
                          </View>
                        ) : (
                          <View style={{ gap: 8 }}>
                            {automizations.map((item) => (
                              <TouchableOpacity
                                key={item.id}
                                style={[styles.settingsChip, act.automizationId === item.id && styles.settingsChipActive]}
                                onPress={() => updateActionValue(expandedActionIndex, 'automizationId', item.id)}
                              >
                                <Text style={[styles.settingsChipText, act.automizationId === item.id && styles.settingsChipTextActive]}>
                                  {item.name}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </ScrollView>
                    ) : (
                      <View style={[styles.modalSplitColLeft, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}>
                        <Text style={buildScaledTextStyle(styles.modalSubLabel, 11)}>STEP TYPE: {typeLabel}</Text>
                        <View style={styles.emptySubCard}>
                          <Text style={styles.emptyStateText}>Sequence delays only wait for elapsed time, no hardware target required.</Text>
                        </View>
                      </View>
                    )}

                    {/* Right Column: Values and Durations */}
                    <ScrollView
                      style={[styles.modalSplitColRight, styles.modalEditorPane, uiIsCompact && styles.modalEditorPaneCompact, useStackedMacroModal && styles.modalSplitColStacked]}
                      contentContainerStyle={styles.modalEditorPaneContent}
                      showsVerticalScrollIndicator={false}
                    >
                      {act.type === 'delay' ? (
                        <View>
                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>DELAY DURATION (MILLISECONDS)</Text>
                          <TextInput
                            style={styles.modalInput}
                            value={String(act.ms)}
                            onChangeText={(val) => updateActionValue(expandedActionIndex, 'ms', val)}
                            placeholder="duration in ms (e.g. 500)"
                            placeholderTextColor="#666"
                            keyboardType="numeric"
                          />
                        </View>
                      ) : act.type === 'fade' ? (
                        <View>
                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>TARGET VOLUME OR FREQUENCY VALUE</Text>
                          <View style={{ backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center', marginBottom: 15, minHeight: 45 }}>
                            <SmartValueEditor 
                              target={act.target}
                              value={String(act.endVal)}
                              onChange={(val) => updateActionValue(expandedActionIndex, 'endVal', val)}
                            />
                          </View>

                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>TRANSITION DURATION (SECONDS)</Text>
                          <TextInput
                            style={styles.modalInput}
                            value={String(act.durationSec)}
                            onChangeText={(val) => updateActionValue(expandedActionIndex, 'durationSec', val)}
                            placeholder="Seconds (e.g. 3.5)"
                            placeholderTextColor="#666"
                            keyboardType="numeric"
                          />
                        </View>
                      ) : act.type === 'automation_cue' ? (
                        <View>
                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>START VALUE</Text>
                          <View style={styles.toggleRowCompact}>
                            {(['current', 'fixed'] as const).map((mode) => (
                              <TouchableOpacity
                                key={mode}
                                style={[styles.toggleBtnCompact, (act.startMode || 'current') === mode && styles.toggleBtnCompactActive]}
                                onPress={() => updateActionValue(expandedActionIndex, 'startMode', mode)}
                              >
                                <Text style={styles.toggleBtnCompactText}>{mode === 'current' ? 'CURRENT' : 'FIXED'}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          {(act.startMode || 'current') === 'fixed' && (
                            <View style={{ backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center', marginBottom: 15, minHeight: 45 }}>
                              <SmartValueEditor
                                target={act.target}
                                value={String(act.startVal)}
                                onChange={(val) => updateActionValue(expandedActionIndex, 'startVal', val)}
                              />
                            </View>
                          )}

                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>END VALUE</Text>
                          <View style={{ backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center', marginBottom: 15, minHeight: 45 }}>
                            <SmartValueEditor
                              target={act.target}
                              value={String(act.endVal)}
                              onChange={(val) => updateActionValue(expandedActionIndex, 'endVal', val)}
                            />
                          </View>

                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>DURATION (MILLISECONDS)</Text>
                          <TextInput
                            style={styles.modalInput}
                            value={String(act.durationMs || Math.round((Number(act.durationSec) || 1) * 1000))}
                            onChangeText={(val) => updateActionValue(expandedActionIndex, 'durationMs', val)}
                            placeholder="800"
                            placeholderTextColor="#666"
                            keyboardType="numeric"
                          />

                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>CURVE</Text>
                          <View style={styles.toggleRowCompact}>
                            {([
                              ['linear', 'LINEAR'],
                              ['smooth', 'SMOOTH'],
                              ['ease_in', 'EASE IN'],
                              ['ease_out', 'EASE OUT'],
                            ] as const).map(([key, label]) => (
                              <TouchableOpacity
                                key={key}
                                style={[styles.toggleBtnCompact, (act.curve || 'linear') === key && styles.toggleBtnCompactActive]}
                                onPress={() => updateActionValue(expandedActionIndex, 'curve', key)}
                              >
                                <Text style={styles.toggleBtnCompactText}>{label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ) : act.type === 'automization_control' ? (
                        <View>
                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>ACTION</Text>
                          <View style={styles.toggleRowCompact}>
                            {([
                              ['toggle', 'TOGGLE'],
                              ['enable', 'ENABLE'],
                              ['disable', 'DISABLE'],
                            ] as const).map(([mode, label]) => (
                              <TouchableOpacity
                                key={mode}
                                style={[styles.toggleBtnCompact, (act.mode || 'toggle') === mode && styles.toggleBtnCompactActive]}
                                onPress={() => updateActionValue(expandedActionIndex, 'mode', mode)}
                              >
                                <Text style={styles.toggleBtnCompactText}>{label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <View style={styles.emptySubCard}>
                            <Text style={styles.emptyStateText}>
                              This step changes the saved automation state when the macro reaches this cue.
                            </Text>
                          </View>
                        </View>
                      ) : (
                        <View>
                          <Text style={buildScaledTextStyle(styles.modalLabel, 12)}>VALUE ARGUMENT TO SEND</Text>
                          <View style={{ backgroundColor: surface3, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center', minHeight: 45 }}>
                            <SmartValueEditor 
                              target={act.target}
                              value={String(act.valStr)}
                              onChange={(val) => updateActionValue(expandedActionIndex, 'valStr', val)}
                            />
                          </View>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                  <View style={[styles.modalWindowFooter, { paddingBottom: modalBottomInset }]}>
                    <TouchableOpacity 
                      style={[styles.workspaceSaveBtn, styles.modalApplyBtn]} 
                      onPress={() => setExpandedActionIndex(null)}
                    >
                      <Text style={buildScaledTextStyle(styles.workspaceSaveBtnText, 11)}>✓ APPLY CUE CHANGES</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </SafeAreaView>
      </Modal>
      </SafeAreaView>
    </UiTypographyContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: surface0,
  },
  scrollContainer: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    paddingTop: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 12,
  },
  sidebarBrandMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface2,
  },
  sidebarBrandImage: {
    width: '100%',
    height: '100%',
  },
  brandHeaderBlock: {
    flex: 1,
    minWidth: 0,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
  },
  title: {
    color: textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
    flexShrink: 1,
  },
  versionBadge: {
    color: textSecondary,
    backgroundColor: surface2,
    borderColor: border1,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
    overflow: 'hidden',
    flexShrink: 0,
  },
  subtitle: {
    color: textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  sidebarTopPane: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: border0,
    backgroundColor: surface0,
  },
  sidebarTopPaneComfortable: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  sidebarPrimaryNav: {
    gap: 4,
  },
  sidebarNavItem: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sidebarNavIconBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface2,
  },
  sidebarNavCopy: {
    flex: 1,
    minWidth: 0,
  },
  sidebarNavLabel: {
    color: textSecondary,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  sidebarNavMeta: {
    color: textMuted,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: 0,
  },
  sidebarUtilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  sidebarUtilityBtn: {
    width: '48%',
    flexGrow: 1,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
  },
  sidebarUtilityText: {
    color: textSecondary,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0,
  },
  sidebarTopActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  globalToolRail: {
    gap: 6,
    marginBottom: 10,
  },
  globalToolRow: {
    flexDirection: 'row',
    gap: 6,
  },
  globalToolBtn: {
    minHeight: 34,
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  globalToolBtnPrimary: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.12)',
  },
  globalToolBtnPopup: {
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  globalToolBtnActive: {
    backgroundColor: accentPrimary,
    borderColor: accentPrimary,
  },
  globalToolBtnActiveMeters: {
    borderColor: 'rgba(52, 199, 89, 0.7)',
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
  },
  globalToolBtnText: {
    color: textSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.35,
    includeFontPadding: false,
  },
  globalToolIcon: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '900',
    includeFontPadding: false,
  },
  globalToolPrimaryIcon: {
    color: accentPrimary,
  },
  globalToolIconActive: {
    color: '#111111',
  },
  globalToolBtnPrimaryText: {
    color: textPrimary,
  },
  globalToolBtnTextActiveMeters: {
    color: '#B8F7C9',
  },
  globalToolBtnTextActive: {
    color: '#111111',
  },
  sidebarTopActionBtn: {
    flex: 1,
  },
  sidebarDiagnosticsLaunchBtn: {
    borderColor: '#5E5CE6',
    backgroundColor: 'rgba(94, 92, 230, 0.13)',
  },
  sidebarGuideCard: {
    padding: 9,
    marginBottom: 10,
    borderRadius: 10,
  },
  sidebarTopCard: {
    marginBottom: 10,
  },
  manualBtn: {
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: accentPrimary,
  },
  manualBtnActive: {
    backgroundColor: accentPrimary,
  },
  manualBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  manualCard: {
    backgroundColor: '#1C2E35',
    borderColor: accentPrimary,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  manualTitle: {
    color: accentPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 12,
  },
  manualSection: {
    color: textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  manualText: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  manualBullet: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginLeft: 10,
  },
  manualHighlight: {
    color: accentPrimary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: surface2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: border1,
  },
  sectionTitle: {
    color: textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 15,
  },
  macrosHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: surface3,
    color: textPrimary,
    padding: 12,
    borderRadius: 6,
    fontSize: 13,
  },
  sidebarIpInput: {
    height: 40,
    paddingVertical: 7,
    paddingHorizontal: 12,
    fontSize: 12.5,
  },
  connectButton: {
    backgroundColor: '#315D73',
    minWidth: 102,
    height: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectedButton: {
    backgroundColor: '#663C3F',
  },
  connectButtonText: {
    color: textPrimary,
    fontWeight: '700',
    fontSize: 10.5,
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: false,
  },
  buttonText: {
    color: textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotRed: {
    backgroundColor: danger,
  },
  dotGreen: {
    backgroundColor: accentPrimary,
    shadowColor: accentPrimary,
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  dotOrange: {
    backgroundColor: '#FF9800',
    shadowColor: '#FF9800',
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  statusText: {
    color: '#999',
    fontSize: 11,
  },
  statusLogText: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  sidebarDiagnosticsInlineBtn: {
    marginTop: 8,
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  sidebarDiagnosticsInlineBtnText: {
    color: '#A6A6FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  sidebarDiagnosticsCard: {
    marginTop: 8,
    backgroundColor: surface2,
    borderRadius: 8,
    padding: 7,
    borderWidth: 1,
    borderColor: border0,
  },
  sidebarDiagnosticsTitle: {
    color: '#8C8CA0',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  sidebarDiagnosticsText: {
    color: textSecondary,
    fontSize: 11,
    marginBottom: 2,
  },
  sidebarDiagnosticsValue: {
    color: accentPrimary,
    fontWeight: '700',
  },
  sidebarDiagnosticsLog: {
    backgroundColor: '#000',
    borderRadius: 4,
    padding: 5,
    height: 74,
    marginTop: 3,
  },
  sidebarCompactStatusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sidebarCompactStatusCard: {
    flex: 1,
  },
  sidebarWorkspaceLabel: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  sidebarWorkspaceSummary: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 6,
  },
  emptyStateCard: {
    backgroundColor: surface2,
    borderRadius: 16,
    padding: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: border1,
    borderStyle: 'dashed',
  },
  emptyStateCardCompact: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
  },
  emptyStateText: {
    color: textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  macroCard: {
    backgroundColor: surface2,
    borderRadius: 16,
    padding: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: border1,
    borderLeftWidth: 4,
    borderLeftColor: accentPrimary,
  },
  macroCardDisabled: {
    opacity: 0.45,
    borderLeftColor: border2,
  },
  macroCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 15,
  },
  actionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  macroCardTitle: {
    color: textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  macroCardSub: {
    color: accentPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 5,
  },
  deleteButton: {
    padding: 5,
  },
  deleteButtonText: {
    color: danger,
    fontSize: 18,
    fontWeight: '700',
  },
  macroSummaryText: {
    color: textMuted,
    fontSize: 12,
    marginTop: 10,
    letterSpacing: 0.5,
  },
  macroRunButton: {
    backgroundColor: surface3,
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
  },
  macroRunButtonDisabled: {
    backgroundColor: surface2,
  },
  macroRunButtonText: {
    color: textPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  fab: {
    position: 'absolute',
    bottom: 25,
    right: 25,
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: accentPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: {
    color: '#121212',
    fontSize: 32,
    fontWeight: '700',
  },
  // Modal Styles
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  modalSafe: {
    width: '95%',
    height: '90%',
  },
  modalCard: {
    flex: 1,
    backgroundColor: surface2,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: border1,
  },
  utilityModalCard: {
    width: '94%',
    borderRadius: 10,
    padding: 14,
  },
  utilityModalBody: {
    marginTop: 0,
  },
  utilityModalHint: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  utilityGuideCard: {
    borderRadius: 8,
    padding: 14,
    marginBottom: 0,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  closeModalText: {
    color: textMuted,
    fontSize: 20,
    fontWeight: '700',
  },
  modalScroll: {
    flex: 1,
  },
  modalLabel: {
    color: textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 15,
    marginBottom: 8,
    letterSpacing: 1,
  },
  modalInput: {
    backgroundColor: surface3,
    color: textPrimary,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
  },
  haEndpointInput: {
    borderWidth: 1.5,
  },
  haEndpointBody: {
    padding: 16,
  },
  disclosure: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: border0,
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
  },
  disclosureCaret: {
    color: textMuted,
    fontSize: 12,
    width: 12,
    textAlign: 'center',
  },
  disclosureTitle: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  disclosureBody: {
    marginTop: 12,
    gap: 10,
  },
  haEndpointHintText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  haEndpointActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  haEndpointActionBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: border1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  haEndpointActionBtnText: {
    color: accentHa,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.35,
  },
  haEndpointActionBtnGhost: {
    flex: 0.72,
    borderColor: border1,
    backgroundColor: surface1,
  },
  haEndpointActionBtnGhostText: {
    color: textMuted,
  },
  haEndpointDiagText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  haEndpointDiagTextFirst: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: border0,
  },
  manualValueBlock: {
    borderWidth: 1.5,
    borderColor: border2,
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  manualValueLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  manualValueInput: {
    marginTop: 0,
    textAlign: 'center',
    borderWidth: 1.5,
    borderColor: accentPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  toggleBtn: {
    flex: 1,
    minWidth: 80,
    backgroundColor: surface3,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: border1,
  },
  toggleBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  toggleBtnDisabled: {
    opacity: 0.45,
    borderColor: border2,
  },
  toggleBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: false,
  },
  warningChip: {
    backgroundColor: 'rgba(255, 149, 0, 0.14)',
    borderWidth: 1,
    borderColor: '#FF9500',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  warningChipText: {
    color: '#FFD9A1',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  preflightCard: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border2,
    backgroundColor: surface1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  preflightTitle: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  preflightErrorText: {
    color: '#FF9F9A',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  preflightWarningText: {
    color: '#FFD28A',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  macroReadinessPanel: {
    backgroundColor: surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    padding: 14,
    marginBottom: 14,
  },
  macroReadinessPanelMacro: {
    borderTopWidth: 2,
    borderTopColor: accentMacro,
  },
  macroReadinessPanelAutomization: {
    borderTopWidth: 2,
    borderTopColor: accentAutomation,
  },
  macroReadinessPanelHa: {
    backgroundColor: surface1,
    borderTopWidth: 2,
    borderTopColor: accentHa,
  },
  macroReadinessHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  macroReadinessTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  macroReadinessSubtitle: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
    fontWeight: '600',
  },
  macroReadinessStatusBadge: {
    minHeight: 30,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  macroReadinessStatusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  macroReadinessGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  macroReadinessCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: surface0,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  macroReadinessLabel: {
    color: '#7E8A99',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 4,
  },
  macroReadinessValue: {
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 3,
  },
  macroReadinessDetail: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 15,
  },
  modalSectionTitle: {
    color: textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  addButtonMini: {
    backgroundColor: surface3,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  addButtonMiniText: {
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  sectionHelperText: {
    color: textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  addActionPrimaryBtn: {
    backgroundColor: 'rgba(255, 179, 87, 0.12)',
    borderWidth: 1.5,
    borderColor: accentPrimary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addActionPrimaryBtnText: {
    color: accentPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  actionPicker: {
    gap: 8,
    marginTop: 10,
  },
  actionPickerOption: {
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  actionPickerOptionTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 3,
  },
  actionPickerOptionDesc: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  builderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: surface3,
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  builderInput: {
    backgroundColor: surface2,
    color: textPrimary,
    padding: 10,
    borderRadius: 6,
    fontSize: 13,
    minWidth: 80,
  },
  opSegment: {
    flexDirection: 'row',
    backgroundColor: surface2,
    borderRadius: 6,
    padding: 2,
    gap: 2,
  },
  opSegmentBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  opSegmentBtnActive: {
    backgroundColor: accentPrimary,
  },
  opSegmentBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  removeRowBtn: {
    padding: 8,
  },
  removeRowBtnText: {
    color: danger,
    fontSize: 14,
    fontWeight: '700',
  },
  builderRowCol: {
    backgroundColor: surface3,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: border1,
  },
  typeSegment: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: surface2,
    borderRadius: 6,
    padding: 2,
    gap: 2,
  },
  typeSegmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  typeSegmentBtnActive: {
    backgroundColor: accentPrimary,
  },
  typeSegmentBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  builderRowUnitText: {
    color: textMuted,
    fontSize: 13,
    marginLeft: 5,
  },
  wizardStepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: surface2,
    borderBottomWidth: 1,
    borderBottomColor: border1,
    borderRadius: 8,
    marginBottom: 15,
  },
  wizardStepTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  wizardStepTabActive: {
    backgroundColor: surface3,
  },
  wizardStepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: surface3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wizardStepBadgeActive: {
    backgroundColor: accentPrimary,
  },
  wizardStepBadgeText: {
    color: textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  wizardStepLabel: {
    color: textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  wizardStepLabelActive: {
    color: accentPrimary,
  },
  wizardStepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: surface3,
    marginHorizontal: 8,
  },
  backBtn: {
    backgroundColor: surface3,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
  },
  backBtnText: {
    color: textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  nextBtn: {
    backgroundColor: accentPrimary,
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
  nextBtnText: {
    color: '#121212',
    fontWeight: '800',
    fontSize: 14,
  },
  emptyBuilderCard: {
    backgroundColor: surface2,
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: border1,
    borderStyle: 'dashed',
    marginVertical: 10,
  },
  emptyBuilderText: {
    color: textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  gridHelpersRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  gridHelperBtn: {
    backgroundColor: surface3,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
  },
  gridHelperBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  objectGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: surface1,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border0,
  },
  objectGridScroll: {
    maxHeight: 360,
    marginBottom: 8,
  },
  objectGridModalCard: {
    width: '92%',
    maxWidth: 980,
    maxHeight: '84%',
    backgroundColor: surface1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: border0,
    padding: 12,
  },
  objectGridModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: border0,
    paddingBottom: 8,
    marginBottom: 8,
  },
  objectGridModalTitle: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  objectGridModalFooter: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: border0,
    paddingTop: 8,
  },
  objectGridBadge: {
    backgroundColor: surface2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  objectGridBadgeActive: {
    backgroundColor: accentPrimary,
    borderColor: accentPrimary,
  },
  objectGridBadgeText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  objectGridBadgeTextActive: {
    color: '#121212',
  },
  modalFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: border1,
    paddingTop: 15,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: textMuted,
    fontWeight: '700',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: accentPrimary,
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#121212',
    fontWeight: '800',
    fontSize: 14,
  },
  wizardStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 179, 87, 0.05)',
    padding: 12,
    borderRadius: 10,
    marginTop: 25,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 87, 0.15)',
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stepBadgeText: {
    color: '#121212',
    fontSize: 13,
    fontWeight: '800',
  },
  stepTitle: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  stepSubCard: {
    backgroundColor: surface2,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: border1,
    marginBottom: 10,
  },
  targetEditorCard: {
    backgroundColor: surface2,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border1,
    marginTop: 5,
    marginBottom: 5,
  },
  targetEditorLabel: {
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 1,
  },
  modalSubLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  gridBtn: {
    backgroundColor: surface3,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '48%',
  },
  gridBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  gridBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: false,
  },
  macroScroller: {
    paddingVertical: 5,
    gap: 8,
  },
  msMacroBadgeBtn: {
    backgroundColor: surface3,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    minWidth: 100,
    alignItems: 'center',
  },
  msMacroBadgeBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  msMacroBadgeBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  devSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: border1,
  },
  devSwitchText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  customOscHintText: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 7,
    fontWeight: '600',
  },
  customOscHintTextError: {
    color: '#FF9F9A',
  },
  subCategoryScroller: {
    paddingVertical: 5,
    gap: 6,
  },
  subCatBtn: {
    backgroundColor: surface3,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
  },
  subCatBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  subCatBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  modeBtnDisabled: {
    opacity: 0.45,
    borderColor: border2,
  },
  modeBtnDesc: {
    color: '#777',
    fontSize: 11,
    lineHeight: 14,
  },
  importExportBtn: {
    backgroundColor: surface2,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
  },
  importExportBtnText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  macroActionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  macroMiniBtn: {
    backgroundColor: surface2,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    alignItems: 'center',
  },
  macroMiniBtnText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  dashboardSection: {
    paddingVertical: 18,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: border0,
    marginBottom: 22,
  },
  dashboardSectionConfig: {
    borderLeftWidth: 3,
    borderLeftColor: border2,
  },
  dashboardSectionMapping: {
    borderLeftWidth: 3,
    borderLeftColor: success,
  },
  dashboardSectionRuntime: {
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  metersOverviewPanel: {
    borderColor: border1,
    borderTopWidth: 2,
    backgroundColor: surface1,
  },
  meterToolbarRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  meterGroupDropdownBtn: {
    flex: 1,
    minWidth: 280,
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meterGroupDropdownLabel: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  meterGroupDropdownValue: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  meterHealthMiniCard: {
    minWidth: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  meterHealthMiniLabel: {
    color: textMuted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  meterHealthMiniValue: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  meterActionBtn: {
    minWidth: 118,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border2,
    backgroundColor: surface2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  meterDangerBtn: {
    borderColor: 'rgba(255, 59, 48, 0.5)',
    backgroundColor: 'rgba(255, 59, 48, 0.09)',
  },
  meterSelectionModeBtn: {
    borderColor: success,
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
  },
  meterActionBtnLabel: {
    color: textMuted,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  meterActionBtnText: {
    color: accentPrimary,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.45,
    textAlign: 'center',
  },
  meterDetailCard: {
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 10,
    padding: 12,
  },
  meterDetailActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  meterSelectionSummary: {
    minWidth: 160,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.42)',
    backgroundColor: surface1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterSelectionSummaryValue: {
    color: success,
    fontSize: 14,
    fontWeight: '900',
    includeFontPadding: false,
  },
  meterSelectionSummaryLabel: {
    color: textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
    includeFontPadding: false,
    maxWidth: 136,
    textAlign: 'center',
  },
  meterRangePresetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    maxWidth: 430,
  },
  meterRangePresetBtn: {
    minWidth: 54,
    minHeight: 32,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.34)',
    backgroundColor: surface1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  meterRangePresetBtnText: {
    color: textSecondary,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  meterNameModalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  meterGroupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  meterGroupCard: {
    width: '31.8%',
    minWidth: 220,
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border1,
    borderLeftWidth: 3,
    borderRadius: 7,
    padding: 11,
    gap: 7,
  },
  meterGroupCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meterGroupCardTitle: {
    color: textPrimary,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  meterGroupCardMeta: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  meterGroupCardValue: {
    color: success,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  dashboardSectionTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 12,
  },
  vuMeterContainer: {
    backgroundColor: surface2,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border0,
    marginTop: 15,
  },
  vuMeterLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  vuMeterTrack: {
    flex: 1,
    height: 12,
    backgroundColor: surface3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  stateMeterChipTrack: {
    flex: 1,
    height: 18,
    backgroundColor: surface3,
    borderRadius: 8,
    padding: 2,
    justifyContent: 'center',
  },
  stateMeterChip: {
    alignSelf: 'flex-start',
    minWidth: 54,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateMeterChipOn: {
    backgroundColor: 'rgba(52, 199, 89, 0.2)',
    borderColor: success,
  },
  stateMeterChipOff: {
    backgroundColor: 'rgba(99, 99, 102, 0.2)',
    borderColor: border2,
  },
  stateMeterChipText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  vuMeterFill: {
    height: '100%',
    borderRadius: 6,
  },
  vuMeterValue: {
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 0,
    minWidth: 68,
    textAlign: 'right',
  },
  vuMeterStack: {
    gap: 10,
  },
  vuMeterSelectableStack: {
    position: 'relative',
  },
  vuMeterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  vuMeterRowSelectable: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 4,
  },
  vuMeterRowSelected: {
    borderColor: 'rgba(52, 199, 89, 0.55)',
    backgroundColor: 'rgba(52, 199, 89, 0.11)',
  },
  meterSelectionDragRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: METER_ROW_DRAG_RAIL_WIDTH,
    zIndex: 10,
  },
  meterSelectionIndicator: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: border2,
    backgroundColor: surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterSelectionIndicatorSelected: {
    borderColor: success,
    backgroundColor: success,
  },
  meterSelectionIndicatorText: {
    color: surface0,
    fontSize: 14,
    fontWeight: '900',
    includeFontPadding: false,
  },
  meterSelectionIndicatorTextSelected: {
    color: surface0,
  },
  vuMeterChannelLabel: {
    width: 72,
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  vuMeterActionBtn: {
    minWidth: 58,
    minHeight: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border2,
    backgroundColor: surface3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  vuMeterActionBtnText: {
    color: textSecondary,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  vuMeterOfflineText: {
    color: '#636366',
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  vuMeterOverflowText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  inlineMeterContainer: {
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  inlineMeterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  inlineMeterMeta: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  targetPickerHeaderPanel: {
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  targetPickerHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  targetPickerEyebrow: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  targetPickerTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  targetPickerSubtitle: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  targetPickerCategoryBtn: {
    minWidth: 148,
    maxWidth: 220,
    minHeight: 42,
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  targetPickerCategoryBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  objectGridMeterBadge: {
    gap: 5,
    minHeight: 48,
  },
  objectGridMeterTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  objectGridMeterFill: {
    height: '100%',
    borderRadius: 3,
  },
  triggerStateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  triggerStateHeaderLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  triggerStateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  triggerStateBadgeMatched: {
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
    borderColor: success,
  },
  triggerStateBadgeIdle: {
    backgroundColor: 'rgba(99, 99, 102, 0.18)',
    borderColor: border2,
  },
  triggerStateBadgeUnknown: {
    backgroundColor: 'rgba(255, 204, 0, 0.12)',
    borderColor: '#FFCC00',
  },
  triggerStateBadgeText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  triggerStateCardMatched: {
    borderColor: success,
    backgroundColor: 'rgba(52, 199, 89, 0.05)',
  },
  triggerStateCardIdle: {
    borderColor: border2,
  },
  quickAddRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 15,
  },
  quickAddBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  quickAddBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dropdownSelectorBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: surface2,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: border2,
    marginTop: 4,
  },
  dropdownSelectorBtnText: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dropdownSelectorChevron: {
    color: textMuted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  colorBadge: {
    width: 10,
    height: 10,
    borderRadius: 4,
  },
  categorySelectorModalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: surface1,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: border0,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  categorySelectorModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: border0,
    paddingBottom: 15,
    marginBottom: 15,
  },
  categorySelectorModalTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.0,
  },
  categorySelectorModalCloseBtn: {
    backgroundColor: surface3,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categorySelectorModalCloseBtnText: {
    color: textMuted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  categorySelectorScrollContainer: {
    gap: 15,
  },
  categoryGroupCard: {
    backgroundColor: surface1,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: border0,
    padding: 12,
  },
  categoryGroupTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 10,
  },
  categoryGroupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryGridCardBtn: {
    width: '48%',
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryGridCardBtnText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  categoryGridCardBtnCount: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  boolSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  boolSelectorBtn: {
    flex: 1,
    backgroundColor: surface2,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: border1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boolSelectorBtnActiveOff: {
    borderColor: danger,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },
  boolSelectorBtnActiveOn: {
    borderColor: success,
    backgroundColor: 'rgba(76, 217, 100, 0.1)',
  },
  boolSelectorText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  inputWithUnitRow: {
    flexDirection: 'column',
    gap: 6,
    marginTop: 10,
  },
  builderRowLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  modalInputPremium: {
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: border1,
    borderRadius: 8,
    color: textPrimary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '700',
  },
  operatorGuideContainer: {
    gap: 8,
    marginTop: 6,
  },
  operatorGuideCard: {
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: border1,
    borderRadius: 8,
    padding: 10,
  },
  operatorGuideCardActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.05)',
  },
  operatorGuideHeaderOld: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  operatorGuideLabel: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  operatorGuideSymbol: {
    backgroundColor: surface3,
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  operatorGuideDesc: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '500',
  },
  msIntegrationGuideCard: {
    backgroundColor: surface1,
    borderWidth: 1.5,
    borderColor: border0,
    borderRadius: 12,
    padding: 15,
    marginTop: 15,
  },
  msIntegrationGuideTitle: {
    color: accentPrimary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  msIntegrationGuideSubtitle: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
    fontWeight: '500',
  },
  msStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  msStepNum: {
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '900',
    width: 18,
    height: 18,
    borderRadius: 8,
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  msStepText: {
    flex: 1,
    color: textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  msCodeBadge: {
    backgroundColor: surface2,
    color: '#FFB300',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  msIntegrationStatusBadge: {
    color: success,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 5,
    letterSpacing: 0.5,
    backgroundColor: 'rgba(76, 217, 100, 0.05)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    textAlign: 'center',
    overflow: 'hidden',
  },
  splitScreenContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: surface0,
  },
  splitScreenContainerComfortable: {
    backgroundColor: surface0,
  },
  sidebarColumn: {
    width: 304,
    borderRightWidth: 1,
    borderColor: border0,
    backgroundColor: surface0,
    flexDirection: 'column',
  },
  sidebarColumnComfortable: {
    width: 328,
  },
  sidebarListsPane: {
    flex: 1,
    paddingHorizontal: 10,
  },
  sidebarListsPaneContent: {
    paddingVertical: 10,
    gap: 8,
  },
  sidebarListsPaneContentComfortable: {
    paddingHorizontal: 2,
  },
  sidebarListSection: {
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    flexShrink: 0,
  },
  sidebarConnectionPanel: {
    borderBottomWidth: 1,
    borderBottomColor: border0,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 12,
  },
  sidebarConnectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  sidebarPanelEyebrow: {
    color: textMuted,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  sidebarConnectionBadge: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 5,
    paddingHorizontal: 8,
  },
  sidebarConnectionBadgeText: {
    color: textSecondary,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0,
  },
  sidebarConnectionDetail: {
    color: textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    marginTop: 7,
  },
  sidebarShowPanel: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 2,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: border0,
  },
  sidebarShowIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface2,
  },
  sidebarShowCopy: {
    flex: 1,
    minWidth: 0,
  },
  sidebarShowName: {
    color: textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 2,
  },
  sidebarContextPanel: {
    borderTopWidth: 2,
    paddingTop: 10,
    marginTop: 4,
  },
  sidebarContextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  sidebarContextTitle: {
    color: textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  sidebarContextEmpty: {
    color: textMuted,
    fontSize: 10.5,
    paddingVertical: 8,
  },
  sidebarMetersActiveSection: {
    borderColor: 'rgba(52, 199, 89, 0.45)',
    backgroundColor: 'rgba(52, 199, 89, 0.06)',
  },
  sidebarMetersOpenBtn: {
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
    borderColor: 'rgba(52, 199, 89, 0.4)',
  },
  sidebarMetersOpenBtnText: {
    color: '#B8F7C9',
  },
  sidebarMeterMiniGrid: {
    gap: 5,
    marginTop: 8,
  },
  sidebarMeterMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: surface2,
  },
  sidebarMeterMiniLabel: {
    color: textSecondary,
    fontSize: 10,
    fontWeight: '800',
    flex: 1,
  },
  sidebarMeterMiniValue: {
    color: success,
    fontSize: 10,
    fontWeight: '900',
    minWidth: 54,
    textAlign: 'right',
  },
  sidebarSectionMetaText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  sidebarListActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sidebarListOpenBtn: {
    minHeight: 34,
    minWidth: 96,
    borderWidth: 1.5,
    borderColor: border1,
    backgroundColor: 'transparent',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarListOpenBtnText: {
    color: '#8ED6FF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  sidebarListOpenBtnAlt: {
    borderColor: border1,
    backgroundColor: surface2,
  },
  sidebarListOpenBtnAltText: {
    color: '#FFBE70',
  },
  sidebarListOpenBtnHa: {
    borderColor: border1,
    backgroundColor: surface2,
  },
  sidebarListOpenBtnHaText: {
    color: '#E6C079',
  },
  sidebarListDivider: {
    height: 1,
    backgroundColor: surface2,
    marginHorizontal: 2,
  },
  sidebarQuickList: {
    gap: 6,
    marginTop: 2,
  },
  sidebarQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingLeft: 10,
    paddingRight: 6,
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 6,
  },
  sidebarQuickRowMuted: {
    opacity: 0.74,
  },
  sidebarQuickRowSelectable: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 8,
  },
  sidebarQuickRowMetaBlock: {
    flex: 1,
    minWidth: 0,
  },
  sidebarQuickSwitch: {
    transform: [{ scaleX: 0.76 }, { scaleY: 0.76 }],
  },
  sidebarQuickRowActive: {
    borderColor: accentMacro,
    backgroundColor: 'rgba(242, 180, 93, 0.08)',
  },
  sidebarQuickRowAlt: {
    borderColor: border0,
    backgroundColor: surface1,
  },
  sidebarQuickRowAltActive: {
    borderColor: accentAutomation,
    backgroundColor: 'rgba(85, 214, 190, 0.08)',
  },
  sidebarQuickRowHa: {
    borderColor: border0,
    backgroundColor: surface1,
  },
  sidebarQuickRowHaActive: {
    borderColor: accentHa,
    backgroundColor: 'rgba(157, 183, 255, 0.08)',
  },
  sidebarQuickDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5B5C6A',
  },
  sidebarQuickDotOn: {
    backgroundColor: accentPrimary,
  },
  sidebarQuickDotAlt: {
    backgroundColor: '#52525B',
  },
  sidebarQuickDotOnAlt: {
    backgroundColor: accentAutomation,
  },
  sidebarQuickDotHa: {
    backgroundColor: '#52525B',
  },
  sidebarQuickDotOnHa: {
    backgroundColor: accentHa,
  },
  sidebarQuickLabel: {
    flex: 1,
    minWidth: 0,
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  sidebarQuickRuntime: {
    color: '#FFCC66',
    fontSize: 10,
    fontWeight: '800',
  },
  sidebarQuickSubHa: {
    marginTop: 2,
    color: accentHa,
    fontSize: 11,
    fontWeight: '600',
  },
  sidebarQuickMoreText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 2,
    marginTop: 1,
  },
  sidebarQuickMoreTextAlt: {
    color: '#B8874F',
  },
  sidebarPreviewItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sidebarPreviewItemTitle: {
    flex: 1,
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  sidebarPreviewStatePill: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    overflow: 'hidden',
  },
  sidebarPreviewStatePillOn: {
    color: accentMacro,
    backgroundColor: 'rgba(242, 180, 93, 0.12)',
  },
  sidebarPreviewStatePillOnAlt: {
    color: accentAutomation,
    backgroundColor: 'rgba(85, 214, 190, 0.14)',
  },
  sidebarPreviewStatePillOff: {
    color: textMuted,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  sidebarPreviewItemSub: {
    marginTop: 4,
    color: '#87AEC2',
    fontSize: 11,
    fontWeight: '600',
  },
  sidebarPreviewItemSubAlt: {
    color: '#C7A173',
  },
  sidebarPreviewMoreText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 2,
  },
  sidebarPreviewMoreTextAlt: {
    color: '#B8874F',
  },
  sidebarCardLayout: {
    padding: 10,
    marginBottom: 10,
  },
  sidebarCardLayoutComfortable: {
    padding: 12,
    marginBottom: 12,
  },
  workspaceColumn: {
    flex: 1,
    backgroundColor: surface0,
  },
  workspaceHeader: {
    height: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
  },
  workspaceHeaderComfortable: {
    height: 66,
    paddingHorizontal: 22,
  },
  workspaceHeaderPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginRight: 10,
    minWidth: 0,
  },
  workspaceHeaderTitle: {
    color: textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
    flexShrink: 1,
  },
  workspaceHeaderBadge: {
    fontSize: 9.5,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 8,
    letterSpacing: 0,
    overflow: 'hidden',
  },
  workspaceHeaderShowPreset: {
    minWidth: 190,
    maxWidth: 420,
    marginLeft: 22,
    paddingLeft: 18,
    borderLeftWidth: 1,
    borderLeftColor: border1,
    justifyContent: 'center',
  },
  workspaceHeaderShowPresetLabel: {
    color: textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0,
  },
  workspaceHeaderShowPresetName: {
    color: accentPrimary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  workspaceHeaderShowPresetNameEmpty: {
    color: textSecondary,
  },
  workspaceHeaderActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  workspaceHeaderActionsCompact: {
    flexWrap: 'nowrap',
  },
  workspaceRunBtn: {
    backgroundColor: 'rgba(72, 209, 122, 0.09)',
    borderWidth: 1,
    borderColor: success,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
  },
  workspaceRunBtnText: {
    color: success,
    fontSize: 10.5,
    fontWeight: '700',
  },
  workspaceSaveBtn: {
    backgroundColor: accentPrimary,
    borderRadius: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
  },
  workspaceSaveBtnText: {
    color: '#071014',
    fontSize: 10.5,
    fontWeight: '700',
  },
  modalApplyBtn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 42,
  },
  settingsSectionCard: {
    borderBottomWidth: 1,
    borderBottomColor: border0,
    paddingVertical: 11,
    paddingHorizontal: 2,
    gap: 6,
    marginBottom: 2,
  },
  settingsSectionTitle: {
    color: textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  settingsSectionDescription: {
    color: '#9191A2',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  settingsSafetyText: {
    color: '#D9FFE5',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  settingsChipsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  settingsScrollContent: {
    paddingBottom: 18,
  },
  settingsChip: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  settingsChipActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(114, 199, 244, 0.12)',
  },
  settingsChipText: {
    color: '#A7A7AF',
    fontSize: 11,
    fontWeight: '700',
  },
  settingsChipTextActive: {
    color: accentPrimary,
    fontWeight: '800',
  },
  settingsHintCard: {
    marginTop: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
    padding: 10,
    gap: 8,
  },
  settingsPreviewCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
    padding: 10,
    gap: 5,
    marginTop: 2,
  },
  settingsPreviewTitle: {
    color: textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  settingsPreviewBody: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  settingsHintText: {
    color: '#9A9AA2',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  settingsFooterButtons: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  settingsResetBtn: {
    minWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface1,
    borderColor: border1,
    flexDirection: 'row',
    gap: 7,
  },
  settingsResetBtnText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  workspaceCloseBtn: {
    backgroundColor: surface2,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  workspaceCloseBtnText: {
    color: textSecondary,
    fontSize: 10.5,
    fontWeight: '600',
  },
  workspaceScroll: {
    flex: 1,
  },
  workspaceScrollContent: {
    padding: 20,
    paddingBottom: 48,
  },
  workspaceScrollContentComfortable: {
    padding: 24,
    paddingBottom: 56,
  },
  workspaceCreateBtnSidebar: {
    backgroundColor: 'rgba(242, 180, 93, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(242, 180, 93, 0.3)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  workspaceCreateBtnSidebarText: {
    color: accentMacro,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  workspaceCreateBtnSidebarAlt: {
    backgroundColor: 'rgba(85, 214, 190, 0.1)',
    borderColor: 'rgba(85, 214, 190, 0.4)',
  },
  workspaceCreateBtnSidebarAltText: {
    color: accentAutomation,
  },
  workspaceCreateBtnSidebarHa: {
    backgroundColor: 'rgba(157, 183, 255, 0.1)',
    borderColor: 'rgba(157, 183, 255, 0.4)',
  },
  workspaceCreateBtnSidebarHaText: {
    color: accentHa,
  },
  libraryModalCard: {
    width: '97%',
  },
  libraryModalHintText: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginBottom: 9,
  },
  libraryModalToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  libraryModalToolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  libraryModalToolbarBtn: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  searchConsoleBtn: {
    minHeight: 34,
    marginTop: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border2,
    backgroundColor: surface2,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  searchConsoleBtnText: {
    color: textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0,
  },
  presetComposerCard: {
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    padding: 12,
    marginBottom: 10,
  },
  presetTransferActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  presetNameInput: {
    flex: 0,
    minHeight: 44,
    color: textPrimary,
    borderWidth: 1,
    borderColor: border2,
  },
  presetSaveActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  presetSaveActionBtn: {
    flex: 1,
    minHeight: 42,
    marginBottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetSaveBlankBtn: {
    borderColor: border2,
    backgroundColor: surface2,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface2,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  presetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  loadedPresetBadge: {
    color: '#FFE1BA',
    backgroundColor: 'rgba(255, 179, 87, 0.12)',
    borderWidth: 1,
    borderColor: accentPrimary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 9,
    fontWeight: '900',
  },
  recoveryPresetBadge: {
    color: '#D9FFE5',
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
    borderWidth: 1,
    borderColor: success,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 9,
    fontWeight: '900',
  },
  presetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 7,
    maxWidth: '52%',
  },
  presetDeleteBtn: {
    minWidth: 0,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  libraryDuplicateBtnAlt: {
    borderColor: accentAutomation,
  },
  libraryDuplicateBtnAltText: {
    color: accentAutomation,
  },
  libraryDuplicateBtnHa: {
    borderColor: accentHa,
  },
  libraryDuplicateBtnHaText: {
    color: accentHa,
  },
  libraryEditModeBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.12)',
  },
  libraryDeleteSelectedBtn: {
    minHeight: 36,
    minWidth: 112,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: danger,
    backgroundColor: 'rgba(255, 59, 48, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  libraryDeleteSelectedBtnDisabled: {
    opacity: 0.38,
  },
  libraryDeleteSelectedBtnText: {
    color: danger,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.45,
  },
  libraryRowMarkedForDelete: {
    borderColor: danger,
    backgroundColor: 'rgba(255, 59, 48, 0.09)',
  },
  librarySelectionIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: border2,
    backgroundColor: surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  librarySelectionIndicatorActive: {
    borderColor: danger,
    backgroundColor: danger,
  },
  librarySelectionIndicatorText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  libraryModalBody: {
    flex: 1,
  },
  libraryModalBodyContent: {
    paddingBottom: 14,
  },
  libraryEmptyStateCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  libraryEmptyStateTitle: {
    color: textPrimary,
    fontSize: 12.5,
    fontWeight: '800',
  },
  libraryEmptyStateBody: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 10,
  },
  libraryEmptyCreateBtn: {
    marginBottom: 0,
    alignSelf: 'flex-start',
  },
  libraryRowOpenHint: {
    color: accentMacro,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.65,
    backgroundColor: 'rgba(242, 180, 93, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(242, 180, 93, 0.28)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  libraryRowOpenHintAlt: {
    color: accentAutomation,
    backgroundColor: 'rgba(85, 214, 190, 0.1)',
    borderColor: 'rgba(85, 214, 190, 0.3)',
  },
  libraryRowOpenHintHa: {
    color: accentHa,
    backgroundColor: 'rgba(157, 183, 255, 0.1)',
    borderColor: 'rgba(157, 183, 255, 0.32)',
  },
  sidebarMacroCard: {
    backgroundColor: surface1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: border0,
  },
  sidebarMacroCardDisabled: {
    opacity: 0.55,
  },
  sidebarMacroCardActive: {
    borderColor: accentMacro,
    backgroundColor: surface2,
  },
  sidebarAutomationCard: {
    backgroundColor: surface1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: border0,
  },
  sidebarAutomationCardDisabled: {
    opacity: 0.55,
  },
  sidebarAutomationCardActive: {
    borderColor: accentAutomation,
    backgroundColor: surface2,
  },
  sidebarAutomationCardTitle: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  sidebarAutomationCardSub: {
    color: accentAutomation,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  sidebarHaCardSub: {
    color: accentHa,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  sidebarAutomationCardSummary: {
    color: accentAutomation,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    backgroundColor: 'rgba(85, 214, 190, 0.08)',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  sidebarHaCardSummary: {
    color: accentHa,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  automizationCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  automizationCounterBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: accentAutomation,
    backgroundColor: 'rgba(85, 214, 190, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  automizationCounterBtnText: {
    color: accentAutomation,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 19,
  },
  automizationCounterValue: {
    minWidth: 44,
    textAlign: 'center',
    color: textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  automizationGuideText: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  haGuideText: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  eventLogRow: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  sidebarMacroCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sidebarMacroCardTitle: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  sidebarMacroCardSub: {
    color: textMuted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  sidebarMacroCardSummary: {
    color: accentAutomation,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    backgroundColor: 'rgba(255, 179, 87, 0.05)',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  sidebarMacroCardActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  sidebarMacroMiniBtn: {
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  sidebarMacroMiniBtnText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  sidebarMacroRunBtn: {
    backgroundColor: accentPrimary,
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarMacroRunBtnText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
  },
  emptyWorkspace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    backgroundColor: surface0,
  },
  emptyWorkspaceIcon: {
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 16,
    color: accentPrimary,
  },
  emptyWorkspaceTitle: {
    color: textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyWorkspaceSubtitle: {
    color: textMuted,
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 420,
    marginBottom: 20,
    fontWeight: '500',
  },
  workspaceCreateBtn: {
    backgroundColor: accentPrimary,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  workspaceCreateBtnAlt: {
    marginTop: 8,
    backgroundColor: 'rgba(85, 214, 190, 0.12)',
    borderWidth: 1,
    borderColor: accentAutomation,
  },
  workspaceSecondaryBtn: {
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    marginBottom: 10,
  },
  workspaceSecondaryBtnText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  controlHeroCard: {
    paddingBottom: 16,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: border0,
  },
  controlHeroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  controlHeroTopRowStacked: {
    flexDirection: 'column',
  },
  controlHeroCopyBlock: {
    flex: 1,
    minWidth: 0,
  },
  controlHeroEyebrow: {
    color: accentPrimary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 5,
  },
  controlHeroTitle: {
    color: textPrimary,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    maxWidth: 720,
    marginBottom: 5,
  },
  controlHeroBody: {
    color: textSecondary,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '500',
    maxWidth: 760,
  },
  controlStatusStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  controlStatusPill: {
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  controlStatusPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0,
  },
  controlHeroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  controlHeroPrimaryBtn: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: accentPrimary,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlHeroPrimaryBtnText: {
    color: '#041017',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  controlHeroSecondaryBtn: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: border1,
    backgroundColor: surface1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlHeroSecondaryBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  overviewFocusRail: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 12,
    padding: 4,
    borderRadius: 7,
    backgroundColor: surface1,
  },
  overviewFocusBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  overviewFocusLabel: {
    color: textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  overviewFocusCount: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    includeFontPadding: false,
  },
  overviewMonitorPanel: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(9, 9, 17, 0.52)',
    padding: 12,
  },
  overviewMonitorHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  overviewMonitorEyebrow: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  overviewMonitorTitle: {
    color: textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  overviewMonitorCount: {
    fontSize: 11,
    fontWeight: '900',
  },
  overviewMonitorList: {
    gap: 8,
  },
  overviewMonitorRow: {
    minHeight: 70,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    padding: 10,
  },
  overviewMonitorStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 9,
  },
  overviewMonitorRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  overviewMonitorRowTitle: {
    color: textPrimary,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '900',
  },
  overviewMonitorStatusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
  },
  overviewMonitorDetail: {
    color: textSecondary,
    fontSize: 11.2,
    fontWeight: '700',
    marginBottom: 3,
  },
  overviewMonitorMeta: {
    color: textMuted,
    fontSize: 10.5,
    fontWeight: '700',
  },
  overviewMonitorEmpty: {
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
  },
  controlOverviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  controlOverviewCard: {
    flex: 1,
    minWidth: 160,
    borderRadius: 7,
    borderWidth: 1,
    padding: 11,
    gap: 4,
  },
  controlOverviewCardTitle: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  controlOverviewCardValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  controlOverviewCardSub: {
    color: '#94A0B0',
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '600',
  },
  controlStatusBanner: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#253344',
    backgroundColor: '#121923',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  controlStatusBannerLabel: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  controlStatusBannerText: {
    color: textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 16,
  },
  controlModuleGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  controlModuleCard: {
    flex: 1,
    minWidth: 220,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border1,
    borderLeftWidth: 3,
    backgroundColor: surface1,
    padding: 14,
  },
  controlModuleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  controlModuleTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  controlModuleSubtitle: {
    color: textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  controlModuleMetaPill: {
    fontSize: 9.5,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    overflow: 'hidden',
  },
  controlModulePreviewList: {
    gap: 8,
    marginBottom: 14,
  },
  controlModulePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: border0,
    backgroundColor: surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  controlModulePreviewDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  controlModulePreviewTitle: {
    color: textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  controlModulePreviewSub: {
    color: '#8EA0B0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  controlModuleActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  controlModulePrimaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 6,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
  },
  controlModulePrimaryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  controlModuleSecondaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border1,
    backgroundColor: surface1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
  },
  controlModuleSecondaryBtnText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  controlModuleEmptyCard: {
    paddingVertical: 8,
    marginBottom: 14,
  },
  controlModuleEmptyText: {
    color: '#7F90A2',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  workspaceCreateBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  workspaceCreateBtnAltText: {
    color: '#FF9500',
  },
  triggerValueRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  operatorContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  operatorButton: {
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: border1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 44,
    alignItems: 'center',
  },
  operatorButtonActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  operatorButtonText: {
    color: textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  operatorGuideGrid: {
    marginTop: 12,
    backgroundColor: surface1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border0,
  },
  operatorGuideHeader: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  operatorGuideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  operatorGuideBadge: {
    backgroundColor: surface2,
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  operatorGuideText: {
    color: textMuted,
    fontSize: 11,
    flex: 1,
    lineHeight: 12,
    fontWeight: '500',
  },
  operatorGuideTextSingle: {
    color: textMuted,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '500',
  },
  meterTriggerPanel: {
    marginTop: 12,
    paddingTop: 2,
  },
  meterTriggerTuningRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  meterTriggerTuningField: {
    flex: 1,
    minWidth: 108,
  },
  meterTriggerTuningLabel: {
    color: textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  meterTriggerTuningInput: {
    minHeight: 40,
    paddingVertical: 8,
    textAlign: 'center',
  },
  selectionSummaryRow: {
    marginTop: 6,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectionSummaryText: {
    flex: 1,
    color: textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  selectionHintText: {
    color: '#5D6B7B',
    fontSize: 11,
    marginBottom: 8,
  },
  gridToggleBtn: {
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: accentPrimary,
    borderRadius: 10,
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridToggleBtnText: {
    color: accentPrimary,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  rowJustified: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleRowCompact: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  toggleBtnCompact: {
    flex: 1,
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: border1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  toggleBtnCompactActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  toggleBtnCompactText: {
    color: textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  toggleBtnCompactActiveText: {
    color: accentPrimary,
  },
  emptySubCard: {
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border0,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  conditionCard: {
    backgroundColor: surface2,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  conditionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    backgroundColor: surface1,
  },
  conditionCardHeaderTitle: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  conditionCardBody: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: border1,
  },
  operatorContainerSmall: {
    flexDirection: 'row',
    gap: 4,
  },
  operatorButtonSmall: {
    backgroundColor: surface1,
    borderWidth: 1,
    borderColor: border1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 32,
    alignItems: 'center',
  },
  operatorButtonSmallActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  operatorButtonSmallText: {
    color: textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  timelineExpandIcon: {
    color: accentPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  cueNumberBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: textPrimary,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timelineCard: {
    backgroundColor: surface1,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: border0,
  },
  timelineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  timelineCardHeaderTitle: {
    color: textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
    marginLeft: 8,
  },
  timelineCardBody: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: border0,
    marginTop: 10,
  },
  cardToolBtn: {
    minHeight: 42,
    minWidth: 72,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  cardToolBtnText: {
    color: textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  cardDeleteBtn: {
    minHeight: 42,
    minWidth: 84,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 59, 48, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  cardDeleteBtnText: {
    color: danger,
    fontSize: 12,
    fontWeight: '900',
  },
  bankSelectorScroller: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 8,
  },
  bankBtn: {
    backgroundColor: surface2,
    borderWidth: 1.5,
    borderColor: border1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 90,
  },
  bankBtnActive: {
    borderColor: accentPrimary,
    backgroundColor: 'rgba(255, 179, 87, 0.1)',
  },
  bankBtnText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  bankBtnTextActive: {
    color: accentPrimary,
    fontWeight: '800',
  },
  sidebarFooter: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1.5,
    borderColor: border0,
    backgroundColor: surface0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sidebarFooterStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sidebarFooterStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 4,
  },
  sidebarFooterStatusText: {
    color: textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalWindowContent: {
    width: '96%',
    backgroundColor: surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: border2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  modalWindowContentCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalWindowContentComfortable: {
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalWindowContentWide: {
    maxWidth: 1480,
  },
  modalWindowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: border0,
    paddingBottom: 10,
    marginBottom: 12,
  },
  modalWindowTitle: {
    color: textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  modalWindowCloseBtn: {
    color: textPrimary,
    fontSize: 20,
    fontWeight: '700',
    padding: 4,
  },
  modalWindowBody: {
    flexGrow: 0,
    marginBottom: 15,
  },
  modalWindowFooter: {
    borderTopWidth: 1,
    borderTopColor: border0,
    paddingTop: 8,
    marginTop: 8,
    alignItems: 'center',
    flexShrink: 0,
  },
  modalSplitRow: {
    flexDirection: 'row',
    gap: 16,
    flex: 1,
    minHeight: 0,
    alignItems: 'stretch',
  },
  modalSplitRowStacked: {
    flexDirection: 'column',
    gap: 10,
  },
  modalSplitColLeft: {
    flex: 1.3,
    minHeight: 0,
  },
  modalSplitColRight: {
    flex: 1,
    minHeight: 0,
  },
  modalSplitColStacked: {
    flex: 1,
    minHeight: 0,
  },
  modalEditorPane: {
    backgroundColor: surface0,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: border0,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalEditorPaneCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalEditorPaneContent: {
    paddingBottom: 10,
  },
});
