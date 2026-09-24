// 本地持久化：重开页面后测点、复核、方案与修订记录仍能对应
import { ConsoleState, seedState } from "./domain";

const KEY = "hxwl-03-survey-console-v1";

export function loadState(): ConsoleState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as ConsoleState;
    if (!Array.isArray(parsed.holes) || !Array.isArray(parsed.points)) {
      return seedState();
    }
    return {
      holes: parsed.holes,
      points: parsed.points,
      reviews: parsed.reviews ?? [],
      plans: parsed.plans ?? [],
      revisions: parsed.revisions ?? [],
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: ConsoleState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅保留内存态，不打断现场录入
  }
}
