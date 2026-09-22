// 油品价格维护 —— 邻站差价联审领域模型

export const STORAGE_KEY = "dfwlfront-9-price-v2";
export const STORAGE_VERSION = 2;

/** 差额阈值：每升三角五分（0.35 元/升），超过即须写依据并经复核人通过 */
export const DIFF_LIMIT = 0.35;

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "0号柴油"] as const;
export type Fuel = (typeof FUELS)[number];

export const STATIONS = ["城东一站", "城西二站", "城南中心站", "新区加油站"] as const;
export type Station = (typeof STATIONS)[number];

/** 调价单状态：待复核（联审中）/ 已生效（通过，站点价格冻结）/ 已驳回 / 已解除 */
export type OrderStatus = "待复核" | "已生效" | "已驳回" | "已解除";

export const SYSTEM_REVIEWER = "系统免复核";

export interface PriceOrderDraft {
  /** 调价站点 */
  station: string;
  /** 油品 */
  fuel: string;
  /** 拟定售价（元/升） */
  price: number | null;
  /** 参照站 */
  refStation: string;
  /** 生效区间 */
  startDate: string;
  endDate: string;
  /** 调价依据（差额超阈值时必填） */
  basis: string;
  /** 制单人 */
  operator: string;
}

/** 调价单 */
export interface PriceOrder {
  id: string;
  station: string;
  fuel: string;
  price: number;
  refStation: string;
  /** 提交时参照站售价快照（元/升） */
  refPrice: number;
  /** 每升差额 = 售价 - 参照价（正/负，元/升） */
  diff: number;
  startDate: string;
  endDate: string;
  basis: string;
  /** 是否需要人工复核（|差额| > 0.35） */
  needsReview: boolean;
  operator: string;
  status: OrderStatus;
  createdAt: string;
  /** 复核人；免复核单为系统免复核 */
  reviewer?: string;
  reviewedAt?: string;
  /** 驳回原因 */
  rejectReason?: string;
}

/** 冻结快照中的一方价格（参与站点） */
export interface FrozenParty {
  station: string;
  fuel: string;
  price: number;
}

/** 通过后写死的冻结快照，解除前参与站点不能单独调价 */
export interface FrozenSnapshot {
  id: string;
  orderId: string;
  /** 调价站冻结价格 */
  station: string;
  fuel: string;
  price: number;
  /** 参照站冻结价格（联审对方） */
  refStation: string;
  refPrice: number;
  diff: number;
  startDate: string;
  endDate: string;
  reviewer: string;
  createdAt: string;
  released: boolean;
  releasedAt?: string;
  /** 解除操作人（必须为原复核人） */
  releasedBy?: string;
  releaseNoteId?: string;
}

/** 解除说明（另存，与快照、调价单一一对应） */
export interface ReleaseNote {
  id: string;
  snapshotId: string;
  orderId: string;
  station: string;
  fuel: string;
  note: string;
  reviewer: string;
  createdAt: string;
}

/** 站点油品价格底账 */
export interface PriceBookEntry {
  station: string;
  fuel: string;
  price: number;
}

export interface PersistState {
  version: number;
  priceBook: PriceBookEntry[];
  orders: PriceOrder[];
  snapshots: FrozenSnapshot[];
  releases: ReleaseNote[];
}

/** 阻挡项：阻挡时显示站点、油品、差额、冲突区间和规则 */
export interface Blockage {
  rule: string;
  station: string;
  fuel: string;
  diffText: string;
  conflictRange: string;
  detail: string;
}

export function formatMoney(value: number): string {
  return `${value.toFixed(2)} 元/升`;
}

export function formatDiff(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${sign}${Math.abs(diff).toFixed(2)} 元/升`;
}

export function rangeText(start: string, end: string): string {
  return `${start} ~ ${end}`;
}
