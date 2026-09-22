<script setup lang="ts">
import { computed, ref } from "vue";
import { usePriceStore } from "../store";
import { type BlockRule, type PriceOrder, formatDiff, DIFF_THRESHOLD } from "../types";
import BlockAlerts from "./BlockAlerts.vue";

const props = defineProps<{ order: PriceOrder }>();
const store = usePriceStore();

const reviewer = ref("");
const rejectReason = ref("");
const releaseReviewer = ref("");
const releaseNote = ref("");
const blocks = ref<BlockRule[]>([]);
const showReject = ref(false);
const showRelease = ref(false);

const snapshots = computed(() => store.snapshotsOf(props.order.id));
const release = computed(() => store.releaseOf(props.order.id));

const overThreshold = computed(
  () => props.order.diff !== null && Math.abs(props.order.diff) > DIFF_THRESHOLD
);

// 同站同油品的区间占用（含其他单据），用于展示冲突区间
const intervalConflicts = computed(() =>
  store.orders
    .filter((o) => o.id !== props.order.id && o.status !== "已驳回" && o.status !== "已解除")
    .filter((o) => o.fuel === props.order.fuel)
    .filter(
      (o) =>
        [o.station, o.refStation].some((s) => s === props.order.station || s === props.order.refStation) &&
        !(o.startDate > props.order.endDate || props.order.startDate > o.endDate)
    )
);

const stationFrozen = computed(() => store.isFrozen(props.order.station, props.order.fuel));

function approve() {
  const result = store.approve(props.order.id, { reviewer: reviewer.value });
  blocks.value = result.blocks;
  if (result.ok) {
    reviewer.value = "";
    showReject.value = false;
  }
}

function reject() {
  const result = store.reject(props.order.id, rejectReason.value);
  blocks.value = result.blocks;
  if (result.ok) {
    rejectReason.value = "";
    showReject.value = false;
  }
}

function releaseOrder() {
  const result = store.release(props.order.id, {
    reviewer: releaseReviewer.value,
    note: releaseNote.value
  });
  blocks.value = result.blocks;
  if (result.ok) {
    releaseReviewer.value = "";
    releaseNote.value = "";
    showRelease.value = false;
  }
}
</script>

<template>
  <article class="order-card" :class="`st-${order.status}`">
    <div class="order-head">
      <p class="order-title">
        {{ order.station }} · {{ order.fuel }}
        <span class="price">{{ order.price.toFixed(2) }} 元/升</span>
      </p>
      <span class="status" :class="`st-${order.status}`">{{ order.status }}</span>
    </div>

    <div class="order-grid">
      <span>参照站：<b>{{ order.refStation }}</b></span>
      <span>生效区间：<b>{{ order.startDate }} ~ {{ order.endDate }}</b></span>
      <span>提单人：{{ order.operator }}</span>
      <span>提单时间：{{ new Date(order.createdAt).toLocaleString("zh-CN") }}</span>
      <template v-if="order.status === '已通过' || order.status === '已解除'">
        <span>参照站定格价：<b>{{ order.refPrice?.toFixed(2) }}</b> 元/升</span>
        <span>
          每升差额：
          <b :class="{ over: overThreshold }">{{ formatDiff(order.diff) }} 元/升</b>
          <em v-if="overThreshold" class="threshold">超阈值（{{ DIFF_THRESHOLD.toFixed(2) }}）</em>
        </span>
        <span>复核人：<b>{{ order.reviewer }}</b></span>
        <span>复核时间：{{ order.reviewedAt ? new Date(order.reviewedAt).toLocaleString("zh-CN") : "—" }}</span>
      </template>
    </div>

    <p v-if="order.basis" class="basis">
      <span class="basis-tag">调价依据</span>{{ order.basis }}
    </p>
    <p v-else-if="order.status === '待复核'" class="basis empty">差额未超阈值，无附加依据</p>

    <p v-if="order.status === '已驳回'" class="reject-note">
      驳回原因：{{ order.rejectReason }}
    </p>

    <!-- 冻结快照 -->
    <div v-if="snapshots.length" class="snapshots" :class="{ released: order.status === '已解除' }">
      <p class="snap-title">
        {{ order.status === "已解除" ? "已释放的冻结快照（历史留痕）" : "冻结快照（解除前不得单独调价）" }}
      </p>
      <div v-for="snap in snapshots" :key="snap.id" class="snap">
        <span class="snap-role">{{ snap.role }}</span>
        <b>{{ snap.station }}</b>
        <span>{{ snap.fuel }}</span>
        <span class="snap-price">{{ snap.price.toFixed(2) }} 元/升</span>
        <span class="snap-range">{{ snap.startDate }} ~ {{ snap.endDate }}</span>
        <span v-if="order.status === '已通过'" class="lock">🔒 冻结</span>
      </div>
    </div>

    <!-- 冲突区间展示（信息性，便于核对区间占用） -->
    <div v-if="intervalConflicts.length" class="conflicts">
      <p>区间占用关联：</p>
      <ul>
        <li v-for="c in intervalConflicts" :key="c.id">
          单据 <b>{{ c.id.slice(0, 8) }}</b>：{{ c.station }}（调价站点）/ {{ c.refStation }}（参照站）
          · {{ c.fuel }} · 区间 <b>{{ c.startDate }} ~ {{ c.endDate }}</b> · {{ c.status }}
        </li>
      </ul>
    </div>

    <!-- 解除说明留痕 -->
    <div v-if="release" class="release-note">
      <p>
        <span class="release-tag">解除说明</span>
        由原复核人 <b>{{ release.reviewer }}</b> 于
        {{ new Date(release.releasedAt).toLocaleString("zh-CN") }} 另存
      </p>
      <p class="note-body">{{ release.note }}</p>
    </div>

    <BlockAlerts :blocks="blocks" title="操作被规则阻挡" />

    <!-- 待复核：复核动作 -->
    <div v-if="order.status === '待复核'" class="actions review">
      <input v-model="reviewer" type="text" placeholder="复核人姓名" />
      <button type="button" @click="approve">复核通过并冻结</button>
      <button type="button" class="secondary" @click="showReject = !showReject">驳回</button>
    </div>
    <div v-if="showReject && order.status === '待复核'" class="inline-form">
      <textarea v-model="rejectReason" placeholder="驳回原因（必填）" />
      <button type="button" class="danger" @click="reject">确认驳回</button>
    </div>

    <!-- 已通过：仅原复核人可解除 -->
    <div v-if="order.status === '已通过'" class="actions">
      <span v-if="stationFrozen" class="frozen-hint">🔒 站点【{{ order.station }}】{{ order.fuel }} 冻结中</span>
      <button type="button" class="secondary" @click="showRelease = !showRelease">
        {{ showRelease ? "收起解除" : "解除联审（原复核人）" }}
      </button>
    </div>
    <div v-if="showRelease && order.status === '已通过'" class="inline-form release-form">
      <p class="release-rule">
        规则：仅原复核人【{{ order.reviewer }}】可解除，且必须另存解除说明。
      </p>
      <input v-model="releaseReviewer" type="text" placeholder="操作人（须与原复核人一致）" />
      <textarea v-model="releaseNote" placeholder="解除说明（必填并另存留痕）" />
      <button type="button" class="danger" @click="releaseOrder">确认解除并释放冻结</button>
    </div>
  </article>
</template>
