export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;
export type Fuel = (typeof FUELS)[number];

export const STATUSES = ["待复核", "已通过", "已驳回", "已解除"] as const;
export type OrderStatus = (typeof STATUSES)[number];

/** 每升差额阈值：三角五分 */
export const DIFF_THRESHOLD = 0.35;

/** 调价单（邻站差价联审） */
export interface PriceOrder {
  id: string;
  /** 调价站点 */
  station: string;
  /** 油品 */
  fuel: Fuel;
  /** 售价（元/升） */
  price: number;
  /** 参照站 */
  refStation: string;
  /** 生效区间起（含），YYYY-MM-DD */
  startDate: string;
  /** 生效区间止（含），YYYY-MM-DD */
  endDate: string;
  /** 依据：与参照站差额超过三角五分时必填 */
  basis: string;
  /** 提单人 */
  operator: string;
  createdAt: string;

  status: OrderStatus;
  /** 通过时参照站当时的每升价格（复核时定格） */
  refPrice: number | null;
  /** 通过时与参照站的每升差额（正=高于参照站） */
  diff: number | null;
  /** 复核人 */
  reviewer: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;

  releasedBy: string | null;
  releasedAt: string | null;
  releaseNote: string | null;
}

/** 冻结快照：调价单通过后，站点与参照站各生成一份 */
export interface PriceSnapshot {
  id: string;
  orderId: string;
  station: string;
  fuel: Fuel;
  /** 通过瞬间定格的价格 */
  price: number;
  role: "调价站点" | "参照站";
  startDate: string;
  endDate: string;
  createdAt: string;
}

/** 解除联审的留痕说明 */
export interface ReleaseRecord {
  id: string;
  orderId: string;
  /** 必须与原复核人一致 */
  reviewer: string;
  note: string;
  releasedAt: string;
}

export interface BoardState {
  orders: PriceOrder[];
  snapshots: PriceSnapshot[];
  releases: ReleaseRecord[];
  /** 各站点各油品当前牌价 */
  board: Record<string, Record<Fuel, number>>;
}

/** 阻挡规则命中后展示的结构：规则 + 命中明细 */
export interface BlockRule {
  rule: string;
  detail: string;
}

export interface ActionResult {
  ok: boolean;
  blocks: BlockRule[];
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatDiff(diff: number | null): string {
  if (diff === null || Number.isNaN(diff)) return "—";
  const fixed = round2(diff).toFixed(2);
  return diff > 0 ? `+${fixed}` : fixed;
}
