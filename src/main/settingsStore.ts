import { DEFAULT_SETTINGS } from "../shared/constants";
import { CREDIT_AGENTS, defaultCreditAlert } from "../shared/credits";
import { resolveLanguage } from "../shared/i18n";
import {
  hasRequiredCustomPetAssets,
  normalizeCustomPetAppearance,
  resolvePetAppearanceId
} from "../shared/petAppearances";
import type { CreditAlert, Settings } from "../shared/types";

export type SettingsStore = {
  get(key: "settings"): Settings;
};

function normalizeNumber(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

export function normalizeSettings(stored: Partial<Settings> = {}): Settings {
  const customPetAppearance = normalizeCustomPetAppearance(stored.customPetAppearance);
  const petAppearanceId = resolvePetAppearanceId(stored.petAppearanceId ?? DEFAULT_SETTINGS.petAppearanceId);

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    language: resolveLanguage(stored.language ?? DEFAULT_SETTINGS.language),
    petAppearanceId:
      petAppearanceId === "custom" && !hasRequiredCustomPetAssets(customPetAppearance)
        ? DEFAULT_SETTINGS.petAppearanceId
        : petAppearanceId,
    customPetAppearance,
    breakRunDurationSeconds: normalizeNumber(
      stored.breakRunDurationSeconds,
      DEFAULT_SETTINGS.breakRunDurationSeconds,
      10
    ),
    workBuddyEnabled: stored.workBuddyEnabled !== false,
    workBuddyNotifyEnabled: stored.workBuddyNotifyEnabled !== false,
    creditAlerts: normalizeCreditAlerts(stored.creditAlerts)
  };
}

/** 三家固定一档，缺的补默认值，多的丢掉；顺带把数字夹到合理范围 */
export function normalizeCreditAlerts(input: unknown): CreditAlert[] {
  const stored = Array.isArray(input) ? (input as Partial<CreditAlert>[]) : [];

  return CREDIT_AGENTS.map((agentId) => {
    const found = stored.find((item) => item?.agentId === agentId);
    const base = defaultCreditAlert(agentId);
    if (!found) return base;

    const balance =
      typeof found.balance === "number" && Number.isFinite(found.balance) && found.balance >= 0
        ? Math.round(found.balance)
        : null;
    const expiresOn =
      typeof found.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(found.expiresOn)
        ? found.expiresOn
        : null;
    const resetDay =
      typeof found.resetDay === "number" && found.resetDay >= 1 && found.resetDay <= 31
        ? Math.round(found.resetDay)
        : null;
    const remindDays =
      typeof found.remindDays === "number" && Number.isFinite(found.remindDays)
        ? Math.min(30, Math.max(0, Math.round(found.remindDays)))
        : base.remindDays;

    return {
      agentId,
      balance,
      expiresOn,
      resetDay,
      remindDays,
      enabled: found.enabled === true
    };
  });
}

export function getStoredSettings(store: SettingsStore): Settings {
  return normalizeSettings(store.get("settings"));
}
