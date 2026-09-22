<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { usePriceStore } from "../store";
import { type BlockRule, type Fuel, DIFF_THRESHOLD, round2 } from "../types";
import BlockAlerts from "./BlockAlerts.vue";

const store = usePriceStore();

const blank = () => ({
  station: "",
  fuel: "92号汽油" as Fuel,
  price: undefined as number | undefined,
  refStation: "",
  startDate: "",
  endDate: "",
  basis: "",
  operator: ""
});

const form = reactive(blank());
const blocks = ref<BlockRule[]>([]);
const submitted = ref(false);

const refPrice = computed(() =>
  form.refStation ? store.getBoardPrice(form.refStation, form.fuel) : undefined
);

const liveDiff = computed(() => {
  if (refPrice.value === undefined || form.price === undefined || !Number.isFinite(form.price)) {
    return null;
  }
  return round2(form.price - refPrice.value);
});

const overThreshold = computed(() => liveDiff.value !== null && Math.abs(liveDiff.value) > DIFF_THRESHOLD);

const occupancy = computed(() => {
  if (!form.station || !form.startDate || !form.endDate || form.startDate > form.endDate) return [];
  return store.rangeOccupancy(form.station, form.fuel, form.startDate, form.endDate);
});

const refOccupancy = computed(() => {
  if (!form.refStation || form.refStation === form.station || !form.startDate || !form.endDate) return [];
  if (form.startDate > form.endDate) return [];
  return store.rangeOccupancy(form.refStation, form.fuel, form.startDate, form.endDate);
});

// 输入变化时即时预演规则，便于在提交前看到区间占用与差额
watch(
  form,
  () => {
    if (!submitted.value) return;
    blocks.value = store.validateDraft({
      station: form.station,
      fuel: form.fuel,
      price: form.price ?? 0,
      refStation: form.refStation,
      startDate: form.startDate,
      endDate: form.endDate,
      basis: form.basis,
      operator: form.operator
    });
  },
  { deep: true }
);

function submit() {
  submitted.value = true;
  const result = store.createOrder({
    station: form.station,
    fuel: form.fuel,
    price: form.price ?? 0,
    refStation: form.refStation,
    startDate: form.startDate,
    endDate: form.endDate,
    basis: form.basis,
    operator: form.operator
  });
  blocks.value = result.blocks;
  if (!result.ok) return;
  Object.assign(form, blank());
  submitted.value = false;
  blocks.value = [];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
</script>

<template>
  <form class="panel order-form" @submit.prevent="submit">
    <h2>新建邻站差价联审调价单</h2>
    <p class="hint">站点、油品、售价、参照站与生效区间为必填；同站同油品区间不得交叠。</p>

    <div class="form-grid">
      <label>
        调价站点
        <select v-model="form.station" required>
          <option value="">请选择站点</option>
          <option v-for="s in store.stations" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <label>
        油品
        <select v-model="form.fuel" required>
          <option v-for="f in store.fuels" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>

      <label>
        售价（元/升）
        <input v-model.number="form.price" type="number" step="0.01" min="0.01" required />
      </label>

      <label>
        参照站
        <select v-model="form.refStation" required>
          <option value="">请选择参照站</option>
          <option v-for="s in store.stations" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <label>
        生效区间起（含）
        <input v-model="form.startDate" type="date" :max="form.endDate || undefined" required />
      </label>
      <label>
        生效区间止（含）
        <input v-model="form.endDate" type="date" :min="form.startDate || undefined" required />
      </label>

      <label>
        提单人
        <input v-model="form.operator" type="text" placeholder="填写提单人" />
      </label>
      <label class="basis">
        调价依据
        <span v-if="overThreshold" class="basis-required">差额超过三角五分，必须填写依据</span>
        <textarea
          v-model="form.basis"
          :placeholder="overThreshold
            ? '差额超过 0.35 元/升，须写明调价依据供复核'
            : '差额未超阈值时可留空；超阈值必填'"
        />
      </label>
    </div>

    <div v-if="form.station && form.refStation && form.price" class="diff-preview" :class="{ alert: overThreshold }">
      <span>站点【{{ form.station }}】{{ form.fuel }}：{{ Number(form.price).toFixed(2) }}</span>
      <span>参照站【{{ form.refStation }}】：{{ refPrice === undefined ? "无牌价" : refPrice.toFixed(2) }}</span>
      <span>
        差额：
        <strong v-if="liveDiff !== null" :class="{ over: overThreshold }">
          {{ liveDiff > 0 ? "+" : "" }}{{ liveDiff.toFixed(2) }} 元/升
        </strong>
        <em v-else>—</em>
        （阈值 {{ DIFF_THRESHOLD.toFixed(2) }}）
      </span>
    </div>

    <div v-if="occupancy.length || refOccupancy.length" class="occupancy">
      <p>区间占用预览：</p>
      <ul>
        <li v-for="o in occupancy" :key="o.id">
          站点【{{ form.station }}】油品【{{ form.fuel }}】已被单据
          <b>{{ o.id.slice(0, 8) }}</b>（{{ o.station === form.station ? "调价站点" : "参照站" }}）
          占用区间 <b>{{ o.startDate }} ~ {{ o.endDate }}</b>（{{ o.status }}）
        </li>
        <li v-for="o in refOccupancy" :key="'r-' + o.id">
          参照站【{{ form.refStation }}】油品【{{ form.fuel }}】已被单据
          <b>{{ o.id.slice(0, 8) }}</b> 占用区间
          <b>{{ o.startDate }} ~ {{ o.endDate }}</b>（{{ o.status }}）
        </li>
      </ul>
    </div>

    <BlockAlerts :blocks="blocks" title="调价单被联审规则阻挡" />

    <button type="submit" class="submit-btn">提交复核</button>
    <p class="tip">今天：{{ today() }}；区间按闭区间（含首尾日期）判交叠。</p>
  </form>
</template>
