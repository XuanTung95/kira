import {ClientInfo} from './src/extractor_data';
import {StreamNextInfo} from './src/stream_next_info';

enum ExtractType {
    streamNextInfo = 'streamNextInfo',
}

function checkSupport(type: string | null, data: any) {
    if (type == ExtractType.streamNextInfo) {
        return true;
    }
    if (type == null || data == null) {
        return false;
    }
    return false;
}

async function extract(type: string, data: any) {
    let proxyFetch = (window as any).proxyFetch;
    if (proxyFetch) {
        let clientInfo = new ClientInfo(data?.info);
        if (type == ExtractType.streamNextInfo) {
            let res = await new StreamNextInfo(clientInfo, data).fetch();
            return res;
        }
        let res: Response = await proxyFetch('https://abc.com', {
            method: 'POST',
            headers: {
            },
            body: {
                'test': true,
                'type': type,
                'data': data
            }
        });
        let json = await res.json();
        console.log('json', json);
        return json;
    }
    return null;
}

export function initExtractor() {
    if (window == null) {
        return;
    }
    let mWindow = window as any;
    mWindow.extractor = {
        checkSupport: checkSupport,
        extract: extract,
    }
}