/**
 * WorkBuddy 扫码登录取数。
 *
 * 流程（三个公开请求，无签名）：
 *  1. POST {api}/v2/plugin/auth/state?platform=workbuddy  → {state, authUrl}
 *  2. 把 authUrl 在浏览器里打开，用户自己完成登录
 *  3. GET  {api}/v2/plugin/auth/token?state=…             → 未登录 code=11217，成功后给 token
 *  4. POST {api}/billing/meter/get-user-resource-summary  → 积分余额与到期
 *
 * token 只用 safeStorage 加密后落盘（Windows 走 DPAPI），不写明文、不进日志。
 */

import { safeStorage } from "electron";
import { parseResourceSummary, type WorkBuddyCredits } from "../shared/credits";

const API_BASE = "https://www.codebuddy.cn";
const OAUTH_PLATFORM = "workbuddy";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

export type WorkBuddyAccount = {
  accessToken: string;
  refreshToken: string | null;
  domain: string;
  uid: string | null;
  nickname: string | null;
  expiresAt: number | null;
};

export type TokenPollResult =
  | { status: "pending" }
  | { status: "ready"; account: WorkBuddyAccount }
  | { status: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 申请 state 与登录页地址 */
export async function startLogin(): Promise<{ state: string; authUrl: string }> {
  const response = await fetch(
    `${API_BASE}/v2/plugin/auth/state?platform=${OAUTH_PLATFORM}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}"
    }
  );
  const json = asRecord(await response.json());
  const data = asRecord(json?.data);
  const state = asText(data?.state);
  if (!state) throw new Error("登录接口没有返回 state");

  const authUrl =
    asText(data?.authUrl) ||
    asText(data?.auth_url) ||
    `${API_BASE}/login?platform=${OAUTH_PLATFORM}&state=${state}`;
  return { state, authUrl };
}

/** 轮询一次；未登录时离线服务端返回 code=11217 */
export async function pollToken(state: string): Promise<TokenPollResult> {
  const response = await fetch(
    `${API_BASE}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`,
    { headers: { Accept: "application/json" } }
  );
  const json = asRecord(await response.json());
  const code = typeof json?.code === "number" ? json.code : -1;
  if (code !== 0 && code !== 200) return { status: "pending" };

  const data = asRecord(json?.data);
  const accessToken = asText(data?.accessToken) || asText(data?.access_token);
  if (!accessToken) return { status: "pending" };

  const expiresIn = typeof data?.expiresIn === "number" ? data.expiresIn : null;
  return {
    status: "ready",
    account: {
      accessToken,
      refreshToken: asText(data?.refreshToken) || asText(data?.refresh_token) || null,
      domain: asText(data?.domain),
      uid: null,
      nickname: null,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null
    }
  };
}

/** 用 token 拉一次账号信息，补上昵称与 uid */
export async function fetchProfile(account: WorkBuddyAccount): Promise<WorkBuddyAccount> {
  try {
    const response = await fetch(`${API_BASE}/v2/plugin/login/account`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${account.accessToken}` }
    });
    const data = asRecord(asRecord(await response.json())?.data);
    return {
      ...account,
      uid: asText(data?.uid) || account.uid,
      nickname: asText(data?.nickname) || account.nickname
    };
  } catch {
    return account;
  }
}

/** 积分余额与最近到期时间 */
export async function fetchCredits(account: WorkBuddyAccount): Promise<WorkBuddyCredits | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${account.accessToken}`
  };
  if (account.domain) headers["X-Domain"] = account.domain;
  if (account.uid) headers["X-User-Id"] = account.uid;

  const response = await fetch(`${API_BASE}/billing/meter/get-user-resource-summary`, {
    method: "POST",
    headers,
    body: "{}"
  });
  return parseResourceSummary(await response.json());
}

/** 轮询直到登录完成或超时；aborted 由调用方置位 */
export async function waitForLogin(
  state: string,
  isAborted: () => boolean
): Promise<WorkBuddyAccount | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isAborted()) return null;
    const result = await pollToken(state).catch(() => ({ status: "pending" as const }));
    if (result.status === "ready") return fetchProfile(result.account);
    if (result.status === "error") throw new Error(result.message);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

/** token 加密后存 base64；系统不支持时返回 null，由调用方决定要不要降级 */
export function sealToken(token: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(token).toString("base64");
  } catch {
    return null;
  }
}

export function unsealToken(sealed: string): string | null {
  try {
    const buffer = Buffer.from(sealed, "base64");
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}
