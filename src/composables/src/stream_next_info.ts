import {ClientInfo} from './extractor_data';
import {getBody, getJsonPostResponse, ParserHelper} from './extractor_helper';

export class StreamNextInfo {
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
        let body = getBody(this.clientInfo);
        body.videoId = this.videoId;
        body.contentCheckOk = true;
        body.racyCheckOk = true;
        let loginHeader = await this.clientInfo.getLoginHeaderIfAny();
        let res = await getJsonPostResponse('next', body, loginHeader);
        if (res.status == 200 && res.body?.contents != null) {
            let streamInfo: any = {
                streamType: 'VIDEO_STREAM',
                thumbnails: [],
                name: '',
                textualUploadDate: '',
                subChannelName: '',
                subChannelUrl: '',
                dashMpdUrl: '',
                hlsUrl: '',
                nextToken: '',
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
            }
            let contents = res.body?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
            if (Array.isArray(contents)) {
                for (const item of contents) {
                    if (item.videoPrimaryInfoRenderer) {
                        let primary = new VideoPrimaryInfoRenderer(item.videoPrimaryInfoRenderer);
                        streamInfo.name = primary.getTitle() ?? '';
                        streamInfo.viewCountText = primary.getViewCountText();
                    }
                    if (item.videoSecondaryInfoRenderer) {
                        let secondary = new VideoSecondaryInfoRenderer(item.videoSecondaryInfoRenderer);
                        let owner = secondary.getOwner();
                        streamInfo.uploaderName = owner.getUploaderName();
                        streamInfo.uploaderUrl = owner.getChannelId();
                        streamInfo.uploaderAvatars = owner.getUploaderAvatars();
                        streamInfo.uploaderSubscriberCountText = owner.getSubscriberCountText();
                    }
                }
            }
            let results = res.body?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results;
            if (Array.isArray(results)) {
                for (const item of results) {
                    if (item.lockupViewModel != null) {
                        let lockupVM = new LockupViewModel(item?.lockupViewModel);
                        let map = lockupVM.getAppInfoItem();
                        if (map != null) {
                            relatedVideos.push(map);
                        }
                        continue;
                    }
                    if (item.continuationItemRenderer != null) {
                        let token = new ContinuationItemRenderer(item.continuationItemRenderer).getContinuationToken();
                        if (typeof token == 'string') {
                            ret.loadMoreToken = token;
                        }
                    }
                    let contents = item?.itemSectionRenderer?.contents;
                    if (Array.isArray(contents)) {
                        for (const content of contents) {
                            if (content.continuationItemRenderer != null) {
                                let token = new ContinuationItemRenderer(content.continuationItemRenderer).getContinuationToken();
                                if (typeof token == 'string') {
                                    ret.loadMoreToken = token;
                                }
                            }
                            if (content?.lockupViewModel != null) {
                                let lockupVM = new LockupViewModel(content?.lockupViewModel);
                                let map = lockupVM.getAppInfoItem();
                                if (map != null) {
                                    relatedVideos.push(map);
                                }
                            }
                        }
                    }
                }
            }
            ret.relatedVideos = relatedVideos;
            console.log('results', res.body, ret);
            return ret;
        }
        return null;
    }
}

class VideoPrimaryInfoRenderer {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getTitle() : string | null {
        return ParserHelper.parseText(this.map?.title);
    }

    getViewCountText() : string | null {
        let viewCount = ParserHelper.parseText(this.map?.viewCount?.videoViewCountRenderer?.shortViewCount)
        ?? ParserHelper.parseText(this.map?.viewCount?.videoViewCountRenderer?.viewCount);
        let date = this.getRelativeDateText();
        if (date != null) {
            viewCount = (viewCount ?? '') + ' ' + date;
        }
        return viewCount;
    }

    getRelativeDateText(): string | null {
        return ParserHelper.parseText(this.map?.relativeDateText);
    }
}

class VideoSecondaryInfoRenderer {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getTitle() : string | null {
        return ParserHelper.parseText(this.map?.title);
    }

    getViewCountText() : string | null {
        let viewCount = ParserHelper.parseText(this.map?.viewCount);
        let date = this.getRelativeDateText();
        if (date != null) {
            viewCount = (viewCount ?? '') + ' ' + date;
        }
        return viewCount;
    }

    getRelativeDateText(): string | null {
        return ParserHelper.parseText(this.map?.relativeDateText);
    }

    getOwner(): VideoOwnerRenderer {
        return new VideoOwnerRenderer(this.map?.owner);
    }

    getDescription(): string | null {
        return this.map?.attributedDescription?.content;
    }
}

class VideoOwnerRenderer {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getUploaderAvatars(): Array<any> | null {
        return this.map?.thumbnail?.thumbnails;
    }

    getUploaderName(): string | null {
        return ParserHelper.parseText(this.map?.title);
    }

    getSubscriberCountText(): string | null {
        return ParserHelper.parseText(this.map?.subscriberCountText);
    }

    getChannelId(): string | null {
        return new NavigationEndpoint(this.map?.navigationEndpoint).getBrowseId();
    }
}

class NavigationEndpoint {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getBrowseId(): string | null {
        return this.map?.browseEndpoint?.browseId;
    }
}

class ItemSectionRenderer {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };
}

class LockupViewModel {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getImages() : Array<any> | null {
        return this.map?.contentImage?.thumbnailViewModel?.image?.sources;
    }

    getTitle() : string | null {
        return this.map?.metadata?.lockupMetadataViewModel?.title?.content;
    }

    isVideo() {
        return this.map?.contentType == 'LOCKUP_CONTENT_TYPE_VIDEO';
    }

    isPlaylist() {
        return this.map?.contentType == 'LOCKUP_CONTENT_TYPE_PLAYLIST';
    }

    getContentId() : string | null {
        return this.map?.contentId;
    }

    getStreamType() : string | null {
        const overlays = this.map?.contentImage?.thumbnailViewModel?.overlays;
        if (Array.isArray(overlays)) {
            const isLive = overlays.some((e: any) => {
            const badges = e?.thumbnailOverlayBadgeViewModel?.thumbnailBadges;
            if (Array.isArray(badges)) {
                return badges.some((i: any) => {
                    const badgeStyle = i?.thumbnailBadgeViewModel?.badgeStyle;
                    if (badgeStyle === "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") {
                        return true;
                    }

                    const sources = i?.thumbnailBadgeViewModel?.icon?.sources;
                    if (Array.isArray(sources)) {
                        for (const item of sources) {
                        if (item?.clientResource?.imageName === "LIVE") {
                            return true;
                        }
                        }
                    }
                    return false;
                });
            }
                return false;
            });
            if (isLive) {
                return 'LIVE_STREAM';
            }
        }
        return 'VIDEO_STREAM';
    }

    getDurationText(): string | null {
        if (this.getStreamType() === 'LIVE_STREAM') {
            return null;
        }

        let duration: string | null = ParserHelper.parseText(this.map?.lengthText);

        if (!duration) {
            const overlays = this.map?.contentImage?.thumbnailViewModel?.overlays;
            if (Array.isArray(overlays) && overlays.length > 0) {
            for (const overlay of overlays) {
                if (overlay && typeof overlay === "object") {
                const vm = overlay.thumbnailOverlayBadgeViewModel;
                if (!vm) continue;

                if (vm.position === "THUMBNAIL_OVERLAY_BADGE_POSITION_BOTTOM_END") {
                    const thumbnailBadges = vm.thumbnailBadges;

                    if (Array.isArray(thumbnailBadges) && thumbnailBadges.length === 1) {
                        const text = thumbnailBadges[0]?.thumbnailBadgeViewModel?.text;
                        if (typeof text === "string") {
                            duration = text;
                            break;
                        }
                    }
                }
                }
            }
            }
        }
        return duration;
    }

    getUploaderName(): string {
        let metadataRows = this.map?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (metadataRows != null) {
            if (Array.isArray(metadataRows) && metadataRows.length > 0) {
                if (metadataRows[0]?.metadataParts != null) {
                    let content = metadataRows[0].metadataParts[0]?.text?.content;
                    if (typeof content == 'string') {
                        return content;
                    }
                }
            }
        }
        let name: string | null =
            ParserHelper.parseText(this.map?.longBylineText);
        if (!name) {
            name = ParserHelper.parseText(this.map?.ownerText);
            if (!name) {
                name = ParserHelper.parseText(this.map?.shortBylineText);
            }
        }

        return name ?? "";
    }

    getUploaderUrl(): string | null {
        return this.map?.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.
        rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
    }

    getUploaderAvatars() : any {
        return this.map?.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
    }

    getAppInfoItem() : any {
        if (this.isVideo()) {
            return {
                type: 'STREAM',
                video: this.getAppVideoModel(),
            }
        } else if (this.isPlaylist()) {
            return {
                type: 'PLAYLIST',
                playlist: this.getAppPlaylistInfo(),
            }
        }
        return null;
    }

    getViewCountText(): string | null {
        let metadataRows = this.map?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (metadataRows != null) {
            if (Array.isArray(metadataRows) && metadataRows.length > 1) {
                if (metadataRows[1]?.metadataParts != null) {
                    let p = metadataRows[1]?.metadataParts;
                    if (Array.isArray(p) && p.length > 0) {
                        let content = p[0]?.text?.content;
                        if (typeof content == 'string') {
                            return content;
                        }
                    }
                }
            }
        }
        return null;
    }

    getPublishedText(): string | null {
        let metadataRows = this.map?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (metadataRows != null) {
            if (Array.isArray(metadataRows) && metadataRows.length > 1) {
                if (metadataRows[1]?.metadataParts != null) {
                    let p = metadataRows[1]?.metadataParts;
                    if (Array.isArray(p) && p.length > 1) {
                        let content = p[1]?.text?.content;
                        if (typeof content == 'string') {
                            return content;
                        }
                    }
                }
            }
        }
        return null;
    }

    getPlaylistUploaderId(): string | null {
        let metadataRows = this.map?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (metadataRows != null) {
            if (Array.isArray(metadataRows) && metadataRows.length > 0) {
                if (metadataRows[0]?.metadataParts != null) {
                    let commandRuns = metadataRows[0].metadataParts[0]?.text?.commandRuns;
                    if (commandRuns != null) {
                        let browseId = commandRuns[0]?.onTap?.browseEndpoint?.browseId;
                        if (typeof browseId == 'string') {
                            return browseId;
                        }
                    }
                }
            }
        }
        return null;
    }

    getAppVideoModel() : any {
        return {
            id: this.getContentId(),
            title: this.getTitle(),
            description: '',
            thumbnail: {
                thumbnails: this.getImages(),
            },
            channel: {
                name: this.getUploaderName(),
                channelId: this.getUploaderUrl() ?? '',
                baseUrl: this.getUploaderUrl() ?? '',
                verified: true,
                thumbnail: {
                    thumbnails: this.getImages(),
                }
            },
            viewCount: this.getViewCountText() ?? '',
            publishedText: this.getPublishedText() ?? '',
            isLiveStream: this.getStreamType() == 'LIVE_STREAM',
        }
    }

    getAppPlaylistInfo() : any {
        return {
            uploaderName: this.getUploaderName() ?? '',
            uploaderUrl: this.getPlaylistUploaderId() ?? '',
            uploaderAvt: null,
            uploaderVerified: true,
            streamCount: 0,
            name: this.getTitle() ?? '',
            playlistId: this.getContentId() ?? '',
            description: '',
            playlistType: 'NORMAL',
            thumbnail: {
                thumbnails: this.getImages(),
            },
            items: [],
            currIndex: 0,
            isLocalPlaylist: false,
            shuffle: false,
        }
    }
}

class ContinuationItemRenderer {
    public map: any;

    constructor(
        map: any,
    ) {
        this.map = map;
    };

    getContinuationToken() : string | null {
        return this.map?.continuationEndpoint?.continuationCommand?.token;
    }
}