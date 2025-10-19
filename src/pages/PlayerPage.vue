<style scoped>
.watch-page {
  width: 100%;
  margin: 0 auto;
  max-width: 98%;
  display: flex;
  gap: 24px;
}

.primary {
  flex: 1;
  min-width: 0;
}

.secondary {
  width: 402px;
  margin-top: 20px; /* Looks a bit weird at 15px for some reason, so we'll use 20px instead... */
}

@media (max-width: 1024px) {
  .watch-page {
    flex-direction: column;
    max-width: 100%;
  }

  .secondary {
    width: 100%;
    margin-top: 0;
  }
}

@media (min-width: 1600px) {
  .watch-page {
    max-width: calc(1200px + 402px + 24px);
  }
}

.video-info {
  margin-top: 10px;
}

.video-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #fff;
  text-align: left;
  overflow-wrap: break-word;
}

.metadata-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0 16px;
  border-bottom: 1px solid #5e5e5e7c;
}

.channel-details {
  display: flex;
  flex-direction: column;
  text-align: left;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.channel-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.channel-name {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
  color: #fff;
}

.subscriber-count {
  color: #aaa;
  font-size: 13px;
}

.video-stats {
  color: #aaa;
  font-size: 14px;
  justify-content: center;
  align-items: center;
  display: flex;
  gap: 12px;
}

.description {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
  position: relative;
  color: #fff;
  text-align: left;
}

@keyframes fade {
  0% {
    opacity: 0;
  }

  100% {
    opacity: 1;
  }
}

:deep(.shaka-video) {
  position: fixed !important;
}

:deep(.shaka-play-button) {
  padding: min(50px, calc(15% / 2));
}

:deep(.shaka-controls-container) {
  position: fixed !important;
  width: 100vw !important;
  height: 100vh !important;
}

:deep(.shaka-overflow-menu button) {
  padding: 2px;
}

:deep(a) {
  color: rgb(62, 166, 255);
  text-decoration: none;
}

:deep(a.yt-ch-link) {
  color: rgb(255, 255, 255);
  background-color: rgba(255, 255, 255, 0.102);
  border-radius: 10px;
  padding-bottom: 2px;
  padding-left: 5px;
  justify-content: center;
}

:deep(.shaka-overflow-menu),
:deep(.shaka-settings-menu) {
  border-radius: 10px;
  -webkit-transition: opacity .3s cubic-bezier(0, 0, .2, 1);
  transition: opacity .3s cubic-bezier(0, 0, .2, 1);
  animation: fade 0.2s;
  scrollbar-width: none
}

.separator {
  width: 1px;
  height: 24px;
  background-color: #5e5e5e7c;
}


.download-btn-container {
  position: relative;
  margin-left: 8px;
}

.download-btn {
  display: flex;
  align-items: center;
  background: #333;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  min-width: 112px;
  height: 30px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
  position: relative;
  justify-content: center;
  opacity: 0.7;
  z-index: 2;
  overflow: hidden;
}

.download-btn:hover {
  background: #393939;
}

.download-btn:disabled {
  cursor: not-allowed;
}

.progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background-color: #4a4a4a;
  border-radius: 6px;
  z-index: -1;
  transition: width 0.1s linear;
}

.button-content {
  display: flex;
  align-items: center;
  justify-content: center;
}

.button-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>

<template>
  <div class="watch-page">
    <div class="primary">
      <VideoPlayer class="ytplayer" :videoId/>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import VideoPlayer from '@/components/VideoPlayer.vue';

import { VideoDetails, VideoItemData } from '@/utils/helpers';

const route = useRoute();

const videoId = ref(route.params.id.toString());
const relatedVideos = ref<VideoItemData[]>([]);
const videoDetails = ref<VideoDetails | undefined>();

watch(() => route.params.id, (newId) => {
  videoId.value = newId.toString();
  relatedVideos.value = [];
  videoDetails.value = undefined;
  document.title = 'Player';
});
</script>