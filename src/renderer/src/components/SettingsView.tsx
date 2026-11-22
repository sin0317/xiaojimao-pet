import { useEffect, useMemo, useState } from "react";
import type { DragEvent, JSX, ReactNode } from "react";
import { i18n, LANGUAGE_OPTIONS, resolveLanguage } from "../../../shared/i18n";
import { todayKey } from "../../../shared/constants";
import { CREDIT_AGENT_LABELS, creditDaysLeft } from "../../../shared/credits";
import {
  hasRequiredCustomPetAssets,
  PET_STATE_ORDER,
  petAppearanceOptions,
  REQUIRED_CUSTOM_PET_STATES,
  resolveBuiltInPetAppearanceId,
  resolvePetAppearanceId
} from "../../../shared/petAppearances";
import type {
  AgentDiagnostics,
  AgentHookTarget,
  BuiltInPetAppearanceId,
  CreditAgentId,
  CreditAlert,
  CustomPetAppearance,
  CustomPetAsset,
  DemoTrigger,
  Diagnostics,
  PetState,
  Settings,
  UpdateCheckResult,
  WbSwitchSnapshot,
  WorkBuddyLinkStatus
} from "../../../shared/types";
import { getPetAsset } from "../assets";
import { distractionHelp, formatDistractionState, formatTimer, formatTimestamp, localeFor } from "../format";
import { useNow, useSnapshot } from "../hooks";

type SettingsCopy = ReturnType<typeof i18n>["settings"];

/** 支持的 agent 顺序固定，首次加载还没拿到快照时用占位状态 */
const AGENT_SLOTS: Array<{ id: AgentHookTarget; label: string }> = [
  { id: "workbuddy", label: "WorkBuddy" },
  { id: "qoder", label: "Qoder" },
  { id: "qoderCn", label: "Qoder CN" },
  { id: "trae", label: "Trae" }
];

function Row({
  label,
  hint,
  control
}: {
  label: string;
  hint?: string;
  control: JSX.Element;
}): JSX.Element {
  return (
    <div className="pref-row">
      <div className="pref-row__label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="pref-row__control">{control}</div>
    </div>
  );
}

function ToggleControl({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`pref-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="pref-toggle__thumb" />
    </button>
  );
}

function NumberControl({
  value,
  min,
  max,
  unit,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (next: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commitDraft(raw: string): void {
    const next = Number(raw);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }

    const normalized = Math.min(max, Math.max(min, Math.round(next)));
    setDraft(String(normalized));
    onChange(normalized);
  }

  function step(next: number): void {
    const normalized = Math.min(max, Math.max(min, next));
    setDraft(String(normalized));
    onChange(normalized);
  }

  return (
    <div className="pref-stepper">
      <button
        type="button"
        className="pref-stepper__btn"
        aria-label="−"
        disabled={value <= min}
        onClick={() => step(value - 1)}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);

          const next = Number(nextDraft);
          if (Number.isFinite(next) && next >= min && next <= max) {
            onChange(Math.round(next));
          }
        }}
        onBlur={() => commitDraft(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <span className="pref-stepper__unit">{unit}</span>
      <button
        type="button"
        className="pref-stepper__btn"
        aria-label="+"
        disabled={value >= max}
        onClick={() => step(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function SelectControl({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <select className="pref-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TimeControl({
  value,
  onChange
}: {
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  return (
    <input
      className="pref-time"
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value || value)}
    />
  );
}

function DecimalControl({
  value,
  min,
  max,
  step,
  unit,
  onChange
}: {
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  function commit(raw: string): void {
    const text = raw.trim();
    if (!text) {
      onChange(null);
      return;
    }
    const next = Number(text);
    if (!Number.isFinite(next)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, next));
    setDraft(String(clamped));
    onChange(clamped);
  }

  return (
    <div className="pref-stepper pref-stepper--number">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span className="pref-stepper__unit">{unit}</span>
      <button
        type="button"
        className="pref-stepper__btn"
        aria-label="−"
        onClick={() => {
          const base = value ?? min;
          const next = Math.max(min, Number((base - step).toFixed(2)));
          setDraft(String(next));
          onChange(next);
        }}
      >
        −
      </button>
      <button
        type="button"
        className="pref-stepper__btn"
        aria-label="+"
        onClick={() => {
          const base = value ?? min;
          const next = Math.min(max, Number((base + step).toFixed(2)));
          setDraft(String(next));
          onChange(next);
        }}
      >
        +
      </button>
    </div>
  );
}

function WorkDaysControl({
  value,
  labels,
  onChange
}: {
  value: number[];
  labels: SettingsCopy;
  onChange: (next: number[]) => void;
}): JSX.Element {
  return (
    <div className="pref-workdays">
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            className={`pref-workday${active ? " is-on" : ""}`}
            onClick={() => {
              const next = active
                ? value.filter((item) => item !== day)
                : [...value, day].sort((a, b) => a - b);
              if (next.length) onChange(next);
            }}
          >
            {labels.workDayShort[day - 1]}
          </button>
        );
      })}
    </div>
  );
}

function ChipsControl({
  value,
  onChange,
  labels
}: {
  value: string[];
  onChange: (next: string[]) => void;
  labels: SettingsCopy;
}): JSX.Element {
  const [draft, setDraft] = useState("");

  function commit(raw: string): void {
    const trimmed = raw.trim().replace(/,$/, "").trim();
    if (!trimmed) return;
    if (value.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  }

  return (
    <div className="pref-chips">
      <div className="pref-chips__list">
        {value.map((entry) => (
          <span key={entry} className="pref-chip">
            {entry}
            <button
              type="button"
              aria-label={labels.removeListItem(entry)}
              onClick={() => onChange(value.filter((item) => item !== entry))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="pref-chips__input"
          placeholder={labels.addListItem}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            if (next.endsWith(",")) commit(next);
            else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
            }
            if (event.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit
}: {
  label: string;
  value: number;
  unit?: string;
}): JSX.Element {
  return (
    <div className="stat-card">
      <span className="stat-card__label">{label}</span>
      <strong className="stat-card__value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </strong>
    </div>
  );
}

function formatUpdateStatus(updateCheck: UpdateCheckResult, labels: SettingsCopy): string {
  if (updateCheck.status === "checking") return labels.updateChecking;
  if (updateCheck.status === "available" && updateCheck.latestVersion) {
    return labels.updateAvailable(updateCheck.latestVersion);
  }
  if (updateCheck.status === "up-to-date") {
    return labels.updateCurrent(updateCheck.currentVersion);
  }
  if (updateCheck.status === "error") {
    return labels.updateError(updateCheck.error ?? labels.none);
  }
  return labels.updateIdle;
}

function updateCustomPetAsset(
  customPetAppearance: CustomPetAppearance | null,
  state: PetState,
  asset: CustomPetAsset,
  name: string
): CustomPetAppearance {
  return {
    name: customPetAppearance?.name ?? name,
    assets: {
      ...customPetAppearance?.assets,
      [state]: asset
    }
  };
}

function removeCustomPetState(
  customPetAppearance: CustomPetAppearance | null,
  state: PetState,
  name: string
): CustomPetAppearance | null {
  if (!customPetAppearance) return null;
  const { [state]: _removed, ...assets } = customPetAppearance.assets;
  if (Object.keys(assets).length === 0) return null;
  return {
    name: customPetAppearance.name || name,
    assets
  };
}

function customPetStateKind(state: PetState, labels: SettingsCopy): string {
  return REQUIRED_CUSTOM_PET_STATES.includes(state)
    ? labels.customPetRequired
    : labels.customPetOptional;
}

function customPetStateKindClass(state: PetState): string {
  return REQUIRED_CUSTOM_PET_STATES.includes(state) ? " is-required" : "";
}

function formatShortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function LinkRow({
  status,
  labels,
  onStart,
  onRefresh,
  onClear
}: {
  status: WorkBuddyLinkStatus | null;
  labels: SettingsCopy;
  onStart: () => void;
  onRefresh: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="credit-link">
      <button
        type="button"
        className="pref-button"
        disabled={status?.state === "waiting"}
        onClick={onStart}
      >
        {formatLinkAction(status, labels)}
      </button>
      {status?.state === "success" ? (
        <button type="button" className="pref-link" onClick={onRefresh}>
          {labels.creditLinkRelink}
        </button>
      ) : null}
      {status && status.state !== "idle" ? (
        <button type="button" className="pref-link" onClick={onClear}>
          {labels.creditLinkDisconnect}
        </button>
      ) : null}
      <span className="credit-link__status">{formatLinkStatus(status, labels)}</span>
    </div>
  );
}

function formatLinkAction(status: WorkBuddyLinkStatus | null, labels: SettingsCopy): string {
  if (status?.state === "waiting") return labels.creditLinkWaiting;
  return status?.state === "success" ? labels.creditLinkRelink : labels.creditLink;
}

function formatLinkStatus(status: WorkBuddyLinkStatus | null, labels: SettingsCopy): string {
  if (!status) return "";
  if (status.state === "waiting") return labels.creditLinkHint;
  if (status.state === "error") return status.message;
  if (status.state === "idle") return status.message;
  const parts: string[] = [];
  if (status.nickname) parts.push(labels.creditLinkConnected(status.nickname));
  if (status.balance !== null) parts.push(`${status.balance}`);
  if (status.updatedAt) {
    parts.push(
      labels.creditLinkSyncedAt(
        new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(
          new Date(status.updatedAt)
        )
      )
    );
  }
  return parts.join(" · ");
}

function CreditRow({
  agentLabel,
  alert,
  labels,
  onChange
}: {
  agentLabel: string;
  alert: CreditAlert;
  labels: SettingsCopy;
  onChange: (patch: Partial<CreditAlert>) => void;
}): JSX.Element {
  const days = creditDaysLeft(alert, new Date());
  const soon = alert.enabled && days !== null && days >= 0 && days <= 3;
  const status = !alert.enabled
    ? labels.creditOff
    : days === null
      ? labels.creditNoDate
      : days < 0
        ? labels.creditExpired
        : days === 0
          ? labels.creditDueToday
          : labels.creditDaysLeft(days);

  return (
    <div className="credit-row">
      <div className="credit-row__head">
        <span className="credit-row__name">{agentLabel}</span>
        <span className={`credit-row__status${soon ? " is-soon" : ""}`}>{status}</span>
        <ToggleControl
          checked={alert.enabled}
          onChange={(enabled) => onChange({ enabled })}
          ariaLabel={agentLabel}
        />
      </div>
      <div className="credit-row__fields">
        <label className="credit-field">
          <span>{labels.creditBalance}</span>
          <input
            className="pref-time credit-field__num"
            type="number"
            min={0}
            step={10}
            placeholder="—"
            value={alert.balance ?? ""}
            onChange={(event) =>
              onChange({ balance: event.target.value === "" ? null : Number(event.target.value) })
            }
          />
        </label>
        <label className="credit-field">
          <span>{labels.creditExpiresOn}</span>
          <input
            className="pref-time"
            type="date"
            value={alert.expiresOn ?? ""}
            onChange={(event) => onChange({ expiresOn: event.target.value || null })}
          />
        </label>
        <label className="credit-field">
          <span>{labels.creditResetDay}</span>
          <input
            className="pref-time credit-field__num"
            type="number"
            min={1}
            max={31}
            placeholder="几号"
            value={alert.resetDay ?? ""}
            onChange={(event) =>
              onChange({ resetDay: event.target.value === "" ? null : Number(event.target.value) })
            }
          />
        </label>
        <label className="credit-field">
          <span>{labels.creditRemindDays}</span>
          <input
            className="pref-time credit-field__num"
            type="number"
            min={0}
            max={30}
            value={alert.remindDays}
            onChange={(event) => onChange({ remindDays: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function customPetAssetPreviewSrc(asset: CustomPetAsset): string {
  return new URL(window.pawpal.assetUrl(asset.relativePath)).href;
}

/** 诊断页：agent 最近一条事件有多久了 */
function diagAgo(ts: number, labels: SettingsCopy): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return labels.diagJustNow;
  if (diff < 3_600_000) return labels.diagMinutesAgo(Math.round(diff / 60_000));
  return labels.diagHoursAgo(Math.round(diff / 3_600_000));
}

/** 「装没装 / 有没有事件」必须一眼分得开，这是排障的关键 */
function formatAgentDiag(item: AgentDiagnostics, labels: SettingsCopy): string {
  const parts: string[] = [];

  if (item.installed) {
    parts.push(item.id === "dsh" ? labels.diagPluginInstalled : labels.workBuddyInstalled);
  } else if (item.detected) {
    parts.push(labels.workBuddyNotInstalled);
  } else {
    return labels.none;
  }

  if (item.installed && !item.scriptExists) parts.push(labels.diagMissingFile);
  if (item.error) parts.push(item.error);

  if (item.lastEventAt) {
    parts.push(
      `${item.lastEventName ?? ""} ${diagAgo(item.lastEventAt, labels)}`.trim()
    );
  } else {
    parts.push(labels.diagNoEvent);
  }
  if (item.eventsThisRun > 0) parts.push(labels.diagEventCount(item.eventsThisRun));

  return parts.join(" · ");
}

export function SettingsView(): JSX.Element {
  const snapshot = useSnapshot();
  const { settings, stats, updateCheck } = snapshot;
  const [draft, setDraft] = useState(settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [customEditorOpen, setCustomEditorOpen] = useState(settings.petAppearanceId === "custom");
  const [workBuddyBusy, setWorkBuddyBusy] = useState<AgentHookTarget | null>(null);
  const [agentDiag, setAgentDiag] = useState<Diagnostics | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);
  const [linkStatuses, setLinkStatuses] = useState<Record<CreditAgentId, WorkBuddyLinkStatus | null>>(
    { workbuddy: null, qoder: null, trae: null }
  );
  const [wbSwitch, setWbSwitch] = useState<WbSwitchSnapshot | null>(null);
  const [wbBusy, setWbBusy] = useState(false);
  const [redetecting, setRedetecting] = useState(false);

  async function redetectAgents(): Promise<void> {
    setRedetecting(true);
    try {
      await window.pawpal.redetectAgents();
    } finally {
      setRedetecting(false);
    }
  }

  useEffect(() => {
    void window.pawpal.getWbSwitchStatus().then(setWbSwitch);
  }, []);

  async function syncWbSwitchAccounts(): Promise<void> {
    setWbBusy(true);
    try {
      setWbSwitch(await window.pawpal.syncWbSwitch());
    } finally {
      setWbBusy(false);
    }
  }

  useEffect(() => {
    void window.pawpal.getWorkBuddyLinkStatus().then((status) => {
      setLinkStatuses((current) => ({ ...current, workbuddy: status }));
    });
    void window.pawpal.getQoderLinkStatus().then((status) => {
      setLinkStatuses((current) => ({ ...current, qoder: status }));
    });
  }, []);

  useEffect(() => {
    const waiting = (["workbuddy", "qoder"] as const).filter(
      (agent) => linkStatuses[agent]?.state === "waiting"
    );
    if (!waiting.length) return;

    const timer = window.setInterval(() => {
      for (const agent of waiting) {
        const fetchStatus =
          agent === "workbuddy"
            ? window.pawpal.getWorkBuddyLinkStatus()
            : window.pawpal.getQoderLinkStatus();
        void fetchStatus.then((status) => {
          setLinkStatuses((current) => ({ ...current, [agent]: status }));
        });
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [linkStatuses.workbuddy?.state, linkStatuses.qoder?.state]);

  async function startCreditLink(agent: CreditAgentId): Promise<void> {
    const call =
      agent === "workbuddy"
        ? window.pawpal.startWorkBuddyLink()
        : agent === "qoder"
          ? window.pawpal.startQoderLink()
          : null;
    if (!call) return;
    await call;
    const status =
      agent === "workbuddy"
        ? await window.pawpal.getWorkBuddyLinkStatus()
        : await window.pawpal.getQoderLinkStatus();
    setLinkStatuses((current) => ({ ...current, [agent]: status }));
  }

  async function refreshCreditLink(agent: CreditAgentId): Promise<void> {
    const status =
      agent === "workbuddy"
        ? await window.pawpal.refreshWorkBuddyLink()
        : await window.pawpal.refreshQoderLink();
    setLinkStatuses((current) => ({ ...current, [agent]: status }));
  }

  async function clearCreditLink(agent: CreditAgentId): Promise<void> {
    const status =
      agent === "workbuddy"
        ? await window.pawpal.clearWorkBuddyLink()
        : await window.pawpal.clearQoderLink();
    setLinkStatuses((current) => ({ ...current, [agent]: status }));
  }

  useEffect(() => {
    if (!diagnosticsOpen) return;
    let cancelled = false;
    void window.pawpal.getDiagnostics().then((next) => {
      if (!cancelled) setAgentDiag(next);
    });
    return () => {
      cancelled = true;
    };
  }, [diagnosticsOpen]);

  async function refreshAgentDiagnostics(): Promise<void> {
    setAgentDiag(await window.pawpal.getDiagnostics());
  }

  async function copyDiagnosticsText(): Promise<void> {
    const data = agentDiag ?? (await window.pawpal.getDiagnostics());
    setAgentDiag(data);
    const lines = [
      `XiaoJiMao Pet ${data.version} (${data.platform} ${data.arch})`,
      `eventDir: ${data.eventDir}`,
      ...data.agents.map((item) => `- ${item.label}: ${formatAgentDiag(item, labels)}`)
    ];
    await window.pawpal.writeClipboard(lines.join("\n"));
    setDiagCopied(true);
    setTimeout(() => setDiagCopied(false), 2000);
  }
  const [workBuddyError, setWorkBuddyError] = useState<string | null>(null);
  const now = useNow();
  const savedSettingsKey = JSON.stringify(settings);
  const language = resolveLanguage(draft.language);
  const labels = i18n(language).settings;
  const customPetReady = hasRequiredCustomPetAssets(draft.customPetAppearance);
  const integrations = AGENT_SLOTS.map(
    (slot) =>
      snapshot.workBuddyIntegrations.find((item) => item.id === slot.id) ?? {
        id: slot.id,
        label: slot.label,
        settingsPath: "",
        scriptPath: "",
        eventDir: "",
        installed: false,
        detected: false,
        error: null,
        checkedAt: 0
      }
  );
  const eventDir = snapshot.workBuddyIntegrations[0]?.eventDir ?? "";

  const petAvatar = useMemo(
    () =>
      getPetAsset(
        resolvePetAppearanceId(draft.petAppearanceId),
        "happy",
        0,
        0,
        draft.customPetAppearance
      ),
    [draft.customPetAppearance, draft.petAppearanceId]
  );

  useEffect(() => {
    // 快照每秒都会重建 settings 对象，正在编辑时绝不能覆盖草稿——否则打一个字就被抹掉
    if (settingsDirty) return;
    setDraft(settings);
    if (settings.petAppearanceId === "custom") setCustomEditorOpen(true);
  }, [savedSettingsKey, settingsDirty, settings]);

  useEffect(() => {
    if (!settingsDirty) return;
    const timer = window.setTimeout(() => {
      window.pawpal.updateSettings(draft);
      setSettingsDirty(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, settingsDirty]);

  function updateDraft(partial: Partial<Settings>): void {
    setDraft((current) => ({ ...current, ...partial }));
    setSettingsDirty(true);
  }

  async function checkForUpdates(): Promise<void> {
    await window.pawpal.checkForUpdates();
  }

  async function connectWorkBuddy(target: AgentHookTarget): Promise<void> {
    setWorkBuddyBusy(target);
    setWorkBuddyError(null);
    try {
      const result = await window.pawpal.installWorkBuddyHooks(target);
      setWorkBuddyError(result?.error ?? null);
    } finally {
      setWorkBuddyBusy(null);
    }
  }

  async function disconnectWorkBuddy(target: AgentHookTarget): Promise<void> {
    setWorkBuddyBusy(target);
    setWorkBuddyError(null);
    try {
      const result = await window.pawpal.removeWorkBuddyHooks(target);
      setWorkBuddyError(result?.error ?? null);
    } finally {
      setWorkBuddyBusy(null);
    }
  }

  function workBuddyPhaseText(): string {
    const phase = snapshot.workBuddy.phase;
    if (phase === "running") return labels.workBuddyPhaseRunning;
    if (phase === "needsInput") return labels.workBuddyPhaseNeedsInput;
    if (phase === "done") return labels.workBuddyPhaseDone;
    return labels.workBuddyPhaseIdle;
  }

  async function uploadCustomPetAsset(state: PetState): Promise<void> {
    const asset = await window.pawpal.selectCustomPetAsset(state);
    if (!asset) return;
    applyCustomPetAsset(state, asset);
  }

  async function uploadDroppedCustomPetAsset(state: PetState, file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith(".gif")) return;
    const sourcePath = window.pawpal.pathForFile(file);
    if (!sourcePath) return;
    const asset = await window.pawpal.importCustomPetAsset(state, sourcePath);
    if (!asset) return;
    applyCustomPetAsset(state, asset);
  }

  function applyCustomPetAsset(state: PetState, asset: CustomPetAsset): void {
    setCustomEditorOpen(true);
    const customPetAppearance = updateCustomPetAsset(
      draft.customPetAppearance,
      state,
      asset,
      labels.customPet
    );
    updateDraft({
      customPetAppearance,
      petAppearanceId: hasRequiredCustomPetAssets(customPetAppearance)
        ? "custom"
        : draft.petAppearanceId
    });
  }

  function removeCustomPetAsset(state: PetState): void {
    const customPetAppearance = removeCustomPetState(draft.customPetAppearance, state, labels.customPet);
    updateDraft({
      customPetAppearance,
      petAppearanceId:
        draft.petAppearanceId === "custom" && !hasRequiredCustomPetAssets(customPetAppearance)
          ? "xiaoJiMao"
          : draft.petAppearanceId
    });
  }

  return (
    <main className="prefs">
      <header className="prefs__head">
        <img className="prefs__avatar" src={petAvatar.src} alt="" />
        <div className="prefs__intro">
          <p className="prefs__eyebrow">PawPal</p>
          <h1 className="prefs__title">{labels.today}</h1>
        </div>
      </header>

      <section className="prefs__stats" aria-label={labels.today}>
        <StatCard label={labels.breaks} value={stats.breaksTaken} unit={labels.countUnit} />
        <StatCard label={labels.waters} value={stats.watersLogged} unit={labels.countUnit} />
        <StatCard label={labels.focusMin} value={stats.focusMinutes} unit={labels.minuteUnit} />
        <StatCard label={labels.warnings} value={stats.focusWarnings} unit={labels.countUnit} />
      </section>

      {!draft.onboardingDismissed ? (
        <aside className="prefs__welcome">
          <p>
            <strong>{labels.welcomeTitle}.</strong> {labels.welcomeCopy}
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => updateDraft({ onboardingDismissed: true })}
          >
            {labels.dismissWelcome}
          </button>
        </aside>
      ) : null}

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.appearance}</h2>
        <Row
          label={labels.language}
          control={
            <SelectControl
              value={language}
              options={[...LANGUAGE_OPTIONS]}
              onChange={(value) => updateDraft({ language: resolveLanguage(value) })}
            />
          }
        />
        <div className="pref-block">
          <span className="pref-block__label">{labels.petAppearance}</span>
          <div className="pet-picker">
            {petAppearanceOptions(language).map((option) => (
              <PetCard
                key={option.value}
                appearanceId={option.value}
                label={option.label}
                selected={
                  !customEditorOpen &&
                  draft.petAppearanceId !== "custom" &&
                  resolveBuiltInPetAppearanceId(draft.petAppearanceId) === option.value
                }
                onSelect={() => {
                  setCustomEditorOpen(false);
                  updateDraft({ petAppearanceId: resolvePetAppearanceId(option.value) });
                }}
              />
            ))}
            <PetCard
              label={labels.customPet}
              previewSrc={
                customPetReady
                  ? getPetAsset("custom", "idle", 0, 0, draft.customPetAppearance).src
                  : undefined
              }
              selected={customEditorOpen || draft.petAppearanceId === "custom"}
              onSelect={() => {
                setCustomEditorOpen(true);
                if (customPetReady) updateDraft({ petAppearanceId: "custom" });
              }}
            />
          </div>
        </div>
        {customEditorOpen ? (
          <CustomPetEditor
            customPetAppearance={draft.customPetAppearance}
            labels={labels}
            onDrop={uploadDroppedCustomPetAsset}
            onRemove={removeCustomPetAsset}
            onUpload={(state) => void uploadCustomPetAsset(state)}
          />
        ) : null}
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.reminders}</h2>
        <Row
          label={labels.enableBreakReminder}
          control={
            <ToggleControl
              checked={draft.breakReminderEnabled}
              onChange={(breakReminderEnabled) => updateDraft({ breakReminderEnabled })}
              ariaLabel={labels.enableBreakReminder}
            />
          }
        />
        <Row
          label={labels.breakInterval}
          control={
            <NumberControl
              value={draft.breakIntervalMinutes}
              min={1}
              max={900}
              unit={labels.minuteUnit}
              onChange={(breakIntervalMinutes) => updateDraft({ breakIntervalMinutes })}
            />
          }
        />
        <Row
          label={labels.breakRunDuration}
          control={
            <NumberControl
              value={draft.breakRunDurationSeconds}
              min={10}
              max={900}
              unit={labels.secondUnit}
              onChange={(breakRunDurationSeconds) => updateDraft({ breakRunDurationSeconds })}
            />
          }
        />
        <Row
          label={labels.enableHydrationReminder}
          control={
            <ToggleControl
              checked={draft.hydrationReminderEnabled}
              onChange={(hydrationReminderEnabled) => updateDraft({ hydrationReminderEnabled })}
              ariaLabel={labels.enableHydrationReminder}
            />
          }
        />
        <Row
          label={labels.hydrationInterval}
          control={
            <NumberControl
              value={draft.hydrationIntervalMinutes}
              min={1}
              max={900}
              unit={labels.minuteUnit}
              onChange={(hydrationIntervalMinutes) => updateDraft({ hydrationIntervalMinutes })}
            />
          }
        />
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.workClock}</h2>
        <Row
          label={labels.enableWorkClock}
          control={
            <ToggleControl
              checked={draft.workClockEnabled}
              onChange={(workClockEnabled) => updateDraft({ workClockEnabled })}
              ariaLabel={labels.enableWorkClock}
            />
          }
        />
        <Row
          label={labels.workStartTime}
          control={
            <TimeControl
              value={draft.workStartTime}
              onChange={(workStartTime) => updateDraft({ workStartTime })}
            />
          }
        />
        <Row
          label={labels.workEndTime}
          control={
            <TimeControl
              value={draft.workEndTime}
              onChange={(workEndTime) => updateDraft({ workEndTime })}
            />
          }
        />
        <Row
          label={labels.workDays}
          control={
            <WorkDaysControl
              value={draft.workDays}
              labels={labels}
              onChange={(workDays) => updateDraft({ workDays })}
            />
          }
        />
        <Row
          label={labels.enableLunch}
          control={
            <ToggleControl
              checked={draft.workLunchEnabled}
              onChange={(workLunchEnabled) => updateDraft({ workLunchEnabled })}
              ariaLabel={labels.enableLunch}
            />
          }
        />
        {draft.workLunchEnabled ? (
          <>
            <Row
              label={labels.lunchStart}
              control={
                <TimeControl
                  value={draft.workLunchStart}
                  onChange={(workLunchStart) => updateDraft({ workLunchStart })}
                />
              }
            />
            <Row
              label={labels.lunchEnd}
              control={
                <TimeControl
                  value={draft.workLunchEnd}
                  onChange={(workLunchEnd) => updateDraft({ workLunchEnd })}
                />
              }
            />
          </>
        ) : null}
        <Row
          label={labels.enableHourlyReminder}
          control={
            <ToggleControl
              checked={draft.workHourlyReminderEnabled}
              onChange={(workHourlyReminderEnabled) => updateDraft({ workHourlyReminderEnabled })}
              ariaLabel={labels.enableHourlyReminder}
            />
          }
        />
        <Row
          label={labels.enableOvertimeReminder}
          control={
            <ToggleControl
              checked={draft.workOvertimeEnabled}
              onChange={(workOvertimeEnabled) => updateDraft({ workOvertimeEnabled })}
              ariaLabel={labels.enableOvertimeReminder}
            />
          }
        />
        <Row
          label={labels.overtimeInterval}
          control={
            <NumberControl
              value={draft.workOvertimeIntervalMinutes}
              min={1}
              max={240}
              unit={labels.minuteUnit}
              onChange={(workOvertimeIntervalMinutes) => updateDraft({ workOvertimeIntervalMinutes })}
            />
          }
        />
        <Row
          label={labels.monthlySalary}
          control={
            <DecimalControl
              value={draft.monthlySalary}
              min={0}
              max={10000000}
              step={100}
              unit="元"
              onChange={(monthlySalary) => updateDraft({ monthlySalary })}
            />
          }
        />
        <Row
          label={labels.payMode}
          control={
            <SelectControl
              value={draft.payMode}
              options={[
                { value: "fixedDays", label: labels.payModeFixed },
                { value: "plannedDays", label: labels.payModePlanned },
                { value: "customDaily", label: labels.payModeCustom }
              ]}
              onChange={(value) => updateDraft({ payMode: value as Settings["payMode"] })}
            />
          }
        />
        {draft.payMode === "fixedDays" ? (
          <Row
            label={labels.fixedDays}
            control={
              <DecimalControl
                value={draft.fixedDays}
                min={1}
                max={31}
                step={0.25}
                unit="天"
                onChange={(fixedDays) => updateDraft({ fixedDays: fixedDays ?? 21.75 })}
              />
            }
          />
        ) : null}
        {draft.payMode === "customDaily" ? (
          <Row
            label={labels.customDaily}
            control={
              <DecimalControl
                value={draft.customDaily}
                min={0}
                max={10000000}
                step={10}
                unit="元"
                onChange={(customDaily) => updateDraft({ customDaily })}
              />
            }
          />
        ) : null}
        <Row
          label={labels.hideEarnings}
          control={
            <ToggleControl
              checked={draft.hideEarnings}
              onChange={(hideEarnings) => updateDraft({ hideEarnings })}
              ariaLabel={labels.hideEarnings}
            />
          }
        />
        <Row
          label={labels.workCheckout}
          control={
            <button
              type="button"
              className="pref-button"
              onClick={() => window.pawpal.checkoutWork()}
            >
              {draft.workCheckoutDate === todayKey() ? labels.workCheckedOut : labels.workCheckout}
            </button>
          }
        />
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.workBuddy}</h2>
        <Row
          label={labels.enableWorkBuddy}
          hint={labels.enableWorkBuddyHelp}
          control={
            <ToggleControl
              checked={draft.workBuddyEnabled}
              onChange={(workBuddyEnabled) => updateDraft({ workBuddyEnabled })}
              ariaLabel={labels.enableWorkBuddy}
            />
          }
        />
        {draft.workBuddyEnabled ? (
          <>
            <Row
              label={labels.workBuddyNotify}
              hint={labels.workBuddyNotifyHelp}
              control={
                <ToggleControl
                  checked={draft.workBuddyNotifyEnabled}
                  onChange={(workBuddyNotifyEnabled) => updateDraft({ workBuddyNotifyEnabled })}
                  ariaLabel={labels.workBuddyNotify}
                />
              }
            />
            {integrations.map((item) => (
              <Row
                key={item.id}
                label={item.label}
                hint={
                  item.error ??
                  (item.installed ? labels.workBuddyRestartHint : labels.workBuddyInstallHint)
                }
                control={
                  <div className="pref-button-group">
                    <span className={`pref-status ${item.installed ? "is-on" : "is-off"}`}>
                      {item.installed ? labels.workBuddyInstalled : labels.workBuddyNotInstalled}
                    </span>
                    {item.installed ? (
                      <button
                        type="button"
                        className="pref-button"
                        disabled={workBuddyBusy === item.id}
                        onClick={() => void disconnectWorkBuddy(item.id)}
                      >
                        {labels.workBuddyRemove}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pref-button is-primary"
                        disabled={workBuddyBusy === item.id}
                        onClick={() => void connectWorkBuddy(item.id)}
                      >
                        {labels.workBuddyConnect}
                      </button>
                    )}
                  </div>
                }
              />
            ))}
            <Row
              label="DeepSeek Harness"
              hint={
                snapshot.dshBridge.installed
                  ? labels.workBuddyDshReadyHint
                  : labels.workBuddyDshHint
              }
              control={
                <span
                  className={`pref-status ${snapshot.dshBridge.installed ? "is-on" : "is-off"}`}
                >
                  {snapshot.dshBridge.installed
                    ? labels.workBuddyInstalled
                    : labels.workBuddyUnsupported}
                </span>
              }
            />
            <Row
              label={labels.workBuddyCurrent}
              control={
                <span className="pref-static-value">
                  {workBuddyPhaseText()}
                  {snapshot.workBuddy.sessions[0]
                    ? ` · ${snapshot.workBuddy.sessions[0].agent}`
                    : ""}
                </span>
              }
            />
            <Row
              label={labels.workBuddyEventDir}
              hint={labels.workBuddyEventDirHint}
              control={
                <div className="pref-button-group">
                  <button
                    type="button"
                    className="pref-button"
                    title={eventDir || undefined}
                    onClick={window.pawpal.openWorkBuddyEventDir}
                  >
                    {labels.workBuddyOpenDir}
                  </button>
                  <button
                    type="button"
                    className="pref-button"
                    onClick={window.pawpal.showWorkBuddyStatus}
                  >
                    {labels.workBuddyShowOnPet}
                  </button>
                  <button
                    type="button"
                    className="pref-button"
                    disabled={redetecting}
                    onClick={() => void redetectAgents()}
                  >
                    {redetecting ? labels.workBuddyRedetecting : labels.workBuddyRedetect}
                  </button>
                </div>
              }
            />
            {workBuddyError ? <p className="pref-status-note">{workBuddyError}</p> : null}
          </>
        ) : null}
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.credits}</h2>
        <p className="prefs__group-hint">{labels.creditsHint}</p>
        {draft.creditAlerts.map((alert) => (
          <div key={alert.agentId}>
            <CreditRow
              agentLabel={CREDIT_AGENT_LABELS[alert.agentId]}
              alert={alert}
              labels={labels}
              onChange={(patch) =>
                updateDraft({
                  creditAlerts: draft.creditAlerts.map((item) =>
                    item.agentId === alert.agentId ? { ...item, ...patch } : item
                  )
                })
              }
            />
            {alert.agentId === "workbuddy" || alert.agentId === "qoder" ? (
              <LinkRow
                status={linkStatuses[alert.agentId] ?? null}
                labels={labels}
                onStart={() => void startCreditLink(alert.agentId)}
                onRefresh={() => void refreshCreditLink(alert.agentId)}
                onClear={() => void clearCreditLink(alert.agentId)}
              />
            ) : null}
            {alert.agentId === "workbuddy" ? (
              <>
                <div className="credit-link">
                  <button
                    type="button"
                    className="pref-button"
                    disabled={wbBusy}
                    onClick={() => void syncWbSwitchAccounts()}
                  >
                    {wbBusy ? labels.wbSwitchSyncing : labels.wbSwitchSync}
                  </button>
                  {wbSwitch ? (
                    <span className="credit-link__status">
                      {labels.wbSwitchCount(wbSwitch.accounts.length)} ·{" "}
                      {labels.wbSwitchUpdated(
                        new Intl.DateTimeFormat("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit"
                        }).format(new Date(wbSwitch.updatedAt))
                      )}
                    </span>
                  ) : null}
                </div>
                {wbSwitch ? (
                  <ul className="wb-list">
                    {wbSwitch.accounts.map((account) => (
                      <li key={account.id} className={account.error ? "is-error" : ""}>
                        <span className="wb-list__name">{account.nickname}</span>
                        <span className="wb-list__credit">
                          {account.error
                            ? account.error
                            : [
                                `余额 ${account.remaining}`,
                                account.planQuota ? `套餐 ${account.planQuota}/月` : null,
                                `${account.expiresAt ? formatShortDate(account.expiresAt) : "—"} 到期`
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {wbSwitch ? <p className="prefs__diag-hint">{labels.wbSwitchHint}</p> : null}
              </>
            ) : null}
          </div>
        ))}
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.focus}</h2>
        <Row
          label={labels.focusDuration}
          control={
            <NumberControl
              value={draft.focusDurationMinutes}
              min={1}
              max={900}
              unit={labels.minuteUnit}
              onChange={(focusDurationMinutes) => updateDraft({ focusDurationMinutes })}
            />
          }
        />
        <Row
          label={labels.enableDistractionDetection}
          hint={
            draft.distractionDetectionEnabled
              ? labels.detectionFocusHelp
              : labels.detectionOffHelp
          }
          control={
            <ToggleControl
              checked={draft.distractionDetectionEnabled}
              onChange={(distractionDetectionEnabled) => updateDraft({ distractionDetectionEnabled })}
              ariaLabel={labels.enableDistractionDetection}
            />
          }
        />
        {draft.distractionDetectionEnabled ? (
          <>
            <Row
              label={labels.detectionGrace}
              control={
                <NumberControl
                  value={draft.distractionGraceSeconds}
                  min={0}
                  max={900}
                  unit={labels.secondUnit}
                  onChange={(distractionGraceSeconds) => updateDraft({ distractionGraceSeconds })}
                />
              }
            />
            <Row
              label={labels.blockedApps}
              control={
                <ChipsControl
                  value={draft.distractionBlockedApps}
                  labels={labels}
                  onChange={(distractionBlockedApps) => updateDraft({ distractionBlockedApps })}
                />
              }
            />
            <Row
              label={labels.blockedKeywords}
              control={
                <ChipsControl
                  value={draft.distractionBlockedKeywords}
                  labels={labels}
                  onChange={(distractionBlockedKeywords) => updateDraft({ distractionBlockedKeywords })}
                />
              }
            />
          </>
        ) : null}
        <div className="prefs__inline-actions">
          {snapshot.focusActive ? (
            <button type="button" className="pref-button" onClick={window.pawpal.stopFocus}>
              {labels.stopFocus}
            </button>
          ) : (
            <button type="button" className="pref-button is-primary" onClick={window.pawpal.startFocus}>
              {labels.startFocus}
            </button>
          )}
        </div>
      </section>

      {!window.pawpal.isPackaged && (
        <section className="prefs__group">
          <h2 className="prefs__group-title">{labels.testTools}</h2>
          <div className="test-tools">
            <DemoChip trigger="break" label={labels.demoBreak} />
            <DemoChip trigger="hydration" label={labels.demoWater} />
            <DemoChip trigger="focusWarning" label={labels.demoFocusWarning} />
            <DemoChip trigger="happy" label={labels.demoHappy} />
            <button type="button" className="pref-chip-button" onClick={window.pawpal.resetToday}>
              {labels.resetToday}
            </button>
          </div>
        </section>
      )}

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.system}</h2>
        <Row
          label={labels.launchAtLogin}
          hint={labels.launchAtLoginHelp}
          control={
            <ToggleControl
              checked={draft.launchAtLoginEnabled}
              onChange={(launchAtLoginEnabled) => updateDraft({ launchAtLoginEnabled })}
              ariaLabel={labels.launchAtLogin}
            />
          }
        />
        <Row
          label={labels.hideOnFullscreen}
          hint={labels.hideOnFullscreenHelp}
          control={
            <ToggleControl
              checked={draft.hideOnFullscreenEnabled}
              onChange={(hideOnFullscreenEnabled) => updateDraft({ hideOnFullscreenEnabled })}
              ariaLabel={labels.hideOnFullscreen}
            />
          }
        />
        <Row
          label={labels.updateCheckOnLaunch}
          hint={labels.updateCheckOnLaunchHelp}
          control={
            <ToggleControl
              checked={draft.checkUpdatesOnLaunchEnabled}
              onChange={(checkUpdatesOnLaunchEnabled) =>
                updateDraft({ checkUpdatesOnLaunchEnabled })
              }
              ariaLabel={labels.updateCheckOnLaunch}
            />
          }
        />
      </section>

      <section className="prefs__group">
        <h2 className="prefs__group-title">{labels.about}</h2>
        <Row
          label={labels.version}
          hint={
            updateCheck.latestVersion
              ? labels.latestVersion(updateCheck.latestVersion)
              : undefined
          }
          control={
            <span className="pref-static-value">{snapshot.appInfo.version || labels.none}</span>
          }
        />
        <Row
          label={labels.customBuild}
          hint={labels.customBuildCredit}
          control={<span className="pref-static-value">Sin</span>}
        />
        <Row
          label={labels.updates}
          hint={formatUpdateStatus(updateCheck, labels)}
          control={
            <div className="pref-button-group">
              <button
                type="button"
                className="pref-button"
                disabled={updateCheck.status === "checking"}
                onClick={() => void checkForUpdates()}
              >
                {updateCheck.status === "checking"
                  ? labels.checkingUpdates
                  : labels.checkForUpdates}
              </button>
              {updateCheck.status === "available" ? (
                <button
                  type="button"
                  className="pref-button is-primary"
                  onClick={window.pawpal.openReleaseNotes}
                >
                  {labels.openReleaseNotes}
                </button>
              ) : null}
            </div>
          }
        />
        <Row
          label={labels.releaseNotes}
          control={
            <button type="button" className="pref-button" onClick={window.pawpal.openReleaseNotes}>
              {labels.openReleaseNotes}
            </button>
          }
        />
      </section>

      <section className="prefs__group prefs__group--quiet">
        <button
          type="button"
          className="prefs__disclosure"
          onClick={() => setDiagnosticsOpen((open) => !open)}
          aria-expanded={diagnosticsOpen}
        >
          <span>{labels.diagnostics}</span>
          <span className="prefs__disclosure-caret">{diagnosticsOpen ? "▾" : "▸"}</span>
        </button>
        {diagnosticsOpen ? (
          <div className="prefs__diag">
            <DiagGroup title={labels.diagAgents}>
              {(agentDiag?.agents ?? []).map((item) => (
                <DiagCard key={item.id} label={item.label} value={formatAgentDiag(item, labels)} />
              ))}
            </DiagGroup>
            <div className="prefs__diag-actions">
              <button
                type="button"
                className="pref-button"
                onClick={() => void refreshAgentDiagnostics()}
              >
                {labels.diagRefresh}
              </button>
              <button
                type="button"
                className="pref-button"
                onClick={() => void copyDiagnosticsText()}
              >
                {diagCopied ? labels.diagCopied : labels.diagCopy}
              </button>
            </div>

            <DiagGroup title={labels.runtime}>
              <DiagCard label={labels.state} value={snapshot.petState} />
              <DiagCard
                label={labels.mode}
                value={
                  snapshot.focusActive
                    ? labels.focus
                    : labels.idle
                }
              />
              <DiagCard label={labels.reminder} value={snapshot.blockingMode ?? labels.none} />
              <DiagCard
                label={labels.dog}
                value={snapshot.dogVisible ? labels.visible : labels.hidden}
              />
            </DiagGroup>

            <DiagGroup title={labels.distraction}>
              <DiagCard
                label={labels.status}
                value={formatDistractionState(snapshot.distraction.state, labels)}
              />
              <DiagCard
                label={labels.matched}
                value={snapshot.distraction.matchedRule ?? labels.none}
              />
              <DiagCard
                label={labels.app}
                value={snapshot.distraction.activeApp || labels.none}
              />
              <DiagCard
                label={labels.checked}
                value={formatTimestamp(snapshot.distraction.lastCheckedAt, language, labels)}
              />
            </DiagGroup>

            {snapshot.distraction.activeWindowTitle ? (
              <p className="prefs__diag-note">{snapshot.distraction.activeWindowTitle}</p>
            ) : null}
            <p className="prefs__diag-hint">{distractionHelp(snapshot, labels)}</p>

            <DiagGroup title={labels.timers}>
              <DiagCard
                label={labels.break}
                value={formatTimer(snapshot.timers.breakDueAt, now, language, labels)}
              />
              <DiagCard
                label={labels.water}
                value={formatTimer(snapshot.timers.hydrationDueAt, now, language, labels)}
              />
              <DiagCard
                label={labels.focusEnd}
                value={formatTimer(snapshot.timers.focusEndsAt, now, language, labels)}
              />
              <DiagCard
                label={labels.updated}
                value={new Intl.DateTimeFormat(localeFor(language), {
                  hour: "2-digit",
                  minute: "2-digit"
                }).format(now)}
              />
            </DiagGroup>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PetCard({
  appearanceId,
  label,
  previewSrc,
  selected,
  disabled = false,
  onSelect
}: {
  appearanceId?: BuiltInPetAppearanceId;
  label: string;
  previewSrc?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}): JSX.Element {
  const asset = useMemo(
    () => (appearanceId ? getPetAsset(appearanceId, "idle") : null),
    [appearanceId]
  );
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`pet-card${selected ? " is-selected" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="pet-card__preview">
        {previewSrc || asset ? <img src={previewSrc ?? asset?.src} alt="" /> : <span>+</span>}
      </span>
      <span className="pet-card__name">{label}</span>
    </button>
  );
}

function CustomPetEditor({
  customPetAppearance,
  labels,
  onDrop,
  onUpload,
  onRemove
}: {
  customPetAppearance: CustomPetAppearance | null;
  labels: SettingsCopy;
  onDrop: (state: PetState, file: File) => void;
  onUpload: (state: PetState) => void;
  onRemove: (state: PetState) => void;
}): JSX.Element {
  function allowGifDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, state: PetState): void {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    onDrop(state, file);
  }

  return (
    <div className="custom-pet">
      <div className="custom-pet__head">
        <div className="custom-pet__title">
          <span className="pref-block__label">{labels.customPetAssets}</span>
          <span className="custom-pet__help">
            <button
              type="button"
              className="custom-pet__help-button"
              aria-label={labels.customPetRequirements}
            >
              ?
            </button>
            <span className="custom-pet__tooltip" role="tooltip">
              {labels.customPetRequirements}
            </span>
          </span>
        </div>
        <span className="custom-pet__status">
          {hasRequiredCustomPetAssets(customPetAppearance)
            ? labels.customPetReady
            : labels.customPetMissingRequired}
        </span>
      </div>
      <div className="custom-pet__grid">
        {PET_STATE_ORDER.map((state) => {
          const reference = getPetAsset("lineDog", state);
          const customAsset = customPetAppearance?.assets[state] ?? null;
          const customPreview = customAsset ? customPetAssetPreviewSrc(customAsset) : null;
          return (
            <div className="custom-pet-slot" key={state}>
              <div className="custom-pet-slot__meta">
                <span className="custom-pet-slot__state">{labels.petStates[state]}</span>
                <span className="custom-pet-slot__description">
                  {labels.petStateDescriptions[state]}
                </span>
                <span className={`custom-pet-slot__kind${customPetStateKindClass(state)}`}>
                  {customPetStateKind(state, labels)}
                </span>
              </div>
              <div className="custom-pet-slot__media">
                <div className="custom-pet-slot__preview">
                  <span className="custom-pet-slot__badge">{labels.referenceAsset}</span>
                  <img src={reference.src} alt="" />
                </div>
                <div
                  className={`custom-pet-slot__preview custom-pet-slot__dropzone${
                    customPreview ? "" : " is-empty"
                  }`}
                  onDragOver={allowGifDrop}
                  onDrop={(event) => handleDrop(event, state)}
                >
                  {customPreview ? <img src={customPreview} alt="" /> : <strong>+</strong>}
                  {!customAsset ? (
                    <button
                      type="button"
                      className="pref-button custom-pet-slot__upload"
                      onClick={() => onUpload(state)}
                    >
                      {labels.uploadGif}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="custom-pet-slot__actions">
                {customAsset ? (
                  <>
                    <button type="button" className="pref-button" onClick={() => onUpload(state)}>
                      {labels.replaceGif}
                    </button>
                    <button
                      type="button"
                      className="pref-button"
                      onClick={() => onRemove(state)}
                    >
                      {labels.removeGif}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DemoChip({ trigger, label }: { trigger: DemoTrigger; label: string }): JSX.Element {
  return (
    <button
      type="button"
      className="pref-chip-button"
      onClick={() => window.pawpal.triggerDemo(trigger)}
    >
      {label}
    </button>
  );
}

function DiagGroup({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="diag-group">
      <h3 className="diag-group__title">{title}</h3>
      <div className="diag-group__grid">{children}</div>
    </section>
  );
}

function DiagCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="diag-card">
      <span className="diag-card__label">{label}</span>
      <span className="diag-card__value">{value}</span>
    </div>
  );
}
