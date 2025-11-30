
import {getApiSIDHash} from './extractor_helper';

export class ClientInfo {
    public countryCode: string | null = null;
    public languageCode: string | null = null;
    public clientVersion: string | null = null;
    public clientName: string | null = null;
    public visitorData: string | null = null;
    public requiredVisitorData: string | null = null;
    public cookie: string | null = null;
    public cookieLogin: any | null = null;
    public idToken: string | null = null;
    public apiKey: string | null = null;
    public dataSyncId: string | null = null;
    public platform: string | null = null;

    constructor(
        data: any
    ) {
        this.countryCode = data?.countryCode;
        this.languageCode = data?.languageCode;
        this.clientVersion = data?.clientVersion;
        this.clientName = data?.clientName;
        this.visitorData = data?.visitorData;
        this.requiredVisitorData = data?.requiredVisitorData;
        this.cookie = data?.cookie;
        this.cookieLogin = data?.cookieLogin;
        this.idToken = data?.idToken;
        this.apiKey = data?.apiKey;
        this.dataSyncId = data?.dataSyncId;
        this.platform = data?.platform;
    }

    public getHeaders(): any {
        return {
            "origin": 'https://www.youtube.com',
            "referer": 'https://www.youtube.com',
            "host":"www.youtube.com",
            "x-youtube-client-name": this.clientName,
            "x-youtube-client-version": this.clientVersion,
            "sec-ch-ua-mobile": "?0",
            "sec-fetch-dest":"empty",
            "sec-fetch-site":"same-origin",
            "sec-fetch-mode":"same-origin",
            "x-goog-visitor-id": this.getVisitorData(),
        }
    }

    public async getLoginHeaderIfAny() {
        let headers = this.getHeaders();
        let sapisid = this.getSAPISID();
        if (sapisid) {
            let hash = await getApiSIDHash(sapisid);
            if (hash != null) {
                headers.authorization = hash;
                headers.cookie = this.toCookieString(this.cookieLogin);
            }
        }
        return headers;
    }

    getVisitorData() {
        return this.visitorData ?? this.requiredVisitorData;
    }

    getSAPISID(): string | null {
        return this.cookieLogin?.SAPISID;
    }

    toCookieString(cookies: any): string | null {
        if (cookies == null) {
            return null;
        }
        let ret = "";
        for (const [key, val] of Object.entries(cookies)) {
            if (ret.length > 0) {
                ret += `; ${key}=${val}`;
            } else {
                ret += `${key}=${val}`;
            }
        }
        return ret;
    }
}
