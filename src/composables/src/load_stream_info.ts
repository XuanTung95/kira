import {ClientInfo} from './extractor_data';
import {getBody, getJsonPostResponse, ParserHelper} from './extractor_helper';
import {getJsonResponse} from '../app_player_interface';
import { convertHlsPathStyleToQueryStyle } from '../useYoutubePlayer';
import { macSafariClient, playerEndpoint } from '../app_clients';

export class LoadStreamInfo {
    public clientInfo: ClientInfo;
    public videoId: string | null = null;
    public navigationEndpoint: any;

    constructor(
        clientInfo: ClientInfo,
        data: any,
    ) {
        this.clientInfo = clientInfo;
        this.videoId = data?.videoId;
        this.navigationEndpoint = data?.navigationEndpoint;
    };

    public async fetch() : Promise<any> {
        if (!this.videoId) {
            return null;
        }
        const getInnertube = (window as any)?.getInnertube;
        const innertube = getInnertube == null ? (window as any)?.innertube : await getInnertube();
        let info = this.clientInfo;
        let client = innertube?.session?.context?.client;
        /// App: 9Tube
        // let userArgent = "com.google.ios.youtube/20.24.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
        // let userArgent = client?.userAgent ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1,gzip(gfe)";
        let mClient = macSafariClient;
        let mSession = innertube.session;
        let cInfo = (window as any)?.appClientInfo;
        let hl = cInfo?.languageCode;
        let gl = cInfo?.countryCode;
        
        // let userArgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15";
        let onMintPoTokenCallback = (window as any)?.hlsServer?.onMintPoTokenCallback;
        let poToken = onMintPoTokenCallback != null ? await onMintPoTokenCallback(this.videoId) : null;
        let body: any = {
            context: {
                client: {
                    hl: hl,
                    gl: gl,
                    deviceMake: mClient.deviceMake,
                    deviceModel: mClient.deviceModel,
                    userAgent: mClient.userAgent,
                    clientName: mClient.clientName,
                    clientVersion: mSession.client_version,
                    osName: mClient.osName,
                    osVersion: mClient.osVersion,
                    platform: mClient.platform,
                    browserName: mClient.browserName,
                    browserVersion: mClient.browserVersion,
                },
                user: {
                    lockedSafetyMode: false,
                },
                request: {
                    useSsl: true,
                },
            },
            serviceIntegrityDimensions: poToken ? {
                poToken: poToken,
            } : null,
        };
        body.videoId = this.videoId;
        body.contentCheckOk = true;
        body.racyCheckOk = true;
        body.playbackContext = {
            contentPlaybackContext: {
                signatureTimestamp : innertube?.session?.player?.signature_timestamp ?? 20458
            }
        };
        let headers = {
            'Accept': '*/*',
            'Accept-Language': '*',
            'Content-Type': 'application/json',
            'X-Youtube-Client-Version': mSession.client_version,
            'X-Youtube-Client-Name': '1',
            'X-Goog-Visitor-Id': mSession.context.client.visitorData ?? '',
            'Referer': `https://www.youtube.com/watch?v=${this.videoId}`,
            'User-Agent': mClient.userAgent,
            'cache-control': 'no-cache'
        }
        let res = await getJsonResponse('POST', playerEndpoint, body, headers);
        if (res.status == 200 && res.body?.streamingData != null) {
            let videoDetails = res.body?.videoDetails;
            let streamingData = res.body?.streamingData;
            let playabilityStatus = res.body?.playabilityStatus;
            let streamType = 'VIDEO_STREAM';
            if (videoDetails?.isLiveContent == true) {
                streamType = 'LIVE_STREAM'
            }
            let formats = streamingData?.formats;
            let mp4Url = null;
            if (formats != null && Array.isArray(formats) && formats.length > 0) {
                let format = formats[0];
                let url = format.url;
                let sc = format.signatureCipher;
                if (url || sc) {
                    mp4Url = await innertube.session.player!.decipher(url, sc);
                }
            }
            let hlsManifestUrl = streamingData?.hlsManifestUrl;
            if (hlsManifestUrl) {
                hlsManifestUrl = convertHlsPathStyleToQueryStyle(hlsManifestUrl);
                hlsManifestUrl = await innertube.session.player!.decipher(hlsManifestUrl);
                streamingData.hlsManifestUrl = hlsManifestUrl;
            }
            (window as any).hlsUrl = hlsManifestUrl;
            let streamInfo: any = {
                id: this.videoId,
                streamType: streamType,
                thumbnails: videoDetails?.thumbnail?.thumbnails,
                name: videoDetails?.title ?? '',
                uploaderName: videoDetails?.author,
                uploaderUrl: videoDetails?.channelId,
                textualUploadDate: '',
                subChannelName: '',
                subChannelUrl: '',
                dashMpdUrl: '',
                videoStreams: mp4Url != null ? [{content: mp4Url}] : null,
                hlsUrl: streamingData?.hlsManifestUrl ?? '',
                errorReason: playabilityStatus?.reason,
                isLoginRequired: playabilityStatus?.status == 'LOGIN_REQUIRED' ? true : null,
                nextToken: '',
                loadedNextResponse: false,
                createdDate: new Date().toISOString(),
            };
            let relatedVideos: any[] = [];
            let ret = {
                streamInfo: streamInfo,
                relatedVideos: relatedVideos,
                loadMoreToken: '',
                frameSetWrapper: {
                    maxDuration: 0,
                    pageDuration: 0,
                },
            };
            return ret;
        }
        return null;
    }
}