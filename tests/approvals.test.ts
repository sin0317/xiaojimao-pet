import assert from "node:assert/strict";
import { isApprovalExpired, parseApprovalRequest } from "../src/main/approvals";
import { mergeAgentHooks, removeWorkBuddyHooks } from "../src/main/workbuddyHooks";

const NOW = 1_700_000_000_000;

function request(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "a1",
    agent: "Qoder",
    tool: "Bash",
    detail: '{"command":"rm -rf build"}',
    at: NOW / 1000,
    expiresAt: NOW / 1000 + 25,
    ...overrides
  });
}

export const tests = [
  {
    name: "parseApprovalRequest reads the hook payload",
    run(): void {
      const parsed = parseApprovalRequest(request());
      assert.ok(parsed);
      assert.equal(parsed.id, "a1");
      assert.equal(parsed.agent, "Qoder");
      assert.equal(parsed.tool, "Bash");
      assert.ok(parsed.detail.includes("rm -rf"));
    }
  },
  {
    name: "parseApprovalRequest rejects broken input",
    run(): void {
      assert.equal(parseApprovalRequest("not json"), null);
      assert.equal(parseApprovalRequest("[]"), null);
      assert.equal(parseApprovalRequest(JSON.stringify({ agent: "Qoder" })), null);
    }
  },
  {
    name: "expiry is compared in milliseconds",
    run(): void {
      const parsed = parseApprovalRequest(request());
      assert.ok(parsed);
      assert.equal(isApprovalExpired(parsed, NOW + 24_000), false);
      assert.equal(isApprovalExpired(parsed, NOW + 26_000), true);
    }
  },
  {
    name: "qoder gets a blocking PermissionRequest hook",
    run(): void {
      const merged = mergeAgentHooks(
        {},
        "qoder",
        'powershell -File "xiaojimao-status.ps1"',
        'powershell -File "xiaojimao-approve.ps1"'
      ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>> };

      assert.ok(Array.isArray(merged.hooks.PermissionRequest));
      const command = merged.hooks.PermissionRequest[0].hooks[0].command;
      assert.ok(command.includes("xiaojimao-approve"));
      // 审批要给人留时间，超时必须比普通事件长
      assert.ok(merged.hooks.PermissionRequest[0].hooks[0].timeout >= 30);
    }
  },
  {
    name: "trae never gets an approval hook",
    run(): void {
      const merged = mergeAgentHooks(
        {},
        "trae",
        'powershell -File "xiaojimao-status.ps1"',
        ""
      ) as { hooks: Record<string, unknown> };
      assert.equal(merged.hooks.PermissionRequest, undefined);
    }
  },
  {
    name: "uninstall also strips the approval hook",
    run(): void {
      const merged = mergeAgentHooks(
        {},
        "qoder",
        'powershell -File "xiaojimao-status.ps1"',
        'powershell -File "xiaojimao-approve.ps1"'
      );
      const cleaned = removeWorkBuddyHooks(merged) as { hooks?: Record<string, unknown> };
      assert.equal(cleaned.hooks, undefined);
    }
  }
];
