import {fetchFunction } from '@/utils/helpers';

let _requestId: number = 0;

type PendingPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
};

const promiseMap = new Map<number, PendingPromise<any>>();

function createPromise<T>(id: number): Promise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promiseMap.set(id, { promise, resolve, reject});
  return promise;
}

function completePromise(id: number, value: any) {
  const item = promiseMap.get(id);
  if (item) {
    item.resolve(value);
  }
}

export function getNewRequestId() {
    return _requestId++;
}

let historyPlayback = {
    firstPlayingInitId: '',
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function proxyFetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
    if (window == null || !(window as any).flutter_inappwebview?.callHandler) {
        return fetchFunction(input, init, true);
    }
    let requestId = getNewRequestId();
    const url =
        input instanceof URL
        ? input.toString()
        : typeof input === 'string'
        ? input
        : input.url;

    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const headers: Record<string, string> = {};

    if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((value, key) => (headers[key] = value));
    } else if (input instanceof Request) {
        input.headers.forEach((value, key) => (headers[key] = value));
    }

    let body: any = init?.body;
    let bodyBase64 = null;
    if (body && body instanceof ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(body);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        bodyBase64 = btoa(binary);
    } else if (body && typeof body !== 'string') {
        let raw: string;
        if (body instanceof Blob) {
            raw = await body.text();
        } else if (body instanceof FormData) {
            const obj: Record<string, any> = {};
            body.forEach((v, k) => (obj[k] = v));
            raw = JSON.stringify(obj);
        } else {
            raw = JSON.stringify(body);
        }
        body = raw;
    }

    if (headers['user-agent'] == null) {
        headers['user-agent'] = navigator.userAgent;
    }

    let cmd = 'proxy';
    const req = { id: requestId, cmd, url, method, headers, body: bodyBase64 == null ? body : null, bodyBase64 };
    try {
        createPromise(requestId);
        const res = await (window as any).flutter_inappwebview.callHandler(
            'sendToApp',
            req,
        );
        if (res != null) {
            let id = res.id;
            let status = res.status;
            let body = res.body;
            let bodyType = res.bodyType;
            let headers = res.headers;
            if (bodyType == 'base64') {
                if (body != null) {
                    body = base64ToArrayBuffer(body);
                }
            }
                let finalBody = body;
                if (bodyType == 'webMessage') {
                    let promise = promiseMap.get(requestId);
                    if (promise != null) {
                        let data = await promise.promise;
                        finalBody = data;
                    }
                }
                let response = new Response(finalBody, {
                    status: status,
                    headers: headers,
                    statusText: res.statusText ?? 'OK',
                });
                promiseMap.delete(requestId);
                /*
                Object.defineProperties(response, {
                    ok: { value: status >= 200 && status < 300 },
                    redirected: { value: false },
                    type: { value: 'cors' },
                    url: { value: res.url ?? '' },
                });
                */
                return response;
        }
    } catch (e) {
        console.log('app proxy error', e);
    }
    
    return fetchFunction(input, init, true);
}

function injectProxyFunction() {
    console.log('injectProxyFunction');
    (window as any).proxyFetch = proxyFetch;
}

async function initEnv() {
    if (window == null || !(window as any).flutter_inappwebview?.callHandler) {
        return;
    }
    const res = await (window as any).flutter_inappwebview.callHandler(
        'sendToApp',
        {
            cmd: 'initEnv',
        },
    );
    console.log('sendToApp res', JSON.stringify(res))
    if (res.useWebMessage == true) {
        /// use webmessage
    }
    if (res.injectProxy == true) {
        injectProxyFunction();
    }
    if (res.playerSetting != null) {
        (window as any).playerSetting = res.playerSetting;
    }
}

async function initEnvIfNeeded() {
    if ((window as any).proxyFetch != null) {
        return;
    }
    return initEnv();
}

export function initWebMessage() {
    let mWindow = (window as any);
    if (mWindow != null && mWindow.webMessageData == null) {
        mWindow.webMessageData = {
            support: false,
            onReceiveData: null,
        }
        let flutter_inappwebview = mWindow.flutter_inappwebview;
        if (flutter_inappwebview != null) {
            flutter_inappwebview.callHandler('sendToApp', {
                'cmd': 'testWebMessage',
            });
            mWindow.addEventListener('message', function(event: any) {
                if (event.data instanceof ArrayBuffer) {
                    if (mWindow.webMessageData.support == false) {
                        if (event.data.byteLength == 2) {
                            const view = new Uint8Array(event.data);
                            if (view.length == 2 && view[0] == 9 && view[1] == 5) {
                                mWindow.webMessageData.support = true;
                                let flutter_inappwebview = mWindow.flutter_inappwebview;
                                if (flutter_inappwebview != null) {
                                    flutter_inappwebview.callHandler('sendToApp', {
                                        'cmd': 'supportWebMessage',
                                        'support': true
                                    });
                                }
                            }
                        }
                    } else {
                        let buffer = event.data;
                        const view = new DataView(buffer);
                        const id = view.getUint32(0, false);
                        const originalBuffer = buffer.slice(4);
                        completePromise(id, originalBuffer);
                    }
                }
            }, false);
        }
    }
}

export function useAppPlayerInit() {
    return {
        initEnvIfNeeded: initEnvIfNeeded,
        injectProxyFunction: injectProxyFunction,
    };
}

export function useAppPlayerInterface() {
    function sendMessageToApp(data: any) {
        let flutter_inappwebview = (window as any)?.flutter_inappwebview;
        if (flutter_inappwebview != null) {
            flutter_inappwebview.callHandler('sendToApp', data);
        }
    }

    function initInterface({
        load,
        playerComponents,
        controlPlayer,
        initVideoId,
    } : {
        load: (id: string) => Promise<void>;
        playerComponents: any;
        controlPlayer: (cmd: string, _data: any) => any;
        initVideoId?: string,
    }) {
        if (window != null) {
            let mWindow = (window as any);

            function resumePlayerIfNeeded() {
                let duration = Date.now() - (mWindow.appPlayer?.playHistory?.lastPause ?? 0);
                console.log('resumePlayer duration', duration);
                if (duration < 1000) {
                    controlPlayer('play', null);
                }
            }

            let controller = {
                play: () => {
                    controlPlayer('play', null);
                },
                pause: () => {
                    controlPlayer('pause', null);
                },
                seekTo: (data: number) => {
                    controlPlayer('seekTo', data);
                },
                startSilencePlayer: () => {
                    controlPlayer('startSilencePlayer', null);
                },
                getTracks: () => {
                    return controlPlayer('getTracks', null);
                },
                selectTrack: (data: any) => {
                    return controlPlayer('selectTrack', data);
                },
                selectSpeed: (data: any) => {
                    return controlPlayer('selectSpeed', data);
                },
                setLoop: (data: any) => {
                    return controlPlayer('setLoop', data);
                },
                enablePip: (data: any) => {
                    return controlPlayer('enablePip', data);
                }
            }

            mWindow.handleAppCmd = async (data: any) => {
                let cmd = data.cmd;
                if (cmd == 'appLifecycleState') {
                    let state = data.state;
                    if (state == 'paused') {
                        resumePlayerIfNeeded();
                    } else if (state == 'resumed') {
                        resumePlayerIfNeeded();
                    }
                } else if (cmd == 'controller') {
                    let action = data.action;
                    if (action == 'play') {
                        controller.play();
                    } else if (action == 'pause') {
                        controller.pause();
                    } else if (action == 'seekTo') {
                        let actionData = data.data;
                        controller.seekTo(actionData);
                    }
                } else if (cmd == 'preLoadVideo') {
                    let videoId = data.videoId;
                    /// TODO: preload videoId
                } else if (cmd == 'getPlaybackInfo') {
                    /// TODO: return playback info
                    return {
                        cmd: cmd,
                        data: 'test',
                    }
                } else if (cmd == 'getTracks') {
                    return controller.getTracks();
                } else if (cmd == 'selectTrack') {
                    return controller.selectTrack(data);
                } else if (cmd == 'selectSpeed') {
                    return controller.selectSpeed(data);
                } else if (cmd == 'setLoop') {
                    return controller.setLoop(data);
                } else if (cmd == 'enablePip') {
                    return controller.enablePip(data);
                }
            }

            function loadVideo(videoId: string, height?: number, language?: string) {
                if (mWindow.appPlayer != null) {
                    mWindow.appPlayer.videoId = videoId;
                    if (height != null) {
                        mWindow.playerSetting.defaultHeight = height;
                    }
                    if (language != null) {
                        mWindow.playerSetting.language = height;
                    }
                }
                load(videoId);
            }
            if (mWindow.playerSetting == null) {
                mWindow.playerSetting = {
                    language: null,
                    defaultHeight: 720,
                }
            }
            if (mWindow.appPlayer == null) {
                mWindow.appPlayer = {
                    videoId: initVideoId,
                    playerComponents: playerComponents,
                    loadVideo: loadVideo,
                    playHistory: {
                        lastPlay: 0,
                        lastPause: 0,
                    },
                    controller: controller,
                };
            }
            mWindow.appPlayer.playerComponents = playerComponents;
            mWindow.appPlayer.loadVideo = loadVideo;
            mWindow.appPlayer.controller = controller;

            if (mWindow.onPlayerStateChanged == null) {
                mWindow.onPlayerStateChanged = (state: any) => {
                    /// state.status: unloading/buffering/progress/ended
                    let status = state.status;
                    if (status != 'progress') {
                        console.log(`onPlayerState ${status}`);
                    }
                    if (status == 'pause' || status == 'paused') {
                        sendMessageToApp({
                            cmd: 'statusChanged',
                            status: status,
                        });
                        mWindow.appPlayer.playHistory.lastPause = Date.now();
                    } else if (status == 'playing') {
                        sendMessageToApp({
                            cmd: 'statusChanged',
                            status: status,
                        });
                        mWindow.appPlayer.playHistory.lastPlay = Date.now();
                    } else if (status == 'progress') {
                        sendMessageToApp({
                            cmd: 'progressChanged',
                            state: state,
                        });
                        mWindow.appPlayer.playHistory.lastPlay = Date.now();
                    } else if (status == 'ended') {
                        sendMessageToApp({
                            cmd: 'statusChanged',
                            status: status,
                        });
                    } else if (status == 'trackschanged') {
                        let tracks = controller.getTracks();
                        if (historyPlayback.firstPlayingInitId != mWindow.appPlayer.videoId) {
                            historyPlayback.firstPlayingInitId = mWindow.appPlayer.videoId;
                            controller.selectTrack({
                                height: mWindow.playerSetting.defaultHeight,
                                language: mWindow.playerSetting.language,
                            });
                        }
                        sendMessageToApp({
                            cmd: 'getTracks',
                            tracks: tracks,
                        });
                    }
                };
            }

            mWindow.sendMessageToApp = sendMessageToApp;
        }
    }

    return {
        initInterface: initInterface,
        injectProxyFunction: injectProxyFunction,
    };
}