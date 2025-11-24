
export function initExtractor() {
    if (window == null) {
        return;
    }
    let mWindow = window as any;
    mWindow.extractor = {
        support: true,
    }
}