<style scoped>
.video-player-container {
  overflow: hidden;
  position: relative;
  /* aspect-ratio: 16 / 9; */
  width: 100%;
}

.player-host {
  width: 100%;
  height: 100%;
  position: relative;
}

:deep(video) {
  width: 100%;
  height: 100%;
  aspect-ratio: 16 / 9;
  background-color: black;
}

:deep(.loading-overlay) {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

:deep(.spinner) {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Shaka's spinner sucks. We use our own. */
:deep(.shaka-spinner-container) {
  display: none !important;
}
</style>

<template>
  <div class="video-player-container">
    <div ref="playerHostElement" class="player-host"/>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useYoutubePlayer } from '@/composables/useYoutubePlayer';
import { useAppPlayerInterface } from '@/composables/app_player_interface';

const { videoId } = defineProps<{ videoId: string; }>();

const playerHostElement = ref<HTMLElement | null>(null);

const {playerComponents, ui, playerState, loadVideo, controlPlayer} = useYoutubePlayer();

async function load(id: string) {
  if (!playerHostElement.value) return;
  await loadVideo(id, playerHostElement.value);
}

watch(() => videoId, (newId) => load(newId));
onMounted(async () => {
  const {initInterface} = useAppPlayerInterface();
  load(videoId);
  initInterface({
    load: load,
    playerComponents: playerComponents,
    controlPlayer: controlPlayer,
    initVideoId: videoId,
  });
});
</script>