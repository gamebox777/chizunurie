import Foundation
import Capacitor
import UnityAds
import UIKit

/**
 * Unity Ads のリワード動画・フッターバナーを WebView（リモートURLで動く frontend）から
 * 呼ぶための iOS 版プラグイン。Android 版 UnityAdsPlugin.java と API を揃えてある。
 *
 * frontend 側は frontend/src/lib/nativeRewardedAd.ts / nativeBannerAd.ts が
 * window.Capacitor.Plugins.UnityAds 経由で showRewarded() / showBanner() / hideBanner() を呼ぶ。
 * showRewarded() は Web 版 GPT（rewardedAd.ts）と同じ
 * { outcome: granted|dismissed|unavailable|error, detail? } を返す。
 * 報酬付与の検証は Web 版と同じ backend の nonce 方式をそのまま使う（このクラスは表示のみ）。
 *
 * リワードは起動時からプリロードしておき、在庫の有無（ready）を
 * getRewardedStatus() と "rewardedStatus" イベント（notifyListeners）で frontend に伝える。
 *
 * Unity の各 delegate コールバックは self（プラグイン＝アプリ生存中ずっと保持される）に
 * 流して扱うため、delegate の寿命管理（解放されてコールバックが来ない問題）が起きない。
 */
@objc(UnityAdsPlugin)
public class UnityAdsPlugin: CAPPlugin {

    // ── Unity Cloud ダッシュボードの Game ID / Ad Unit ID（iOS 用） ──────
    // 本番 iOS Game ID は 6133602（Android は別プロジェクト 6133603）。テスト広告は
    // testMode=true でこの本番 Game ID から配信される（Unity は昔の共有テスト用ゲーム
    // ID（14851 等）を廃止しており、現在は「自分の Game ID + testMode」でしか
    // テスト広告を出せない。14851 を渡すと GatewayResponseError で初期化失敗する）。
    //
    // 2026-06-14：当初デフォルト名の ad unit（Rewarded_iOS/Banner_iOS）を使ったが、
    // 初期化は成功するのに load が「unknown error（LoadError internal=1）/
    // UADSBannerError 0」で失敗した（Android の 6133603 で「デフォルト名 ad unit が
    // Network error で fill しない」のと同じ症状）。Android が別名 ad unit
    // （Rewarded_Chizunurie 等）に作り直して直したのと同様に、iOS（6133602）にも別名
    // ad unit を新規作成して下の定数を差し替えた。インタースティシャル
    // （Interstitial_ios_Chizunurie）は存在するが未使用。
    private let prodGameId = "6133602"
    private let rewardedId = "Rewarded_ios_Chizunurie"
    private let bannerId = "Banner_ios_Chizunurie"

    /// 初期化に使う Game ID（現状テスト/本番とも本番プロジェクト・testMode で出し分け）。
    private func gameId(forTestMode testMode: Bool) -> String {
        return prodGameId
    }
    /// 直近の初期化に使った Game ID（診断表示用）。
    private var activeGameId = ""

    // テスト広告/本広告の切り替え（実行時設定・UserDefaults に永続化）。
    // 既定は debug ビルド＝テスト広告・release ビルド＝本広告
    // （自分で実広告を視聴するとポリシー違反になり得るため）。
    // SDK は同一プロセスで一度しか initialize できないので、初期化後の切り替えは
    // 「アプリ再起動後」に反映される（requiresRestart で通知）。
    private let prefTestModeKey = "unity_ads_test_mode"

    // バナーサイズ（pt）。320x50 はスマホ標準のアンカーバナー。
    private let bannerWidth: CGFloat = 320
    private let bannerHeight: CGFloat = 50

    // 在庫なし時に load を再試行する間隔。
    private let reloadDelay: TimeInterval = 30

    // ── 状態（Unity のコールバックは基本メインスレッドだが、安全のため main で更新） ──
    private var initTestMode: Bool? // SDK 初期化に実際に使った値（未初期化なら nil）
    private var initState = "not_started" // not_started / initializing / initialized / failed
    private var initError: String?
    private var rewardedLoaded = false
    private var rewardedLoading = false
    private var rewardedLoadAttempts = 0
    private var lastRewardedLoadAt: Double = 0
    private var lastRewardedError: String?
    private var lastBannerError: String?

    // 表示中のフッターバナー（未表示なら nil）。
    private var bannerView: UADSBannerView?
    private var bannerCall: CAPPluginCall?

    // 初期化完了待ちのコールバック（複数の呼び出しが初期化中に重なる場合に備えてキュー）。
    private var pendingReady: [() -> Void] = []
    private var pendingFailed: [() -> Void] = []

    // 在庫が無いときに showRewarded された場合に保持する呼び出し（load 完了後に表示する）。
    private var pendingShowCall: CAPPluginCall?
    // 進行中のリワード表示の呼び出し。
    private var showCall: CAPPluginCall?

    /// デバッグ用ログ（debug ビルドのみ・os_log に出る。
    /// `log stream --predicate 'process == "App"'` で観測可能）。
    private func dbg(_ msg: String) {
        #if DEBUG
        NSLog("[UnityAdsPlugin] %@", msg)
        #endif
    }

    /// アプリ起動（プラグイン登録）時に SDK 初期化とリワードのプリロードを始めておく。
    override public func load() {
        dbg("load() called")
        whenInitialized(onReady: { [weak self] in self?.preloadRewarded() }, onFailed: {})
    }

    // ── 初期化 ────────────────────────────────────────────────────

    private func storedTestMode() -> Bool {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: prefTestModeKey) == nil {
            #if DEBUG
            return true
            #else
            return false
            #endif
        }
        return defaults.bool(forKey: prefTestModeKey)
    }

    /// いま広告に効いているテストモード。SDK 初期化後は初期化時の値で固定。
    private func effectiveTestMode() -> Bool {
        return initTestMode ?? storedTestMode()
    }

    /// SDK 初期化済みなら即 onReady。未初期化なら initialize して完了後に onReady を呼ぶ。
    private func whenInitialized(onReady: @escaping () -> Void, onFailed: @escaping () -> Void) {
        DispatchQueue.main.async {
            let testMode = self.storedTestMode()
            // テストモードは SDK の詳細ログを出す（load 失敗などの原因切り分け用）。
            UnityAds.setDebugMode(testMode)
            if UnityAds.isInitialized() {
                self.initState = "initialized"
                self.dbg("whenInitialized: already initialized -> onReady")
                onReady()
                return
            }
            self.pendingReady.append(onReady)
            self.pendingFailed.append(onFailed)
            if self.initState == "initializing" {
                self.dbg("whenInitialized: already initializing, queued")
                return // すでに初期化中。完了時にまとめて呼ぶ。
            }
            self.initTestMode = testMode // 以降このプロセスではこのモードで固定（再起動で切替反映）
            self.initState = "initializing"
            let gid = self.gameId(forTestMode: testMode)
            self.activeGameId = gid
            self.dbg("whenInitialized: calling UnityAds.initialize gameId=\(gid) testMode=\(testMode)")
            UnityAds.initialize(gid, testMode: testMode, initializationDelegate: self)
        }
    }

    private func flushInit(success: Bool) {
        let readies = pendingReady
        let faileds = pendingFailed
        pendingReady = []
        pendingFailed = []
        for cb in (success ? readies : faileds) { cb() }
    }

    // ── リワードのプリロード・在庫通知 ────────────────────────────

    /// 在庫状態の変化を frontend（addListener "rewardedStatus"）へ知らせる。
    private func notifyRewardedStatus() {
        notifyListeners("rewardedStatus", data: ["ready": rewardedLoaded])
    }

    /// リワードを1本プリロードする。失敗は reloadDelay 後に再試行し続ける。
    private func preloadRewarded() {
        if rewardedLoaded || rewardedLoading { return }
        rewardedLoading = true
        rewardedLoadAttempts += 1
        lastRewardedLoadAt = Date().timeIntervalSince1970 * 1000
        dbg("preloadRewarded: UnityAds.load \(rewardedId)")
        UnityAds.load(rewardedId, loadDelegate: self)
    }

    /// リワードの在庫が表示可能か（frontend のボタン活性/非活性の判定用）。
    @objc func getRewardedStatus(_ call: CAPPluginCall) {
        call.resolve(["ready": rewardedLoaded])
        // 万一プリロードが止まっていたら起こす。
        whenInitialized(onReady: { [weak self] in self?.preloadRewarded() }, onFailed: {})
    }

    /**
     * 広告の診断情報をまとめて返す（開発者デバッグメニューの「広告ステータス」表示用）。
     * 読み取りのみだが、ついでに止まっていたプリロードを起こす。
     */
    @objc func getAdDebugInfo(_ call: CAPPluginCall) {
        var ret: [String: Any] = [
            "sdkVersion": UnityAds.getVersion(),
            "initState": UnityAds.isInitialized() ? "initialized" : initState,
            "testMode": storedTestMode(),
            "effectiveTestMode": effectiveTestMode(),
            "isDebugBuild": isDebugBuild(),
            "gameId": activeGameId.isEmpty ? gameId(forTestMode: storedTestMode()) : activeGameId,
            "rewardedPlacementId": rewardedId,
            "bannerPlacementId": bannerId,
            "rewardedReady": rewardedLoaded,
            "rewardedLoading": rewardedLoading,
            "rewardedLoadAttempts": rewardedLoadAttempts,
            "bannerShown": bannerView != nil,
        ]
        if let initError = initError { ret["initError"] = initError }
        if lastRewardedLoadAt > 0 { ret["lastRewardedLoadAt"] = lastRewardedLoadAt }
        if let lastRewardedError = lastRewardedError { ret["lastRewardedError"] = lastRewardedError }
        if let lastBannerError = lastBannerError { ret["lastBannerError"] = lastBannerError }
        call.resolve(ret)
        whenInitialized(onReady: { [weak self] in self?.preloadRewarded() }, onFailed: {})
    }

    // ── テスト広告/本広告の切り替え（開発者デバッグ用） ─────────────

    /// 現在の広告モードを返す。requiresRestart=true なら保存値は次回起動から有効。
    @objc func getAdTestMode(_ call: CAPPluginCall) {
        call.resolve([
            "testMode": storedTestMode(),
            "effectiveTestMode": effectiveTestMode(),
            "requiresRestart": initTestMode != nil && initTestMode != storedTestMode(),
            "isDebugBuild": isDebugBuild(),
        ])
    }

    /// テスト広告モードを設定する（永続化）。SDK 初期化後の変更はアプリ再起動で反映。
    @objc func setAdTestMode(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        UserDefaults.standard.set(enabled, forKey: prefTestModeKey)
        call.resolve([
            "testMode": enabled,
            "requiresRestart": initTestMode != nil && initTestMode != enabled,
        ])
    }

    private func isDebugBuild() -> Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    // ── リワード表示 ──────────────────────────────────────────────

    @objc func showRewarded(_ call: CAPPluginCall) {
        whenInitialized(
            onReady: { [weak self] in
                guard let self = self else { return }
                if self.rewardedLoaded {
                    // プリロード済みをそのまま表示（通常経路）。
                    self.showLoadedRewarded(call)
                } else {
                    // 在庫なしで押された場合は load 完了後に表示する（旧経路・レース対策）。
                    self.pendingShowCall = call
                    self.preloadRewarded()
                }
            },
            onFailed: { self.resolveOutcome(call, "error", "init_failed") }
        )
    }

    /// プリロード済みリワードを表示し、消費後に次の1本をプリロードする。
    private func showLoadedRewarded(_ call: CAPPluginCall) {
        rewardedLoaded = false
        notifyRewardedStatus()
        showCall = call
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                self.showCall = nil
                self.resolveOutcome(call, "unavailable", "show_failed")
                self.preloadRewarded()
                return
            }
            UnityAds.show(vc, placementId: self.rewardedId, showDelegate: self)
        }
    }

    private func resolveOutcome(_ call: CAPPluginCall, _ outcome: String, _ detail: String?) {
        var ret: [String: Any] = ["outcome": outcome]
        if let detail = detail { ret["detail"] = detail }
        call.resolve(ret)
    }

    // ── フッターバナー ────────────────────────────────────────────
    // 320x50 のバナーを画面下中央に固定表示する。Capacitor の WebView は
    // ViewController の root view（view = webView）なので、バナーは webView の
    // subview として最下部に重ね、ViewController の additionalSafeAreaInsets.bottom を
    // バナー高ぶん広げて Web 側の UI（safe-area-inset-bottom 参照）をバナーの上へ押し上げる。
    // 戻り値は { shown: boolean, detail?: string }。

    @objc func showBanner(_ call: CAPPluginCall) {
        dbg("showBanner called")
        whenInitialized(
            onReady: { [weak self] in
                guard let self = self else { return }
                self.dbg("showBanner: onReady, creating UADSBannerView \(self.bannerId)")
                DispatchQueue.main.async {
                    if self.bannerView != nil {
                        // 既に表示中なら何もしない（多重呼び出し対策）。
                        call.resolve(["shown": true])
                        return
                    }
                    self.bannerCall = call
                    let banner = UADSBannerView(
                        placementId: self.bannerId,
                        size: CGSize(width: self.bannerWidth, height: self.bannerHeight)
                    )
                    banner.delegate = self
                    self.bannerView = banner
                    banner.load()
                }
            },
            onFailed: { call.resolve(["shown": false, "detail": "init_failed"]) }
        )
    }

    @objc func hideBanner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let banner = self.bannerView {
                banner.removeFromSuperview()
                self.bannerView = nil
                self.setWebViewBottomInset(0)
            }
            call.resolve()
        }
    }

    /// ロード済みバナーを webView の最下部中央に載せ、Web 側 UI を押し上げる。
    private func attachBanner(_ banner: UADSBannerView) {
        guard let host = bridge?.viewController?.view else {
            dbg("attachBanner: NO host view")
            return
        }
        dbg("attachBanner: host=\(type(of: host))")
        banner.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            banner.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            banner.widthAnchor.constraint(equalToConstant: bannerWidth),
            banner.heightAnchor.constraint(equalToConstant: bannerHeight),
        ])
        setWebViewBottomInset(bannerHeight)
    }

    /// ViewController の追加セーフエリア下端を変える＝WKWebView の env(safe-area-inset-bottom)
    /// が広がり、frontend の下部 UI がバナーの上に逃げる。
    private func setWebViewBottomInset(_ inset: CGFloat) {
        bridge?.viewController?.additionalSafeAreaInsets.bottom = inset
    }
}

// ── Unity Ads delegate ───────────────────────────────────────────

extension UnityAdsPlugin: UnityAdsInitializationDelegate {
    public func initializationComplete() {
        dbg("initializationComplete")
        initState = "initialized"
        initError = nil
        flushInit(success: true)
    }

    public func initializationFailed(_ error: UnityAdsInitializationError, withMessage message: String) {
        dbg("initializationFailed: \(error.rawValue): \(message)")
        initState = "failed"
        initError = "\(error.rawValue): \(message)"
        flushInit(success: false)
    }
}

extension UnityAdsPlugin: UnityAdsLoadDelegate {
    public func unityAdsAdLoaded(_ placementId: String) {
        dbg("unityAdsAdLoaded: \(placementId)")
        rewardedLoading = false
        rewardedLoaded = true
        lastRewardedError = nil
        if let call = pendingShowCall {
            // 在庫なしで押された呼び出しが待っていた → そのまま表示する。
            pendingShowCall = nil
            showLoadedRewarded(call)
        } else {
            notifyRewardedStatus()
        }
    }

    public func unityAdsAdFailed(toLoad placementId: String, withError error: UnityAdsLoadError, withMessage message: String) {
        dbg("unityAdsAdFailed(load): \(placementId) err=\(error.rawValue) msg=\(message)")
        rewardedLoading = false
        rewardedLoaded = false
        lastRewardedError = "\(error.rawValue): \(message)"
        if let call = pendingShowCall {
            // 表示待ちの呼び出しには「在庫なし」を返す（Web 版の ready_timeout 相当）。
            pendingShowCall = nil
            resolveOutcome(call, "unavailable", "load_failed")
        } else {
            notifyRewardedStatus()
            DispatchQueue.main.asyncAfter(deadline: .now() + reloadDelay) { [weak self] in
                self?.preloadRewarded()
            }
        }
    }
}

extension UnityAdsPlugin: UnityAdsShowDelegate {
    public func unityAdsShowComplete(_ placementId: String, withFinish state: UnityAdsShowCompletionState) {
        if let call = showCall {
            showCall = nil
            if state == .showCompletionStateCompleted {
                resolveOutcome(call, "granted", nil)
            } else {
                // skipped＝最後まで見ずに閉じた（報酬なし）
                resolveOutcome(call, "dismissed", nil)
            }
        }
        preloadRewarded()
    }

    public func unityAdsShowFailed(_ placementId: String, withError error: UnityAdsShowError, withMessage message: String) {
        if let call = showCall {
            showCall = nil
            resolveOutcome(call, "unavailable", "show_failed")
        }
        preloadRewarded()
    }

    public func unityAdsShowStart(_ placementId: String) {}
    public func unityAdsShowClick(_ placementId: String) {}
}

extension UnityAdsPlugin: UADSBannerViewDelegate {
    public func bannerViewDidLoad(_ bannerView: UADSBannerView) {
        // load 完了後にビュー階層へ載せる（在庫なしのとき空白を出さない）。
        dbg("bannerViewDidLoad")
        lastBannerError = nil
        attachBanner(bannerView)
        bannerCall?.resolve(["shown": true])
        bannerCall = nil
    }

    public func bannerViewDidError(_ bannerView: UADSBannerView, error: UADSBannerError) {
        dbg("bannerViewDidError: \(error.localizedDescription)")
        lastBannerError = error.localizedDescription
        if self.bannerView === bannerView { self.bannerView = nil }
        bannerView.removeFromSuperview()
        bannerCall?.resolve(["shown": false, "detail": "load_failed"])
        bannerCall = nil
    }

    public func bannerViewDidClick(_ bannerView: UADSBannerView) {}
    public func bannerViewDidLeaveApplication(_ bannerView: UADSBannerView) {}
}
