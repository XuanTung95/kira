import {ClientInfo} from './extractor_data';
import {getBody, getJsonPostResponse, ParserHelper} from './extractor_helper';
import {getJsonResponse} from '../app_player_interface';

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
        let userArgent = client?.userAgent ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1,gzip(gfe)";
        let body: any = {
            context: {
                client: {
                    hl : info?.languageCode,
                    gl : info?.countryCode,
                    // clientVersion: "20.24.4",
                    // osName: "iOS",
                    // visitorData: "",
                    // userAgent: userArgent,
                    // clientName: "iOS",
                    // platform: "MOBILE",
                    // deviceMake: "Apple",
                    // deviceModel: "iPhone16,2",
                    // osVersion: "18.3.2.22D82"
                    "osName": client?.osName,
                    "osVersion": client?.osVersion,
                    "userAgent": userArgent,
                    "deviceMake": client?.deviceMake,
                    "deviceModel": client?.deviceModel,
                    "clientName": client?.clientName,
                    "clientVersion": client?.clientVersion,
                    "browserName": client?.browserName,
                    "browserVersion": client?.browserVersion,
                    "platform": client?.platform,
                },
                user: {
                    lockedSafetyMode: false,
                }
            }
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
            'host': 'm.youtube.com',
            'accept': '*/*',
            'content-type': 'application/json',
            'origin': 'https://m.youtube.com',
            'user-agent': userArgent,
            'referer': 'https://m.youtube.com/watch?v=QxGt54-oh1A',
            'cache-control': 'no-cache'
        }
        let res = await getJsonResponse('POST', `https://m.youtube.com/youtubei/v1/player?prettyprint=false`, body, headers);
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
                hlsUrl: videoDetails?.isLiveContent == true ? (streamingData?.hlsManifestUrl ?? '') : '',
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