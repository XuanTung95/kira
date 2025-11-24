<style scoped>
.main-content {
  width: 100%;
  overflow-y: auto;
}
</style>

<template>
  <div class="main-content">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { useAppPlayerInterface, initWebMessage } from '@/composables/app_player_interface';
import { useYoutubePlayer } from '@/composables/useYoutubePlayer';

onMounted(async () => {
  initWebMessage();
  const {initInterface} = useAppPlayerInterface();
  const {playerComponents, ui, playerState, loadVideo, controlPlayer} = useYoutubePlayer();
  initInterface({
    load: loadVideo,
    playerComponents: playerComponents,
    controlPlayer: controlPlayer,
    initVideoId: '',
  });
});
</script>