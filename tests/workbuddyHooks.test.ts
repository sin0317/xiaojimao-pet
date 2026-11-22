import assert from "node:assert/strict";
import {
  agentHookPaths,
  buildPowerShellHookScript,
  buildStatusHookScript,
  hasAgentHooks,
  hasWorkBuddyHooks,
  mergeAgentHooks,
  mergeWorkBuddyHooks,
  removeWorkBuddyHooks,
  toBashPath,
  workBuddyPaths,
  WORKBUDDY_HOOK_MARKER
} from "../src/main/workbuddyHooks";

const COMMAND = "bash '/c/Users/sin/.workbuddy/hooks/xiaojimao-status.sh'";

const EXISTING_CONFIG = {
  theme: "dark",
  hooks: {
    Stop: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "bash '/c/Users/sin/.wb-switch/hook.sh'" }]
      }
    ],
    FinalStop: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "bash '/c/Users/sin/.wb-switch/hook.sh'" }]
      }
    ]
  }
};

export const tests = [
  {
    name: "toBashPath converts Windows paths for Git Bash",
    run(): void {
      assert.equal(toBashPath("C:\\Users\\sin\\.xiaojimao\\workbuddy-events"), "/c/Users/sin/.xiaojimao/workbuddy-events");
      assert.equal(toBashPath("/already/posix"), "/already/posix");
    }
  },
  {
    name: "workBuddyPaths keeps everything under the home directory",
    run(): void {
      const paths = workBuddyPaths("C:\\Users\\sin");
      assert.ok(paths.settingsPath.endsWith("settings.json"));
      assert.ok(paths.scriptPath.includes(WORKBUDDY_HOOK_MARKER));
      assert.ok(paths.eventDir.endsWith("workbuddy-events"));
      assert.equal(paths.hookCommand, COMMAND);
    }
  },
  {
    name: "qoder and trae use their own config files and PowerShell",
    run(): void {
      const qoder = agentHookPaths("qoder", "C:\\Users\\sin");
      assert.ok(qoder.settingsPath.endsWith(".qoder\\settings.json"));
      assert.ok(qoder.hookCommand.startsWith("powershell"));
      assert.ok(qoder.hookCommand.includes("xiaojimao-status.ps1"));

      const trae = agentHookPaths("trae", "C:\\Users\\sin");
      assert.ok(trae.settingsPath.endsWith(".trae-cn\\hooks.json"));
      assert.ok(trae.scriptPath.endsWith("xiaojimao-status.ps1"));
    }
  },
  {
    name: "trae hook config only uses events trae supports",
    run(): void {
      const merged = mergeAgentHooks({}, "trae", "powershell -File xiaojimao-status.ps1") as {
        hooks: Record<string, unknown[]>;
      };
      assert.deepEqual(Object.keys(merged.hooks).sort(), [
        "Notification",
        "PreToolUse",
        "Stop",
        "UserPromptSubmit"
      ]);
      assert.ok(hasAgentHooks(merged, "trae"));
    }
  },
  {
    name: "powerShell hook script stamps the agent directory",
    run(): void {
      const script = buildPowerShellHookScript("C:\\Users\\sin\\.xiaojimao\\workbuddy-events", "Qoder");
      assert.match(script, /\$agent = 'Qoder'/);
      assert.match(script, /Join-Path \$root \$agent/);
      assert.match(script, /\[Console\]::In\.ReadToEnd\(\)/);
    }
  },
  {
    name: "hook script only writes a file and never blocks",
    run(): void {
      const script = buildStatusHookScript("C:\\Users\\sin\\.xiaojimao\\workbuddy-events");
      assert.match(script, /event_dir="\/c\/Users\/sin\/\.xiaojimao\/workbuddy-events"/);
      assert.match(script, /exit 0/);
      assert.match(script, /mv "\$tmp"/);
    }
  },
  {
    name: "merge keeps unrelated hooks and adds all bridge events",
    run(): void {
      const merged = mergeWorkBuddyHooks(EXISTING_CONFIG, COMMAND) as {
        theme: string;
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      assert.equal(merged.theme, "dark");
      const stopCommands = merged.hooks.Stop.map((entry) => entry.hooks[0].command);
      assert.ok(stopCommands.includes("bash '/c/Users/sin/.wb-switch/hook.sh'"));
      assert.ok(stopCommands.includes(COMMAND));

      for (const event of ["UserPromptSubmit", "PreToolUse", "Notification", "Stop", "FinalStop", "SessionEnd"]) {
        assert.ok(merged.hooks[event], `missing ${event}`);
      }
      assert.ok(hasWorkBuddyHooks(merged));
    }
  },
  {
    name: "merge is idempotent",
    run(): void {
      const once = mergeWorkBuddyHooks(EXISTING_CONFIG, COMMAND);
      const twice = mergeWorkBuddyHooks(once, COMMAND);
      assert.equal(JSON.stringify(once), JSON.stringify(twice));
    }
  },
  {
    name: "remove only strips the bridge hooks",
    run(): void {
      const merged = mergeWorkBuddyHooks(EXISTING_CONFIG, COMMAND);
      const cleaned = removeWorkBuddyHooks(merged) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      assert.equal(hasWorkBuddyHooks(cleaned), false);
      assert.deepEqual(
        Object.keys(cleaned.hooks).sort(),
        ["FinalStop", "Stop"],
        "user hooks stay, our extra events are dropped"
      );
      assert.equal(cleaned.hooks.Stop.length, 1);
      assert.match(cleaned.hooks.Stop[0].hooks[0].command, /wb-switch/);
    }
  }
];
