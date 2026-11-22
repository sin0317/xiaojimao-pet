/**
 * 复用 workbuddy-switch 已登录的多账号，一次性查完所有账号的积分。
 *
 * 只读它的 `~/.wb-switch/accounts.json`（里面有明文 access_token），
 * **读出来只用于这一次请求，不落盘、不进日志**——桌宠自己不保管这些 token。
 *
 * 每个账号两次请求：
 *   POST /billing/meter/get-user-resource-summary      → 余额
 *   POST /billing/meter/get-user-resource-free-packages → 每笔发放的到期时间
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePackageGrants, parseResourceSummary } from "../shared/credits";

const API_BASE = "https://www.codebuddy.cn";

export type { WbSwitchAccount } from "../shared/types";
import type { WbSwitchAccount } from "../shared/types";

type StoredAccount = {
  id?: unknown;
  nickname?: unknown;
  email?: unknown;
  uid?: unknown;
  domain?: unknown;
  access_token?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function wbSwitchAccountsPath(): string {
  return join(homedir(), ".wb-switch", "accounts.json");
}

async function readStoredAccounts(): Promise<Array<{ id: string; nickname: string; email: string; token: string; uid: string; domain: string }>> {
  const raw = await readFile(wbSwitchAccountsPath(), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => item as StoredAccount)
    .filter((item) => typeof item.access_token === "string")
    .map((item, index) => ({
      id: asText(item.id) || `wb-${index}`,
      nickname: asText(item.nickname) || asText(item.email) || `账号 ${index + 1}`,
      email: asText(item.email),
      token: asText(item.access_token),
      uid: asText(item.uid),
      domain: asText(item.domain) || "www.codebuddy.cn"
    }));
}

function authHeaders(account: { token: string; uid: string; domain: string }): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Domain": account.domain
  };
  if (account.uid) headers["X-User-Id"] = account.uid;
  return headers;
}

async function postJson(
  path: string,
  account: { token: string; uid: string; domain: string },
  body: unknown
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(account),
    body: JSON.stringify(body)
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("登录已过期");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** 一个账号：余额 + 最近到期 */
export async function fetchAccountCredits(account: {
  token: string;
  uid: string;
  domain: string;
}): Promise<{ remaining: number; total: number; expiresAt: number | null }> {
  const summary = await postJson("/billing/meter/get-user-resource-summary", account, {});
  const balance = parseResourceSummary(summary);
  if (!balance) throw new Error("接口没返回积分");

  // 拿到 PackageCodes 才能问每笔发放的到期时间
  const codes = extractPackageCodes(summary);
  let expiresAt = balance.expiresAt;
  if (codes.length) {
    const grants = await postJson(
      "/billing/meter/get-user-resource-free-packages",
      account,
      { PageNumber: 1, PageSize: 200, Status: [0, 3], PackageCodes: codes, NeedRenewInfo: true }
    ).catch(() => null);
    const parsed = grants ? parsePackageGrants(grants) : null;
    if (parsed?.expiresAt) expiresAt = parsed.expiresAt;
  }

  return { remaining: balance.remaining, total: balance.total, expiresAt };
}

function extractPackageCodes(summary: unknown): string[] {
  const data = (summary as { data?: { Packages?: unknown } } | null)?.data;
  const packages = Array.isArray(data?.Packages) ? data.Packages : [];
  return packages
    .map((item) => (item as { PackageCode?: unknown }).PackageCode)
    .filter((code): code is string => typeof code === "string" && code.length > 0)
    .slice(0, 20);
}

/** 全部账号，2 个一批，避免把接口打爆 */
export async function syncWbSwitchAccounts(): Promise<WbSwitchAccount[]> {
  const accounts = await readStoredAccounts();
  const results: WbSwitchAccount[] = [];

  for (let index = 0; index < accounts.length; index += 2) {
    const batch = accounts.slice(index, index + 2);
    const settled = await Promise.all(
      batch.map(async (account) => {
        try {
          const credits = await fetchAccountCredits(account);
          return {
            id: account.id,
            nickname: account.nickname,
            email: account.email,
            remaining: credits.remaining,
            total: credits.total,
            expiresAt: credits.expiresAt,
            error: null
          } satisfies WbSwitchAccount;
        } catch (error) {
          return {
            id: account.id,
            nickname: account.nickname,
            email: account.email,
            remaining: 0,
            total: 0,
            expiresAt: null,
            error: error instanceof Error ? error.message : String(error)
          } satisfies WbSwitchAccount;
        }
      })
    );
    results.push(...settled);
  }

  // 快到期、还有余额的排前面
  return results.sort((a, b) => {
    const left = a.expiresAt ?? Number.MAX_SAFE_INTEGER;
    const right = b.expiresAt ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}
