import { type ApiResponse, Constants, Utils, YT } from 'youtubei.js/web';

let _preloadData : PreloadData = {
    videoId: null,
    response: null,
};

interface PreloadData {
  videoId: string | null;
  response: ApiResponse | null;
}

export function preloadVideo(videoId: string | null, responseFuture: () => Promise<ApiResponse>) {
    if (videoId != null && videoId != _preloadData.videoId) {
        _preloadData.videoId = videoId;
        _preloadData.response = null;
        responseFuture().then(response => {
            if (_preloadData.videoId == videoId) {
                console.log(`preloadVideo success ${videoId}`);
                _preloadData.response = response;
            }
        })
    }
}

export function getPreloadVideo(videoId: string | null) : ApiResponse | null {
    if (videoId != null && videoId == _preloadData.videoId) {
        console.log(`getPreloadVideo success ${videoId}`);
        return _preloadData.response;
    }
    return null;
}