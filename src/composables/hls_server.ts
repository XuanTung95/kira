import { VideoPlaybackAbrRequest, FormatId, StreamerContext, PlaybackCookie } from 'googlevideo/protos';
import { useInnertube } from './useInnertube';
import { useOnesieConfig } from './useOnesieConfig';
import { botguardService } from '@/services/botguard';
import { base64ToU8, u8ToBase64 } from '../../../googlevideo/dist/src/utils/shared';
import { Constants } from 'youtubei.js';
import { onInitCodeDone, getClientData } from './app_player_interface'
import { sendMessageToApp } from './src/extractor_helper'

interface PoTokenData {
  coldStartToken: string | null;
  playbackWebPoToken: string | null;
}

function _removeUnUsedFormats(adaptiveFormats: any) {
    if (Array.isArray(adaptiveFormats)) {
        let ret = adaptiveFormats.filter((item) => {
            return item.isVb !== true && item.mimeType?.includes('vp9') != true 
            && item.mimeType?.includes('opus') != true
            && item.mimeType?.includes('av01') != true
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

function filterAudioByLanguagePerItag(
  formats: any[],
  language: string,
): any[] {
  const byItag = new Map<number, any[]>();
  for (const f of formats) {
    let itag = f.itag ?? -1;
    if (!byItag.has(itag)) {
      byItag.set(itag, []);
    }
    byItag.get(itag)!.push(f);
  }
  const result: any[] = [];
  for (const [itag, list] of byItag.entries()) {
    // tìm các audio track có ngôn ngữ mong muốn
    const matched = list.filter(
      f => f.audioTrack?.id?.includes(language) == true
    );
    if (matched.length > 0) {
      result.push(...matched);
    } else {
      result.push(...list);
    }
  }
  return result;
}

export function initHlsServer() {
    if (window == null) {
        return;
    }
    let mWindow = window as any;
    let poTokenMap : Record<string, PoTokenData> = {};
    const getInnertube = useInnertube();
    // const getClientConfig = useOnesieConfig();

    async function getPlayerResponse(data: any) {
        let videoId = data.videoId ?? '';
        return getPlayerResponseInternal(videoId);
    }

    async function getPlayerResponseInternal(videoId: string) {
        const innertube = await getInnertube();
        await getClientData();

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
        let cInfo = (window as any)?.appClientInfo;
        let hl = cInfo?.languageCode;
        let gl = cInfo?.countryCode;
        let client = innertube.session.context.client;
        if (hl && gl) {
            client.hl = hl;
            client.gl = gl;
        }
        let ret = await innertube.actions.execute('/player', { ...requestParams, parse: false });
        let streamingData = ret?.data?.streamingData;
        let adaptiveFormats = streamingData?.adaptiveFormats;
        if (adaptiveFormats) {
            let formats = _removeUnUsedFormats(adaptiveFormats);
            if (hl) {
                formats = filterAudioByLanguagePerItag(formats, hl);
            }
            streamingData!.adaptiveFormats = formats;
        }
        let data = ret.data;
        let serverAbrStreamingUrl = streamingData?.serverAbrStreamingUrl;
        let decodedAbrUrl;
        if (serverAbrStreamingUrl != null) {
            decodedAbrUrl = await innertube.session.player!.decipher(serverAbrStreamingUrl)
        }
        let redirectHlsUrl = null;
        if (ret?.data?.videoDetails?.isLive == true) {
            redirectHlsUrl = streamingData?.hlsManifestUrl;
        }
        let response = {
            videoDetails: data?.videoDetails,
            streamingData: data?.streamingData,
            playerConfig: data?.playerConfig,
            playabilityStatus: data?.playabilityStatus,
            // captionTracks: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
            decodedAbrUrl: decodedAbrUrl,
            redirectHlsUrl: redirectHlsUrl,
        }
        return response;
    }

    //#region --- WebPO Minter ---
    async function onMintPoTokenCallback(videoId: string | undefined) {
        if (poTokenMap[videoId ?? ''] == null) {
            poTokenMap[videoId ?? ''] = {
                coldStartToken: null,
                playbackWebPoToken: null,
            };
        }
        let token = poTokenMap[videoId ?? ''];
        if (token.playbackWebPoToken == null) {
            await mintContentWebPO(videoId);
        }
        return token.playbackWebPoToken || token.coldStartToken || '';
    }

    async function mintContentWebPO(videoId: string | undefined) {
        let token = poTokenMap[videoId ?? ''];
        if (!videoId) return;
        let playbackWebPoTokenContentBinding = videoId;
        try {
            token.coldStartToken = botguardService.mintColdStartToken(videoId);
            console.info('[Player]', `Cold start token created (Content binding: ${decodeURIComponent(playbackWebPoTokenContentBinding)})`);

            if (!botguardService.isInitialized()) await botguardService.reinit();

            if (botguardService.integrityTokenBasedMinter) {
            token.playbackWebPoToken = await botguardService.integrityTokenBasedMinter.mintAsWebsafeString(decodeURIComponent(playbackWebPoTokenContentBinding));
            console.info('[Player]', `WebPO token created (Content binding: ${decodeURIComponent(playbackWebPoTokenContentBinding)})`);
            }
        } catch (err) {
            console.error('[Player]', 'Error minting WebPO token', err);
        } finally {
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
                    clientVersion: client.clientVersion
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
                    lastModified: videoFormat.lastModified,
                    xtags: videoFormat.xtags ?? '',
                }
                abrRequest.selectedFormatIds.push(selectedVideoFormat);
            }
            if (audioFormat != null) {
                selectedAudioFormat = {
                    itag: audioFormat.itag,
                    lastModified: audioFormat.lastModified,
                    xtags: audioFormat.xtags ?? '',
                };
                abrRequest.selectedFormatIds.push(selectedAudioFormat);
            }

            if (!isInit && videoBuffer != null) {
                abrRequest.bufferedRanges.push({
                    durationMs: videoBuffer.durationMs ?? '0',
                    endSegmentIndex: videoBuffer.endSegmentIndex ?? 1,
                    formatId: selectedVideoFormat,
                    startSegmentIndex: videoBuffer.startSegmentIndex ?? 1,
                    startTimeMs: '0',
                });
            }

            if (!isInit && audioBuffer != null) {
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
                // abrRequest.clientAbrState!.elapsedWallTimeMs = playerTimeMs;
            }

            if (nextRequest?.playbackCookie != null) {
                abrRequest.streamerContext!.playbackCookie = PlaybackCookie.encode(nextRequest?.playbackCookie).finish()
            }

            console.log('abrRequest', abrRequest);

            let body = VideoPlaybackAbrRequest.encode(abrRequest).finish();
            const sabrUrl = new URL(decodedAbrUrl || '');
            sabrUrl.searchParams.set('rn', requestNum);
            sabrUrl.searchParams.set('alr','yes');
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
        let asyncId = data?.asyncId;
        let result = null;
        if (cmd == 'getPlayerResponse') {
            result = await getPlayerResponse(data);
        } else if (cmd == 'getInitSegmentBody') {
            result = await  getSegmentRequest(data, true);
        } else if (cmd == 'getNextSegmentBody') {
            result = await getSegmentRequest(data, false);
        } else if (cmd == 'log') {
            // console.log('log', data);
        }
        if (asyncId != null) {
            sendMessageToApp({
                asyncId: asyncId,
                cmd: 'returnAsyncResult',
                result: result,
            });
        }
        return result;
    }

    mWindow.hlsServer = {
        handleCmd: handleAppCommand
    };

    onInitCodeDone();
}