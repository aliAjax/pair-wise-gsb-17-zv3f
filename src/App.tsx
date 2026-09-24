import { useMemo, useState, type ReactNode } from "react";
import "./styles.css";
import type { CorrectionPlan, InclinationPoint, ReviewResult } from "./types";
import type { DerivedPoint } from "./domain";
import {
  AZIMUTH_LIMIT,
  blockedList,
  DIRECTION_PRESETS,
  formatTime,
  holeIdsOf,
  INCLINATION_LIMIT,
  isoToLocalInput,
  reviewStateOf,
  signatureOf,
  latestReview,
} from "./domain";
import { useStation } from "./store";

type Tab = "points" | "review" | "plans" | "revisions";

const SHIFTS = ["甲班", "乙班", "丙班"];
const REVIEW_LABEL: Record<string, { text: string; cls: string }> = {
  normal: { text: "正常", cls: "badge-ok" },
  pending: { text: "待复核", cls: "badge-danger" },
  rejected: { text: "复核驳回", cls: "badge-warn" },
  passed: { text: "复核通过", cls: "badge-ok" },
};

function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString());
}

// ── 小部件 ────────────────────────────────────────────────
function Badge({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ── 测点录入 ──────────────────────────────────────────────
function PointEntryForm({
  holes,
  defaultHole,
  defaultShift,
  onSubmit,
}: {
  holes: string[];
  defaultHole: string;
  defaultShift: string;
  onSubmit: (p: {
    holeId: string;
    depth: number;
    inclination: number;
    azimuth: number;
    measuredAt: string;
    shift: string;
  }) => void;
}) {
  const [holeId, setHoleId] = useState(defaultHole);
  const [depth, setDepth] = useState("");
  const [inclination, setInclination] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocalInput());
  const [shift, setShift] = useState(defaultShift || "甲班");
  const [err, setErr] = useState("");

  const submit = () => {
    const d = Number(depth);
    const inc = Number(inclination);
    const az = Number(azimuth);
    if (!holeId.trim()) return setErr("请填写孔号");
    if (!(d >= 0)) return setErr("深度须为不小于 0 的数字（顺孔口向下，米）");
    if (!(inc >= 0 && inc <= 90)) return setErr("倾角须在 0–90° 之间");
    if (!(az >= 0 && az < 360)) return setErr("方位角须在 0–360° 之间");
    if (!measuredAt) return setErr("请填写测点时间");
    onSubmit({
      holeId: holeId.trim().toUpperCase(),
      depth: d,
      inclination: inc,
      azimuth: az,
      measuredAt: new Date(measuredAt).toISOString(),
      shift,
    });
    setDepth("");
    setInclination("");
    setAzimuth("");
    setErr("");
  };

  return (
    <div className="entry-form">
      <div className="form-grid">
        <Field label="钻孔编号">
          <input list="hole-list" value={holeId} onChange={(e) => setHoleId(e.target.value)} placeholder="如 ZK-25" />
          <datalist id="hole-list">
            {holes.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </Field>
        <Field label="深度（m，孔口向下）">
          <input type="number" step="0.1" min="0" value={depth} onChange={(e) => setDepth(e.target.value)} placeholder="如 6.0" />
        </Field>
        <Field label={`倾角（°，>${INCLINATION_LIMIT}° 复核）`}>
          <input type="number" step="0.1" min="0" max="90" value={inclination} onChange={(e) => setInclination(e.target.value)} placeholder="如 4.2" />
        </Field>
        <Field label={`方位角（°，变化 >${AZIMUTH_LIMIT}° 复核）`}>
          <input type="number" step="1" min="0" max="360" value={azimuth} onChange={(e) => setAzimuth(e.target.value)} placeholder="0–360" />
        </Field>
        <Field label="测点时间">
          <input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </Field>
        <Field label="测量班次">
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {err && <p className="form-error">{err}</p>}
      <button className="primary-action" onClick={submit}>
        录入测点
      </button>
    </div>
  );
}

// ── 修订测点读数 ──────────────────────────────────────────
function PointEditForm({
  point,
  onCancel,
  onSave,
}: {
  point: InclinationPoint;
  onCancel: () => void;
  onSave: (patch: Partial<Pick<InclinationPoint, "depth" | "inclination" | "azimuth" | "measuredAt" | "shift">>) => void;
}) {
  const [depth, setDepth] = useState(String(point.depth));
  const [inclination, setInclination] = useState(String(point.inclination));
  const [azimuth, setAzimuth] = useState(String(point.azimuth));
  const [measuredAt, setMeasuredAt] = useState(isoToLocalInput(point.measuredAt));
  const [shift, setShift] = useState(point.shift);
  const [err, setErr] = useState("");

  const save = () => {
    const d = Number(depth);
    const inc = Number(inclination);
    const az = Number(azimuth);
    if (!(d >= 0)) return setErr("深度须为不小于 0 的数字");
    if (!(inc >= 0 && inc <= 90)) return setErr("倾角须在 0–90° 之间");
    if (!(az >= 0 && az < 360)) return setErr("方位角须在 0–360° 之间");
    onSave({
      depth: d,
      inclination: inc,
      azimuth: az,
      measuredAt: new Date(measuredAt).toISOString(),
      shift,
    });
  };

  return (
    <div className="inline-form">
      <p className="inline-hint">修订读数将记入修订记录；若超限读数变化，原复核失效并重新留待复核。</p>
      <div className="form-grid">
        <Field label="深度（m）">
          <input type="number" step="0.1" min="0" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </Field>
        <Field label="倾角（°）">
          <input type="number" step="0.1" min="0" max="90" value={inclination} onChange={(e) => setInclination(e.target.value)} />
        </Field>
        <Field label="方位角（°）">
          <input type="number" step="1" min="0" max="360" value={azimuth} onChange={(e) => setAzimuth(e.target.value)} />
        </Field>
        <Field label="测点时间">
          <input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </Field>
        <Field label="测量班次">
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {err && <p className="form-error">{err}</p>}
      <div className="inline-actions">
        <button className="primary-action" onClick={save}>
          保存修订
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

// ── 补测另开 ──────────────────────────────────────────────
function SupplementForm({
  original,
  defaultShift,
  onCancel,
  onSave,
}: {
  original: InclinationPoint;
  defaultShift: string;
  onCancel: () => void;
  onSave: (p: {
    depth: number;
    inclination: number;
    azimuth: number;
    measuredAt: string;
    shift: string;
    supplementReason: string;
  }) => void;
}) {
  const [depth, setDepth] = useState(String(original.depth));
  const [inclination, setInclination] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocalInput());
  const [shift, setShift] = useState(defaultShift || "乙班");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  const save = () => {
    const d = Number(depth);
    const inc = Number(inclination);
    const az = Number(azimuth);
    if (!(d >= 0)) return setErr("深度须为不小于 0 的数字");
    if (!(inc >= 0 && inc <= 90)) return setErr("倾角须在 0–90° 之间");
    if (!(az >= 0 && az < 360)) return setErr("方位角须在 0–360° 之间");
    if (!reason.trim()) return setErr("补测必须写明原因");
    onSave({
      depth: d,
      inclination: inc,
      azimuth: az,
      measuredAt: new Date(measuredAt).toISOString(),
      shift,
      supplementReason: reason.trim(),
    });
  };

  return (
    <div className="inline-form">
      <p className="inline-hint">
        补测另开新测点，原测点（{original.holeId} {original.depth.toFixed(1)}m）失效但记录保留，两测点通过修订记录对应。
      </p>
      <div className="form-grid">
        <Field label="补测深度（m）">
          <input type="number" step="0.1" min="0" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </Field>
        <Field label="倾角（°）">
          <input type="number" step="0.1" min="0" max="90" value={inclination} onChange={(e) => setInclination(e.target.value)} />
        </Field>
        <Field label="方位角（°）">
          <input type="number" step="1" min="0" max="360" value={azimuth} onChange={(e) => setAzimuth(e.target.value)} />
        </Field>
        <Field label="补测时间">
          <input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </Field>
        <Field label="测量班次">
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="补测原因（必填）">
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：复测怀疑测斜仪遇套管边，换仪器重新测斜" />
      </Field>
      {err && <p className="form-error">{err}</p>}
      <div className="inline-actions">
        <button className="primary-action" onClick={save}>
          另开补测
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

// ── 复核卡片 ──────────────────────────────────────────────
function ReviewCard({
  point,
  derived,
  state,
  defaultReviewer,
  onReview,
}: {
  point: InclinationPoint;
  derived: DerivedPoint;
  state: ReturnType<typeof useStation>["state"];
  defaultReviewer: string;
  onReview: (pointId: string, result: ReviewResult, reviewer: string, comment: string) => void;
}) {
  const rs = reviewStateOf(point, derived, state.reviews);
  const [reviewer, setReviewer] = useState(defaultReviewer);
  const [comment, setComment] = useState("");
  const history = state.reviews
    .filter((r) => r.pointId === point.id)
    .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));

  return (
    <article className={`review-card ${rs === "rejected" ? "rejected" : ""}`}>
      <header>
        <div>
          <h3>
            {point.holeId} · {point.depth.toFixed(1)}m
          </h3>
          <p className="excess-line">超限：{derived.excessText}</p>
        </div>
        <Badge cls={REVIEW_LABEL[rs].cls}>{REVIEW_LABEL[rs].text}</Badge>
      </header>
      <div className="kv-row">
        <span>倾角 {point.inclination}°</span>
        <span>
          方位 {point.azimuth}°（变化{" "}
          {derived.azimuthChange === null ? "孔口首点" : `${derived.azimuthChange!.toFixed(1)}°`}）
        </span>
        <span>{formatTime(point.measuredAt)} · {point.shift}</span>
      </div>
      <div className="review-form">
        <Field label="复核人">
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="姓名（岗位）" />
        </Field>
        <Field label="复核意见">
          <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="通过后才能安排纠偏；驳回请写明排查/补测要求" />
        </Field>
        <div className="inline-actions">
          <button
            className="primary-action"
            onClick={() => reviewer.trim() && onReview(point.id, "passed", reviewer.trim(), comment.trim())}
          >
            复核通过
          </button>
          <button className="danger-action" onClick={() => reviewer.trim() && onReview(point.id, "rejected", reviewer.trim(), comment.trim())}>
            驳回
          </button>
          {!reviewer.trim() && <span className="form-error">请先填写复核人</span>}
        </div>
      </div>
      {history.length > 0 && (
        <ul className="history-list">
          {history.map((r) => {
            const validNow = r.signature === signatureOf(point);
            return (
              <li key={r.id}>
                <Badge cls={r.result === "passed" ? "badge-ok" : "badge-warn"}>
                  {r.result === "passed" ? "通过" : "驳回"}
                </Badge>
                <span>
                  {r.reviewer} · {formatTime(r.reviewedAt)}
                  {r.comment ? `：${r.comment}` : ""}
                  {!validNow && <em className="stale">（读数已修订，本次复核失效）</em>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

// ── 纠偏方案 ──────────────────────────────────────────────
function PlanCreateForm({
  state,
  derivedMap,
  defaultShift,
  onCreate,
}: {
  state: ReturnType<typeof useStation>["state"];
  derivedMap: ReturnType<typeof useStation>["derivedMap"];
  defaultShift: string;
  onCreate: (plan: Omit<CorrectionPlan, "id" | "status" | "createdAt">) => void;
}) {
  // 可选测点：现行、超限、复核通过、且尚无方案
  const options = state.points.filter((p) => {
    const d = derivedMap.get(p.id)!;
    if (!p.active || !d.excess) return false;
    if (reviewStateOf(p, d, state.reviews) !== "passed") return false;
    return !state.plans.some((pl) => pl.pointId === p.id);
  });

  const [pointId, setPointId] = useState("");
  const point = state.points.find((p) => p.id === pointId);
  const [startDepth, setStartDepth] = useState("");
  const [direction, setDirection] = useState("");
  const [shift, setShift] = useState(defaultShift || "甲班");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  if (options.length === 0) {
    return <p className="empty-hint">暂无可安排纠偏的测点——超限测点须先复核通过，且一个测点只建一个方案。</p>;
  }

  const choose = (id: string) => {
    setPointId(id);
    const p = state.points.find((q) => q.id === id);
    setStartDepth(p ? String(p.depth) : "");
    setErr("");
  };

  const create = () => {
    if (!point) return setErr("请选择复核通过的超限测点");
    const sd = Number(startDepth);
    if (!(sd >= 0)) return setErr("起始深度须为不小于 0 的数字");
    if (!direction.trim()) return setErr("请填写纠偏方向");
    onCreate({
      holeId: point.holeId,
      pointId: point.id,
      startDepth: sd,
      direction: direction.trim(),
      shift,
      note: note.trim() || undefined,
    });
    setPointId("");
    setStartDepth("");
    setDirection("");
    setNote("");
    setErr("");
  };

  return (
    <div className="entry-form">
      <div className="form-grid">
        <Field label="超限测点（已复核通过）">
          <select value={pointId} onChange={(e) => choose(e.target.value)}>
            <option value="">请选择…</option>
            {options.map((p) => {
              const d = derivedMap.get(p.id)!;
              return (
                <option key={p.id} value={p.id}>
                  {p.holeId} · {p.depth.toFixed(1)}m（{d.excessText}）
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="起始深度（m）">
          <input type="number" step="0.1" min="0" value={startDepth} onChange={(e) => setStartDepth(e.target.value)} />
        </Field>
        <Field label="纠偏方向">
          <input list="direction-list" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="如 向正北回摆" />
          <datalist id="direction-list">
            {DIRECTION_PRESETS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <Field label="责任班次">
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="方案备注">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="钻具组合、复测要求等" />
      </Field>
      {err && <p className="form-error">{err}</p>}
      <button className="primary-action" onClick={create}>
        建立纠偏方案
      </button>
    </div>
  );
}

function PlanCard({
  plan,
  point,
  onExecute,
  onEdit,
  onDelete,
}: {
  plan: CorrectionPlan;
  point?: InclinationPoint;
  onExecute: (id: string) => void;
  onEdit: (id: string, patch: Partial<Pick<CorrectionPlan, "startDepth" | "direction" | "shift" | "note">>) => void;
  onDelete: (id: string) => void;
}) {
  const locked = plan.status === "executed";
  const [editing, setEditing] = useState(false);
  const [startDepth, setStartDepth] = useState(String(plan.startDepth));
  const [direction, setDirection] = useState(plan.direction);
  const [shift, setShift] = useState(plan.shift);
  const [note, setNote] = useState(plan.note ?? "");

  return (
    <article className={`plan-card ${locked ? "locked" : ""}`}>
      <header>
        <div>
          <h3>
            {plan.holeId} · 起始 {plan.startDepth.toFixed(1)}m
          </h3>
          <p>
            方向：<strong>{plan.direction}</strong> · 责任班次：<strong>{plan.shift}</strong>
          </p>
        </div>
        {locked ? <Badge cls="badge-lock">已执行 · 锁定</Badge> : <Badge cls="badge-warn">待执行</Badge>}
      </header>
      <div className="kv-row">
        <span>关联测点：{point ? `${point.depth.toFixed(1)}m（倾角 ${point.inclination}° / 方位 ${point.azimuth}°）` : "原测点已不存在"}</span>
        <span>建立于 {formatTime(plan.createdAt)}</span>
        {locked && <span>执行人：{plan.executedBy} · {plan.executedAt && formatTime(plan.executedAt)}</span>}
      </div>
      {plan.note && <p className="plan-note">备注：{plan.note}</p>}
      {!locked && !editing && (
        <div className="inline-actions">
          <button
            className="primary-action"
            onClick={() => {
              if (window.confirm("确认方案已执行？执行后将锁定，不可再修改或撤销，补测须另开。")) onExecute(plan.id);
            }}
          >
            执行并锁定
          </button>
          <button onClick={() => setEditing(true)}>修订方案</button>
          <button className="danger-action" onClick={() => window.confirm("撤销该未执行方案？") && onDelete(plan.id)}>
            撤销
          </button>
        </div>
      )}
      {!locked && editing && (
        <div className="inline-form">
          <div className="form-grid">
            <Field label="起始深度（m）">
              <input type="number" step="0.1" min="0" value={startDepth} onChange={(e) => setStartDepth(e.target.value)} />
            </Field>
            <Field label="纠偏方向">
              <input list="direction-list" value={direction} onChange={(e) => setDirection(e.target.value)} />
            </Field>
            <Field label="责任班次">
              <select value={shift} onChange={(e) => setShift(e.target.value)}>
                {SHIFTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="方案备注">
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="inline-actions">
            <button
              className="primary-action"
              onClick={() => {
                const sd = Number(startDepth);
                if (!(sd >= 0) || !direction.trim()) return;
                onEdit(plan.id, { startDepth: sd, direction: direction.trim(), shift, note: note.trim() || undefined });
                setEditing(false);
              }}
            >
              保存方案修订
            </button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
      {locked && <p className="lock-note">🔒 执行后锁定：方案不可改、不可撤；如需复测请对测点“补测另开”并写明原因。</p>}
    </article>
  );
}

// ── 主应用 ────────────────────────────────────────────────
function App() {
  const { state, dispatch, derivedMap } = useStation();
  const [tab, setTab] = useState<Tab>("points");
  const [operator, setOperator] = useState("现场编录员");
  const [activeHole, setActiveHole] = useState("ZK-18");
  const [defaultShift, setDefaultShift] = useState("甲班");
  const [showInactive, setShowInactive] = useState(false);
  const [uiMode, setUiMode] = useState<{ kind: "edit" | "supplement"; pointId: string } | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const holes = holeIdsOf(state.points);
  const selectedHole = activeHole || holes[0] || "";

  const safe = (fn: () => void, ok?: string) => {
    try {
      fn();
      setBanner(ok ? { kind: "ok", text: ok } : null);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const blocked = useMemo(() => blockedList(state), [state]);
  const pendingCount = blocked.length;
  const lockedCount = state.plans.filter((p) => p.status === "executed").length;

  const chain = useMemo(
    () =>
      state.points
        .filter((p) => p.holeId === selectedHole && (showInactive || p.active))
        .sort((a, b) => (a.depth === b.depth ? Number(!a.active) - Number(!b.active) : a.depth - b.depth)),
    [state.points, selectedHole, showInactive]
  );

  const reviewQueue = useMemo(
    () =>
      state.points
        .filter((p) => p.active)
        .map((p) => ({ p, d: derivedMap.get(p.id)! }))
        .filter(({ p, d }) => {
          const rs = reviewStateOf(p, d, state.reviews);
          return d.excess && rs !== "passed";
        })
        .sort((a, b) =>
          a.p.holeId === b.p.holeId ? a.p.depth - b.p.depth : a.p.holeId < b.p.holeId ? -1 : 1
        ),
    [state, derivedMap]
  );

  const plansSorted = state.plans.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const [revisionHole, setRevisionHole] = useState("全部");
  const revisions = state.revisions
    .filter((r) => revisionHole === "全部" || r.holeId === revisionHole)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const focusPoint = (pointId: string, tabTo: Tab = "points") => {
    const p = state.points.find((q) => q.id === pointId);
    if (p) {
      setActiveHole(p.holeId);
      setShowInactive(true);
    }
    setUiMode(null);
    setTab(tabTo);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `测斜复核与纠偏台_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell station">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-03 · 测斜复核与纠偏台</p>
          <h1>岩土钻孔测斜复核与纠偏台</h1>
          <p className="subtitle">
            每孔录入倾角、方位角与测点时间，深度顺孔口向下排列；倾角 &gt; {INCLINATION_LIMIT}° 或方位变化 &gt; {AZIMUTH_LIMIT}°
            留待复核，复核通过后方可安排纠偏；方案执行即锁定，补测另开并写原因。
          </p>
        </div>
        <div className="stack-card">
          <span>当前操作人</span>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} />
          <span>默认班次</span>
          <select value={defaultShift} onChange={(e) => setDefaultShift(e.target.value)}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="inline-actions">
            <button onClick={exportJson}>导出台账 JSON</button>
            <button
              className="danger-action"
              onClick={() => window.confirm("恢复演示数据？当前录入将被覆盖。") && dispatch({ type: "reset" })}
            >
              重置演示
            </button>
          </div>
        </div>
      </section>

      {/* 受阻台：孔号、深度、超限值 */}
      {blocked.length > 0 && (
        <section className="blocked-banner">
          <h2>受阻清单（{blocked.length} 个超限测点未完成复核，不能安排纠偏）</h2>
          <ul>
            {blocked.map((b) => (
              <li key={b.pointId}>
                <button onClick={() => focusPoint(b.pointId, "review")}>
                  <strong>{b.holeId}</strong>
                  <span>{b.depth.toFixed(1)}m</span>
                  <span className="excess">{b.excessText}</span>
                  <Badge cls={b.state === "rejected" ? "badge-warn" : "badge-danger"}>
                    {b.state === "rejected" ? "已驳回" : "待复核"}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {banner && (
        <section className={`flash ${banner.kind}`} onClick={() => setBanner(null)}>
          {banner.kind === "ok" ? "✓ " : "⚠ "}
          {banner.text}（点击关闭）
        </section>
      )}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>在册孔数</span>
          <strong>{holes.length}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>现行测点</span>
          <strong>{state.points.filter((p) => p.active).length}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>待复核测点</span>
          <strong>{pendingCount}</strong>
          <i className={pendingCount ? "status-danger" : "status-ok"} />
        </article>
        <article className="metric-card">
          <span>已锁定纠偏方案</span>
          <strong>{lockedCount}</strong>
          <i className="status-ok" />
        </article>
      </section>

      <nav className="tabs">
        {(
          [
            ["points", "测斜测点"],
            ["review", `复核台${pendingCount ? `（${pendingCount}）` : ""}`],
            ["plans", "纠偏方案"],
            ["revisions", "修订记录"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>钻孔</h2>
          <div className="chips">
            {holes.map((h) => (
              <button key={h} className={h === selectedHole ? "chip-on" : ""} onClick={() => setActiveHole(h)}>
                {h}
              </button>
            ))}
          </div>
          <h2>规则</h2>
          <ul className="rule-list">
            <li>深度自孔口向下，按深度排列测点</li>
            <li>倾角 &gt; {INCLINATION_LIMIT}° 或方位变化 &gt; {AZIMUTH_LIMIT}° 留待复核</li>
            <li>复核通过后才能安排纠偏</li>
            <li>方案须写起始深度、纠偏方向、责任班次</li>
            <li>执行后锁定；补测另开并写原因</li>
            <li>数据本机保存，重开页面记录仍对应</li>
          </ul>
        </aside>

        <section className="panel main-panel">
          {tab === "points" && (
            <>
              <div className="section-heading">
                <div>
                  <p>测斜录入</p>
                  <h2>{selectedHole || "新孔"} 测点</h2>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  显示已被补测替代的测点
                </label>
              </div>
              <PointEntryForm
                holes={holes}
                defaultHole={selectedHole}
                defaultShift={defaultShift}
                onSubmit={(p) =>
                  safe(
                    () => {
                      setActiveHole(p.holeId);
                      dispatch({ type: "addPoint", point: { ...p, isSupplement: false }, operator });
                    },
                    `已录入 ${p.holeId} ${p.depth.toFixed(1)}m 测点`
                  )
                }
              />

              <div className="chain">
                {chain.map((p) => {
                  const d = derivedMap.get(p.id)!;
                  const rs = reviewStateOf(p, d, state.reviews);
                  const latest = latestReview(state.reviews, p.id);
                  const plan = state.plans.find((pl) => pl.pointId === p.id);
                  const mode = uiMode?.pointId === p.id ? uiMode.kind : null;
                  return (
                    <article key={p.id} className={`point-card ${!p.active ? "inactive" : ""}`}>
                      <div className="point-head">
                        <div className="point-depth">{p.depth.toFixed(1)}m</div>
                        <div className="point-reads">
                          <span>
            倾角 <strong className={d.inclOver ? "over" : ""}>{p.inclination}°</strong>
                          </span>
                          <span>
            方位 <strong>{p.azimuth}°</strong>
                            {d.azimuthChange !== null && (
                              <em className={d.azimuthOver ? "over" : ""}>
                                {" "}（Δ{d.azimuthChange.toFixed(1)}°）
                              </em>
                            )}
                          </span>
                          <span className="muted">{formatTime(p.measuredAt)} · {p.shift}</span>
                        </div>
                        <div className="point-badges">
                          {p.isSupplement && <Badge cls="badge-info">补测</Badge>}
                          {!p.active && <Badge cls="badge-muted">已被替代</Badge>}
                          {d.excess && p.active && <Badge cls={REVIEW_LABEL[rs].cls}>{REVIEW_LABEL[rs].text}</Badge>}
                          {!d.excess && p.active && <Badge cls="badge-ok">正常</Badge>}
                        </div>
                      </div>
                      {d.excess && <p className="excess-line">超限：{d.excessText}</p>}
                      {p.isSupplement && p.supplementReason && (
                        <p className="link-line">↻ 补测原因：{p.supplementReason}</p>
                      )}
                      {!p.active && (
                        <p className="link-line">
                          被补测测点{" "}
                          <button
                            className="link-btn"
                            onClick={() => {
                              const supp = state.points.find((q) => q.supersedesId === p.id);
                              if (supp) focusPoint(supp.id);
                            }}
                          >
                            {state.points.find((q) => q.supersedesId === p.id)?.id}
                          </button>{" "}
                          替代
                        </p>
                      )}
                      {p.supersedesId && (
                        <p className="link-line">
                          ↳ 替代原测点{" "}
                          <button className="link-btn" onClick={() => focusPoint(p.supersedesId!)}>
                            {p.supersedesId}（{state.points.find((q) => q.id === p.supersedesId)?.depth.toFixed(1)}m）
                          </button>
                        </p>
                      )}
                      {(latest || plan) && (
                        <ul className="point-links">
                          {latest && (
                            <li>
                              <Badge cls={latest.result === "passed" ? "badge-ok" : "badge-warn"}>
                                复核{latest.result === "passed" ? "通过" : "驳回"}
                              </Badge>
                              {latest.reviewer} · {formatTime(latest.reviewedAt)}
                              {latest.signature !== signatureOf(p) && <em className="stale">（读数已修订，失效）</em>}
                            </li>
                          )}
                          {plan && (
                            <li>
                              <Badge cls={plan.status === "executed" ? "badge-lock" : "badge-warn"}>
                                {plan.status === "executed" ? "方案已锁定" : "方案待执行"}
                              </Badge>
                              起始 {plan.startDepth.toFixed(1)}m · {plan.direction} · {plan.shift}
                              <button className="link-btn" onClick={() => setTab("plans")}>
                                查看
                              </button>
                            </li>
                          )}
                        </ul>
                      )}
                      {p.active && (
                        <div className="inline-actions">
                          {d.excess && rs !== "passed" && (
                            <button className="primary-action" onClick={() => focusPoint(p.id, "review")}>
                              去复核
                            </button>
                          )}
                          {d.excess && rs === "passed" && !plan && (
                            <button className="primary-action" onClick={() => setTab("plans")}>
                              安排纠偏
                            </button>
                          )}
                          <button onClick={() => setUiMode({ kind: "supplement", pointId: p.id })}>补测另开</button>
                          <button onClick={() => setUiMode({ kind: "edit", pointId: p.id })}>修订读数</button>
                        </div>
                      )}
                      {mode === "edit" && (
                        <PointEditForm
                          point={p}
                          onCancel={() => setUiMode(null)}
                          onSave={(patch) =>
                            safe(
                              () => dispatch({ type: "editPoint", id: p.id, patch, operator }),
                              "测点修订已记入修订记录"
                            )
                          }
                        />
                      )}
                      {mode === "supplement" && (
                        <SupplementForm
                          original={p}
                          defaultShift={defaultShift}
                          onCancel={() => setUiMode(null)}
                          onSave={(sp) =>
                            safe(
                              () =>
                                dispatch({
                                  type: "addSupplement",
                                  originalId: p.id,
                                  point: sp,
                                  operator,
                                }),
                              "补测已另开，原测点失效保留"
                            )
                          }
                        />
                      )}
                    </article>
                  );
                })}
                {chain.length === 0 && <p className="empty-hint">该孔尚无测点，请在上方录入。</p>}
              </div>
            </>
          )}

          {tab === "review" && (
            <>
              <div className="section-heading">
                <div>
                  <p>超限留待复核</p>
                  <h2>复核台</h2>
                </div>
              </div>
              {reviewQueue.length === 0 && (
                <p className="empty-hint">没有待复核测点。所有现行测点均未超限，或已复核通过。</p>
              )}
              {reviewQueue.map(({ p, d }) => (
                <ReviewCard
                  key={p.id}
                  point={p}
                  derived={d}
                  state={state}
                  defaultReviewer={operator}
                  onReview={(pointId, result, reviewer, comment) =>
                    safe(
                      () => dispatch({ type: "review", pointId, result, reviewer, comment }),
                      result === "passed" ? "复核通过，可安排纠偏" : "已驳回并记录意见"
                    )
                  }
                />
              ))}
            </>
          )}

          {tab === "plans" && (
            <>
              <div className="section-heading">
                <div>
                  <p>通过复核后安排</p>
                  <h2>纠偏方案</h2>
                </div>
              </div>
              <PlanCreateForm
                state={state}
                derivedMap={derivedMap}
                defaultShift={defaultShift}
                onCreate={(plan) =>
                  safe(() => dispatch({ type: "createPlan", plan, operator }), "纠偏方案已建立")
                }
              />
              <div className="plan-list">
                {plansSorted.map((pl) => (
                  <PlanCard
                    key={pl.id}
                    plan={pl}
                    point={state.points.find((p) => p.id === pl.pointId)}
                    onExecute={(id) =>
                      safe(() => dispatch({ type: "executePlan", id, operator }), "方案已执行并锁定")
                    }
                    onEdit={(id, patch) =>
                      safe(() => dispatch({ type: "editPlan", id, patch, operator }), "方案修订已记录")
                    }
                    onDelete={(id) =>
                      safe(() => dispatch({ type: "deletePlan", id, operator }), "未执行方案已撤销")
                    }
                  />
                ))}
                {plansSorted.length === 0 && <p className="empty-hint">尚无纠偏方案。</p>}
              </div>
            </>
          )}

          {tab === "revisions" && (
            <>
              <div className="section-heading">
                <div>
                  <p>测点 · 复核 · 方案 · 替代</p>
                  <h2>修订记录</h2>
                </div>
                <select value={revisionHole} onChange={(e) => setRevisionHole(e.target.value)}>
                  <option value="全部">全部钻孔</option>
                  {holes.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </div>
              <ul className="timeline">
                {revisions.map((r) => {
                  const isPlan = r.kind.startsWith("plan");
                  return (
                    <li key={r.id}>
                      <div className="tl-time">{formatTime(r.at)}</div>
                      <div className="tl-body">
                        <div className="tl-tags">
                          <Badge cls="badge-muted">{r.holeId}</Badge>
                          <Badge cls="badge-info">{kindLabel(r.kind)}</Badge>
                        </div>
                        <p>{r.message}</p>
                        <p className="muted">
                          {r.operator} · 关联{" "}
                          <button className="link-btn" onClick={() => focusPoint(r.entityId, isPlan ? "plans" : "points")}>
                            {r.entityId}
                          </button>
                        </p>
                      </div>
                    </li>
                  );
                })}
                {revisions.length === 0 && <p className="empty-hint">暂无修订记录。</p>}
              </ul>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function kindLabel(kind: string): string {
  return (
    {
      "point-edit": "测点修订",
      "point-superseded": "补测替代",
      review: "复核",
      "plan-create": "方案建立",
      "plan-edit": "方案修订",
      "plan-execute": "方案执行",
      "plan-delete": "方案撤销",
    } as Record<string, string>
  )[kind] ?? kind;
}

export default App;
