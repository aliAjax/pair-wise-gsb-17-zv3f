// 测斜复核与纠偏台：领域类型

/** 测点：每孔录倾角、方位角和测点时间，深度顺孔口向下排列 */
export interface InclinationPoint {
  id: string;
  holeId: string;
  /** 孔口向下深度（m） */
  depth: number;
  /** 倾角（°，相对铅垂线，>3° 须复核） */
  inclination: number;
  /** 方位角（0–360°） */
  azimuth: number;
  /** 测点时间 ISO 字符串 */
  measuredAt: string;
  /** 测量班次 */
  shift: string;
  /** 是否补测另开的测点 */
  isSupplement: boolean;
  /** 补测原因 */
  supplementReason?: string;
  /** 补测所替代的原测点 id */
  supersedesId?: string;
  /** 是否现行有效；被补测替代后置 false，记录保留 */
  active: boolean;
  createdAt: string;
}

export type ReviewResult = "passed" | "rejected";

/** 复核记录：超限测点留待复核，通过后才能安排纠偏 */
export interface Review {
  id: string;
  pointId: string;
  result: ReviewResult;
  reviewer: string;
  comment: string;
  reviewedAt: string;
  /** 复核时测点关键读数的签名，读数被修订后须重新复核 */
  signature: string;
}

export type PlanStatus = "planned" | "executed";

/** 纠偏方案：起始深度、纠偏方向、责任班次；执行后锁定 */
export interface CorrectionPlan {
  id: string;
  holeId: string;
  /** 触发本方案的超限测点 */
  pointId: string;
  /** 起始深度（m） */
  startDepth: number;
  /** 纠偏方向 */
  direction: string;
  /** 责任班次 */
  shift: string;
  note?: string;
  status: PlanStatus;
  createdAt: string;
  executedAt?: string;
  executedBy?: string;
}

/** 修订记录：测点修订、补测替代、复核、方案变更/执行/撤销均留痕 */
export interface Revision {
  id: string;
  kind: "point-edit" | "point-superseded" | "review" | "plan-create" | "plan-edit" | "plan-execute" | "plan-delete";
  /** 关联实体（测点或方案）id，保证可对应 */
  entityId: string;
  holeId: string;
  message: string;
  before?: string;
  after?: string;
  operator: string;
  at: string;
}

export interface AppState {
  points: InclinationPoint[];
  reviews: Review[];
  plans: CorrectionPlan[];
  revisions: Revision[];
}
