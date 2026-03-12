import {ClientInfo} from './src/extractor_data';
import { LoadStreamInfo } from './src/load_stream_info';
import {StreamNextInfo} from './src/stream_next_info';
import { sendMessageToApp } from './src/extractor_helper'

enum ExtractType {
    streamNextInfo = 'streamNextInfo',
    streamInfo = 'streamInfo',
}

function getSupportNames() {
    return 'streamInfo';
}

function checkSupport(type: string | null, data: any) {
    if (type == ExtractType.streamInfo) {
        return true;
    }
    if (type == null || data == null) {
        return false;
    }
    return false;
}

async function extract(type: string, data: any) {
    let proxyFetch = (window as any).proxyFetch;
    let asyncId = data?.asyncId;
    let res = null;
    if (proxyFetch) {
        let clientInfo = new ClientInfo(data?.info);
        if (type == ExtractType.streamNextInfo) {
            res = await new StreamNextInfo(clientInfo, data).fetch();
        } else if (type == ExtractType.streamInfo) {
            res = await new LoadStreamInfo(clientInfo, data).fetch();
        }
    }
    if (asyncId != null) {
        sendMessageToApp({
            asyncId: asyncId,
            cmd: 'returnAsyncResult',
            result: res,
        });
    }
    return res;
}

export function initExtractor() {
    if (window == null) {
        return;
    }
    let mWindow = window as any;
    mWindow.extractor = {
        checkSupport: checkSupport,
        supportNames: getSupportNames,
        extract: extract,
        version: 72
    }
}