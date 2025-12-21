import { VideoPlaybackAbrRequest, FormatId, StreamerContext, PlaybackCookie } from 'googlevideo/protos';
import { useInnertube } from './useInnertube';
import { useOnesieConfig } from './useOnesieConfig';
import { botguardService } from '@/services/botguard';
import { base64ToU8, u8ToBase64 } from '../../../googlevideo/dist/src/utils/shared';
import { Constants } from 'youtubei.js';

function _removeUnUsedFormats(adaptiveFormats: any) {
    if (Array.isArray(adaptiveFormats)) {
        let ret = adaptiveFormats.filter((item) => {
            return item.isVb !== true && item.mimeType?.includes('vp9') != true 
            && item.mimeType?.includes('opus') != true;
        });
        for (const item of ret) {
            if (item.xtags == null) {
                item.xtags = '';
            }
        }
        return ret;
    }
    return adaptiveFormats;
}

function _onlyKeetItag(adaptiveFormats: any, itag: any) {
    if (Array.isArray(adaptiveFormats)) {
        return adaptiveFormats.filter((item) => {
            return item.itag == itag;
        });
    }
    return adaptiveFormats;
}

function _getBandwidthEstimate(adaptiveFormats: any) : string {
    let maxBitrate = 0;
    if (Array.isArray(adaptiveFormats)) {
        for (const item of adaptiveFormats) {
            if (item.bitrate != null && item.bitrate > maxBitrate) {
                maxBitrate = item.bitrate;
            }
        }
    }
    maxBitrate = maxBitrate * 2;
    if (maxBitrate < 5653951) {
        maxBitrate = 5653951;
    }
    return maxBitrate.toString();
}

function _getAudioFormats(adaptiveFormats: any) : FormatId[] {
    let ret: FormatId[] = [];
    if (Array.isArray(adaptiveFormats)) {
        for (const item of adaptiveFormats) {
            if (item.height == null) {
                ret.push({
                    itag: item.itag,
                    lastModified: item.lastModified,
                    xtags: item.xtags,
                });
            }
        }
    }
    return ret;
}

function _getVideoFormats(adaptiveFormats: any) : FormatId[] {
    let ret: FormatId[] = [];
    if (Array.isArray(adaptiveFormats)) {
        for (const item of adaptiveFormats) {
            if (item.height != null) {
                ret.push({
                    itag: item.itag,
                    lastModified: item.lastModified,
                    xtags: item.xtags,
                });
            }
        }
    }
    return ret;
}

export function initHlsServer() {
    if (window == null) {
        return;
    }
    let mWindow = window as any;
    let playbackWebPoTokenCreationLock = false;
    let playbackWebPoToken: string | undefined;
    let coldStartToken: string | undefined;
    const getInnertube = useInnertube();
    // const getClientConfig = useOnesieConfig();

    async function getPlayerResponse(data: any) {
        let videoId = data.videoId ?? '';
        return getPlayerResponseInternal(videoId);
    }

    async function getPlayerResponseInternal(videoId: string) {
        const innertube = await getInnertube();
        // const clientConfig = await getClientConfig();

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
        let ret = await innertube.actions.execute('/player', { ...requestParams, parse: false });
        let streamingData = ret?.data?.streamingData;
        let adaptiveFormats = streamingData?.adaptiveFormats;
        if (adaptiveFormats) {
            streamingData!.adaptiveFormats = _removeUnUsedFormats(adaptiveFormats);
        }
        let data = ret.data;
        let serverAbrStreamingUrl = streamingData?.serverAbrStreamingUrl;
        let decodedAbrUrl;
        if (serverAbrStreamingUrl != null) {
            decodedAbrUrl = await innertube.session.player!.decipher(serverAbrStreamingUrl)
        }
        let response = {
            videoDetails: data?.videoDetails,
            streamingData: data?.streamingData,
            playerConfig: data?.playerConfig,
            playabilityStatus: data?.playabilityStatus,
            decodedAbrUrl: decodedAbrUrl,
        }
        return response;
    }

    //#region --- WebPO Minter ---
    async function onMintPoTokenCallback(videoId: string | undefined) {
      if (!playbackWebPoToken) {
        await mintContentWebPO(videoId);
      }

      return playbackWebPoToken || coldStartToken || '';
    }

    async function mintContentWebPO(videoId: string | undefined) {
        if (!videoId || playbackWebPoTokenCreationLock) return;
        let playbackWebPoTokenContentBinding = videoId;
        playbackWebPoTokenCreationLock = true;
        try {
            coldStartToken = botguardService.mintColdStartToken(videoId);
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

    async function getSegmentRequest(data: any, isInit: boolean) {
        let videoId = data.videoId;
        let playerResponse = data.playerResponse;
        let streamingData = playerResponse?.streamingData;
        let playerConfig = playerResponse?.playerConfig;
        let resolution = playerResponse?.resolution;
        let decodedAbrUrl = playerResponse?.decodedAbrUrl;
        let requestNum = playerResponse?.rn;
        /// 
        let playerState = data?.playerState;
        let audioFormat = playerState?.audioFormat;
        let videoFormat = playerState?.videoFormat;
        let audioBuffer = playerState?.audioBuffer;
        let videoBuffer = playerState?.videoBuffer;
        let playerTimeMs = playerState?.playerTimeMs;
        let nextRequest = playerState?.nextRequest;
        let sabrContexts = playerState?.sabrContexts;
        if (streamingData != null) {
            const innertube = await getInnertube();
            if (decodedAbrUrl == null) {
                decodedAbrUrl = await innertube.session.player!.decipher(streamingData?.serverAbrStreamingUrl)
            }
            let adaptiveFormats = streamingData.adaptiveFormats;
            adaptiveFormats = _removeUnUsedFormats(adaptiveFormats);
            let poToken = await onMintPoTokenCallback(videoId);
            let client = innertube.session.context.client;
            let preferredAudioFormatIds = _getAudioFormats(adaptiveFormats);
            if (audioFormat?.itag != null) {
                preferredAudioFormatIds = _onlyKeetItag(preferredAudioFormatIds, audioFormat?.itag);
            }
            let preferredVideoFormatIds = _getVideoFormats(adaptiveFormats);
            if (videoFormat?.itag != null) {
                preferredVideoFormatIds = _onlyKeetItag(preferredVideoFormatIds, videoFormat?.itag);
            }

            const streamerContext: StreamerContext = {
                poToken: base64ToU8(poToken),
                // playbackCookie: this.lastPlaybackCookie ? PlaybackCookie.encode(this.lastPlaybackCookie).finish() : undefined,
                clientInfo: {
                    osName: client.osName,
                    osVersion: client.osVersion,
                    clientName: parseInt(Constants.CLIENT_NAME_IDS[client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),
                    clientVersion: "2.20251217.01.00" //client.clientVersion
                },
                sabrContexts: [],
                unsentSabrContexts: []
            };
            let abrRequest : VideoPlaybackAbrRequest = {
                clientAbrState: {
                    allowProximaLiveLatency: 0,
                    audioRoute: 0,
                    audioTrackId: '',
                    av1QualityThreshold: 1080,
                    bandwidthEstimate: _getBandwidthEstimate(adaptiveFormats),
                    playbackRate: 0,
                    dataSaverMode: false,
                    detailedNetworkType: 0,
                    disableStreamingXhr: false,
                    enableVoiceBoost: false,
                    enabledTrackTypesBitfield: 0,
                    isPrefetch: false,
                    clientViewportIsFlexible: false,
                    stickyResolution: resolution ?? 720,
                    visibility: 0,
                    playerState: '0',
                    preferVp9: false,
                    sabrSupportQualityConstraints: false,
                    playerTimeMs: '0',
                },
                bufferedRanges: [],
                selectedFormatIds: [],
                playerTimeMs: "0",
                preferredAudioFormatIds: preferredAudioFormatIds,
                preferredVideoFormatIds: preferredVideoFormatIds,
                preferredSubtitleFormatIds: [],
                videoPlaybackUstreamerConfig: base64ToU8(playerConfig?.mediaCommonConfig.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig),
                streamerContext: streamerContext,
                field1000: []
            };
            let selectedVideoFormat: FormatId | undefined;
            let selectedAudioFormat: FormatId | undefined;
            if (videoFormat != null) {
                selectedVideoFormat = {
                    itag: videoFormat.itag,
                    xtags: videoFormat.xtags ?? '',
                }
                abrRequest.selectedFormatIds.push(selectedVideoFormat);
            }
            if (audioFormat != null) {
                selectedAudioFormat = {
                    itag: audioFormat.itag,
                    xtags: audioFormat.xtags ?? '',
                };
                abrRequest.selectedFormatIds.push(selectedAudioFormat);
            }

            if (videoBuffer != null) {
                abrRequest.bufferedRanges.push({
                    durationMs: videoBuffer.durationMs ?? '0',
                    endSegmentIndex: videoBuffer.endSegmentIndex ?? 1,
                    formatId: selectedVideoFormat,
                    startSegmentIndex: videoBuffer.startSegmentIndex ?? 1,
                    startTimeMs: '0',
                });
            }

            if (audioBuffer != null) {
                abrRequest.bufferedRanges.push({
                    durationMs: audioBuffer.durationMs ?? '0',
                    endSegmentIndex: audioBuffer.endSegmentIndex ?? 1,
                    formatId: selectedAudioFormat,
                    startSegmentIndex: audioBuffer.startSegmentIndex ?? 1,
                    startTimeMs: '0',
                });
            }

            if (playerTimeMs) {
                abrRequest.clientAbrState!.playerTimeMs = playerTimeMs;
                abrRequest.clientAbrState!.elapsedWallTimeMs = playerTimeMs;
            }

            if (nextRequest?.playbackCookie != null) {
                abrRequest.streamerContext!.playbackCookie = PlaybackCookie.encode(nextRequest?.playbackCookie).finish()
            }

            if (false && !isInit && audioBuffer?.durationMs == "29953") {
                abrRequest.clientAbrState = {
                    allowProximaLiveLatency: 0,
                    audioRoute: 0,
                    audioTrackId: "",
                    av1QualityThreshold: 8192,
                    bandwidthEstimate: "4572277",
                    clientBitrateCapBytesPerSec: "0",
                    clientViewportHeight: 496,
                    clientViewportIsFlexible: false,
                    clientViewportWidth: 867,
                    dataSaverMode: false,
                    detailedNetworkType: 0,
                    disableStreamingXhr: false,
                    drcEnabled: true,
                    elapsedWallTimeMs: "7510",
                    enableVoiceBoost: false,
                    enabledTrackTypesBitfield: 0,
                    field48: 0,
                    field50: 0,
                    field51: 0,
                    field57: "229",
                    field60: 0,
                    field67: 0,
                    isPrefetch: false,
                    lastManualDirection: 1,
                    lastManualSelectedResolution: 1080,
                    maxAudioQuality: 0,
                    maxPacingRate: 0,
                    minAudioQuality: 0,
                    networkMeteredState: 0,
                    playbackRate: 0,
                    playerState: "0",
                    playerTimeMs: "6995",
                    preferVp9: false,
                    sabrForceMaxNetworkInterruptionDurationMs: "5333",
                    sabrForceProxima: 0,
                    sabrReportRequestCancellationInfo: 0,
                    sabrSupportQualityConstraints: false,
                    stickyResolution: 1080,
                    timeSinceLastActionMs: "7060",
                    timeSinceLastManualFormatSelectionMs: "772686113",
                    timeSinceLastSeek: "7502",
                    videoQualitySetting: 0,
                    visibility: 0,
                }
            }

            console.log('abrRequest', abrRequest);

            let body = VideoPlaybackAbrRequest.encode(abrRequest).finish();
            const sabrUrl = new URL(decodedAbrUrl || '');
            sabrUrl.searchParams.set('rn', requestNum);
            let requestUrl = sabrUrl.toString();
            let headers = {
                'origin': 'https://www.youtube.com',
                'referer': 'https://www.youtube.com/',
                'user-agent': navigator?.userAgent,
            }
            let method = 'POST';
            return {
                requestUrl,
                method,
                body: u8ToBase64(body),
                type: 'base64',
                headers,
            }
        }
        return null;
    }

    async function handleAppCommand(cmd: string, data: any) {
        console.log('hlsServer cmd', cmd, data)
        if (cmd == 'getPlayerResponse') {
            return getPlayerResponse(data);
        } else if (cmd == 'getInitSegmentBody') {
            return getSegmentRequest(data, true);
        } else if (cmd == 'getNextSegmentBody') {
            return getSegmentRequest(data, false);
        } else if (cmd == 'log') {
            // console.log('log', data);
        }
        return null;
    }

    mWindow.hlsServer = {
        handleCmd: handleAppCommand
    }
}