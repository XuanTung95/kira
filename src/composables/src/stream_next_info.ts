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
            let contents = res.body?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
            if (Array.isArray(contents)) {
                let ret = {
                    streamInfo: {
                        streamType: 'VIDEO_STREAM',
                        thumbnails: [],
                        name: 'test1231232',
                        subChannelName: '',
                        subChannelUrl: '',
                        dashMpdUrl: '',
                        hlsUrl: '',
                        nextToken: '',
                        createdDate: new Date().toISOString(),
                    },
                    relatedVideos: [],
                    loadMoreToken: '',
                    frameSetWrapper: {
                        maxDuration: 0,
                        pageDuration: 0,
                    },
                }
                return ret;
            }
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

    getContentId() : string | null {
        return this.map?.contentId;
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