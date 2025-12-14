import { VideoPlaybackAbrRequest, FormatId, StreamerContext } from 'googlevideo/protos';
import { useInnertube } from './useInnertube';
import { useOnesieConfig } from './useOnesieConfig';
import { botguardService } from '@/services/botguard';
import { base64ToU8, u8ToBase64 } from '../../../googlevideo/dist/src/utils/shared';
import { Constants } from 'youtubei.js';

function _removeUnUsedFormats(adaptiveFormats: any) {
    if (Array.isArray(adaptiveFormats)) {
        return adaptiveFormats.filter((item) => {
            return item.isVb !== true && item.mimeType?.includes('vp9') != true 
            && item.mimeType?.includes('opus') != true;
        });
    }
    return adaptiveFormats;
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

    async function getInitSegmentRequest(data: any) {
        let videoId = data.videoId;
        let playerResponse = data.playerResponse;
        let streamingData = playerResponse?.streamingData;
        let playerConfig = playerResponse?.playerConfig;
        let resolution = playerResponse?.resolution;
        let decodedAbrUrl = playerResponse?.decodedAbrUrl;
        let requestNum = playerResponse?.rn;
        if (streamingData != null) {
            const innertube = await getInnertube();
            if (decodedAbrUrl == null) {
                decodedAbrUrl = await innertube.session.player!.decipher(streamingData?.serverAbrStreamingUrl)
            }
            let adaptiveFormats = streamingData.adaptiveFormats;
            adaptiveFormats = _removeUnUsedFormats(adaptiveFormats);
            let poToken = await onMintPoTokenCallback(videoId);
            let client = innertube.session.context.client;
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
                    bandwidthEstimate: "5653951",
                    playbackRate: 0,
                    enableVoiceBoost: false,
                    enabledTrackTypesBitfield: 0,
                    isPrefetch: false,
                    clientViewportIsFlexible: false,
                    playerState: '0',
                    preferVp9: false,
                    sabrSupportQualityConstraints: false,
                    playerTimeMs: '0',
                },
                bufferedRanges: [],
                selectedFormatIds: [],
                preferredAudioFormatIds: _getAudioFormats(adaptiveFormats),
                preferredVideoFormatIds: _getVideoFormats(adaptiveFormats),
                preferredSubtitleFormatIds: [],
                videoPlaybackUstreamerConfig: base64ToU8(playerConfig?.mediaCommonConfig.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig),
                streamerContext: streamerContext,
                field1000: []
            };
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
            return getInitSegmentRequest(data);
        }
        return null;
    }

    mWindow.hlsServer = {
        handleCmd: handleAppCommand
    }
}