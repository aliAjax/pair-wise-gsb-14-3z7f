<script setup lang="ts">
import { computed, ref } from "vue";
import { usePriceStore } from "../store";
import { type BlockRule, type Fuel } from "../types";
import BlockAlerts from "./BlockAlerts.vue";

const store = usePriceStore();
const station = ref(store.stations[0]);
const fuel = ref<Fuel>("92号汽油");
const price = ref<number | undefined>(undefined);
const blocks = ref<BlockRule[]>([]);
const okMsg = ref("");

const currentPrice = computed(() => store.getBoardPrice(station.value, fuel.value));
const frozen = computed(() => store.isFrozen(station.value, fuel.value));
const reasons = computed(() => store.freezeReason(station.value, fuel.value));

function save() {
  okMsg.value = "";
  const result = store.updateBoardPrice(station.value, fuel.value, price.value ?? 0);
  blocks.value = result.blocks;
  if (result.ok) {
    okMsg.value = `站点【${station.value}】油品【${fuel.value}】牌价已更新为 ${(price.value ?? 0).toFixed(2)} 元/升`;
    price.value = undefined;
  }
}
</script>

<template>
  <section class="panel board-panel">
    <h2>站点当前牌价 / 单独调价</h2>
    <p class="hint">冻结中的站点+油品不能单独调价，须由原复核人先解除联审。</p>

    <div class="board-grid">
      <table>
        <thead>
          <tr>
            <th>站点</th>
            <th v-for="f in store.fuels" :key="f">
              {{ f }}
              <span v-if="store.isFrozen(station, f)" class="mini-lock">🔒</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in store.stations" :key="s">
            <td>{{ s }}</td>
            <td v-for="f in store.fuels" :key="f" :class="{ frozen: store.isFrozen(s, f) }">
              {{ store.getBoardPrice(s, f)?.toFixed(2) ?? "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="quick-form">
      <label>
        站点
        <select v-model="station">
          <option v-for="s in store.stations" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label>
        油品
        <select v-model="fuel">
          <option v-for="f in store.fuels" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
      <label>
        新价格（元/升）
        <input v-model.number="price" type="number" step="0.01" min="0.01" :disabled="frozen" />
      </label>
      <button type="button" :disabled="frozen || price === undefined" @click="save">
        {{ frozen ? "冻结中，禁止单独调价" : "保存牌价" }}
      </button>
    </div>

    <p class="current-price">
      当前牌价：<b>{{ currentPrice?.toFixed(2) ?? "—" }}</b> 元/升
      <span v-if="frozen" class="frozen-tag">🔒 冻结</span>
    </p>

    <div v-if="frozen" class="freeze-detail">
      <p>冻结冲突区间：</p>
      <ul>
        <li v-for="o in reasons" :key="o.id">
          站点【{{ o.station }}】油品【{{ o.fuel }}】单据 <b>{{ o.id.slice(0, 8) }}</b>
          （本{{ o.station === station ? "调价站点" : "参照站" }}），
          冲突区间 <b>{{ o.startDate }} ~ {{ o.endDate }}</b>，
          每升差额 <b>{{ o.diff! > 0 ? "+" : "" }}{{ o.diff?.toFixed(2) }}</b>，
          复核人 <b>{{ o.reviewer }}</b>
        </li>
      </ul>
    </div>

    <BlockAlerts :blocks="blocks" title="单独调价被阻挡" />
    <p v-if="okMsg" class="ok-msg">✓ {{ okMsg }}</p>
  </section>
</template>
