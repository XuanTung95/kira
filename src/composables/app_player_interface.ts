

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
    } : {
        load: (id: string) => Promise<void>;
        playerComponents: any;
        controlPlayer: (cmd: string, _data: any) => any;
    }) {
        if (window != null) {
            let mWindow = (window as any);

            function resumePlayerIfNeeded() {
                let duration = Date.now() - (mWindow.appPlayer?.playHistory?.lastPause ?? 0);
                console.log('duration', duration);
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
                }
            }

            mWindow.handleAppCmd = (data: any) => {
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
                }
            }

            mWindow.appPlayer = {
                playerComponents: playerComponents,
                load: load,
                playHistory: {
                    lastPlay: 0,
                    lastPause: 0,
                },
                controller: controller,
            };
            if (mWindow.onPlayerStateChanged == null) {
                mWindow.onPlayerStateChanged = (state: any) => {
                    /// state.status: unloading/buffering/progress/ended
                    let status = state.status;
                    // console.log(`onPlayerState ${status}`);
                    if (status == 'pause') {
                        sendMessageToApp({
                            cmd: 'statusChanged',
                            status: status,
                        });
                        mWindow.appPlayer.playHistory.lastPause = Date.now();
                    } else if (status == 'progress') {
                        sendMessageToApp({
                            cmd: 'progressChanged',
                            state: state,
                        });
                        mWindow.appPlayer.playHistory.lastPlay = Date.now();
                    }
                };
            }
            mWindow.onKiraPlayerEnded = (_event: any) => {
                console.log("call onKiraPlayerEnded");
                controller.startSilencePlayer();
            }

            mWindow.sendMessageToApp = sendMessageToApp;
        }
    }
    return {
        initInterface: initInterface,
    };
}