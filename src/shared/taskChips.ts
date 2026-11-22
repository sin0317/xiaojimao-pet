/**
 * 把会话列表按 agent 折叠成徽标（纯函数，方便单测）。
 *
 * 规则：同一个 agent 只出一张卡片，标签取它最「需要你」的那个状态；
 * **计数只算同状态的会话**——已完成的那条不能继续算进「任务中 ×N」。
 */

import type { WorkBuddyPhase, WorkBuddySession } from "./workbuddy";

export type TaskChipGroup = {
  key: string;
  agent: string;
  phase: WorkBuddyPhase;
  project: string;
  title: string;
  count: number;
};

const PHASE_ORDER: Record<WorkBuddyPhase, number> = { needsInput: 0, running: 1, done: 2 };

export function groupTaskChips(sessions: WorkBuddySession[]): TaskChipGroup[] {
  const groups: TaskChipGroup[] = [];
  const index = new Map<string, TaskChipGroup>();

  const sorted = [...sessions].sort(
    (a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || b.updatedAt - a.updatedAt
  );

  for (const session of sorted) {
    const agent = session.agent || "WorkBuddy";
    const existing = index.get(agent);
    if (existing) {
      if (existing.phase === session.phase) existing.count += 1;
      continue;
    }

    const group: TaskChipGroup = {
      key: `${agent}-${session.id}`,
      agent,
      phase: session.phase,
      project: session.project,
      title: session.title,
      count: 1
    };
    index.set(agent, group);
    groups.push(group);
  }

  return groups.slice(0, 3);
}
