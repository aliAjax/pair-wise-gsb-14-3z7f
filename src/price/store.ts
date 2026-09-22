import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DIFF_LIMIT,
  FUELS,
  STATIONS,
  STORAGE_KEY,
  STORAGE_VERSION,
  SYSTEM_REVIEWER,
  type Blockage,
  type FrozenSnapshot,
  type PersistState,
  type PriceBookEntry,
  type PriceOrder,
  type PriceOrderDraft,
  type ReleaseNote
} from "./model";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function seedPriceBook(): PriceBookEntry[] {
  const base: Record<string, number[]> = {
    "城东一站": [7.62, 8.16, 9.12, 7.18],
    "城西二站": [7.58, 8.1, 9.05, 7.12],
    "城南中心站": [7.6, 8.13, 9.08, 7.15],
    "新区加油站": [7.55, 8.07, 8.99, 7.08]
  };
  return STATIONS.flatMap((station) =>
    FUELS.map((fuel, index) => ({ station, fuel, price: base[station][index] }))
  );
}

function seedState(): PersistState {
  // 一条已生效的冻结快照（城东一站 92号汽油，参照新区加油站，差额 +0.32，免复核）
  const order: PriceOrder = {
    id: "seed-order-1",
    station: "城东一站",
    fuel: "92号汽油",
    price: 7.87,
    refStation: "新区加油站",
    refPrice: 7.55,
    diff: 0.32,
    startDate: "2026-09-15",
    endDate: "2026-10-15",
    basis: "东片区交通流量回升，挂牌价联动调整，差额在阈值内。",
    needsReview: false,
    operator: "站长",
    status: "已生效",
    createdAt: "2026-09-10T09:00:00.000Z",
    reviewer: SYSTEM_REVIEWER,
    reviewedAt: "2026-09-10T09:00:00.000Z"
  };
  const snapshot: FrozenSnapshot = {
    id: "seed-snap-1",
    orderId: order.id,
    station: order.station,
    fuel: order.fuel,
    price: order.price,
    refStation: order.refStation,
    refPrice: order.refPrice,
    diff: order.diff,
    startDate: order.startDate,
    endDate: order.endDate,
    reviewer: SYSTEM_REVIEWER,
    createdAt: order.reviewedAt as string,
    released: false
  };
  // 一条待复核联审单（新区加油站 95号汽油，差额 -0.40，须写依据并经复核人通过）
  const pending: PriceOrder = {
    id: "seed-order-2",
    station: "新区加油站",
    fuel: "95号汽油",
    price: 7.7,
    refStation: "城西二站",
    refPrice: 8.1,
    diff: -0.4,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    basis: "新区开业促销，会员日引流，区域价格备案已口头同意。",
    needsReview: true,
    operator: "值班经理",
    status: "待复核",
    createdAt: "2026-09-18T02:30:00.000Z"
  };
  return {
    version: STORAGE_VERSION,
    priceBook: seedPriceBook(),
    orders: [pending, order],
    snapshots: [snapshot],
    releases: []
  };
}

function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as PersistState;
    if (parsed.version !== STORAGE_VERSION) return seedState();
    return {
      version: STORAGE_VERSION,
      priceBook: parsed.priceBook ?? [],
      orders: parsed.orders ?? [],
      snapshots: parsed.snapshots ?? [],
      releases: parsed.releases ?? []
    };
  } catch {
    return seedState();
  }
}

/** 生效区间闭区间重叠判断 */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export const usePriceStore = defineStore("price-joint-review", () => {
  const initial = loadState();
  const priceBook = ref<PriceBookEntry[]>(initial.priceBook);
  const orders = ref<PriceOrder[]>(initial.orders);
  const snapshots = ref<FrozenSnapshot[]>(initial.snapshots);
  const releases = ref<ReleaseNote[]>(initial.releases);

  function persist() {
    const state: PersistState = {
      version: STORAGE_VERSION,
      priceBook: priceBook.value,
      orders: orders.value,
      snapshots: snapshots.value,
      releases: releases.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /** 某日某站点某油品的未解除冻结快照（取生效中的第一条） */
  function activeSnapshotAt(station: string, fuel: string, date: string): FrozenSnapshot | undefined {
    return snapshots.value.find(
      (snap) =>
        !snap.released &&
        ((snap.station === station && snap.fuel === fuel) ||
          (snap.refStation === station && snap.fuel === fuel)) &&
        date >= snap.startDate &&
        date <= snap.endDate
    );
  }

  /** 参照站当日售价：优先取联审冻结价，否则取底账价 */
  function refPriceAt(station: string, fuel: string, date: string): number | null {
    const frozen = activeSnapshotAt(station, fuel, date);
    if (frozen) {
      return frozen.station === station ? frozen.price : frozen.refPrice;
    }
    const entry = priceBook.value.find((item) => item.station === station && item.fuel === fuel);
    return entry ? entry.price : null;
  }

  /** 当前（今天）站点油品售价：冻结区间内取冻结快照，否则取底账 */
  const currentPriceMap = computed(() => {
    const today = todayIso();
    const map = new Map<string, number>();
    for (const entry of priceBook.value) map.set(`${entry.station}|${entry.fuel}`, entry.price);
    for (const snap of snapshots.value) {
      if (snap.released || today < snap.startDate || today > snap.endDate) continue;
      map.set(`${snap.station}|${snap.fuel}`, snap.price);
      map.set(`${snap.refStation}|${snap.fuel}`, snap.refPrice);
    }
    return map;
  });

  function currentPrice(station: string, fuel: string): number | undefined {
    return currentPriceMap.value.get(`${station}|${fuel}`);
  }

  /**
   * 提交/填写调价单时的全部阻挡项。
   * excludeOrderId 用于（理论上的）编辑场景排除自身。
   */
  function validateDraft(draft: PriceOrderDraft, excludeOrderId?: string): Blockage[] {
    const blockages: Blockage[] = [];
    const push = (blockage: Blockage) => blockages.push(blockage);

    if (!draft.station || !draft.fuel || !draft.refStation || !draft.startDate || !draft.endDate) {
      return blockages;
    }
    if (draft.price === null || Number.isNaN(draft.price) || draft.price <= 0) return blockages;

    if (draft.station === draft.refStation) {
      push({
        rule: "参照站必须为邻站",
        station: draft.station,
        fuel: draft.fuel,
        diffText: "—",
        conflictRange: `${draft.startDate} ~ ${draft.endDate}`,
        detail: "调价站点与参照站不能相同，请选择其他站点作为邻站参照。"
      });
      return blockages;
    }

    if (draft.endDate < draft.startDate) {
      push({
        rule: "生效区间必须合法",
        station: draft.station,
        fuel: draft.fuel,
        diffText: "—",
        conflictRange: `${draft.startDate} ~ ${draft.endDate}`,
        detail: "生效结束日期不能早于开始日期。"
      });
      return blockages;
    }

    // 规则一：同站同油品区间不能交叠（待复核与已生效未解除的调价单均占用区间）
    for (const other of orders.value) {
      if (other.id === excludeOrderId) continue;
      if (other.status === "已驳回" || other.status === "已解除") continue;
      if (other.station !== draft.station || other.fuel !== draft.fuel) continue;
      if (overlaps(draft.startDate, draft.endDate, other.startDate, other.endDate)) {
        push({
          rule: "同站同油品区间不能交叠",
          station: draft.station,
          fuel: draft.fuel,
          diffText: "—",
          conflictRange: `${other.startDate} ~ ${other.endDate}`,
          detail: `调价单 ${other.id}（${other.status}）已占用该区间。`
        });
      }
    }

    // 规则二：冻结未解除前，参与站点（调价站与参照站）不能单独调价
    for (const snap of snapshots.value) {
      if (snap.released) continue;
      const isParty =
        (snap.station === draft.station || snap.refStation === draft.station) &&
        snap.fuel === draft.fuel;
      if (!isParty) continue;
      if (overlaps(draft.startDate, draft.endDate, snap.startDate, snap.endDate)) {
        push({
          rule: "冻结快照解除前不能单独调价",
          station: draft.station,
          fuel: draft.fuel,
          diffText: "—",
          conflictRange: `${snap.startDate} ~ ${snap.endDate}`,
          detail: `调价单 ${snap.orderId} 联审通过后价格已冻结，须由原复核人「${snap.reviewer}」解除后方可再调价。`
        });
      }
    }

    // 规则三：与参照站每升差额超过三角五分（0.35 元）须写依据并经复核人通过
    const refPrice = refPriceAt(draft.refStation, draft.fuel, draft.startDate);
    if (refPrice !== null) {
      const diff = draft.price - refPrice;
      const diffText = `${diff > 0 ? "+" : diff < 0 ? "-" : ""}${Math.abs(diff).toFixed(2)} 元/升`;
      if (Math.abs(diff) > DIFF_LIMIT + 1e-9 && !draft.basis.trim()) {
        push({
          rule: "差额超三角五分须写依据",
          station: draft.station,
          fuel: draft.fuel,
          diffText,
          conflictRange: `${draft.startDate} ~ ${draft.endDate}`,
          detail: `与参照站「${draft.refStation}」每升差额 ${diffText}，阈值 0.35 元/升，必须填写调价依据并经复核人通过。`
        });
      }
    }

    return blockages;
  }

  /** 表单实时预览：参照价与差额 */
  function previewDiff(draft: PriceOrderDraft): { refPrice: number | null; diff: number | null } {
    if (!draft.refStation || !draft.fuel || !draft.startDate) return { refPrice: null, diff: null };
    const refPrice = refPriceAt(draft.refStation, draft.fuel, draft.startDate);
    if (refPrice === null || draft.price === null) return { refPrice, diff: null };
    return { refPrice, diff: draft.price - refPrice };
  }

  function submitDraft(draft: PriceOrderDraft): { ok: boolean; blockages: Blockage[]; orderId?: string } {
    const blockages = validateDraft(draft);
    if (blockages.length > 0) return { ok: false, blockages };

    const refPrice = refPriceAt(draft.refStation, draft.fuel as string, draft.startDate) ?? 0;
    const price = draft.price as number;
    const diff = price - refPrice;
    const needsReview = Math.abs(diff) > DIFF_LIMIT + 1e-9;
    const now = new Date().toISOString();
    const order: PriceOrder = {
      id: uid("order"),
      station: draft.station,
      fuel: draft.fuel,
      price,
      refStation: draft.refStation,
      refPrice,
      diff,
      startDate: draft.startDate,
      endDate: draft.endDate,
      basis: draft.basis.trim(),
      needsReview,
      operator: draft.operator.trim() || "未填操作员",
      status: "待复核",
      createdAt: now
    };
    orders.value = [order, ...orders.value];

    // 差额未超阈值：无需复核，直接通过并冻结
    if (!needsReview) {
      approveOrder(order.id, SYSTEM_REVIEWER, true);
    }
    persist();
    return { ok: true, blockages: [], orderId: order.id };
  }

  /** 复核人通过：超过阈值的单据必须由具名复核人（非系统、非空）执行 */
  function approveOrder(
    orderId: string,
    reviewer: string,
    system = false
  ): { ok: boolean; blockages: Blockage[] } {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || order.status !== "待复核") {
      return {
        ok: false,
        blockages: [{
          rule: "仅待复核单据可通过",
          station: order?.station ?? "—",
          fuel: order?.fuel ?? "—",
          diffText: order ? `${order.diff.toFixed(2)} 元/升` : "—",
          conflictRange: order ? `${order.startDate} ~ ${order.endDate}` : "—",
          detail: "当前状态不允许复核通过。"
        }]
      };
    }

    const name = (reviewer || "").trim();
    if (!system) {
      if (!name) {
        return {
          ok: false,
          blockages: [{
            rule: "差额超三角五分须经复核人通过",
            station: order.station,
            fuel: order.fuel,
            diffText: `${order.diff > 0 ? "+" : ""}${order.diff.toFixed(2)} 元/升`,
            conflictRange: `${order.startDate} ~ ${order.endDate}`,
            detail: "请填写复核人姓名后再通过。"
          }]
        };
      }
      if (name === order.operator) {
        return {
          ok: false,
          blockages: [{
            rule: "制单与复核须分离",
            station: order.station,
            fuel: order.fuel,
            diffText: `${order.diff > 0 ? "+" : ""}${order.diff.toFixed(2)} 元/升`,
            conflictRange: `${order.startDate} ~ ${order.endDate}`,
            detail: `复核人不能与制单人「${order.operator}」为同一人。`
          }]
        };
      }
    }

    const finalReviewer = system ? SYSTEM_REVIEWER : name;
    const now = new Date().toISOString();
    order.status = "已生效";
    order.reviewer = finalReviewer;
    order.reviewedAt = now;

    // 通过后参与站点价格写成冻结快照
    const snapshot: FrozenSnapshot = {
      id: uid("snap"),
      orderId: order.id,
      station: order.station,
      fuel: order.fuel,
      price: order.price,
      refStation: order.refStation,
      refPrice: order.refPrice,
      diff: order.diff,
      startDate: order.startDate,
      endDate: order.endDate,
      reviewer: finalReviewer,
      createdAt: now,
      released: false
    };
    snapshots.value = [snapshot, ...snapshots.value];
    persist();
    return { ok: true, blockages: [] };
  }

  function rejectOrder(orderId: string, reviewer: string, reason: string): { ok: boolean; blockages: Blockage[] } {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order || order.status !== "待复核") {
      return {
        ok: false,
        blockages: [{
          rule: "仅待复核单据可驳回",
          station: order?.station ?? "—",
          fuel: order?.fuel ?? "—",
          diffText: "—",
          conflictRange: "—",
          detail: "当前状态不允许驳回。"
        }]
      };
    }
    if (!reviewer.trim()) {
      return {
        ok: false,
        blockages: [{
          rule: "驳回须登记复核人",
          station: order.station,
          fuel: order.fuel,
          diffText: `${order.diff > 0 ? "+" : ""}${order.diff.toFixed(2)} 元/升`,
          conflictRange: `${order.startDate} ~ ${order.endDate}`,
          detail: "请填写执行驳回的复核人姓名。"
        }]
      };
    }
    if (!reason.trim()) {
      return {
        ok: false,
        blockages: [{
          rule: "驳回须填写原因",
          station: order.station,
          fuel: order.fuel,
          diffText: `${order.diff > 0 ? "+" : ""}${order.diff.toFixed(2)} 元/升`,
          conflictRange: `${order.startDate} ~ ${order.endDate}`,
          detail: "请填写驳回原因，随调价单一并留痕。"
        }]
      };
    }
    order.status = "已驳回";
    order.reviewer = reviewer.trim();
    order.reviewedAt = new Date().toISOString();
    order.rejectReason = reason.trim();
    persist();
    return { ok: true, blockages: [] };
  }

  /** 解除冻结：须由原复核人执行，并另存说明 */
  function releaseSnapshot(
    snapshotId: string,
    operator: string,
    note: string
  ): { ok: boolean; blockages: Blockage[] } {
    const snap = snapshots.value.find((item) => item.id === snapshotId);
    if (!snap) {
      return {
        ok: false,
        blockages: [{
          rule: "快照不存在",
          station: "—",
          fuel: "—",
          diffText: "—",
          conflictRange: "—",
          detail: "未找到对应冻结快照。"
        }]
      };
    }
    if (snap.released) {
      return {
        ok: false,
        blockages: [{
          rule: "快照已解除",
          station: snap.station,
          fuel: snap.fuel,
          diffText: `${snap.diff > 0 ? "+" : ""}${snap.diff.toFixed(2)} 元/升`,
          conflictRange: `${snap.startDate} ~ ${snap.endDate}`,
          detail: "该冻结快照已解除，不能重复解除。"
        }]
      };
    }

    const name = (operator || "").trim();
    const text = (note || "").trim();
    const blockages: Blockage[] = [];

    // 免复核单（系统自动通过）无具体原复核人，允许具名站长解除；人工复核单必须本人
    if (snap.reviewer !== SYSTEM_REVIEWER && name !== snap.reviewer) {
      blockages.push({
        rule: "解除须由原复核人执行",
        station: snap.station,
        fuel: snap.fuel,
        diffText: `${snap.diff > 0 ? "+" : ""}${snap.diff.toFixed(2)} 元/升`,
        conflictRange: `${snap.startDate} ~ ${snap.endDate}`,
        detail: `该快照原复核人为「${snap.reviewer}」，仅本人可解除；当前操作人为「${name || "空"}」。`
      });
    }
    if (!name) {
      blockages.push({
        rule: "解除须登记操作人",
        station: snap.station,
        fuel: snap.fuel,
        diffText: `${snap.diff > 0 ? "+" : ""}${snap.diff.toFixed(2)} 元/升`,
        conflictRange: `${snap.startDate} ~ ${snap.endDate}`,
        detail: "请填写执行解除的操作人。"
      });
    }
    if (!text) {
      blockages.push({
        rule: "解除须另存说明",
        station: snap.station,
        fuel: snap.fuel,
        diffText: `${snap.diff > 0 ? "+" : ""}${snap.diff.toFixed(2)} 元/升`,
        conflictRange: `${snap.startDate} ~ ${snap.endDate}`,
        detail: "必须填写解除说明并另存后方可解除冻结。"
      });
    }
    if (blockages.length) return { ok: false, blockages };

    const now = new Date().toISOString();
    const release: ReleaseNote = {
      id: uid("rel"),
      snapshotId: snap.id,
      orderId: snap.orderId,
      station: snap.station,
      fuel: snap.fuel,
      note: text,
      reviewer: name,
      createdAt: now
    };
    releases.value = [release, ...releases.value];
    snap.released = true;
    snap.releasedAt = now;
    snap.releasedBy = name;
    snap.releaseNoteId = release.id;

    const order = orders.value.find((item) => item.id === snap.orderId);
    if (order) order.status = "已解除";
    persist();
    return { ok: true, blockages: [] };
  }

  /** 删除：仅待复核/已驳回可调，已生效单须走解除流程以保留审计链 */
  function removeOrder(orderId: string) {
    const order = orders.value.find((item) => item.id === orderId);
    if (!order) return;
    if (order.status !== "待复核" && order.status !== "已驳回") return;
    orders.value = orders.value.filter((item) => item.id !== orderId);
    persist();
  }

  return {
    priceBook,
    orders,
    snapshots,
    releases,
    currentPriceMap,
    currentPrice,
    refPriceAt,
    validateDraft,
    previewDiff,
    submitDraft,
    approveOrder,
    rejectOrder,
    releaseSnapshot,
    removeOrder,
    persist
  };
});
