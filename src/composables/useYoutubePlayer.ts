import type { WatchHandle } from 'vue';
import { onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';

import shaka from 'shaka-player/dist/shaka-player.ui';
import { type ApiResponse, Constants, Utils, YT } from 'youtubei.js/web';

import { SabrStreamingAdapter } from 'googlevideo/sabr-streaming-adapter';
import type { ReloadPlaybackContext } from 'googlevideo/protos';
import { buildSabrFormat } from 'googlevideo/utils';

import { botguardService } from '@/services/botguard';
import { makePlayerRequest } from '@/services/onesie';
import { ShakaPlayerAdapter } from '@/streaming/ShakaPlayerAdapter';

import { useInnertube } from './useInnertube';
import { useOnesieConfig } from './useOnesieConfig';
import { useToastStore } from '@/stores/toastStore';
import { useProxySettings } from '@/composables/useProxySettings';
import { checkExtension } from '@/utils/helpers';
import {preloadVideo, getPreloadVideo} from '@/composables/app_preload_video';

const VOLUME_KEY = 'youtube_player_volume';
const PLAYBACK_POSITION_KEY = 'youtube_playback_positions';
const SAVE_POSITION_INTERVAL_MS = 5000;
const WIDEVINE_DRM_SYSTEM = 'com.widevine.alpha';
const INNERTUBE_DRM_LICENSE_URL = 'https://www.youtube.com/youtubei/v1/player/get_drm_license?prettyPrint=false&alt=json';
const ENABLE_PLAYBACK_TRACKING = true;

const DEFAULT_ABR_CONFIG = {
  enabled: true,
  // NOTE: This is reset when playback starts (limiting the resolution initially improves load times).
  restrictions: { maxHeight: 480 },
  switchInterval: 4, // Switch as soon as the above is reset.
  useNetworkInformation: false // Still unreliable.
};

type PlayerState = 'loading' | 'ready' | 'error' | 'buffering';

interface PlayerComponents {
  player: shaka.Player | null;
  ui: shaka.ui.Overlay | null;
  sabrAdapter: SabrStreamingAdapter | null;
  videoElement: HTMLVideoElement | null;
  shakaContainer: HTMLElement | null;
  customSpinner: HTMLElement | null;
  audio: HTMLElement | null;
}

const playerComponents = shallowRef<PlayerComponents>({
  player: null,
  ui: null,
  sabrAdapter: null,
  videoElement: null,
  shakaContainer: null,
  audio: null,
  customSpinner: null
});

const playerState = ref<PlayerState>('loading');

let playbackWebPoToken: string | undefined;
let coldStartToken: string | undefined;

let startSilencePlayerInternal: () => Promise<void> | null;
let stopSilencePlayerInternal: () => void | null;
let isShowingAds = false;
let textTrackVisibility = false;
let pipBusy = false;

async function initSilencePlayer() {
  if (startSilencePlayerInternal == null) {
    let response = await fetch("/assets/5_seconds_of_silence.mp3");
    let arrayBuffer = await response.arrayBuffer();
    let audioCtx = new AudioContext();
    let buffer = await audioCtx.decodeAudioData(arrayBuffer);
    let source: AudioBufferSourceNode | null = null;
    startSilencePlayerInternal = async function () {
      if (source == null) {
        source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.start();
        source.connect(audioCtx.destination);
      }
      if (audioCtx.state != "running") {
        await audioCtx.resume();
      }
    }
    stopSilencePlayerInternal = function () {
      if (source != null) {
        source.stop();
        source.disconnect();
        source = null;
      }
      if (audioCtx.state != "suspended") {
        audioCtx.suspend()
      }
    }
  }
}

export function useYoutubePlayer() {
  const route = useRoute();
  const getInnertube = useInnertube();
  const getClientConfig = useOnesieConfig();
  const { addToast } = useToastStore();
  const { settings } = useProxySettings();

  let drmParams: string | undefined;
  let playbackWebPoTokenContentBinding: string | undefined;
  let playbackWebPoTokenCreationLock = false;
  let savePositionInterval: number | null = null;
  let playbackTrackerInterval: number | null = null;
  let playerStartTimeWatcher: WatchHandle | null = null;
  let currentVideoId = '';
  let isLive = false;

  const startTime = Math.floor(Date.now() / 1000);
  const clientPlaybackNonce = Utils.generateRandomString(12);
  const sessionId = Array.from(Array(16), () => Math.floor(Math.random() * 36).toString(36)).join('');

  initSilencePlayer();

  function onPlayerStateChanged(state: any) {
    if (window && (window as any).onPlayerStateChanged != null) {
      if (state != null && state.videoId == null) {
        state.videoId = currentVideoId;
      }
      (window as any).onPlayerStateChanged(state);
    }
  }

  function updateMediaSessionPosition() {
    if (navigator && 'mediaSession' in navigator) {
      let { videoElement, player } = playerComponents.value;
      if (player != null && videoElement != null) {
        let currentTime = videoElement.currentTime;
        let duration = videoElement.duration;
        if (!duration || duration === Infinity) {
          let range = player.seekRange();
          if (range.end != null && range.end != Infinity || range.end === 0) {
              duration = range.end;
              if (currentTime != null && duration < currentTime) {
                currentTime = duration;
              }
          }
        }
        let rate = videoElement.playbackRate;
        if (currentTime != null && currentTime != Infinity && duration != null && duration != Infinity) {
          let state = {
            duration: duration,
            playbackRate: rate,
            position: currentTime
          };
          console.log('update session pos ', JSON.stringify(state))
          navigator.mediaSession.setPositionState(state);
          navigator.mediaSession.playbackState = videoElement.paused ? "paused" : "playing";
        }
      }
    }
  }

  function enableAutoArbIfNeeded() {
    let player = playerComponents.value.player;
    if (player != null) {
      let stats = player.getStats();
      let est = stats.estimatedBandwidth;
      let stream = stats.streamBandwidth;
      if (est != null && stream != null && stream != 0
        && est != 0 && est != Infinity && stream != Infinity) {
          let ratio = est / stream;
          if (ratio != Infinity && ratio <= 0.7) {
            player.configure({ abr: { enabled: true } });
            onPlayerStateChanged({
              status: 'debug',
              msg: `abr: enabled: true est ${est} / str ${stream} = ${ratio}`,
            });
          }
      }
    }
  }

  async function startSilencePlayer() {
    if (isShowingAds == true) {
      return;
    }
    var audio: any = playerComponents.value.audio;
    if (audio == null) {
      audio = document.getElementById("audioPlayer");
      playerComponents.value.audio = audio;
    }
    if (audio != null) {
      if (audio.muted == true) {
        audio.muted = false;
      }
      if (audio.paused != false) {
        console.log('startSilencePlayer');
        audio.play();
      }
    }
    await new Promise(r => setTimeout(r, 200));
    if (audio.paused == false && audio.muted == false) {
      startSilencePlayerInternal?.();
      audio.pause();
    }
  }

  function stopSilentcePlayer() {
    var audio : any = playerComponents.value.audio;
    if (audio == null) {
      audio = document.getElementById("audioPlayer");
      playerComponents.value.audio = audio;
    }
    if (audio != null) {
      if (audio.muted != true) {
        console.log('stopSilentcePlayer()');
        audio.muted = true;
      }
      let video = playerComponents.value.videoElement;
      if (video != null && video.paused == true) {
        audio.pause()
      }
    }
    stopSilencePlayerInternal?.();
  }

  //#region --- Playback Position and Volume Management ---
  function getPlaybackPositions(): Record<string, number> {
    try {
      const positions = localStorage.getItem(PLAYBACK_POSITION_KEY);
      return positions ? JSON.parse(positions) : {};
    } catch (error) {
      console.error('[Player]', 'Error reading playback positions:', error);
      return {};
    }
  }

  function savePlaybackPosition(videoId: string, time: number) {
    if (!videoId || time < 1) return;
    try {
      const positions = getPlaybackPositions();
      positions[videoId] = time;
      localStorage.setItem(PLAYBACK_POSITION_KEY, JSON.stringify(positions));
    } catch (error) {
      console.error('[Player]', 'Error saving playback position:', error);
    }
  }

  function getPlaybackPosition(videoId: string): number {
    const positions = getPlaybackPositions();
    return positions[videoId] || 0;
  }

  function startSavingPosition() {
    if (savePositionInterval) {
      clearInterval(savePositionInterval);
    }

    savePositionInterval = window.setInterval(() => {
      const { videoElement } = playerComponents.value;
      if (videoElement && currentVideoId && !videoElement.paused) {
        savePlaybackPosition(currentVideoId, videoElement.currentTime);
      }
    }, SAVE_POSITION_INTERVAL_MS);
  }

  function getSavedVolume(): number {
    try {
      const volume = localStorage.getItem(VOLUME_KEY);
      return volume ? parseFloat(volume) : 1;
    } catch (error) {
      console.error('[Player]', 'Error reading saved volume:', error);
      return 1;
    }
  }

  function saveVolume(volume: number) {
    try {
      localStorage.setItem(VOLUME_KEY, volume.toString());
    } catch (error) {
      console.error('[Player]', 'Error saving volume:', error);
    }
  }
  //#endregion

  //#region --- WebPO Minter ---
  async function mintContentWebPO() {
    if (!playbackWebPoTokenContentBinding || playbackWebPoTokenCreationLock) return;

    playbackWebPoTokenCreationLock = true;
    try {
      coldStartToken = botguardService.mintColdStartToken(playbackWebPoTokenContentBinding);
      console.info('[Player]', `Cold start token created (Content binding: ${decodeURIComponent(playbackWebPoTokenContentBinding)})`);

      if (!botguardService.isInitialized()) await botguardService.reinit();

      if (botguardService.integrityTokenBasedMinter) {
        playbackWebPoToken = await botguardService.integrityTokenBasedMinter.mintAsWebsafeString(decodeURIComponent(playbackWebPoTokenContentBinding));
        console.info('[Player]', `WebPO token created (Content binding: ${decodeURIComponent(playbackWebPoTokenContentBinding)})`);
      }
    } catch (err) {
      console.error('[Player]', 'Error minting WebPO token', err);
    } finally {
      playbackWebPoTokenCreationLock = false;
    }
  }
  //#endregion

  //#region --- Player Setup ---
  async function cleanupPreviousVideo() {
    const { player, sabrAdapter } = playerComponents.value;

    if (player) {
      await player.unload();
      const networkingEngine = player.getNetworkingEngine();
      if (networkingEngine) {
        networkingEngine.clearAllRequestFilters();
        networkingEngine.clearAllResponseFilters();
      }
    }

    if (sabrAdapter) {
      sabrAdapter.dispose();
      playerComponents.value.sabrAdapter = null;
    }

    if (playerStartTimeWatcher) {
      playerStartTimeWatcher.stop();
      playerStartTimeWatcher = null;
    }

    if (playbackTrackerInterval) {
      clearInterval(playbackTrackerInterval);
      playbackTrackerInterval = null;
    }

    if (savePositionInterval) {
      clearInterval(savePositionInterval);
      savePositionInterval = null;
    }

    drmParams = undefined;
  }

  function initMediaSession(videoInfo: ApiResponse) {
    if (navigator && 'mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          isShowingAds = false;
          if ((window as any)?.sendMessageToApp) {
            (window as any).sendMessageToApp({
                cmd: 'nexttrack'
            })
          }
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            isShowingAds = false;
            if ((window as any)?.sendMessageToApp) {
            (window as any).sendMessageToApp({
                cmd: 'previoustrack'
            })
          }
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime) {
              controlPlayer('seekTo', details.seekTime)
            }
          }
        );
        navigator.mediaSession.setActionHandler('play', () => {
            isShowingAds = false;
            controlPlayer('playOrPause', null)
          }
        );
        navigator.mediaSession.setActionHandler('pause', () => {
            controlPlayer('playOrPause', null)
          }
        );
        let videoDetails = videoInfo?.data?.videoDetails;
        let thumbnails = videoDetails?.thumbnail?.thumbnails;
        if (thumbnails instanceof Array) {
          const target = 138;
          const smallest = thumbnails.reduce((prev, curr) => 
            Math.abs(curr.height - target) < Math.abs(prev.height - target) ? curr : prev
          );
          if (smallest?.height != null) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: videoDetails?.title,
              artist: videoDetails?.author,
              // album: 'Album Name',
              artwork: [
                { src: smallest.url, sizes: `${smallest?.width}x${smallest?.height}`, type: 'image/jpeg' }
              ]
            });
          }
        }
        
    }
  }

  async function initializeShakaPlayer() {
    const shakaContainer = document.createElement('div');
    shakaContainer.className = 'yt-player';

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    // videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    // videoEl.setAttribute('onended', 'window.onKiraPlayerEnded(event)');

    // Let's make sure this thing scales to the host container.
    videoEl.style.width = '100vw';
    videoEl.style.height = '100vh';
    shakaContainer.appendChild(videoEl);

    /*
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';

    const spinner = document.createElement('div');
    spinner.className = 'spinner';

    loadingOverlay.appendChild(spinner);
    shakaContainer.appendChild(loadingOverlay);
    */

    const player = new shaka.Player();

    const allEvents = [
      'error',
      'onstatechange',
      // 'timelineregionadded',
      'mediaqualitychanged',
      'buffering',
      'loading',
      'loaded',
      'unloading',
      'trackschanged',
      'variantchanged',
      'manifestparsed',
      'metadataadded',
      'streaming',
      'abrstatuschanged',
      // 'segmentappended',
      // 'manifestupdated',
      // 'canupdatestarttime',
      // 'stalldetected',
      'keystatuschanged',
      'statechanged',
      'started',
      'complete',
    ];
    allEvents.forEach((eventName) => {
      player.addEventListener(eventName, (_event: any) => {
        console.log('shaka event ' + eventName, JSON.stringify(_event));
        if (eventName == 'statechanged') {
          let newstate = _event.newstate;
          if (newstate == 'playing') {
            stopSilentcePlayer();
            updateMediaSessionPosition();
          } else if (newstate == 'ended' || newstate == 'paused'
             || newstate == 'buffering' || newstate == 'unload') {
            startSilencePlayer();
          }
          if (newstate == "buffering") {
             enableAutoArbIfNeeded();
          }
          onPlayerStateChanged({status: newstate});
        } else if (eventName == 'trackschanged') {
          if (textTrackVisibility != player.isTextTrackVisible()) {
             player.setTextTrackVisibility(textTrackVisibility);
          }
          onPlayerStateChanged({status: eventName});
        } else {
          onPlayerStateChanged({
            status: eventName,
            msg: `${_event}`,
          });
        }
      });
    });

    player.configure({
      // preferredAudioLanguage: 'en-US',
      // Ưu tiên codec ở cấp cấu hình chung
      preferredVideoCodecs: ['avc1'], // H.264 family
      preferredAudioCodecs: ['mp4a'], // AAC family
      abr: DEFAULT_ABR_CONFIG,
      streaming: {
        failureCallback: (error: shaka.util.Error) => {
          // Always retry after retries are exhausted (the default behaviour was to give up).
          console.error('Streaming failure:', error);
          playerState.value = 'error';
          addToast(`Streaming error`);
          player.retryStreaming(5);
          onPlayerStateChanged({
            status: 'error',
            msg: `Streaming error ${error}`
          });
        },
        bufferingGoal: 120,
        rebufferingGoal: 0.01,
        bufferBehind: 300,
        retryParameters: {
          maxAttempts: 8,
          fuzzFactor: 0.5,
          timeout: 30 * 1000
        }
      },
      // textDisplayFactory: () => new shaka.text.UITextDisplayer(videoEl, shakaContainer),
    });

    videoEl.addEventListener('timeupdate', () => {
      const currentTime = videoEl.currentTime;
      const duration = videoEl.duration;
      onPlayerStateChanged({
        status: 'progress',
        currentTime,
        duration,
        player,
      });
      stopSilentcePlayer();
    });

    videoEl.addEventListener('enterpictureinpicture', (_e) => {
      onPlayerStateChanged({
        status: 'enterPIP',
      });
    });

    videoEl.addEventListener('leavepictureinpicture', (_e) => {
      onPlayerStateChanged({
        status: 'exitPIP',
      });
    });

    // videoEl.volume = getSavedVolume();
    /*
    videoEl.addEventListener('volumechange', () => saveVolume(videoEl.volume));
    videoEl.addEventListener('playing', () => player.configure('abr.restrictions.maxHeight', Infinity));
    videoEl.addEventListener('pause', () => {
      if (currentVideoId) {
        savePlaybackPosition(currentVideoId, videoEl.currentTime);
      }
    });

    player.addEventListener('buffering', (event: Event) => {
      playerState.value = (player.isBuffering() || (event as any).buffering) ? 'buffering' : 'ready';
    });

    videoEl.addEventListener('ended', () => {
      onPlayerStateChanged({
        status: 'ended',
      });
    });

    videoEl.addEventListener('pause', () => {
      onPlayerStateChanged({
        status: 'pause',
      });
    });

    videoEl.addEventListener('playing', () => {
      onPlayerStateChanged({
        status: 'playing',
      });
    });

    videoEl.addEventListener('play', () => {
      onPlayerStateChanged({
        status: 'play',
      });
    });
    */

    await player.attach(videoEl);
    /*
    const ui = new shaka.ui.Overlay(player, shakaContainer, videoEl);

    ui.configure({
      addBigPlayButton: true,
      // doubleClickForFullscreen: false,
      // enableFullscreenOnRotation: false,
      // forceLandscapeOnFullscreen: false,
      // preferVideoFullScreenInVisionOS: false,
      // closeMenusDelay: 3000,
      // displayInVrMode: false,
      // setupMediaSession: true,
      // clearBufferOnQualityChange: true,
      // fullScreenElement: null,
      overflowMenuButtons: [
        'captions',
        'quality',
        'language',
        'picture_in_picture',
        'loop',

        // 'chapter',
        // 'playback_rate',
        // 'recenter_vr',
        // 'toggle_stereoscopic',
        // 'save_video_frame'
      ],
      customContextMenu: true
    });

    const volumeContainer = shakaContainer.getElementsByClassName('shaka-volume-bar-container');
    if (volumeContainer && volumeContainer.length > 0) {
      volumeContainer[0].addEventListener('mousewheel', (event) => {
        event.preventDefault();
        const delta = Math.sign((event as any).deltaY);
        const newVolume = Math.max(0, Math.min(1, videoEl.volume - delta * 0.05));
        videoEl.volume = newVolume;
        saveVolume(newVolume);
      });
    }
    */

    playerComponents.value.player = player;
    // playerComponents.value.ui = ui;
    playerComponents.value.videoElement = videoEl;
    playerComponents.value.shakaContainer = shakaContainer;
    // playerComponents.value.customSpinner = loadingOverlay;
    /*
    watch(playerState, (newState) => {
      if (loadingOverlay) {
        const isVisible = [ 'loading', 'buffering' ].includes(newState);
        loadingOverlay.style.display = isVisible ? 'flex' : 'none';
      }
    });
    */
  }

  async function initializeSabrAdapter() {
    const innertube = await getInnertube();
    const { player } = playerComponents.value;
    if (!player || !innertube) return;

    const sabrAdapter = new SabrStreamingAdapter({
      playerAdapter: new ShakaPlayerAdapter(),
      clientInfo: {
        osName: innertube.session.context.client.osName,
        osVersion: innertube.session.context.client.osVersion,
        clientName: parseInt(Constants.CLIENT_NAME_IDS[innertube.session.context.client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),
        clientVersion: innertube.session.context.client.clientVersion
      }
    });

    sabrAdapter.onMintPoToken(async () => {
      if (!playbackWebPoToken) {
        // For live streams, we must block and wait for the PO token as it's sometimes required for playback to start.
        // For VODs, we can mint the token in the background to avoid delaying playback, as it's not immediately required.
        // While BotGuard is pretty darn fast, it still makes a difference in user experience (from my own testing).
        if (isLive) {
          await mintContentWebPO();
        } else {
          mintContentWebPO().then();
        }
      }

      return playbackWebPoToken || coldStartToken || '';
    });

    sabrAdapter.onReloadPlayerResponse(async (reloadPlaybackContext) => {
      const apiResponse = await fetchVideoInfo(currentVideoId, reloadPlaybackContext);

      if (!apiResponse) {
        console.error('[Player]', 'Failed to reload player response');
        return;
      }

      const videoInfo = new YT.VideoInfo([ apiResponse ], innertube.actions, clientPlaybackNonce);
      sabrAdapter.setStreamingURL(await innertube.session.player!.decipher(videoInfo.streaming_data?.server_abr_streaming_url));
      sabrAdapter.setUstreamerConfig(videoInfo.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
    });

    sabrAdapter.attach(player);
    playerComponents.value.sabrAdapter = sabrAdapter;
  }

  async function setupRequestFilters() {
    const { player } = playerComponents.value;
    const networkingEngine = player?.getNetworkingEngine();
    if (!networkingEngine) return;

    networkingEngine.registerRequestFilter(async (type, request) => {
      let url = new URL(request.uris[0]);

      if ((url.host.endsWith('.googlevideo.com') || url.href.includes('drm')) && !checkExtension()) {
        const newUrl = new URL(url.toString());
        newUrl.searchParams.set('__host', url.host);
        newUrl.host = settings.host;
        newUrl.port = settings.port;
        newUrl.protocol = settings.protocol;
        url = newUrl;
      }

      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const innertube = await getInnertube();

        const wrapped = {
          context: innertube.session.context,
          cpn: clientPlaybackNonce,
          drmParams: decodeURIComponent(drmParams || ''),
          drmSystem: 'DRM_SYSTEM_WIDEVINE',
          drmVideoFeature: 'DRM_VIDEO_FEATURE_SDR',
          licenseRequest: shaka.util.Uint8ArrayUtils.toBase64(request.body as ArrayBuffer | ArrayBufferView),
          sessionId: sessionId,
          videoId: currentVideoId
        };

        request.body = shaka.util.StringUtils.toUTF8(JSON.stringify(wrapped));
      } else if (request.contentType === 'text' && url.href.includes('timedtext')) {
        const innertube = await getInnertube();
        const params = new URLSearchParams(url.search);
        params.set('c', innertube.session.context.client.clientName);
        params.set('cver', innertube.session.context.client.clientVersion);
        params.set('potc', '1');
        params.set('pot', await botguardService.integrityTokenBasedMinter?.mintAsWebsafeString(currentVideoId) || '');
        url.search = params.toString();
      }

      request.uris[0] = url.toString();
    });

    networkingEngine.registerResponseFilter(async (type, response) => {
      if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
        const wrapped = JSON.parse(shaka.util.StringUtils.fromUTF8(response.data));
        response.data = shaka.util.Uint8ArrayUtils.fromBase64(wrapped.license);
      }
    });
  }

  async function fetchVideoInfo(videoId: string, reloadPlaybackContext?: ReloadPlaybackContext): Promise<ApiResponse> {
    const innertube = await getInnertube();
    const clientConfig = await getClientConfig();

    const requestParams: Record<string, any> = {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: {
        adPlaybackContext: {
          pyv: true
        },
        contentPlaybackContext: {
          signatureTimestamp: innertube.session.player?.signature_timestamp
        }
      }
    };

    // const savedPosition = getPlaybackPosition(currentVideoId);
    // if (savedPosition > 0) {
    //   requestParams.startTimeSecs = Math.floor(savedPosition);
    // }

    if (reloadPlaybackContext) {
      requestParams.playbackContext.reloadPlaybackContext = reloadPlaybackContext;
    }
    return await innertube.actions.execute('/player', { ...requestParams, parse: false });
    
    try {
      return await makePlayerRequest({
        clientConfig,
        innertubeRequest: { context: innertube.session.context, ...requestParams }
      });
    } catch (error) {
      console.error('[Player]', 'Onesie request failed, falling back to Innertube:', error);
      return await innertube.actions.execute('/player', { ...requestParams, parse: false });
    }
  }

  async function reportWatchTimeStats(watchtimeUrl: string) {
    try {
      const innertube = await getInnertube();

      if (!playerComponents.value.videoElement) return;

      const relativeTime = Math.floor(Date.now() / 1000) - startTime;
      const currentTime = playerComponents.value.videoElement.currentTime;

      const params: Record<string, any> = {
        cpn: clientPlaybackNonce,
        rt: relativeTime,
        rti: relativeTime,
        cmt: currentTime,
        cbr: 'Chrome',
        cbrver: '115.0.0.0',
        cplayer: 'UNIPLAYER',
        cos: 'Windows',
        cosver: '11',
        cplatform: 'DESKTOP',
        hl: 'en_US',
        cr: 'US',
        et: currentTime,
        st: startTime,
        state: playerComponents.value.videoElement.paused ? 'paused' : 'playing',
        volume: playerComponents.value.videoElement.volume,
        ver: 2,
        muted: playerComponents.value.videoElement.muted ? 1 : 0,
        fmt: 0
      };

      if (playerComponents.value.videoElement.paused) {
        params.rtn = relativeTime + 20;
      } else {
        params.final = 1;
      }

      const clientInfo = {
        client_name: innertube.session.context.client.clientName,
        client_version: innertube.session.context.client.clientVersion
      };

      return innertube.actions.stats(watchtimeUrl, clientInfo, params);
    } catch (err) {
      console.error('[Player]', 'Failed to report stats', err);
    }
  }

  async function reportPlaybackStats(videostatsPlaybackUrl: string) {
    try {
      const innertube = await getInnertube();

      if (!playerComponents.value.videoElement) return;

      const relativeTime = Math.floor(Date.now() / 1000) - startTime;

      const params = {
        cpn: clientPlaybackNonce,
        rt: relativeTime,
        rtn: relativeTime,
        volume: playerComponents.value.videoElement.volume,
        muted: playerComponents.value.videoElement.muted ? 1 : 0,
        fmt: 0
      };

      const clientInfo = {
        client_name: innertube.session.context.client.clientName,
        client_version: innertube.session.context.client.clientVersion
      };

      return innertube.actions.stats(videostatsPlaybackUrl, clientInfo, params);
    } catch (err) {
      console.error('[Player]', 'Failed to report stats', err);
    }
  }

  async function loadManifest(apiResponse: ApiResponse) {
    const { player, sabrAdapter, videoElement } = playerComponents.value;
    const innertube = await getInnertube();
    if (!player || !sabrAdapter || !videoElement || !innertube) return;

    const videoInfo = new YT.VideoInfo([ apiResponse ], innertube.actions, clientPlaybackNonce);
    const isPostLiveDVR = !!videoInfo.basic_info.is_post_live_dvr || (videoInfo.basic_info.is_live_content && !!(videoInfo.streaming_data?.dash_manifest_url || videoInfo.streaming_data?.hls_manifest_url));
    const playbackTracking = videoInfo.page[0].playback_tracking;
    const playbackStartConfig = (apiResponse.data?.playerConfig as any)?.playbackStartConfig as {
      startSeconds?: number
    } | undefined;

    isLive = !!videoInfo.basic_info.is_live;
    drmParams = (apiResponse.data.streamingData as any)?.drmParams;

    if (drmParams) {
      player.configure({ drm: { servers: { [WIDEVINE_DRM_SYSTEM]: INNERTUBE_DRM_LICENSE_URL } } });
    }

    if (videoInfo.streaming_data && !isPostLiveDVR && !isLive) {
      sabrAdapter.setStreamingURL(await innertube.session.player!.decipher(videoInfo.streaming_data?.server_abr_streaming_url));
      sabrAdapter.setServerAbrFormats(videoInfo.streaming_data.adaptive_formats.map(buildSabrFormat));
      sabrAdapter.setUstreamerConfig(videoInfo.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
    }

    let manifestUri: string | undefined;
    if (videoInfo.streaming_data) {
      if (isLive) {
        manifestUri = videoInfo.streaming_data.dash_manifest_url ? `${videoInfo.streaming_data.dash_manifest_url}/mpd_version/7` : videoInfo.streaming_data.hls_manifest_url;
      } else if (isPostLiveDVR) {
        manifestUri = videoInfo.streaming_data.hls_manifest_url || `${videoInfo.streaming_data.dash_manifest_url}/mpd_version/7`;
      } else {
        manifestUri = `data:application/dash+xml;base64,${btoa(await videoInfo.toDash({
          manifest_options: {
            is_sabr: true,
            captions_format: 'vtt',
            include_thumbnails: false
          }
        }))}`;
      }
    }

    if (!manifestUri)
      throw new Error('Could not find a valid manifest URI.');

    playerStartTimeWatcher = watch(() => route.query?.st, (newStartTime) => {
      const startTime = parseFloat((<string | undefined>newStartTime) || '0');
      if (!isNaN(startTime)) {
        videoElement.currentTime = startTime;
        console.info('[Player]', `Setting start time to ${startTime} seconds`);
      }
    }, { immediate: false });

    const startTime = route.query?.st !== undefined
      ? parseFloat(route.query.st as string) || 0
      : playbackStartConfig?.startSeconds;

    try {
      // Allows YouTube to show/improve recommendations, etc.
      if (playbackTracking && ENABLE_PLAYBACK_TRACKING) {
        reportPlaybackStats(playbackTracking.videostats_playback_url).then(() => {
          reportWatchTimeStats(playbackTracking!.videostats_watchtime_url);
          playbackTrackerInterval = setInterval(() => reportWatchTimeStats(playbackTracking!.videostats_watchtime_url), 30000) as unknown as number;
        });
      }
    } catch (err) {
      console.error('[Player]', 'Error reporting playback stats', err);
    }

    await player.load(manifestUri, isLive ? undefined : startTime);

    videoElement.play().catch((err) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        console.warn('[Player]', 'Autoplay was prevented by the browser.', err);
        addToast('Autoplay was prevented by the browser.', 'info');
      }
    });
  }
  //#endregion

  async function loadVideo(videoId: string, targetContainer: HTMLElement) {
    isShowingAds = false;
    if (!videoId) return;

    currentVideoId = videoId;
    playerState.value = 'loading';
    playbackWebPoToken = undefined;
    textTrackVisibility = false;

    try {
      startSilencePlayer();
      if (!playerComponents.value.player) {
        await initializeShakaPlayer();
      } else {
        // Reset Shaka player configuration to default ABR behavior.
        // This is necessary because the player instance is 
        // reused across videos for better performance.
        playerComponents.value.player.configure('abr', DEFAULT_ABR_CONFIG);
      }

      const { shakaContainer, videoElement } = playerComponents.value;
      if (shakaContainer && shakaContainer.parentElement !== targetContainer) {
        targetContainer.appendChild(shakaContainer);
      }

      if (videoElement != null) {
        if (videoElement.loop == true) {
          videoElement.loop = false;
        }
      }

      const innertube = await getInnertube();
      if (!innertube) return;

      playbackWebPoTokenContentBinding = videoId;

      await cleanupPreviousVideo();
      await initializeSabrAdapter();
      await setupRequestFilters();

      let videoInfo = getPreloadVideo(videoId);
      if (videoInfo?.data?.streamingData?.serverAbrStreamingUrl != null) {
        console.log('Use stream from preload');
      } else {
        videoInfo = await fetchVideoInfo(videoId);
      }
      onPlayerStateChanged({
        status: 'updateVideoInfo',
        data: videoInfo?.data,
      });
      document.title = videoInfo?.data?.videoDetails?.title ?? 'Player';
      if (videoInfo.data.playabilityStatus?.status !== 'OK') {
        console.error('[Player]', 'Unplayable:', videoInfo.data.playabilityStatus?.reason || 'Unknown reason');
        addToast('Unplayable video.', 'error');
        playerState.value = 'error';
        onPlayerStateChanged({
          status: 'videoNotAvailable',
          msg: 'Unplayable video.',
          errorDescription: 'Unplayable video.',
        });
        setTimeout(() => {
          onPlayerStateChanged({
            cmd: 'playNextCountdown',
          });
        }, 1500);
        return;
      }

      /*
      if (window != null) {
        let lang = (window as any)?.playerSetting?.language;
        if (lang != null) {
          playerComponents.value.player?.configure('preferredAudioLanguage', lang);
        }
      }
      */

      await loadManifest(videoInfo);

      startSavingPosition();
      playerState.value = 'ready';
      // auto play
      controlPlayer('play', null);
      initMediaSession(videoInfo);
    } catch (error) {
      console.error(error);
      playerState.value = 'error';
      addToast(`Error loading video: ${(error as any).message}`, 'error');
    }
  }

  onUnmounted(async () => {
    const { videoElement, shakaContainer } = playerComponents.value;

    if (videoElement && currentVideoId) {
      savePlaybackPosition(currentVideoId, videoElement.currentTime);
    }

    if (shakaContainer)
      shakaContainer.remove();

    await cleanupPreviousVideo();
  });

  function controlPlayer(cmd: string, data: any) {
    if (cmd == 'pause') {
      playerComponents.value.videoElement?.pause();
    } else if (cmd == 'play') {
      if (isShowingAds) {
        return;
      }
      playerComponents.value.videoElement?.play();
    } else if (cmd == 'playOrPause') {
      let video = playerComponents.value.videoElement;
      if (video != null) {
        if (video.paused) {
          if (isShowingAds) {
            return;
          }
          video.play();
        } else {
          video.pause();
        }
      }
    } else if (cmd == 'volume') {
      let volume = data.volume;
      if (volume != null) {
        let video = playerComponents.value.videoElement;
        if (video != null) {
          const newVolume = Math.max(0, Math.min(1, volume));
          video.volume = newVolume;
        }
      }
    } else if (cmd == 'seekTo') {
      if (playerComponents.value?.videoElement != null) {
        playerComponents.value.videoElement!.currentTime = data;
      }
    } else if (cmd == 'startSilencePlayer') {
      startSilencePlayer();
    } else if (cmd == 'stopSilentcePlayer') {
      stopSilentcePlayer();
    } else if (cmd == 'getTracks') {
      return getTracks();
    } else if (cmd == 'selectTrack') {
      selectTrack(data.height, data.language);
    } else if (cmd == 'setLoop') {
      setLoop(data);
    } else if (cmd == 'selectSpeed') {
      selectSpeed(data);
    } else if (cmd == 'enablePip') {
      enablePip();
    } else if (cmd == 'preLoadVideo') {
      let videoId = data.videoId;
      if (videoId != null) {
        preloadVideo(videoId, () => fetchVideoInfo(videoId));
      }
    } else if (cmd == 'showingAds') {
      let showing = data.showing;
      if (showing != null) {
        let prev = isShowingAds;
        isShowingAds = showing;
        let video = playerComponents.value.videoElement;
        if (video != null) {
          if (showing == true) {
            video.pause();
            stopSilentcePlayer();
          } else if (showing == false && prev == true) {
            video.play();
          }
        }
      }
    } else if (cmd == 'getTextTracks') {
      return getTextTracks();
    } else if (cmd == 'setTextTrack') {
      return setTextTrack(data);
    }
  }

  function enablePip() {
    if (pipBusy) {
      return;
    }
    const { videoElement } = playerComponents.value;
    let currTime = videoElement?.currentTime;
    if (currTime == null || currTime == Infinity || currTime <= 0) {
      return;
    }
    try {
      pipBusy = true;
      if (videoElement != null) {
        if (document && document.pictureInPictureElement) {
          document.exitPictureInPicture();
        } else {
          videoElement.requestPictureInPicture();
        }
      }
    } catch (error) {
      console.log('Picture-in-Picture:', error);
    } finally {
      pipBusy = false;
    }
  }

  function setLoop(data: any) {
    let loop = data.loop;
    if (loop != null) {
      const { player } = playerComponents.value;
      if (player != null) {
        let video = player.getMediaElement();
        if (video instanceof HTMLMediaElement) {
          video.loop = loop;
        }
      }
    }
  }

  function selectSpeed(data: any) {
    let speed = data.speed;
    if (speed != null) {
      const { player } = playerComponents.value;
      if (player != null) {
        let video = player.getMediaElement();
        if (video instanceof HTMLMediaElement) {
          video.playbackRate = speed;
        }
      }
    }
  }

  function selectTrack(height: any, language: any) {
    const { player } = playerComponents.value;
    if (player != null) {
      let tracks = player.getVariantTracks();
      if (tracks) {
        let target = tracks.filter(t => {
          return t.height == height 
          && t.videoCodec && !t.videoCodec.includes('vp9');
        });
        let targetWithLang = target.filter((t) => {
          if (language && t.language) {
            return t.language.includes(language);
          }
          return true;
        });
        if (targetWithLang.length == 0) {
          let mainAudio = target.filter((t) => {
            return t.audioRoles?.includes('main');
          });
          targetWithLang = mainAudio.length > 0 ? mainAudio : target;
        }
        if (targetWithLang.length > 0) {
          let track = targetWithLang[0];
          if (track.active != true) {
            player.configure({ abr: { enabled: false } });
            player.selectVariantTrack(track, true)
          }
        }
      }
    }
  }

  function getTracks() {
    const { player } = playerComponents.value;
    if (player) {
      let tracks = player.getVariantTracks();
      if (tracks) {
        let activeTrack = tracks.find(track => track.active);
        tracks = tracks.filter(t => {
          return t.videoCodec && !t.videoCodec.includes('vp9');
        });
        var ret: Array<any> = [];
        for (const item of tracks) {
          if (!ret.some(x => x.height === item.height)) {
            ret.push({
              id: item.id,
              name: `${item.height}p`,
              height: item.height,
              active: item.active
            });
          }
        }
        if (activeTrack) {
          for (const item of ret) {
            if (item.height == activeTrack.height) {
              item.active = true;
            } else {
              item.active = false;
            }
          }
        }
        ret.sort((a, b) => a.height - b.height);
        return ret;
      }
    }
    return [];
  }

  function getTextTracks(): Array<any> {
    const { player } = playerComponents.value;
    if (player) {
      let tracks = player.getTextTracks();
      if (tracks) {
        var ret: Array<any> = [];
        for (const item of tracks) {
          ret.push({
            id: item.id,
            language: item.language,
            text: item.label,
            selected: item.active
          });
        }
        return ret;
      }
    }
    return [];
  }

  function setTextTrack(data: any) {
    const { player } = playerComponents.value;
    if (player) {
      let language = data?.language;
      let text = data?.text;
      let show = data?.show;
      if (language != null && text != null) {
        let target = player.getTextTracks().find(u => u.language == language && u.label == text);
        if (target != null) {
          textTrackVisibility = show ?? textTrackVisibility;
          player.selectTextTrack(target);    
        } else {
          textTrackVisibility = false;
        }
      }
      player.setTextTrackVisibility(textTrackVisibility);
    }
  }

  return {
    playerComponents: playerComponents,
    ui: playerComponents.value.ui,
    playerState,
    loadVideo,
    controlPlayer,
  };
}