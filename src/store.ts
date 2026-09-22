import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  type ActionResult,
  type BlockRule,
  type BoardState,
  type Fuel,
  type PriceOrder,
  type PriceSnapshot,
  type ReleaseRecord,
  DIFF_THRESHOLD,
  round2
} from "./types";

const STORAGE_KEY = "dfwlfront-9-joint-review-v1";

const FUELS: Fuel[] = ["92号汽油", "95号汽油", "98号汽油", "柴油"];

/** 内置站点（可补充） */
export const STATIONS = ["城东一站", "城东二站", "滨江站", "开发区站", "高新站"];

type DraftInput = {
  station: string;
  fuel: Fuel;
  price: number;
  refStation: string;
  startDate: string;
  endDate: string;
  basis: string;
  operator: string;
};

type ReviewInput = {
  reviewer: string;
};

type ReleaseInput = {
  reviewer: string;
  note: string;
};

/** 两个闭区间（含端点）是否交叠 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function seed(): BoardState {
  const board: BoardState["board"] = {
    城东一站: { "92号汽油": 7.62, "95号汽油": 8.11, "98号汽油": 9.05, 柴油: 7.18 },
    城东二站: { "92号汽油": 7.58, "95号汽油": 8.05, "98号汽油": 8.99, 柴油: 7.12 },
    滨江站: { "92号汽油": 7.66, "95号汽油": 8.15, "98号汽油": 9.10, 柴油: 7.22 },
    开发区站: { "92号汽油": 7.55, "95号汽油": 8.02, "98号汽油": 8.95, 柴油: 7.08 },
    高新站: { "92号汽油": 7.60, "95号汽油": 8.08, "98号汽油": 9.02, 柴油: 7.15 }
  };
  const now = Date.now();
  const day = 86400000;
  const iso = (offset: number) => new Date(now + offset * day).toISOString();
  const order: PriceOrder = {
    id: "seed-order-1",
    station: "城东一站",
    fuel: "92号汽油",
    price: 7.99,
    refStation: "城东二站",
    startDate: "2026-09-20",
    endDate: "2026-09-30",
    basis: "周边路网施工，竞品站挂牌价上行，经片区会商后跟涨",
    operator: "站长",
    createdAt: iso(-3),
    status: "待复核",
    refPrice: null,
    diff: null,
    reviewer: null,
    reviewedAt: null,
    rejectReason: null,
    releasedBy: null,
    releasedAt: null,
    releaseNote: null
  };
  return {
    board,
    orders: [order],
    snapshots: [],
    releases: []
  };
}

function load(): BoardState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seed();
  try {
    const parsed = JSON.parse(raw) as Partial<BoardState>;
    return {
      board: parsed.board ?? {},
      orders: parsed.orders ?? [],
      snapshots: parsed.snapshots ?? [],
      releases: parsed.releases ?? []
    };
  } catch {
    return seed();
  }
}

export const usePriceStore = defineStore("price-joint-review", () => {
  const state = ref<BoardState>(load());

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value));
  }

  const orders = computed(() => state.value.orders);
  const snapshots = computed(() => state.value.snapshots);
  const releases = computed(() => state.value.releases);
  const board = computed(() => state.value.board);

  function getBoardPrice(station: string, fuel: Fuel): number | undefined {
    return state.value.board[station]?.[fuel];
  }

  /** 冻结中的站点+油品（任一已通过且未解除的单据） */
  const frozenKeys = computed(() => {
    const keys = new Set<string>();
    for (const order of state.value.orders) {
      if (order.status !== "已通过") continue;
      keys.add(`${order.station}__${order.fuel}`);
      keys.add(`${order.refStation}__${order.fuel}`);
    }
    return keys;
  });

  function isFrozen(station: string, fuel: Fuel): boolean {
    return frozenKeys.value.has(`${station}__${fuel}`);
  }

  /** 冻结原因：命中的已通过单据（含参照关系） */
  function freezeReason(station: string, fuel: Fuel): PriceOrder[] {
    return state.value.orders.filter(
      (o) =>
        o.status === "已通过" &&
        o.fuel === fuel &&
        (o.station === station || o.refStation === station)
    );
  }

  /** 同站同油品的区间占用（草稿阶段也可查询） */
  function rangeOccupancy(station: string, fuel: Fuel, start: string, end: string, excludeId?: string) {
    return state.value.orders
      .filter((o) => o.id !== excludeId && o.status !== "已驳回" && o.status !== "已解除")
      .filter((o) =>
        (o.station === station || o.refStation === station) &&
        o.fuel === fuel &&
        overlaps(start, end, o.startDate, o.endDate)
      );
  }

  /**
   * 提单前的规则校验，返回所有命中的阻挡项。
   * 阻挡信息包含：站点、油品、差额、冲突区间和规则。
   */
  function validateDraft(input: DraftInput, excludeId?: string): BlockRule[] {
    const blocks: BlockRule[] = [];
    const { station, fuel, price, refStation, startDate, endDate, basis } = input;

    if (!station) blocks.push({ rule: "必填", detail: "请选择调价站点" });
    if (!refStation) blocks.push({ rule: "必填", detail: "请选择参照站" });
    if (!startDate || !endDate) blocks.push({ rule: "必填", detail: "请填写完整的生效区间" });
    if (startDate && endDate && startDate > endDate) {
      blocks.push({ rule: "生效区间合法", detail: `生效区间起 ${startDate} 晚于止 ${endDate}` });
    }
    if (station && refStation && station === refStation) {
      blocks.push({ rule: "邻站联审", detail: `站点【${station}】不能以自身作为参照站` });
    }
    if (!Number.isFinite(price) || price <= 0) {
      blocks.push({ rule: "必填", detail: `站点【${station || "—"}】油品【${fuel}】售价必须为正数` });
    }

    // 邻站每升差额（依据当前牌价估算；通过时再以参照站牌价定格）
    const refPrice = refStation ? getBoardPrice(refStation, fuel) : undefined;
    let diff = NaN;
    if (refPrice !== undefined && Number.isFinite(price) && price > 0) {
      diff = round2(price - refPrice);
    }
    if (Number.isFinite(diff) && Math.abs(diff) > DIFF_THRESHOLD) {
      if (!basis.trim()) {
        blocks.push({
          rule: "邻站差价联审 · 超阈值须依据",
          detail:
            `站点【${station}】油品【${fuel}】售价 ${price.toFixed(2)} 元/升，参照站【${refStation}】` +
            `${refPrice!.toFixed(2)} 元/升，差额 ${diff > 0 ? "+" : ""}${diff.toFixed(2)} 元/升，` +
            `超过 ${DIFF_THRESHOLD.toFixed(2)} 元/升，须填写调价依据后再提交复核`
        });
      }
    }

    // 区间占用：调价站点 / 参照站 同站同油品不能交叠
    if (station && startDate && endDate && startDate <= endDate) {
      const conflicts = rangeOccupancy(station, fuel, startDate, endDate, excludeId);
      for (const c of conflicts) {
        const role = c.station === station ? "调价站点" : "参照站";
        blocks.push({
          rule: "同站同油品区间不得交叠",
          detail:
            `站点【${station}】油品【${fuel}】与单据【${c.id.slice(0, 8)}】冲突` +
            `（本单在该站角色：${role}），冲突区间 ${c.startDate} ~ ${c.endDate}，` +
            `申请区间 ${startDate} ~ ${endDate}`
        });
      }
    }
    if (refStation && refStation !== station && startDate && endDate && startDate <= endDate) {
      const conflicts = rangeOccupancy(refStation, fuel, startDate, endDate, excludeId);
      for (const c of conflicts) {
        const role = c.station === refStation ? "调价站点" : "参照站";
        blocks.push({
          rule: "同站同油品区间不得交叠",
          detail:
            `参照站【${refStation}】油品【${fuel}】与单据【${c.id.slice(0, 8)}】冲突` +
            `（参照站在该单角色：${role}），冲突区间 ${c.startDate} ~ ${c.endDate}，` +
            `申请区间 ${startDate} ~ ${endDate}`
        });
      }
    }

    // 站点或参照站处于冻结中，不能单独再提单调价
    for (const [label, name] of [["站点", station], ["参照站", refStation]] as const) {
      if (name && isFrozen(name, fuel)) {
        const reasons = freezeReason(name, fuel)
          .map((o) => `单据【${o.id.slice(0, 8)}】区间 ${o.startDate} ~ ${o.endDate}（复核人 ${o.reviewer}）`)
          .join("；");
        blocks.push({
          rule: "冻结期不得单独调价",
          detail: `${label}【${name}】油品【${fuel}】价格已冻结，${reasons}；须先由原复核人解除联审`
        });
      }
    }

    return blocks;
  }

  function createOrder(input: DraftInput): ActionResult {
    const blocks = validateDraft(input);
    if (blocks.length) return { ok: false, blocks };

    const order: PriceOrder = {
      id: crypto.randomUUID(),
      station: input.station,
      fuel: input.fuel,
      price: round2(input.price),
      refStation: input.refStation,
      startDate: input.startDate,
      endDate: input.endDate,
      basis: input.basis.trim(),
      operator: input.operator.trim() || "未填写",
      createdAt: new Date().toISOString(),
      status: "待复核",
      refPrice: null,
      diff: null,
      reviewer: null,
      reviewedAt: null,
      rejectReason: null,
      releasedBy: null,
      releasedAt: null,
      releaseNote: null
    };
    state.value.orders.unshift(order);
    persist();
    return { ok: true, blocks: [] };
  }

  /** 复核通过：定格参照价/差额，写站点牌价，双方各生成冻结快照 */
  function approve(orderId: string, input: ReviewInput): ActionResult {
    const blocks: BlockRule[] = [];
    const order = state.value.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, blocks: [{ rule: "数据", detail: "调价单不存在" }] };
    if (order.status !== "待复核") {
      return {
        ok: false,
        blocks: [
          {
            rule: "状态流转",
            detail: `单据【${order.id.slice(0, 8)}】当前状态为【${order.status}】，仅待复核单据可通过`
          }
        ]
      };
    }
    if (!input.reviewer.trim()) {
      blocks.push({ rule: "必填", detail: "须填写复核人方可通过" });
    }

    // 通过瞬间重新核验：牌价可能已变动，差额超阈值须有依据
    const refPrice = getBoardPrice(order.refStation, order.fuel);
    if (refPrice === undefined) {
      blocks.push({
        rule: "牌价缺失",
        detail: `参照站【${order.refStation}】油品【${order.fuel}】缺少当前牌价，无法定格差额`
      });
    } else {
      const diff = round2(order.price - refPrice);
      if (Math.abs(diff) > DIFF_THRESHOLD && !order.basis.trim()) {
        blocks.push({
          rule: "邻站差价联审 · 超阈值须依据",
          detail:
            `站点【${order.station}】油品【${order.fuel}】差额 ${diff > 0 ? "+" : ""}${diff.toFixed(2)} 元/升` +
            `（参照站 ${refPrice.toFixed(2)}），超过 ${DIFF_THRESHOLD.toFixed(2)} 元/升且缺少依据`
        });
      }
    }

    // 重新核验区间（防止提单后有新单据占用）
    const recheck = validateDraft(
      {
        station: order.station,
        fuel: order.fuel,
        price: order.price,
        refStation: order.refStation,
        startDate: order.startDate,
        endDate: order.endDate,
        basis: order.basis,
        operator: order.operator
      },
      order.id
    );
    blocks.push(...recheck);

    if (blocks.length) return { ok: false, blocks };

    const now = new Date().toISOString();
    const finalRef = refPrice!;
    const diff = round2(order.price - finalRef);

    order.status = "已通过";
    order.reviewer = input.reviewer.trim();
    order.reviewedAt = now;
    order.refPrice = finalRef;
    order.diff = diff;
    order.rejectReason = null;

    // 通过后参与站点价格写成冻结快照（站点用新售价，参照站定格当前牌价）
    const stationSnap: PriceSnapshot = {
      id: crypto.randomUUID(),
      orderId: order.id,
      station: order.station,
      fuel: order.fuel,
      price: order.price,
      role: "调价站点",
      startDate: order.startDate,
      endDate: order.endDate,
      createdAt: now
    };
    const refSnap: PriceSnapshot = {
      id: crypto.randomUUID(),
      orderId: order.id,
      station: order.refStation,
      fuel: order.fuel,
      price: finalRef,
      role: "参照站",
      startDate: order.startDate,
      endDate: order.endDate,
      createdAt: now
    };
    state.value.snapshots.unshift(stationSnap, refSnap);

    // 站点牌价更新为单据售价；参照站牌价保持不变（快照定格）
    state.value.board[order.station] ??= {
      "92号汽油": 0,
      "95号汽油": 0,
      "98号汽油": 0,
      柴油: 0
    };
    state.value.board[order.station][order.fuel] = order.price;

    persist();
    return { ok: true, blocks: [] };
  }

  function reject(orderId: string, reason: string): ActionResult {
    const order = state.value.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, blocks: [{ rule: "数据", detail: "调价单不存在" }] };
    if (order.status !== "待复核") {
      return {
        ok: false,
        blocks: [{ rule: "状态流转", detail: `仅待复核单据可驳回，当前为【${order.status}】` }]
      };
    }
    if (!reason.trim()) {
      return { ok: false, blocks: [{ rule: "必填", detail: "驳回须填写原因" }] };
    }
    order.status = "已驳回";
    order.rejectReason = reason.trim();
    persist();
    return { ok: true, blocks: [] };
  }

  /** 解除联审：仅原复核人执行，须另存说明；解除后释放冻结快照 */
  function release(orderId: string, input: ReleaseInput): ActionResult {
    const order = state.value.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, blocks: [{ rule: "数据", detail: "调价单不存在" }] };
    const blocks: BlockRule[] = [];
    if (order.status !== "已通过") {
      blocks.push({
        rule: "状态流转",
        detail: `仅已通过（冻结中）的单据可解除，单据【${order.id.slice(0, 8)}】当前为【${order.status}】`
      });
    }
    if (order.status === "已通过" && input.reviewer.trim() !== order.reviewer) {
      blocks.push({
        rule: "解除须原复核人",
        detail:
          `单据【${order.id.slice(0, 8)}】站点【${order.station}】油品【${order.fuel}】原复核人为【${order.reviewer}】，` +
          `当前操作人【${input.reviewer.trim() || "未填写"}】无权解除`
      });
    }
    if (!input.note.trim()) {
      blocks.push({ rule: "解除须另存说明", detail: "解除联审须填写并另存解除说明" });
    }
    if (blocks.length) return { ok: false, blocks };

    const now = new Date().toISOString();
    order.status = "已解除";
    order.releasedBy = input.reviewer.trim();
    order.releasedAt = now;
    order.releaseNote = input.note.trim();

    const record: ReleaseRecord = {
      id: crypto.randomUUID(),
      orderId: order.id,
      reviewer: input.reviewer.trim(),
      note: input.note.trim(),
      releasedAt: now
    };
    state.value.releases.unshift(record);
    persist();
    return { ok: true, blocks: [] };
  }

  /** 冻结中尝试单独改牌价：一律阻挡 */
  function updateBoardPrice(station: string, fuel: Fuel, price: number): ActionResult {
    if (isFrozen(station, fuel)) {
      const reasons = freezeReason(station, fuel)
        .map(
          (o) =>
            `单据【${o.id.slice(0, 8)}】（${o.station === station ? "调价站点" : "参照站"}）` +
            `区间 ${o.startDate} ~ ${o.endDate}，复核人 ${o.reviewer}`
        )
        .join("；");
      return {
        ok: false,
        blocks: [
          {
            rule: "冻结期不得单独调价",
            detail: `站点【${station}】油品【${fuel}】处于联审冻结：${reasons}`
          }
        ]
      };
    }
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, blocks: [{ rule: "必填", detail: "价格必须为正数" }] };
    }
    state.value.board[station] ??= {
      "92号汽油": 0,
      "95号汽油": 0,
      "98号汽油": 0,
      柴油: 0
    };
    state.value.board[station][fuel] = round2(price);
    persist();
    return { ok: true, blocks: [] };
  }

  function snapshotsOf(orderId: string): PriceSnapshot[] {
    return state.value.snapshots.filter((s) => s.orderId === orderId);
  }

  function releaseOf(orderId: string): ReleaseRecord | undefined {
    return state.value.releases.find((r) => r.orderId === orderId);
  }

  return {
    // state
    orders,
    snapshots,
    releases,
    board,
    frozenKeys,
    // constants
    fuels: FUELS,
    stations: STATIONS,
    // actions
    createOrder,
    approve,
    reject,
    release,
    updateBoardPrice,
    // queries
    getBoardPrice,
    isFrozen,
    freezeReason,
    rangeOccupancy,
    validateDraft,
    snapshotsOf,
    releaseOf,
    persist
  };
});
