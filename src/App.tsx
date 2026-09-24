import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  AZIMUTH_DELTA_LIMIT,
  INCLINATION_LIMIT,
  SHIFTS,
  ConsoleState,
  CorrectionPlan,
  Hole,
  Review,
  SurveyPoint,
  azimuthDelta,
  evaluateFlags,
  flagText,
  fmtShort,
  fmtTime,
  nowLocal,
  previousPoint,
  sortPoints,
  uid,
  REVIEW_STATUS_TEXT,
} from "./domain";
import { loadState, saveState } from "./store";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "测斜复核与纠偏台",
  subtitle: `每孔录入倾角、方位角与测点时间，深度顺孔口向下排；倾角超过 ${INCLINATION_LIMIT}° 或方位变化超过 ${AZIMUTH_DELTA_LIMIT}° 自动留待复核，复核通过后方可编制纠偏方案，方案执行即锁定，补测另开并注明原因。`,
};

interface PointInput {
  depth: number;
  inclination: number;
  azimuth: number;
  measuredAt: string;
  kind: "routine" | "supplementary";
  reason?: string;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function reviewBadgeClass(status: Review["status"]): string {
  if (status === "passed") return "badge badge-ok";
  if (status === "rejected") return "badge badge-danger";
  return "badge badge-warn";
}

function holeStatus(holeId: string, reviews: Review[], plans: CorrectionPlan[]) {
  if (reviews.some((r) => r.holeId === holeId && r.status !== "passed")) {
    return { label: "受阻", cls: "badge badge-danger" };
  }
  if (plans.some((p) => p.holeId === holeId && p.status === "executed")) {
    return { label: "纠偏已锁定", cls: "badge badge-ok" };
  }
  if (plans.some((p) => p.holeId === holeId && p.status === "scheduled")) {
    return { label: "待执行纠偏", cls: "badge badge-warn" };
  }
  return { label: "正常", cls: "badge badge-neutral" };
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tone} />
    </article>
  );
}

/** 测点录入：常规测点与补测共用，补测另开且必填原因 */
function PointForm({ holeId, onAdd }: { holeId: string; onAdd: (input: PointInput) => void }) {
  const [depth, setDepth] = useState("");
  const [inclination, setInclination] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocal());
  const [supplementary, setSupplementary] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const d = Number(depth);
    const inc = Number(inclination);
    const az = Number(azimuth);
    if (!Number.isFinite(d) || d <= 0) return setError("深度须为大于 0 的数值");
    if (!Number.isFinite(inc) || inc < 0 || inc > 90) return setError("倾角须在 0–90° 之间");
    if (!Number.isFinite(az) || az < 0 || az > 360) return setError("方位角须在 0–360° 之间");
    if (!measuredAt) return setError("请填写测点时间");
    if (supplementary && !reason.trim()) return setError("补测须填写原因");
    setError("");
    onAdd({
      depth: round2(d),
      inclination: round1(inc),
      azimuth: round1(az),
      measuredAt,
      kind: supplementary ? "supplementary" : "routine",
      reason: supplementary ? reason.trim() : undefined,
    });
    setDepth("");
    setInclination("");
    setAzimuth("");
    setMeasuredAt(nowLocal());
    setSupplementary(false);
    setReason("");
  }

  return (
    <div>
      <div className="field-grid">
        <label>
          <span>深度（m，自孔口向下）</span>
          <input type="number" min="0" step="0.1" value={depth} onChange={(e) => setDepth(e.target.value)} placeholder="如 18.0" />
        </label>
        <label>
          <span>倾角（°）</span>
          <input type="number" min="0" max="90" step="0.1" value={inclination} onChange={(e) => setInclination(e.target.value)} placeholder="如 2.4" />
        </label>
        <label>
          <span>方位角（°）</span>
          <input type="number" min="0" max="360" step="0.1" value={azimuth} onChange={(e) => setAzimuth(e.target.value)} placeholder="0–360" />
        </label>
        <label>
          <span>测点时间</span>
          <input type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={supplementary} onChange={(e) => setSupplementary(e.target.checked)} />
        <span>补测（另开新测点，不改写原记录）</span>
      </label>
      {supplementary && (
        <label>
          <span>补测原因</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：更换测斜仪后原位复测" />
        </label>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="primary-action" onClick={submit}>
          {supplementary ? "登记补测" : `录入 ${holeId} 测点`}
        </button>
        <span className="hint">
          倾角 &gt; {INCLINATION_LIMIT}° 或方位变化 &gt; {AZIMUTH_DELTA_LIMIT}° 将自动留待复核
        </span>
      </div>
    </div>
  );
}

/** 测点明细：深度顺孔口向下排 */
function PointTable({ points, reviewByPoint }: { points: SurveyPoint[]; reviewByPoint: Map<string, Review> }) {
  if (points.length === 0) return <p className="empty">该孔暂无测点，请先在上方录入。</p>;
  const sorted = sortPoints(points);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>深度（m）</th>
          <th>倾角（°）</th>
          <th>方位角（°）</th>
          <th>方位变化（°）</th>
          <th>测点时间</th>
          <th>类型</th>
          <th>复核状态</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const prev = previousPoint(sorted, p.holeId, p.depth);
          const delta = prev ? azimuthDelta(p.azimuth, prev.azimuth) : null;
          const review = reviewByPoint.get(p.id);
          const over = p.flags.length > 0;
          return (
            <tr key={p.id} className={over ? "row-flagged" : ""}>
              <td>{p.depth.toFixed(1)}</td>
              <td>{p.inclination.toFixed(1)}</td>
              <td>{p.azimuth.toFixed(1)}</td>
              <td>{delta === null ? "—" : delta.toFixed(1)}</td>
              <td>{fmtShort(p.measuredAt)}</td>
              <td>
                {p.kind === "supplementary" ? (
                  <span className="badge badge-warn" title={p.reason}>补测</span>
                ) : (
                  <span className="badge badge-neutral">常规</span>
                )}
                {p.kind === "supplementary" && p.reason && <div className="cell-note">{p.reason}</div>}
                {over && <div className="cell-note danger">{p.flags.map(flagText).join("；")}</div>}
              </td>
              <td>
                {review ? (
                  <span className={reviewBadgeClass(review.status)}>{REVIEW_STATUS_TEXT[review.status]}</span>
                ) : (
                  <span className="badge badge-ok">正常</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 单条复核：通过后方能安排纠偏 */
function ReviewCard({
  review,
  point,
  onResolve,
}: {
  review: Review;
  point?: SurveyPoint;
  onResolve: (id: string, pass: boolean, reviewer: string, note: string) => void;
}) {
  const [reviewer, setReviewer] = useState("王工");
  const [note, setNote] = useState("");

  if (review.status !== "pending") {
    return (
      <article className="review-card settled">
        <div className="review-head">
          <strong>{review.depth.toFixed(1)}m</strong>
          {review.flags.map((f) => (
            <span key={f.type} className="badge badge-danger">{flagText(f)}</span>
          ))}
          <span className={reviewBadgeClass(review.status)}>{REVIEW_STATUS_TEXT[review.status]}</span>
        </div>
        <p className="cell-note">
          {review.reviewer} · {review.reviewedAt ? fmtTime(review.reviewedAt) : ""}
          {review.note ? ` · ${review.note}` : ""}
        </p>
      </article>
    );
  }

  return (
    <article className="review-card">
      <div className="review-head">
        <strong>{review.depth.toFixed(1)}m</strong>
        {point?.kind === "supplementary" && <span className="badge badge-warn">补测</span>}
        {review.flags.map((f) => (
          <span key={f.type} className="badge badge-danger">{flagText(f)}</span>
        ))}
        <span className="cell-note">测于 {point ? fmtShort(point.measuredAt) : "—"}</span>
      </div>
      <div className="review-form">
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="复核人" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="复核意见（选填）" />
        <button className="primary-action" onClick={() => onResolve(review.id, true, reviewer.trim() || "未署名", note.trim())}>
          通过复核
        </button>
        <button className="danger-action" onClick={() => onResolve(review.id, false, reviewer.trim() || "未署名", note.trim())}>
          退回
        </button>
      </div>
    </article>
  );
}

/** 纠偏方案：起始深度 + 纠偏方向 + 责任班次，执行后锁定 */
function PlanPanel({
  reviews,
  plans,
  onCreate,
  onExecute,
}: {
  reviews: Review[];
  plans: CorrectionPlan[];
  onCreate: (reviewId: string, startDepth: number, direction: string, shift: string) => void;
  onExecute: (planId: string) => void;
}) {
  const passed = reviews.filter((r) => r.status === "passed");
  const [reviewId, setReviewId] = useState(passed[0]?.id ?? "");
  const [startDepth, setStartDepth] = useState(passed[0] ? String(passed[0].depth) : "");
  const [direction, setDirection] = useState("");
  const [shift, setShift] = useState(SHIFTS[0]);
  const [error, setError] = useState("");

  function pickReview(id: string) {
    setReviewId(id);
    const r = passed.find((x) => x.id === id);
    if (r) setStartDepth(String(r.depth));
  }

  function submit() {
    const d = Number(startDepth);
    if (!reviewId) return setError("需先有复核通过的测点");
    if (!Number.isFinite(d) || d <= 0) return setError("起始深度须为大于 0 的数值");
    if (!direction.trim()) return setError("请填写纠偏方向");
    setError("");
    onCreate(reviewId, round2(d), direction.trim(), shift);
    setDirection("");
  }

  return (
    <div>
      {passed.length === 0 ? (
        <p className="empty">暂无复核通过的测点。超限测点须复核通过后才能安排纠偏。</p>
      ) : (
        <div className="plan-form">
          <div className="field-grid">
            <label>
              <span>依据复核记录</span>
              <select value={reviewId} onChange={(e) => pickReview(e.target.value)}>
                {passed.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.depth.toFixed(1)}m · {r.flags.map(flagText).join("、")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>起始深度（m）</span>
              <input type="number" min="0" step="0.1" value={startDepth} onChange={(e) => setStartDepth(e.target.value)} />
            </label>
            <label>
              <span>纠偏方向</span>
              <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="如：向方位 095° 回纠，倾角压至 2.5° 以内" />
            </label>
            <label>
              <span>责任班次</span>
              <select value={shift} onChange={(e) => setShift(e.target.value)}>
                {SHIFTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" onClick={submit}>编制方案</button>
        </div>
      )}

      <div className="plan-list">
        {plans.map((p) => (
          <article key={p.id} className={`plan-card ${p.status === "executed" ? "locked" : ""}`}>
            <div className="review-head">
              <strong>起始 {p.startDepth.toFixed(1)}m</strong>
              <span className="badge badge-neutral">{p.shift}</span>
              {p.status === "executed" ? (
                <span className="badge badge-ok">已执行 · 已锁定</span>
              ) : (
                <span className="badge badge-warn">待执行</span>
              )}
            </div>
            <p>{p.direction}</p>
            <p className="cell-note">
              编制于 {fmtTime(p.createdAt)}
              {p.executedAt ? ` · 执行于 ${fmtTime(p.executedAt)}` : ""}
            </p>
            {p.status === "scheduled" && (
              <button className="primary-action" onClick={() => onExecute(p.id)}>执行并锁定</button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<ConsoleState>(loadState);
  const [selectedHole, setSelectedHole] = useState(state.holes[0]?.id ?? "");
  const [newHoleId, setNewHoleId] = useState("");
  const [newHoleDepth, setNewHoleDepth] = useState("");
  const [holeError, setHoleError] = useState("");

  useEffect(() => saveState(state), [state]);

  const hole = state.holes.find((h) => h.id === selectedHole) ?? state.holes[0];
  const holePoints = useMemo(
    () => state.points.filter((p) => p.holeId === hole?.id),
    [state.points, hole]
  );
  const holeReviews = useMemo(
    () =>
      state.reviews
        .filter((r) => r.holeId === hole?.id)
        .sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || b.createdAt.localeCompare(a.createdAt)),
    [state.reviews, hole]
  );
  const holePlans = useMemo(
    () => state.plans.filter((p) => p.holeId === hole?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.plans, hole]
  );
  const reviewByPoint = useMemo(() => new Map(state.reviews.map((r) => [r.pointId, r])), [state.reviews]);
  const pointById = useMemo(() => new Map(state.points.map((p) => [p.id, p])), [state.points]);

  const pendingCount = state.reviews.filter((r) => r.status === "pending").length;
  const blockedRows = state.reviews
    .filter((r) => r.status !== "passed")
    .sort((a, b) => a.holeId.localeCompare(b.holeId) || a.depth - b.depth);
  const blockedHoles = new Set(blockedRows.map((r) => r.holeId)).size;

  function addRevision(draft: ConsoleState, holeId: string, action: string, detail: string) {
    draft.revisions = [{ id: uid("rv"), holeId, action, detail, at: nowLocal() }, ...draft.revisions];
  }

  function handleAddPoint(input: PointInput) {
    setState((prev) => {
      const next: ConsoleState = { ...prev, points: [...prev.points], reviews: [...prev.reviews], revisions: [...prev.revisions] };
      const prevPoint = previousPoint(next.points, selectedHole, input.depth);
      const flags = evaluateFlags(input.inclination, input.azimuth, prevPoint);
      const point: SurveyPoint = {
        id: uid("pt"),
        holeId: selectedHole,
        ...input,
        flags,
        createdAt: nowLocal(),
      };
      next.points.push(point);
      if (flags.length > 0) {
        next.reviews.unshift({
          id: uid("rw"),
          holeId: selectedHole,
          pointId: point.id,
          depth: point.depth,
          flags,
          status: "pending",
          createdAt: nowLocal(),
        });
      }
      const flagNote = flags.length > 0 ? `，超限留待复核（${flags.map(flagText).join("、")}）` : "，未见超限";
      const reasonNote = input.reason ? `，原因：${input.reason}` : "";
      addRevision(
        next,
        selectedHole,
        input.kind === "supplementary" ? "补测登记" : "录入测点",
        `${input.depth.toFixed(1)}m 倾角 ${input.inclination}° 方位 ${input.azimuth}°${reasonNote}${flagNote}`
      );
      return next;
    });
  }

  function handleResolveReview(reviewId: string, pass: boolean, reviewer: string, note: string) {
    setState((prev) => {
      const next: ConsoleState = { ...prev, reviews: [...prev.reviews], revisions: [...prev.revisions] };
      const idx = next.reviews.findIndex((r) => r.id === reviewId);
      if (idx < 0) return prev;
      const review = next.reviews[idx];
      next.reviews[idx] = {
        ...review,
        status: pass ? "passed" : "rejected",
        reviewer,
        note,
        reviewedAt: nowLocal(),
      };
      addRevision(
        next,
        review.holeId,
        pass ? "复核通过" : "复核退回",
        `${review.depth.toFixed(1)}m 测点，${reviewer}${note ? `：${note}` : ""}${pass ? "，可安排纠偏" : "，维持受阻"}`
      );
      return next;
    });
  }

  function handleCreatePlan(reviewId: string, startDepth: number, direction: string, shift: string) {
    setState((prev) => {
      const next: ConsoleState = { ...prev, plans: [...prev.plans], revisions: [...prev.revisions] };
      next.plans.unshift({
        id: uid("pl"),
        holeId: selectedHole,
        reviewId,
        startDepth,
        direction,
        shift,
        status: "scheduled",
        createdAt: nowLocal(),
      });
      addRevision(next, selectedHole, "方案编制", `起始深度 ${startDepth.toFixed(1)}m，${shift}，${direction}`);
      return next;
    });
  }

  function handleExecutePlan(planId: string) {
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) return;
    if (!window.confirm(`执行后方案将锁定，不可修改。确认执行 ${plan.holeId} 自 ${plan.startDepth.toFixed(1)}m 起的纠偏方案？`)) return;
    setState((prev) => {
      const next: ConsoleState = { ...prev, plans: [...prev.plans], revisions: [...prev.revisions] };
      const idx = next.plans.findIndex((p) => p.id === planId);
      next.plans[idx] = { ...next.plans[idx], status: "executed", executedAt: nowLocal() };
      addRevision(next, plan.holeId, "方案执行锁定", `起始深度 ${plan.startDepth.toFixed(1)}m，${plan.shift}，执行后锁定`);
      return next;
    });
  }

  function handleAddHole() {
    const id = newHoleId.trim();
    const depth = Number(newHoleDepth);
    if (!id) return setHoleError("请填写孔号");
    if (state.holes.some((h) => h.id === id)) return setHoleError("孔号已存在");
    if (!Number.isFinite(depth) || depth <= 0) return setHoleError("设计孔深须大于 0");
    setHoleError("");
    setState((prev) => {
      const next: ConsoleState = { ...prev, holes: [...prev.holes], revisions: [...prev.revisions] };
      next.holes.push({ id, designDepth: round2(depth), createdAt: nowLocal() });
      addRevision(next, id, "新增钻孔", `设计孔深 ${depth}m`);
      return next;
    });
    setSelectedHole(id);
    setNewHoleId("");
    setNewHoleDepth("");
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>超限规则</span>
          <strong>倾角 &gt; {INCLINATION_LIMIT}° 或方位变化 &gt; {AZIMUTH_DELTA_LIMIT}° → 留待复核</strong>
          <span>复核通过 → 编制纠偏方案 → 执行锁定；补测另开并写原因</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="测点总数" value={state.points.length} tone="status-ok" />
        <MetricCard label="待复核" value={pendingCount} tone="status-watch" />
        <MetricCard label="纠偏方案" value={state.plans.length} tone="status-ok" />
        <MetricCard label="受阻钻孔" value={blockedHoles} tone="status-danger" />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>钻孔</h2>
          <div className="hole-list">
            {state.holes.map((h: Hole) => {
              const st = holeStatus(h.id, state.reviews, state.plans);
              const count = state.points.filter((p) => p.holeId === h.id).length;
              return (
                <button
                  key={h.id}
                  className={`hole-item ${h.id === hole?.id ? "active" : ""}`}
                  onClick={() => setSelectedHole(h.id)}
                >
                  <strong>{h.id}</strong>
                  <span className="cell-note">设计 {h.designDepth}m · 测点 {count}</span>
                  <span className={st.cls}>{st.label}</span>
                </button>
              );
            })}
          </div>
          <h2>新增钻孔</h2>
          <div className="hole-form">
            <input value={newHoleId} onChange={(e) => setNewHoleId(e.target.value)} placeholder="孔号，如 ZK-27" />
            <input type="number" min="0" step="0.5" value={newHoleDepth} onChange={(e) => setNewHoleDepth(e.target.value)} placeholder="设计孔深（m）" />
            {holeError && <p className="form-error">{holeError}</p>}
            <button onClick={handleAddHole}>添加</button>
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>测斜录入 · {hole?.id}</p>
              <h2>测点登记</h2>
            </div>
          </div>
          {hole && <PointForm key={hole.id} holeId={hole.id} onAdd={handleAddPoint} />}
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>测斜明细 · {hole?.id}</p>
            <h2>测点一览（自孔口向下）</h2>
          </div>
        </div>
        <PointTable points={holePoints} reviewByPoint={reviewByPoint} />
      </section>

      <section className="duo">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>超限处置 · {hole?.id}</p>
              <h2>复核队列</h2>
            </div>
          </div>
          {holeReviews.length === 0 && <p className="empty">该孔无超限记录。</p>}
          {holeReviews.map((r) => (
            <ReviewCard key={r.id} review={r} point={pointById.get(r.pointId)} onResolve={handleResolveReview} />
          ))}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>纠偏安排 · {hole?.id}</p>
              <h2>纠偏方案</h2>
            </div>
          </div>
          {hole && (
            <PlanPanel
              key={hole.id}
              reviews={holeReviews}
              plans={holePlans}
              onCreate={handleCreatePlan}
              onExecute={handleExecutePlan}
            />
          )}
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>全工地</p>
            <h2>受阻清单（复核未通过，暂不能安排纠偏）</h2>
          </div>
        </div>
        {blockedRows.length === 0 ? (
          <p className="empty">当前无受阻钻孔，可正常安排作业。</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>孔号</th>
                <th>深度（m）</th>
                <th>超限值</th>
                <th>复核状态</th>
              </tr>
            </thead>
            <tbody>
              {blockedRows.map((r) => (
                <tr key={r.id} className="row-flagged">
                  <td>{r.holeId}</td>
                  <td>{r.depth.toFixed(1)}</td>
                  <td>{r.flags.map(flagText).join("；")}</td>
                  <td><span className={reviewBadgeClass(r.status)}>{REVIEW_STATUS_TEXT[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>留痕</p>
            <h2>修订记录</h2>
          </div>
        </div>
        <div className="log-list">
          {state.revisions.slice(0, 30).map((r) => (
            <div key={r.id} className="log-row">
              <span className="log-time">{fmtTime(r.at)}</span>
              <span className="badge badge-neutral">{r.holeId}</span>
              <strong>{r.action}</strong>
              <span>{r.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
