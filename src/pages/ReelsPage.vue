<style scoped>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }

    .vertical-feed {
      height: 100vh;
      overflow-y: scroll;
      scroll-snap-type: y mandatory;
      -webkit-overflow-scrolling: touch;
    }

    .page {
      height: 100vh;
      width: 100%;
      scroll-snap-align: start;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      font-family: sans-serif;
      color: white;
    }

    .p1 { background: #ff4444; }
    .p2 { background: #0099ff; }
    .p3 { background: #22cc66; }
    .p4 { background: #aa33ff; }

</style>

<template>
  <div>
  <div class="vertical-feed">
    <div class="page p1">Page 1</div>
    <div class="page p2">Page 2</div>
    <div class="page p3">Page 3</div>
    <div class="page p4">Page 4</div>
  </div>
  </div>
</template>

<script lang="ts" setup>

import { onMounted, ref, watch } from 'vue';

onMounted(async () => {
});

</script>