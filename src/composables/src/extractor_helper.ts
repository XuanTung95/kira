import {ClientInfo} from './extractor_data';
import {getJsonResponse} from '../app_player_interface';

export function getBody(info: ClientInfo | null) : any {
    return {
      context: {
        client: {
            hl : info?.languageCode,
            gl : info?.countryCode,
            clientName : info?.clientName,
            clientVersion : info?.clientVersion,
            originalUrl: 'https://www.youtube.com/',
            platform: "DESKTOP",
            utcOffsetMinutes: 0,
            visitorData: info?.getVisitorData(),
        },
        request: {
            useSsl: true,
            internalExperimentFlags: [],
            consistencyTokenJars: []
        },
        user: {
            lockedSafetyMode: false,
        }
      }
    }
}

export async function getJsonPostResponse(endpoint: string, body: any, headers: any): Promise<any> {
    let res = await getJsonResponse('POST', `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, body, headers);
    return res;
}

async function calSha1(input: string) : Promise<string | null> {
    try {
        let res = await sendMessageToApp({
            cmd: 'sha1',
            value: input,
        });
        if (typeof res?.hash === "string") {
            return res?.hash;
        };
    } catch (e) {
        console.log('calSha1 error', e)
    }
    return null;
}

export async function getApiSIDHash(SAPISID: string): Promise<string | null> {
    const origin = "https://www.youtube.com";
    const time = Math.floor(Date.now() / 1000); // seconds
    const token = `${time} ${SAPISID} ${origin}`;
    const sha1Hash = await calSha1(token);
    if (sha1Hash == null) {
        return null;
    }
    return `SAPISIDHASH ${time}_${sha1Hash}`;
}

export async function sendMessageToApp(data: any) : Promise<any> {
    if (window == null || !(window as any).flutter_inappwebview?.callHandler) {
        return;
    }
    const res = await (window as any).flutter_inappwebview.callHandler(
        'sendToApp',
        data,
    );
    return res;
}

export class ParserHelper {
    static parseText(data: any) : string | null {
        if (data?.runs != null) {
            const runs = data?.runs;
            let result = "";
            for (const item of runs) {
                if (typeof item?.text === "string") {
                    if (result == '') {
                        result += item.text;
                    } else {
                        result += item.text + " ";
                    }
                }
            }
            return result;
        } else if (data?.simpleText != null) {
            if (typeof data?.simpleText === "string") {
                return data?.simpleText;
            }
        } else if (data?.text != null) {
            if (typeof data?.text === "string") {
                return data?.text;
            } else if (typeof data?.text?.content === "string") {
                return data?.text?.content;
            }
        }
        return null;
    }

    static parseMetadataParts(data: any) : string | null {
        if (Array.isArray(data)) {
            let result = '';
            for (const item of data) {
                let text = this.parseText(item);
                if (typeof text === "string") {
                    if (result == '') {
                        result += item.text;
                    } else {
                        result += item.text + " • ";
                    }
                }
            }
            return result;
        }
        return null;
    }

    static parseMetadataRows(data: any) : Array<string> | null {
        if (Array.isArray(data)) {
            let result: Array<string> = [];
            for (const item of data) {
                if (item.metadataParts) {
                    let text = this.parseMetadataParts(item);
                    if (typeof text === "string") {
                        result.push(text);
                    }
                }
            }
            return result;
        }
        return null;
    }
}

