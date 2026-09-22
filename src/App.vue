<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { usePriceStore } from "./price/store";
import {
  DIFF_LIMIT,
  FUELS,
  STATIONS,
  SYSTEM_REVIEWER,
  type Blockage,
  type FrozenSnapshot,
  type PriceOrder,
  formatDiff,
  formatMoney,
  rangeText
} from "./price/model";

const store = usePriceStore();

function isoOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const draft = reactive({
  station: "",
  fuel: "",
  price: null as number | null,
  refStation: "",
  startDate: isoOffset(0),
  endDate: isoOffset(30),
  basis: "",
  operator: ""
});

const preview = computed(() => store.previewDiff(draft));
const overLimit = computed(
  () => preview.value.diff !== null && Math.abs(preview.value.diff) > DIFF_LIMIT + 1e-9
);
const liveBlockages = computed(() => store.validateDraft(draft));

const submitError = ref("");
function submit() {
  submitError.value = "";
  const result = store.submitDraft(draft);
  if (!result.ok) return;
  draft.station = "";
  draft.fuel = "";
  draft.price = null;
  draft.refStation = "";
  draft.basis = "";
  draft.operator = "";
  draft.startDate = isoOffset(0);
  draft.endDate = isoOffset(30);
}

/* ---------- 列表筛选 ---------- */
const stationFilter = ref("全部站点");
const fuelFilter = ref("全部油品");

function matchScope(station: string, fuel: string): boolean {
  const stationOk = stationFilter.value === "全部站点" || station === stationFilter.value;
  const fuelOk = fuelFilter.value === "全部油品" || fuel === fuelFilter.value;
  return stationOk && fuelOk;
}

const filteredOrders = computed(() =>
  store.orders.filter((order) => matchScope(order.station, order.fuel) || matchScope(order.refStation, order.fuel))
);
const filteredSnapshots = computed(() =>
  store.snapshots.filter(
    (snap) => matchScope(snap.station, snap.fuel) || matchScope(snap.refStation, snap.fuel)
  )
);

/* ---------- 复核操作 ---------- */
const reviewNames = reactive<Record<string, string>>({});
const rejectReasons = reactive<Record<string, string>>({});
const reviewErrors = reactive<Record<string, Blockage[]>>({});

function approve(order: PriceOrder) {
  reviewErrors[order.id] = [];
  const result = store.approveOrder(order.id, reviewNames[order.id] ?? "");
  if (!result.ok) reviewErrors[order.id] = result.blockages;
  else {
    reviewNames[order.id] = "";
    rejectReasons[order.id] = "";
  }
}

function reject(order: PriceOrder) {
  reviewErrors[order.id] = [];
  const result = store.rejectOrder(order.id, reviewNames[order.id] ?? "", rejectReasons[order.id] ?? "");
  if (!result.ok) reviewErrors[order.id] = result.blockages;
}

/* ---------- 解除操作 ---------- */
const releaseOperators = reactive<Record<string, string>>({});
const releaseNotes = reactive<Record<string, string>>({});
const releaseErrors = reactive<Record<string, Blockage[]>>({});

function release(snap: FrozenSnapshot) {
  releaseErrors[snap.id] = [];
  const result = store.releaseSnapshot(
    snap.id,
    releaseOperators[snap.id] ?? "",
    releaseNotes[snap.id] ?? ""
  );
  if (!result.ok) releaseErrors[snap.id] = result.blockages;
  else {
    releaseOperators[snap.id] = "";
    releaseNotes[snap.id] = "";
  }
}

/* ---------- 指标与图表 ---------- */
const metrics = computed(() => [
  { label: "调价单总数", value: store.orders.length },
  { label: "待复核联审", value: store.orders.filter((order) => order.status === "待复核").length },
  { label: "冻结中快照", value: store.snapshots.filter((snap) => !snap.released).length },
  { label: "已解除留档", value: store.releases.length }
]);

const chartRows = computed(() =>
  (["待复核", "已生效", "已驳回", "已解除"] as const).map((status) => ({
    status,
    value: store.orders.filter((order) => order.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

const statusClass: Record<string, string> = {
  待复核: "status-pending",
  已生效: "status-live",
  已驳回: "status-reject",
  已解除: "status-done"
};

/* ---------- 站点价格底账 ---------- */
const today = isoOffset(0);
const frozenToday = computed(() => {
  const keys = new Set<string>();
  for (const snap of store.snapshots) {
    if (snap.released || today < snap.startDate || today > snap.endDate) continue;
    keys.add(`${snap.station}|${snap.fuel}`);
    keys.add(`${snap.refStation}|${snap.fuel}`);
  }
  return keys;
});

function releaseNoteOf(snap: FrozenSnapshot) {
  return store.releases.find((note) => note.snapshotId === snap.id);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 邻站差价联审</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            调价单登记站点、油品、售价、参照站与生效区间；同站同油品区间不得交叠，与参照站每升差额超过
            <strong>三角五分（0.35 元）</strong>须写依据并经复核人通过。通过后参与站点价格写成冻结快照，解除前不能单独调价；解除须由原复核人执行并另存说明。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage 留痕</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <!-- 调价单录入 -->
        <form class="panel" @submit.prevent="submit">
          <h2>新增调价单（邻站联审）</h2>
          <div class="form-grid">
            <label>
              调价站点
              <select v-model="draft.station" required>
                <option value="">请选择站点</option>
                <option v-for="station in STATIONS" :key="station" :value="station">{{ station }}</option>
              </select>
            </label>

            <label>
              油品
              <select v-model="draft.fuel" required>
                <option value="">请选择油品</option>
                <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
              </select>
            </label>

            <label>
              拟定售价（元/升）
              <input v-model.number="draft.price" type="number" min="0" step="0.01" placeholder="如 7.87" required />
            </label>

            <label>
              参照站（邻站）
              <select v-model="draft.refStation" required>
                <option value="">请选择参照站</option>
                <option v-for="station in STATIONS" :key="station" :value="station">{{ station }}</option>
              </select>
            </label>

            <div class="range-row">
              <label>
                生效开始
                <input v-model="draft.startDate" type="date" required />
              </label>
              <label>
                生效结束
                <input v-model="draft.endDate" type="date" required />
              </label>
            </div>

            <!-- 实时差额预览 -->
            <div v-if="draft.refStation && draft.fuel && preview.refPrice !== null" class="diff-preview" :class="{ over: overLimit }">
              <span>参照站「{{ draft.refStation }}」{{ draft.fuel }}售价：<strong>{{ formatMoney(preview.refPrice) }}</strong></span>
              <span>
                每升差额：<strong>{{ preview.diff !== null ? formatDiff(preview.diff) : "—" }}</strong>
                <em v-if="overLimit">已超 0.35 元阈值，须写依据并经复核人通过</em>
                <em v-else class="ok">阈值内，免人工复核</em>
              </span>
            </div>

            <label>
              调价依据<span v-if="overLimit" class="required-mark">（差额超阈值，必填）</span>
              <textarea
                v-model="draft.basis"
                :placeholder="overLimit ? '与参照站差额超过三角五分（0.35 元/升），必须写明调价依据' : '填写调价依据或现场说明（可选）'"
              />
            </label>

            <label>
              制单人
              <input v-model="draft.operator" type="text" placeholder="如 站长 / 值班经理" required />
            </label>

            <!-- 阻挡提示：站点、油品、差额、冲突区间、规则 -->
            <div v-if="liveBlockages.length" class="block-list">
              <p class="block-title">提交被以下规则阻挡（{{ liveBlockages.length }}）</p>
              <div v-for="(block, index) in liveBlockages" :key="index" class="blockage">
                <div class="blockage-head">
                  <span class="block-rule">{{ block.rule }}</span>
                  <span class="block-diff">差额 {{ block.diffText }}</span>
                </div>
                <div class="blockage-body">
                  <span>站点：{{ block.station }}</span>
                  <span>油品：{{ block.fuel }}</span>
                  <span>冲突区间：{{ block.conflictRange }}</span>
                </div>
                <p>{{ block.detail }}</p>
              </div>
            </div>
            <p v-else-if="draft.station && draft.fuel && draft.refStation" class="hint ok-hint">
              校验通过：区间无交叠、站点未处于冻结期，可提交。
            </p>

            <button type="submit" :disabled="liveBlockages.length > 0">提交调价单</button>
          </div>
        </form>

        <!-- 右侧工作区 -->
        <section class="list-panel">
          <div class="toolbar">
            <h2>调价单与冻结快照</h2>
            <div class="filters">
              <select v-model="stationFilter">
                <option>全部站点</option>
                <option v-for="station in STATIONS" :key="station">{{ station }}</option>
              </select>
              <select v-model="fuelFilter">
                <option>全部油品</option>
                <option v-for="fuel in FUELS" :key="fuel">{{ fuel }}</option>
              </select>
            </div>
          </div>

          <!-- 调价单列表 -->
          <h3 class="section-hint">调价单（区间占用）</h3>
          <div class="record-grid">
            <div v-if="filteredOrders.length === 0" class="empty">暂无匹配调价单</div>
            <article v-for="order in filteredOrders" :key="order.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ order.station }} · {{ order.fuel }}</p>
                <span class="status" :class="statusClass[order.status]">{{ order.status }}</span>
              </div>
              <div class="details">
                <span>拟定售价：{{ formatMoney(order.price) }}</span>
                <span>
                  参照站：{{ order.refStation }}（{{ formatMoney(order.refPrice) }}）
                  <b class="diff-badge" :class="{ over: Math.abs(order.diff) > DIFF_LIMIT + 1e-9 }">
                    差额 {{ formatDiff(order.diff) }}
                  </b>
                </span>
                <span>生效区间：{{ rangeText(order.startDate, order.endDate) }}</span>
                <span>制单人：{{ order.operator }}</span>
                <span v-if="order.reviewer">复核人：{{ order.reviewer }}</span>
                <span v-if="order.reviewedAt">复核时间：{{ new Date(order.reviewedAt).toLocaleString("zh-CN") }}</span>
                <span class="need-review" v-if="order.needsReview && order.status === '待复核'">超阈值联审：须写依据 + 复核人通过</span>
                <span class="auto-review" v-else-if="!order.needsReview && order.status === '待复核'">阈值内：提交即通过并冻结</span>
              </div>
              <p class="note">依据：{{ order.basis || "（未填写）" }}</p>
              <p v-if="order.rejectReason" class="note reject-note">驳回原因：{{ order.rejectReason }}</p>

              <!-- 阻挡信息（复核失败时） -->
              <div v-if="reviewErrors[order.id]?.length" class="block-list compact">
                <div v-for="(block, index) in reviewErrors[order.id]" :key="index" class="blockage">
                  <div class="blockage-head">
                    <span class="block-rule">{{ block.rule }}</span>
                    <span class="block-diff">差额 {{ block.diffText }}</span>
                  </div>
                  <div class="blockage-body">
                    <span>站点：{{ block.station }}</span>
                    <span>油品：{{ block.fuel }}</span>
                    <span>冲突区间：{{ block.conflictRange }}</span>
                  </div>
                  <p>{{ block.detail }}</p>
                </div>
              </div>

              <!-- 待复核操作 -->
              <div v-if="order.status === '待复核'" class="review-box">
                <input v-model="reviewNames[order.id]" type="text" placeholder="复核人姓名（制单复核须分离）" />
                <div class="actions">
                  <button type="button" @click="approve(order)">复核通过并冻结</button>
                  <input
                    v-model="rejectReasons[order.id]"
                    type="text"
                    class="reject-input"
                    placeholder="驳回原因（驳回必填）"
                  />
                  <button class="danger" type="button" @click="reject(order)">驳回</button>
                  <button class="secondary" type="button" @click="store.removeOrder(order.id)">撤单</button>
                </div>
              </div>
            </article>
          </div>

          <!-- 冻结快照 -->
          <h3 class="section-hint">冻结快照（解除前参与站点不能单独调价）</h3>
          <div class="record-grid">
            <div v-if="filteredSnapshots.length === 0" class="empty">暂无冻结快照</div>
            <article v-for="snap in filteredSnapshots" :key="snap.id" class="record snapshot" :class="{ released: snap.released }">
              <div class="record-head">
                <p class="record-title">
                  {{ snap.station }} ↔ {{ snap.refStation }} · {{ snap.fuel }}
                </p>
                <span class="status" :class="snap.released ? 'status-done' : 'status-live'">
                  {{ snap.released ? "已解除" : "冻结中" }}
                </span>
              </div>
              <div class="details">
                <span>{{ snap.station }} 冻结价：<strong>{{ formatMoney(snap.price) }}</strong></span>
                <span>{{ snap.refStation }} 冻结价：<strong>{{ formatMoney(snap.refPrice) }}</strong></span>
                <span>
                  每升差额：
                  <b class="diff-badge" :class="{ over: Math.abs(snap.diff) > DIFF_LIMIT + 1e-9 }">{{ formatDiff(snap.diff) }}</b>
                </span>
                <span>冻结区间：{{ rangeText(snap.startDate, snap.endDate) }}</span>
                <span>原复核人：{{ snap.reviewer }}</span>
                <span>来源调价单：{{ snap.orderId }}</span>
                <span v-if="snap.releasedAt">解除时间：{{ new Date(snap.releasedAt).toLocaleString("zh-CN") }}</span>
                <span v-if="snap.releasedBy">解除人：{{ snap.releasedBy }}</span>
              </div>

              <p v-if="releaseNoteOf(snap)" class="note">
                解除说明（{{ new Date(releaseNoteOf(snap)!.createdAt).toLocaleString("zh-CN") }}）：{{ releaseNoteOf(snap)!.note }}
              </p>

              <div v-if="!snap.released" class="review-box">
                <input
                  v-model="releaseOperators[snap.id]"
                  type="text"
                  :placeholder="snap.reviewer === SYSTEM_REVIEWER ? '解除操作人（免复核单，具名即可）' : `须为原复核人「${snap.reviewer}」本人`"
                />
                <textarea v-model="releaseNotes[snap.id]" placeholder="解除说明（必填，将另存留档）" />
                <div class="actions">
                  <button type="button" @click="release(snap)">解除冻结并另存说明</button>
                </div>
              </div>

              <div v-if="releaseErrors[snap.id]?.length" class="block-list compact">
                <div v-for="(block, index) in releaseErrors[snap.id]" :key="index" class="blockage">
                  <div class="blockage-head">
                    <span class="block-rule">{{ block.rule }}</span>
                    <span class="block-diff">差额 {{ block.diffText }}</span>
                  </div>
                  <div class="blockage-body">
                    <span>站点：{{ block.station }}</span>
                    <span>油品：{{ block.fuel }}</span>
                    <span>冲突区间：{{ block.conflictRange }}</span>
                  </div>
                  <p>{{ block.detail }}</p>
                </div>
              </div>
            </article>
          </div>

          <!-- 解除说明留档 -->
          <h3 class="section-hint">解除说明留档（{{ store.releases.length }}）</h3>
          <div class="record-grid">
            <div v-if="store.releases.length === 0" class="empty">暂无解除说明</div>
            <article v-for="note in store.releases" :key="note.id" class="record release-note-card">
              <div class="record-head">
                <p class="record-title">{{ note.station }} · {{ note.fuel }}</p>
                <span class="status status-done">已另存</span>
              </div>
              <div class="details">
                <span>对应调价单：{{ note.orderId }}</span>
                <span>对应快照：{{ note.snapshotId }}</span>
                <span>解除人（原复核人）：{{ note.reviewer }}</span>
                <span>时间：{{ new Date(note.createdAt).toLocaleString("zh-CN") }}</span>
              </div>
              <p class="note">{{ note.note }}</p>
            </article>
          </div>

          <!-- 站点价格底账 -->
          <h3 class="section-hint">站点油品当前售价（冻结区间内显示冻结价）</h3>
          <div class="price-board">
            <table>
              <thead>
                <tr>
                  <th>站点</th>
                  <th v-for="fuel in FUELS" :key="fuel">{{ fuel }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="station in STATIONS" :key="station">
                  <td class="station-cell">{{ station }}</td>
                  <td v-for="fuel in FUELS" :key="fuel">
                    {{ store.currentPrice(station, fuel)?.toFixed(2) ?? "—" }}
                    <span v-if="frozenToday.has(`${station}|${fuel}`)" class="frozen-flag" title="该站点该油品今日处于联审冻结期">冻</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 状态统计图 -->
          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
