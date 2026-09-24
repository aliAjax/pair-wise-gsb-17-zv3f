import type {
  AppState,
  CorrectionPlan,
  InclinationPoint,
  Review,
} from "./types";

// ── 规则阈值 ──────────────────────────────────────────────
/** 倾角超过 3°（严格大于）须留待复核 */
export const INCLINATION_LIMIT = 3;
/** 方位变化超过 10°（严格大于，按圆周最短角差）须留待复核 */
export const AZIMUTH_LIMIT = 10;
export const STORAGE_KEY = "hxwl-03-inclination-station-v1";

export const DIRECTION_PRESETS = [
  "向正北回摆",
  "向正东回摆",
  "向正南回摆",
  "向正西回摆",
  "减缓倾角（回铅垂）",
  "人工方位，见备注",
];

// ── 几何计算 ──────────────────────────────────────────────
/** 圆周上两方位角的最短角差（0–180°） */
export function azimuthDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface DerivedPoint extends InclinationPoint {
  /** 与同孔上一现行测点的方位角变化（°），孔口首点为 null */
  azimuthChange: number | null;
  inclOver: boolean;
  azimuthOver: boolean;
  /** 任一超限：留待复核 */
  excess: boolean;
  /** 超限值描述 */
  excessText: string;
}

/** 取某孔现行测点，按深度顺孔口向下排列（浅 → 深） */
export function activeChain(points: InclinationPoint[], holeId: string): InclinationPoint[] {
  return points
    .filter((p) => p.holeId === holeId && p.active)
    .slice()
    .sort((a, b) => a.depth - b.depth);
}

export function derive(points: InclinationPoint[]): DerivedPoint[] {
  const holeIds = Array.from(new Set(points.filter((p) => p.active).map((p) => p.holeId)));
  const byHole = new Map<string, InclinationPoint[]>();
  for (const id of holeIds) byHole.set(id, activeChain(points, id));

  return points.map((p) => {
    let azimuthChange: number | null = null;
    if (p.active) {
      const chain = byHole.get(p.holeId) ?? [];
      const idx = chain.findIndex((q) => q.id === p.id);
      if (idx > 0) {
        azimuthChange = azimuthDelta(chain[idx].azimuth, chain[idx - 1].azimuth);
      }
    } else {
      // 已被补测替代：用存档时的下一深度现行点估算变化仅供展示
      const chain = byHole.get(p.holeId) ?? [];
      const shallower = chain.filter((q) => q.depth < p.depth).pop();
      if (shallower) azimuthChange = azimuthDelta(p.azimuth, shallower.azimuth);
    }
    const inclOver = p.inclination > INCLINATION_LIMIT;
    const azimuthOver = azimuthChange !== null && azimuthChange > AZIMUTH_LIMIT;
    const excessText = [
      inclOver ? `倾角 ${p.inclination.toFixed(1)}° > ${INCLINATION_LIMIT}°` : "",
      azimuthOver ? `方位变化 ${azimuthChange!.toFixed(1)}° > ${AZIMUTH_LIMIT}°` : "",
    ]
      .filter(Boolean)
      .join("；");
    return {
      ...p,
      azimuthChange,
      inclOver,
      azimuthOver,
      excess: inclOver || azimuthOver,
      excessText,
    };
  });
}

// ── 复核状态 ──────────────────────────────────────────────
/** 测点读数签名；读数被修订后签名不符，须重新复核 */
export function signatureOf(p: InclinationPoint): string {
  return `${p.depth}|${p.inclination}|${p.azimuth}`;
}

export type ReviewState =
  | "normal" // 未超限，无需复核
  | "pending" // 超限待复核
  | "passed" // 最新一次复核通过，且签名一致
  | "rejected"; // 最新一次复核驳回 / 或签名已失效（读数被改）

export function latestReview(reviews: Review[], pointId: string): Review | undefined {
  return reviews
    .filter((r) => r.pointId === pointId)
    .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))[0];
}

export function reviewStateOf(
  p: InclinationPoint,
  derived: DerivedPoint,
  reviews: Review[]
): ReviewState {
  if (!p.active) return "normal";
  if (!derived.excess) return "normal";
  const latest = latestReview(reviews, p.id);
  if (!latest) return "pending";
  if (latest.signature !== signatureOf(p)) return "pending"; // 读数已修订，重新留待复核
  return latest.result === "passed" ? "passed" : "rejected";
}

/** 受阻：现行、超限、未复核通过 —— 不能安排纠偏 */
export interface BlockedItem {
  holeId: string;
  depth: number;
  excessText: string;
  state: ReviewState;
  pointId: string;
}

export function blockedList(state: AppState): BlockedItem[] {
  const derived = derive(state.points);
  const map = new Map(derived.map((d) => [d.id, d]));
  return state.points
    .filter((p) => p.active)
    .map((p) => ({ p, d: map.get(p.id)! }))
    .filter(({ p, d }) => {
      const rs = reviewStateOf(p, d, state.reviews);
      return d.excess && rs !== "passed";
    })
    .map(({ p, d }) => ({
      holeId: p.holeId,
      depth: p.depth,
      excessText: d.excessText,
      state: reviewStateOf(p, d, state.reviews),
      pointId: p.id,
    }))
    .sort((a, b) => (a.holeId === b.holeId ? a.depth - b.depth : a.holeId < b.holeId ? -1 : 1));
}

// ── 杂项 ──────────────────────────────────────────────────
export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** datetime-local 值 ↔ ISO */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function holeIdsOf(points: InclinationPoint[]): string[] {
  return Array.from(new Set(points.map((p) => p.holeId))).sort();
}

export function planLockViolations(
  points: InclinationPoint[],
  plans: CorrectionPlan[]
): string[] {
  // 执行后锁定的方案，其测点不应再被补测替代；出现即提示数据一致性问题
  return plans
    .filter((pl) => pl.status === "executed")
    .filter((pl) => {
      const p = points.find((q) => q.id === pl.pointId);
      return p && !p.active;
    })
    .map((pl) => `${pl.holeId} 起始 ${pl.startDepth.toFixed(1)}m 的已执行方案对应测点被补测替代`);
}

// ── 种子数据（重开页面时演示四类记录如何对应） ─────────────
const seedPoints: InclinationPoint[] = [
  // ZK-18：正常进尺 + 一段已复核并执行锁定的纠偏
  { id: "pt-z18-1", holeId: "ZK-18", depth: 0.5, inclination: 0.6, azimuth: 82, measuredAt: "2026-09-20T08:30", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-20T08:32" },
  { id: "pt-z18-2", holeId: "ZK-18", depth: 5.0, inclination: 1.2, azimuth: 85, measuredAt: "2026-09-20T10:05", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-20T10:07" },
  { id: "pt-z18-3", holeId: "ZK-18", depth: 10.0, inclination: 4.2, azimuth: 99, measuredAt: "2026-09-20T11:40", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-20T11:42" },
  { id: "pt-z18-4", holeId: "ZK-18", depth: 15.0, inclination: 1.8, azimuth: 93, measuredAt: "2026-09-20T14:10", shift: "乙班", isSupplement: false, active: true, createdAt: "2026-09-20T14:12" },
  // ZK-21：倾角 + 方位双超限，一次驳回后仍待复核，纠偏安排受阻
  { id: "pt-z21-1", holeId: "ZK-21", depth: 0.5, inclination: 0.8, azimuth: 140, measuredAt: "2026-09-21T08:20", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-21T08:22" },
  { id: "pt-z21-2", holeId: "ZK-21", depth: 6.0, inclination: 4.8, azimuth: 158, measuredAt: "2026-09-21T09:50", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-21T09:52" },
  { id: "pt-z21-3", holeId: "ZK-21", depth: 12.0, inclination: 2.1, azimuth: 165, measuredAt: "2026-09-21T11:15", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-21T11:17" },
  // ZK-24：补测另开 + 原测点被替代（留痕）
  { id: "pt-z24-1", holeId: "ZK-24", depth: 0.5, inclination: 0.5, azimuth: 200, measuredAt: "2026-09-22T08:10", shift: "甲班", isSupplement: false, active: true, createdAt: "2026-09-22T08:12" },
  { id: "pt-z24-2", holeId: "ZK-24", depth: 4.0, inclination: 3.4, azimuth: 205, measuredAt: "2026-09-22T09:30", shift: "甲班", isSupplement: false, active: false, createdAt: "2026-09-22T09:32" },
  { id: "pt-z24-2s", holeId: "ZK-24", depth: 4.0, inclination: 1.1, azimuth: 202, measuredAt: "2026-09-22T15:20", shift: "乙班", isSupplement: true, supplementReason: "复测怀疑测斜仪遇套管边，换仪器重新测斜", supersedesId: "pt-z24-2", active: true, createdAt: "2026-09-22T15:22" },
];

const seedReviews: Review[] = [
  { id: "rv-1", pointId: "pt-z18-3", result: "passed", reviewer: "周岩（项目负责人）", comment: "卵石层换层导致，已配纠斜钻具，同意安排纠偏", reviewedAt: "2026-09-20T12:05", signature: signatureOf(seedPoints[2]) },
  { id: "rv-2", pointId: "pt-z21-2", result: "rejected", reviewer: "周岩（项目负责人）", comment: "先排查孔底沉渣与钻具磨损，补充测斜后再报", reviewedAt: "2026-09-21T10:30", signature: signatureOf(seedPoints[4]) },
];

const seedPlans: CorrectionPlan[] = [
  { id: "pl-1", holeId: "ZK-18", pointId: "pt-z18-3", startDepth: 10.0, direction: "向正北回摆", shift: "乙班", note: "纠斜钻具，每钻进 1m 测斜一次", status: "executed", createdAt: "2026-09-20T12:20", executedAt: "2026-09-20T16:40", executedBy: "乙班 班长" },
];

const seedRevisions = [
  { id: "rs-1", kind: "review" as const, entityId: "pt-z18-3", holeId: "ZK-18", message: "复核通过（倾角 4.2°、方位变化 14°）", operator: "周岩（项目负责人）", at: "2026-09-20T12:05" },
  { id: "rs-2", kind: "plan-create" as const, entityId: "pl-1", holeId: "ZK-18", message: "建立纠偏方案：起始 10.0m · 向正北回摆 · 乙班", operator: "周岩（项目负责人）", at: "2026-09-20T12:20" },
  { id: "rs-3", kind: "plan-execute" as const, entityId: "pl-1", holeId: "ZK-18", message: "方案执行完成并锁定", operator: "乙班 班长", at: "2026-09-20T16:40" },
  { id: "rs-4", kind: "review" as const, entityId: "pt-z21-2", holeId: "ZK-21", message: "复核驳回（倾角 4.8°、方位变化 18°）：先排查孔底情况再报", operator: "周岩（项目负责人）", at: "2026-09-21T10:30" },
  { id: "rs-6", kind: "point-superseded" as const, entityId: "pt-z24-2", holeId: "ZK-24", message: "补测另开测点 pt-z24-2s，原测点 4.0m 失效保留。原因：复测怀疑测斜仪遇套管边，换仪器重新测斜", operator: "现场编录员", at: "2026-09-22T15:22" },
];

export function seedState(): AppState {
  return {
    points: seedPoints,
    reviews: seedReviews,
    plans: seedPlans,
    revisions: seedRevisions as AppState["revisions"],
  };
}
