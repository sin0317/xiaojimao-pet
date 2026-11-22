import assert from "node:assert/strict";
import {
  buildStatusHookScript,
  hasWorkBuddyHooks,
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
      assert.ok(paths.scriptPath.endsWith(WORKBUDDY_HOOK_MARKER));
      assert.ok(paths.eventDir.endsWith("workbuddy-events"));
      assert.equal(paths.hookCommand, COMMAND);
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
