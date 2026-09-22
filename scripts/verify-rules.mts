import { createPinia, setActivePinia } from "pinia";
import { usePriceStore } from "../src/store";
import type { Fuel } from "../src/types";

// ---- shims ----
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k)
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log("  PASS", name);
  } else {
    fail++;
    console.error("  FAIL", name, extra ?? "");
  }
}

function freshStore() {
  mem.clear();
  setActivePinia(createPinia());
  return usePriceStore();
}

const fuel: Fuel = "92号汽油";

console.log("1. 超阈值无依据 → 阻挡，有依据 → 提单成功");
{
  const s = freshStore();
  const blocked = s.createOrder({
    station: "滨江站", fuel, price: 8.50, refStation: "开发区站",
    startDate: "2026-10-01", endDate: "2026-10-10", basis: "", operator: "甲"
  });
  check("无依据被阻挡", !blocked.ok && blocked.blocks.some(b => b.rule.includes("超阈值须依据")));
  check("阻挡含站点/油品/差额", blocked.blocks[0].detail.includes("滨江站") && blocked.blocks[0].detail.includes("92号汽油") && blocked.blocks[0].detail.includes("+0.95"));

  const ok = s.createOrder({
    station: "滨江站", fuel, price: 8.50, refStation: "开发区站",
    startDate: "2026-10-01", endDate: "2026-10-10", basis: "竞品上调", operator: "甲"
  });
  check("有依据提单成功", ok.ok, ok.blocks);
}

console.log("2. 同站同油品区间交叠 → 阻挡（闭区间含端点）");
{
  const s = freshStore();
  const mk = (start: string, end: string, station = "高新站", ref = "开发区站") =>
    s.createOrder({ station, fuel, price: 7.60, refStation: ref, startDate: start, endDate: end, basis: "", operator: "甲" });
  check("首单成功", mk("2026-11-01", "2026-11-10").ok);
  const touch = mk("2026-11-10", "2026-11-20"); // 端点相接也算交叠
  check("端点相接被阻挡", !touch.ok && touch.blocks.some(b => b.rule.includes("区间不得交叠")) && touch.blocks[0].detail.includes("冲突区间"));
  const overlap = mk("2026-11-05", "2026-11-08");
  check("区间包含被阻挡", !overlap.ok);
  check("不相交区间成功", mk("2026-11-11", "2026-11-20").ok);
  // 参照站占用也阻挡
  const refBlock = mk("2026-11-01", "2026-11-05", "滨江站", "高新站");
  check("参照站区间占用被阻挡", !refBlock.ok && refBlock.blocks.some(b => b.detail.includes("参照站【高新站】")));
}

console.log("3. 通过 → 定格差额、写价、双冻结快照");
{
  const s = freshStore();
  const order = s.createOrder({
    station: "滨江站", fuel, price: 8.50, refStation: "开发区站",
    startDate: "2026-10-01", endDate: "2026-10-10", basis: "竞品上调", operator: "甲"
  });
  const id = (s.orders[0] as any).id;
  const appr = s.approve(id, { reviewer: "王复核" });
  check("复核通过", appr.ok, appr.blocks);
  const o = s.orders[0] as any;
  check("定格参照价 7.55 与差额 +0.95", o.refPrice === 7.55 && o.diff === 0.95, { refPrice: o.refPrice, diff: o.diff });
  check("站点牌价写成售价", s.getBoardPrice("滨江站", fuel) === 8.5);
  check("两张冻结快照", s.snapshotsOf(id).length === 2);
  check("站点冻结", s.isFrozen("滨江站", fuel));
  check("参照站冻结", s.isFrozen("开发区站", fuel));
}

console.log("4. 冻结期不能单独调价（站点与参照站）");
{
  const s = freshStore();
  const id = (s.orders.find((o: any) => o.id === "seed-order-1") as any)?.id;
  // seed 单是待复核，先通过（7.99 vs 7.58, +0.41 有依据）
  const appr = s.approve(id, { reviewer: "李复核" });
  check("seed 单可复核通过", appr.ok, appr.blocks);
  const b1 = s.updateBoardPrice("城东一站", fuel, 9.99);
  check("调价站点单独调价被阻挡", !b1.ok && b1.blocks[0].detail.includes("城东一站") && b1.blocks[0].rule.includes("冻结"));
  const b2 = s.updateBoardPrice("城东二站", fuel, 9.99);
  check("参照站单独调价被阻挡", !b2.ok && b2.blocks[0].detail.includes("城东二站"));
  check("未冻结站点可调价", s.updateBoardPrice("高新站", "95号汽油", 8.20).ok);
}

console.log("5. 解除：非原复核人阻挡 / 无说明阻挡 / 原复核人+说明成功");
{
  const s = freshStore();
  const id = (s.orders[0] as any).id;
  s.approve(id, { reviewer: "李复核" });
  const wrong = s.release(id, { reviewer: "张三", note: "误操作" });
  check("非原复核人解除被阻挡", !wrong.ok && wrong.blocks.some(b => b.rule.includes("解除须原复核人")));
  const noNote = s.release(id, { reviewer: "李复核", note: "  " });
  check("无解除说明被阻挡", !noNote.ok && noNote.blocks.some(b => b.rule.includes("另存说明")));
  const ok = s.release(id, { reviewer: "李复核", note: "竞争活动结束，恢复单独定价" });
  check("原复核人+说明解除成功", ok.ok, ok.blocks);
  check("解除后不再冻结", !s.isFrozen("城东一站", fuel) && !s.isFrozen("城东二站", fuel));
  check("解除后可单独调价", s.updateBoardPrice("城东一站", fuel, 7.70).ok);
  check("解除说明已另存", (s.releaseOf(id) as any)?.note === "竞争活动结束，恢复单独定价");
}

console.log("6. 重新载入后单据/快照/说明仍对应");
{
  const s = freshStore();
  const id = (s.orders[0] as any).id;
  s.approve(id, { reviewer: "李复核" });
  s.release(id, { reviewer: "李复核", note: "片区统一解除" });

  // 模拟页面重新载入：新 pinia，store 从 localStorage 读取
  setActivePinia(createPinia());
  const s2 = usePriceStore();
  const o = s2.orders.find((x: any) => x.id === id) as any;
  check("单据状态持久化", o && o.status === "已解除" && o.releasedBy === "李复核");
  check("快照仍关联单据", s2.snapshotsOf(id).length === 2);
  check("区间占用信息保留", o.startDate === "2026-09-20" && o.endDate === "2026-09-30");
  check("解除说明仍关联", s2.releaseOf(id)?.note === "片区统一解除");
  check("牌价持久化", s2.getBoardPrice("城东一站", fuel) === 7.99);
}

console.log("7. 通过瞬间重校验：删除依据后超阈值不可通过");
{
  const s = freshStore();
  const r = s.createOrder({
    station: "滨江站", fuel, price: 7.60, refStation: "开发区站",
    startDate: "2026-12-01", endDate: "2026-12-10", basis: "", operator: "甲"
  }); // 7.60-7.55=0.05 未超阈值
  check("小额差无需依据", r.ok);
  const id = (s.orders[0] as any).id;
  // 通过前参照站牌价变动导致差额超阈值且单据无依据
  s.updateBoardPrice("开发区站", fuel, 7.10); // 7.60-7.10=0.50
  const appr = s.approve(id, { reviewer: "赵复核" });
  check("超阈值无依据不可通过", !appr.ok && appr.blocks.some(b => b.rule.includes("超阈值须依据")), appr.blocks);
}

console.log("8. 自身不能作为参照站 / 区间起止非法");
{
  const s = freshStore();
  const r1 = s.createOrder({
    station: "高新站", fuel, price: 7.6, refStation: "高新站",
    startDate: "2026-10-01", endDate: "2026-10-10", basis: "", operator: "甲"
  });
  check("自身参照被阻挡", !r1.ok && r1.blocks.some(b => b.rule.includes("邻站联审")));
  const r2 = s.createOrder({
    station: "高新站", fuel, price: 7.6, refStation: "开发区站",
    startDate: "2026-10-10", endDate: "2026-10-01", basis: "", operator: "甲"
  });
  check("起止颠倒被阻挡", !r2.ok && r2.blocks.some(b => b.rule.includes("生效区间")));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
