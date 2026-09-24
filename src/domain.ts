// 测斜复核与纠偏台：领域模型、超限规则与种子数据

export const INCLINATION_LIMIT = 3; // 倾角超限阈值（°）
export const AZIMUTH_DELTA_LIMIT = 10; // 相邻测点方位角变化超限阈值（°）
export const SHIFTS = ["早班", "中班", "晚班"];

export type PointKind = "routine" | "supplementary"; // 常规测点 / 补测
export type ReviewStatus = "pending" | "passed" | "rejected";
export type PlanStatus = "scheduled" | "executed"; // executed 即锁定

export interface Hole {
  id: string; // 孔号，如 ZK-21
  designDepth: number; // 设计孔深 m
  createdAt: string;
}

export interface Flag {
  type: "inclination" | "azimuth";
  value: number; // 超限值
  limit: number; // 阈值
}

export interface SurveyPoint {
  id: string;
  holeId: string;
  depth: number; // 自孔口向下的深度 m
  inclination: number; // 倾角 °
  azimuth: number; // 方位角 °
  measuredAt: string; // 测点时间，本地 "YYYY-MM-DDTHH:mm"
  kind: PointKind;
  reason?: string; // 补测原因（补测必填）
  flags: Flag[]; // 录入时固化的超限结论，重开页面仍对应
  createdAt: string;
}

export interface Review {
  id: string;
  holeId: string;
  pointId: string; // 对应测点
  depth: number;
  flags: Flag[]; // 超限快照
  status: ReviewStatus;
  reviewer?: string;
  note?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface CorrectionPlan {
  id: string;
  holeId: string;
  reviewId: string; // 依据的复核记录（须已通过）
  startDepth: number; // 起始深度 m
  direction: string; // 纠偏方向
  shift: string; // 责任班次
  status: PlanStatus;
  createdAt: string;
  executedAt?: string; // 执行即锁定
}

export interface Revision {
  id: string;
  holeId: string;
  action: string; // 录入测点 / 补测登记 / 复核通过 / 复核退回 / 方案编制 / 方案执行锁定 / 新增钻孔
  detail: string;
  at: string;
}

export interface ConsoleState {
  holes: Hole[];
  points: SurveyPoint[];
  reviews: Review[];
  plans: CorrectionPlan[];
  revisions: Revision[];
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export function fmtShort(iso: string): string {
  return iso.slice(5, 16).replace("T", " ");
}

/** 方位角最小夹角，处理 0/360 环绕 */
export function azimuthDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.round((d > 180 ? 360 - d : d) * 10) / 10;
}

/** 深度顺孔口向下排（同深度按录入先后） */
export function sortPoints(points: SurveyPoint[]): SurveyPoint[] {
  return [...points].sort((a, b) => a.depth - b.depth || a.createdAt.localeCompare(b.createdAt));
}

/** 上一测点：同孔、严格更浅、深度最大者 */
export function previousPoint(
  points: SurveyPoint[],
  holeId: string,
  depth: number
): SurveyPoint | undefined {
  return sortPoints(points.filter((p) => p.holeId === holeId && p.depth < depth)).pop();
}

/** 超限判定：倾角 > 3° 或较上一测点方位变化 > 10° */
export function evaluateFlags(
  inclination: number,
  azimuth: number,
  prev?: SurveyPoint
): Flag[] {
  const flags: Flag[] = [];
  if (inclination > INCLINATION_LIMIT) {
    flags.push({ type: "inclination", value: inclination, limit: INCLINATION_LIMIT });
  }
  if (prev) {
    const d = azimuthDelta(azimuth, prev.azimuth);
    if (d > AZIMUTH_DELTA_LIMIT) {
      flags.push({ type: "azimuth", value: d, limit: AZIMUTH_DELTA_LIMIT });
    }
  }
  return flags;
}

export function flagText(f: Flag): string {
  return f.type === "inclination"
    ? `倾角 ${f.value}°（限 ${f.limit}°）`
    : `方位变化 ${f.value}°（限 ${f.limit}°）`;
}

export const REVIEW_STATUS_TEXT: Record<ReviewStatus, string> = {
  pending: "待复核",
  passed: "复核通过",
  rejected: "已退回",
};

export function seedState(): ConsoleState {
  const holes: Hole[] = [
    { id: "ZK-18", designDepth: 35, createdAt: "2026-09-23T07:50" },
    { id: "ZK-21", designDepth: 40, createdAt: "2026-09-24T07:40" },
    { id: "ZK-24", designDepth: 30, createdAt: "2026-09-23T13:50" },
  ];

  const points: SurveyPoint[] = [
    { id: "pt-zk18-1", holeId: "ZK-18", depth: 5, inclination: 0.8, azimuth: 42, measuredAt: "2026-09-23T08:10", kind: "routine", flags: [], createdAt: "2026-09-23T08:12" },
    { id: "pt-zk18-2", holeId: "ZK-18", depth: 10, inclination: 1.2, azimuth: 45, measuredAt: "2026-09-23T09:25", kind: "routine", flags: [], createdAt: "2026-09-23T09:27" },
    { id: "pt-zk18-3", holeId: "ZK-18", depth: 15, inclination: 1.6, azimuth: 47, measuredAt: "2026-09-23T10:40", kind: "routine", flags: [], createdAt: "2026-09-23T10:42" },
    { id: "pt-zk21-1", holeId: "ZK-21", depth: 6, inclination: 1.1, azimuth: 88, measuredAt: "2026-09-24T07:55", kind: "routine", flags: [], createdAt: "2026-09-24T07:57" },
    { id: "pt-zk21-2", holeId: "ZK-21", depth: 12, inclination: 2.4, azimuth: 95, measuredAt: "2026-09-24T09:10", kind: "routine", flags: [], createdAt: "2026-09-24T09:12" },
    {
      id: "pt-zk21-3", holeId: "ZK-21", depth: 18, inclination: 3.6, azimuth: 112,
      measuredAt: "2026-09-24T10:35", kind: "routine",
      flags: [
        { type: "inclination", value: 3.6, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 17, limit: AZIMUTH_DELTA_LIMIT },
      ],
      createdAt: "2026-09-24T10:36",
    },
    {
      id: "pt-zk21-4", holeId: "ZK-21", depth: 18, inclination: 3.4, azimuth: 110,
      measuredAt: "2026-09-24T11:20", kind: "supplementary",
      reason: "更换测斜仪后原位补测，确认偏斜属实",
      flags: [
        { type: "inclination", value: 3.4, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 15, limit: AZIMUTH_DELTA_LIMIT },
      ],
      createdAt: "2026-09-24T11:22",
    },
    { id: "pt-zk24-1", holeId: "ZK-24", depth: 5, inclination: 1.8, azimuth: 200, measuredAt: "2026-09-23T14:05", kind: "routine", flags: [], createdAt: "2026-09-23T14:07" },
    {
      id: "pt-zk24-2", holeId: "ZK-24", depth: 10, inclination: 3.2, azimuth: 214,
      measuredAt: "2026-09-23T15:20", kind: "routine",
      flags: [
        { type: "inclination", value: 3.2, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 14, limit: AZIMUTH_DELTA_LIMIT },
      ],
      createdAt: "2026-09-23T15:22",
    },
  ];

  const reviews: Review[] = [
    {
      id: "rw-zk21-1", holeId: "ZK-21", pointId: "pt-zk21-3", depth: 18,
      flags: [
        { type: "inclination", value: 3.6, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 17, limit: AZIMUTH_DELTA_LIMIT },
      ],
      status: "pending", createdAt: "2026-09-24T10:36",
    },
    {
      id: "rw-zk21-2", holeId: "ZK-21", pointId: "pt-zk21-4", depth: 18,
      flags: [
        { type: "inclination", value: 3.4, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 15, limit: AZIMUTH_DELTA_LIMIT },
      ],
      status: "passed", reviewer: "王工", note: "复测确认超限属实，同意自 18.0m 起纠",
      reviewedAt: "2026-09-24T11:50", createdAt: "2026-09-24T11:22",
    },
    {
      id: "rw-zk24-1", holeId: "ZK-24", pointId: "pt-zk24-2", depth: 10,
      flags: [
        { type: "inclination", value: 3.2, limit: INCLINATION_LIMIT },
        { type: "azimuth", value: 14, limit: AZIMUTH_DELTA_LIMIT },
      ],
      status: "passed", reviewer: "王工", note: "超限属实",
      reviewedAt: "2026-09-23T16:10", createdAt: "2026-09-23T15:22",
    },
  ];

  const plans: CorrectionPlan[] = [
    {
      id: "pl-zk21-1", holeId: "ZK-21", reviewId: "rw-zk21-2", startDepth: 18,
      direction: "向方位 095° 一侧扫面回纠，倾角压至 2.5° 以内",
      shift: "中班", status: "scheduled", createdAt: "2026-09-24T12:05",
    },
    {
      id: "pl-zk24-1", holeId: "ZK-24", reviewId: "rw-zk24-1", startDepth: 10,
      direction: "向方位 200° 回纠，每 5m 复测倾角",
      shift: "早班", status: "executed",
      createdAt: "2026-09-23T16:30", executedAt: "2026-09-23T18:40",
    },
  ];

  const revisions: Revision[] = [
    { id: "rv-09", holeId: "ZK-21", action: "方案编制", detail: "起始深度 18.0m，中班，向方位 095° 回纠", at: "2026-09-24T12:05" },
    { id: "rv-08", holeId: "ZK-21", action: "复核通过", detail: "18.0m 补测点，王工：复测确认超限属实", at: "2026-09-24T11:50" },
    { id: "rv-07", holeId: "ZK-21", action: "补测登记", detail: "18.0m 倾角 3.4° 方位 110°，原因：更换测斜仪后原位补测，超限留待复核", at: "2026-09-24T11:22" },
    { id: "rv-06", holeId: "ZK-21", action: "录入测点", detail: "18.0m 倾角 3.6° 方位 112°，超限留待复核（倾角 3.6°、方位变化 17°）", at: "2026-09-24T10:36" },
    { id: "rv-05", holeId: "ZK-24", action: "方案执行锁定", detail: "起始深度 10.0m，早班，执行后锁定", at: "2026-09-23T18:40" },
    { id: "rv-04", holeId: "ZK-24", action: "方案编制", detail: "起始深度 10.0m，早班，向方位 200° 回纠", at: "2026-09-23T16:30" },
    { id: "rv-03", holeId: "ZK-24", action: "复核通过", detail: "10.0m 测点，王工：超限属实", at: "2026-09-23T16:10" },
    { id: "rv-02", holeId: "ZK-24", action: "录入测点", detail: "10.0m 倾角 3.2° 方位 214°，超限留待复核（倾角 3.2°、方位变化 14°）", at: "2026-09-23T15:22" },
    { id: "rv-01", holeId: "ZK-18", action: "录入测点", detail: "15.0m 倾角 1.6° 方位 047°，未见超限", at: "2026-09-23T10:42" },
  ];

  return { holes, points, reviews, plans, revisions };
}
