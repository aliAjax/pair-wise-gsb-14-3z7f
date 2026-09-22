<script setup lang="ts">
import { computed, ref } from "vue";
import { usePriceStore, STATIONS } from "./store";
import OrderForm from "./components/OrderForm.vue";
import OrderCard from "./components/OrderCard.vue";
import BoardPanel from "./components/BoardPanel.vue";
import { DIFF_THRESHOLD } from "./types";

const store = usePriceStore();

const statusFilter = ref("全部");
const stationFilter = ref("全部站点");

const statusOptions = ["全部", "待复核", "已通过", "已驳回", "已解除"];

const filteredOrders = computed(() =>
  store.orders.filter((o) => {
    if (statusFilter.value !== "全部" && o.status !== statusFilter.value) return false;
    if (stationFilter.value !== "全部站点" && o.station !== stationFilter.value && o.refStation !== stationFilter.value) {
      return false;
    }
    return true;
  })
);

const metrics = computed(() => {
  const total = store.orders.length;
  const pending = store.orders.filter((o) => o.status === "待复核").length;
  const frozenOrders = store.orders.filter((o) => o.status === "已通过").length;
  const overThreshold = store.orders.filter(
    (o) => o.diff !== null && Math.abs(o.diff) > DIFF_THRESHOLD
  ).length;
  return [
    { label: "联审调价单", value: total },
    { label: "待复核", value: pending },
    { label: "冻结中单据", value: frozenOrders },
    { label: "超阈值单据", value: overThreshold }
  ];
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 邻站差价联审</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            调价单填写站点、油品、售价、参照站和生效区间；同站同油品区间不得交叠，
            与参照站每升差额超过 {{ DIFF_THRESHOLD.toFixed(2) }} 元（三角五分）须写依据并经复核人通过。
            通过后参与站点价格写成冻结快照，解除前不得单独调价；解除须由原复核人执行并另存说明。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Vite</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <OrderForm />

        <section class="list-panel">
          <div class="toolbar">
            <h2>联审调价单（{{ filteredOrders.length }}）</h2>
            <div class="filters">
              <select v-model="stationFilter">
                <option value="全部站点">全部站点</option>
                <option v-for="s in STATIONS" :key="s" :value="s">{{ s }}</option>
              </select>
              <select v-model="statusFilter">
                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配调价单</div>
            <OrderCard v-for="order in filteredOrders" :key="order.id" :order="order" />
          </div>
        </section>
      </section>

      <BoardPanel />
    </div>
  </main>
</template>
