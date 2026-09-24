import { useEffect, useMemo, useReducer } from "react";
import type {
  AppState,
  CorrectionPlan,
  InclinationPoint,
  Review,
  ReviewResult,
  Revision,
} from "./types";
import {
  derive,
  latestReview,
  nowIso,
  reviewStateOf,
  seedState,
  signatureOf,
  STORAGE_KEY,
  uid,
} from "./domain";

// ── Actions ───────────────────────────────────────────────
type Action =
  | { type: "addPoint"; point: Omit<InclinationPoint, "id" | "active" | "createdAt">; operator: string }
  | {
      type: "editPoint";
      id: string;
      patch: Partial<Pick<InclinationPoint, "depth" | "inclination" | "azimuth" | "measuredAt" | "shift">>;
      operator: string;
    }
  | { type: "addSupplement"; originalId: string; point: Omit<InclinationPoint, "id" | "active" | "createdAt" | "holeId" | "isSupplement" | "supersedesId">; operator: string }
  | { type: "review"; pointId: string; result: ReviewResult; reviewer: string; comment: string }
  | { type: "createPlan"; plan: Omit<CorrectionPlan, "id" | "status" | "createdAt">; operator: string }
  | { type: "editPlan"; id: string; patch: Partial<Pick<CorrectionPlan, "startDepth" | "direction" | "shift" | "note">>; operator: string }
  | { type: "executePlan"; id: string; operator: string }
  | { type: "deletePlan"; id: string; operator: string }
  | { type: "reset" };

function revision(r: Omit<Revision, "id" | "at">): Revision {
  return { ...r, id: uid("rs"), at: nowIso() };
}

function assertUnblocked(state: AppState, pointId: string): InclinationPoint {
  const p = state.points.find((q) => q.id === pointId);
  if (!p) throw new Error("测点不存在");
  if (!p.active) throw new Error("该测点已被补测替代，不能操作");
  return p;
}

function assertPlanWritable(state: AppState, planId: string): CorrectionPlan {
  const pl = state.plans.find((q) => q.id === planId);
  if (!pl) throw new Error("方案不存在");
  if (pl.status === "executed") throw new Error("方案执行后已锁定，不能修改或撤销");
  return pl;
}

/** 安排纠偏前校验：触发测点须现行、超限且最新复核通过（读数未再被修订） */
function assertCanCreatePlan(state: AppState, pointId: string): InclinationPoint {
  const p = assertUnblocked(state, pointId);
  const d = derive(state.points).find((q) => q.id === pointId)!;
  if (!d.excess) throw new Error("该测点未超限，无需安排纠偏");
  const rs = reviewStateOf(p, d, state.reviews);
  if (rs !== "passed") throw new Error("复核通过后才能安排纠偏");
  return p;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "addPoint": {
      const point: InclinationPoint = {
        ...action.point,
        id: uid("pt"),
        active: true,
        createdAt: nowIso(),
      };
      const rev = revision({
        kind: "point-edit",
        entityId: point.id,
        holeId: point.holeId,
        message: `录入测点：深度 ${point.depth.toFixed(1)}m · 倾角 ${point.inclination}° · 方位 ${point.azimuth}°`,
        operator: action.operator,
      });
      return { ...state, points: [...state.points, point], revisions: [rev, ...state.revisions] };
    }

    case "editPoint": {
      const before = state.points.find((p) => p.id === action.id);
      if (!before) return state;
      const after = { ...before, ...action.patch };
      const dBefore = derive(state.points).find((q) => q.id === before.id)!;
      const editableFields = ["depth", "inclination", "azimuth", "shift", "measuredAt"] as const;
      type EditableField = (typeof editableFields)[number];
      const changedFields: EditableField[] = [];
      editableFields.forEach((f) => {
        if (before[f] !== after[f]) changedFields.push(f);
      });
      if (changedFields.length === 0) return state;
      // 读数被修订：历史复核签名不再匹配，自动回到"留待复核"
      const reopens =
        (before.depth !== after.depth ||
          before.inclination !== after.inclination ||
          before.azimuth !== after.azimuth) &&
        dBefore.excess &&
        latestReview(state.reviews, before.id)?.result === "passed";
      const rev = revision({
        kind: "point-edit",
        entityId: before.id,
        holeId: before.holeId,
        message:
          `修订测点 ${before.holeId} ${after.depth.toFixed(1)}m：` +
          changedFields.map((f) => `${f} ${String(before[f])} → ${String(after[f])}`).join("，") +
          (reopens ? "。读数已变，原复核失效，重新留待复核" : ""),
        before: signatureOf(before),
        after: signatureOf(after),
        operator: action.operator,
      });
      return {
        ...state,
        points: state.points.map((p) => (p.id === before.id ? after : p)),
        revisions: [rev, ...state.revisions],
      };
    }

    case "addSupplement": {
      const original = state.points.find((p) => p.id === action.originalId);
      if (!original) return state;
      const point: InclinationPoint = {
        ...action.point,
        id: uid("pt"),
        holeId: original.holeId,
        isSupplement: true,
        supersedesId: original.id,
        active: true,
        createdAt: nowIso(),
      };
      // 补测另开：原测点失效但记录保留
      const superseded: InclinationPoint = { ...original, active: false };
      const rev = revision({
        kind: "point-superseded",
        entityId: original.id,
        holeId: original.holeId,
        message:
          `补测另开新测点（深度 ${point.depth.toFixed(1)}m），原测点（${original.depth.toFixed(
            1
          )}m）失效保留。原因：${point.supplementReason ?? "—"}`,
        operator: action.operator,
      });
      return {
        ...state,
        points: [...state.points.map((p) => (p.id === original.id ? superseded : p)), point],
        revisions: [rev, ...state.revisions],
      };
    }

    case "review": {
      const p = assertUnblocked(state, action.pointId);
      const d = derive(state.points).find((q) => q.id === p.id)!;
      if (!d.excess) throw new Error("该测点未超限，无需复核");
      const review: Review = {
        id: uid("rv"),
        pointId: p.id,
        result: action.result,
        reviewer: action.reviewer,
        comment: action.comment,
        reviewedAt: nowIso(),
        signature: signatureOf(p),
      };
      const rev = revision({
        kind: "review",
        entityId: p.id,
        holeId: p.holeId,
        message:
          `复核${action.result === "passed" ? "通过" : "驳回"}（${d.excessText}）` +
          (action.comment ? `：${action.comment}` : ""),
        operator: action.reviewer,
      });
      return {
        ...state,
        reviews: [...state.reviews, review],
        revisions: [rev, ...state.revisions],
      };
    }

    case "createPlan": {
      assertCanCreatePlan(state, action.plan.pointId);
      const plan: CorrectionPlan = {
        ...action.plan,
        id: uid("pl"),
        status: "planned",
        createdAt: nowIso(),
      };
      const rev = revision({
        kind: "plan-create",
        entityId: plan.id,
        holeId: plan.holeId,
        message: `建立纠偏方案：起始 ${plan.startDepth.toFixed(1)}m · ${plan.direction} · ${plan.shift}`,
        operator: action.operator,
      });
      return { ...state, plans: [...state.plans, plan], revisions: [rev, ...state.revisions] };
    }

    case "editPlan": {
      const pl = assertPlanWritable(state, action.id);
      const after = { ...pl, ...action.patch };
      const fields = ["startDepth", "direction", "shift", "note"] as const;
      const changed = fields
        .filter((f) => pl[f] !== after[f])
        .map((f) => `${f}「${pl[f] ?? "—"}」→「${after[f] ?? "—"}」`);
      if (changed.length === 0) return state;
      const rev = revision({
        kind: "plan-edit",
        entityId: pl.id,
        holeId: pl.holeId,
        message: `修订纠偏方案：${changed.join("，")}`,
        operator: action.operator,
      });
      return {
        ...state,
        plans: state.plans.map((p) => (p.id === pl.id ? after : p)),
        revisions: [rev, ...state.revisions],
      };
    }

    case "executePlan": {
      const pl = assertPlanWritable(state, action.id);
      // 执行前再确认触发测点复核仍然有效
      assertCanCreatePlan(state, pl.pointId);
      const executed: CorrectionPlan = {
        ...pl,
        status: "executed",
        executedAt: nowIso(),
        executedBy: action.operator,
      };
      const rev = revision({
        kind: "plan-execute",
        entityId: pl.id,
        holeId: pl.holeId,
        message: "纠偏方案执行完成并锁定",
        operator: action.operator,
      });
      return {
        ...state,
        plans: state.plans.map((p) => (p.id === pl.id ? executed : p)),
        revisions: [rev, ...state.revisions],
      };
    }

    case "deletePlan": {
      const pl = assertPlanWritable(state, action.id);
      const rev = revision({
        kind: "plan-delete",
        entityId: pl.id,
        holeId: pl.holeId,
        message: `撤销未执行方案（起始 ${pl.startDepth.toFixed(1)}m · ${pl.direction}）`,
        operator: action.operator,
      });
      return {
        ...state,
        plans: state.plans.filter((p) => p.id !== pl.id),
        revisions: [rev, ...state.revisions],
      };
    }

    case "reset":
      return seedState();

    default:
      return state;
  }
}

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (Array.isArray(parsed.points) && Array.isArray(parsed.reviews)) return parsed;
    }
  } catch {
    // 存档损坏时回落到种子数据
  }
  return seedState();
}

export function useStation() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅影响持久化，不阻断现场录入
    }
  }, [state]);

  const derivedMap = useMemo(() => {
    const m = new Map(derive(state.points).map((d) => [d.id, d]));
    return m;
  }, [state.points]);

  return { state, dispatch, derivedMap };
}
