<script setup lang="ts">
import type { BlockRule } from "../types";

defineProps<{ blocks: BlockRule[]; title?: string }>();
</script>

<template>
  <div v-if="blocks.length" class="blocks" role="alert">
    <p class="blocks-title">⚠ {{ title || `联审规则阻挡（${blocks.length} 项）` }}</p>
    <ul>
      <li v-for="(block, index) in blocks" :key="index">
        <span class="block-rule">{{ block.rule }}</span>
        <span class="block-detail">{{ block.detail }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.blocks {
  border: 1px solid #e3b7a8;
  background: #fdf1ec;
  color: #8a3217;
  border-radius: 8px;
  padding: 10px 12px;
}
.blocks-title {
  margin: 0 0 6px;
  font-weight: 700;
  font-size: 13px;
}
.blocks ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}
.blocks li {
  font-size: 13px;
  line-height: 1.6;
}
.block-rule {
  display: inline-block;
  font-weight: 700;
  margin-right: 6px;
}
.block-detail {
  color: #7a3a22;
}
</style>
