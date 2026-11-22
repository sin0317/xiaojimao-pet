import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ApprovalRequest = {
  id: string;
  agent: string;
  tool: string;
  detail: string;
  at: number;
  expiresAt: number;
};

export type ApprovalDecision = "allow" | "deny" | "defer";

const REQUEST_SUFFIX = ".req.json";
const ANSWER_SUFFIX = ".ans.json";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 钩子脚本写的请求文件；形状不对就当没收到，绝不因为一个坏文件挡住别人 */
export function parseApprovalRequest(raw: string): ApprovalRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const id = asText(record.id);
  if (!id) return null;

  const at = Number(record.at);
  const expiresAt = Number(record.expiresAt);
  return {
    id,
    agent: asText(record.agent) || "Agent",
    tool: asText(record.tool) || "tool",
    detail: asText(record.detail),
    at: Number.isFinite(at) ? at : Date.now(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 25_000
  };
}

export function isApprovalExpired(request: ApprovalRequest, now: number): boolean {
  return now >= request.expiresAt * 1000;
}

/** 按到达时间排序，先来先问 */
export async function listApprovalRequests(dir: string): Promise<ApprovalRequest[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const requests: ApprovalRequest[] = [];
  for (const name of names) {
    if (!name.endsWith(REQUEST_SUFFIX) || name.startsWith(".")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const request = parseApprovalRequest(raw);
      if (request) requests.push(request);
    } catch {
      // 读不动就跳过，下一轮再说
    }
  }

  return requests.sort((a, b) => a.at - b.at);
}

/** 答复用 .tmp + rename，钩子不会读到半截 */
export async function writeApprovalAnswer(
  dir: string,
  id: string,
  decision: ApprovalDecision
): Promise<void> {
  const payload = JSON.stringify({ id, decision, at: Date.now() });
  const target = join(dir, `${id}${ANSWER_SUFFIX}`);
  const tmp = join(dir, `.tmp-${id}-${process.pid}`);
  try {
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, target);
  } catch {
    await writeFile(target, payload, "utf8").catch(() => undefined);
  }
}

export async function dropApprovalRequest(dir: string, id: string): Promise<void> {
  await unlink(join(dir, `${id}${REQUEST_SUFFIX}`)).catch(() => undefined);
}
