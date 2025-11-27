
function checkSupport(type: string | null, data: any) {
    if (type == null) {
        return true;
    }
    return true;
}

async function extract(type: string, data: any) {
    let proxyFetch = (window as any).proxyFetch;
    if (proxyFetch) {
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