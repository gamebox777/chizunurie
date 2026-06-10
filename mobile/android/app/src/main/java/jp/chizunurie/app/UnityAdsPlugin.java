package jp.chizunurie.app;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.IUnityAdsInitializationListener;
import com.unity3d.ads.IUnityAdsLoadListener;
import com.unity3d.ads.IUnityAdsShowListener;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsShowOptions;
import com.unity3d.services.banners.BannerErrorInfo;
import com.unity3d.services.banners.BannerView;
import com.unity3d.services.banners.UnityBannerSize;

/**
 * Unity Ads のリワード動画・フッターバナーを WebView（リモートURLで動く frontend）から
 * 呼ぶためのプラグイン。
 *
 * frontend 側は frontend/src/lib/nativeRewardedAd.ts / nativeBannerAd.ts が
 * window.Capacitor.Plugins.UnityAds 経由で showRewarded() / showBanner() / hideBanner() を呼ぶ。
 * showRewarded() は Web 版 GPT（rewardedAd.ts）と同じ
 * { outcome: granted|dismissed|unavailable|error, detail? } を返す。
 * 報酬付与の検証は Web 版と同じ backend の nonce 方式をそのまま使う（このクラスは表示のみ）。
 *
 * リワードは起動時からプリロードしておき、在庫の有無（ready）を
 * getRewardedStatus() と "rewardedStatus" イベント（notifyListeners）で frontend に伝える。
 * frontend は ready になるまで「広告を見て回復」ボタンを非活性にする。
 */
@CapacitorPlugin(name = "UnityAds")
public class UnityAdsPlugin extends Plugin {

    /**
     * テスト広告/本広告の切り替え（実行時設定）。
     *
     * 既定は debug ビルド＝テスト広告・release ビルド＝本広告
     * （自分で実広告を視聴するとポリシー違反になり得るため）。
     * 開発者デバッグメニュー（frontend）から setAdTestMode() でどちらのビルドでも
     * 切り替えられる。設定は SharedPreferences に永続化する。
     * Unity Ads SDK は同一プロセスで一度しか initialize できないため、
     * SDK 初期化後の切り替えは「アプリ再起動後」に反映される（requiresRestart で通知）。
     */
    private static final String PREFS_NAME = "unity_ads";
    private static final String PREF_TEST_MODE = "test_mode";

    /**
     * Unity Cloud ダッシュボードの Game ID / Ad Unit ID（2026-06-10 ダッシュボードで確認済み）。
     *
     * このクラスは Android 専用なので Android 側の値を使う。iOS 版を作るときは
     * Game ID 6133602・`Rewarded_iOS`・`Banner_iOS` を使うこと（インタースティシャルは
     * `Interstitial_Android`/`Interstitial_iOS` が存在するが未使用。動画はリワード型を使う方針）。
     *
     * ⚠ 2026-06-10 時点、本番 Game ID 6133603 は広告ユニット作成後も load が
     * 「INTERNAL_ERROR/NATIVE_ERROR: ... Network error occurred」で失敗する
     * （SDK 初期化は成功する）。Unity フォーラムに同症状の報告あり（2026-05・SDK 4.17系）：
     * 「新規作成のダッシュボードプロジェクトでのみ発生・旧プロジェクトの ID なら動く」
     * 「デフォルト名の Ad Unit をやめて別名で新規作成したら直った」
     * https://discussions.unity.com/t/ads-loading-failed/1718865
     * → 対処はまず Ad Unit を別名（例 Rewarded_Chizunurie）で作り直して下の定数を差し替え。
     *   次にダッシュボードの Monetization 設定（ストア URL・COPPA 回答）の完了確認、
     *   それでもダメなら Unity サポートへチケット。
     * 切り分けには開発者デバッグメニューの「広告ステータス」（getAdDebugInfo）を使う。
     * そのためテストモードは Unity 公式のテスト用ゲーム（14851）に固定し、テスト広告で
     * 機能確認できるようにしている。本番 ID 側が直ったら、テストモードも本番 ID ＋
     * testMode=true（テスト広告が出る）に戻してよい。
     */
    private static final String PROD_GAME_ID = "6133603"; // Android（iOS は 6133602）
    private static final String PROD_REWARDED_ID = "Rewarded_Android"; // iOS は Rewarded_iOS
    private static final String PROD_BANNER_ID = "Banner_Android"; // iOS は Banner_iOS

    // Unity 公式のテスト用ゲーム（必ずテスト広告がフィルする）。
    private static final String TEST_GAME_ID = "14851";
    private static final String TEST_REWARDED_ID = "rewardedVideo";
    private static final String TEST_BANNER_ID = "bannerads";

    /** SDK の initialize に実際に使ったテストモード（未初期化なら null）。 */
    private volatile Boolean initTestMode = null;

    /** 保存済みのテストモード設定（未保存ならビルド種別に従う）。 */
    private boolean storedTestMode() {
        return getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(PREF_TEST_MODE, BuildConfig.DEBUG);
    }

    /** いま広告に効いているテストモード。SDK 初期化後は初期化時の値で固定。 */
    private boolean effectiveTestMode() {
        Boolean init = initTestMode;
        return init != null ? init : storedTestMode();
    }

    private String gameId() {
        return effectiveTestMode() ? TEST_GAME_ID : PROD_GAME_ID;
    }

    private String rewardedPlacementId() {
        return effectiveTestMode() ? TEST_REWARDED_ID : PROD_REWARDED_ID;
    }

    private String bannerPlacementId() {
        return effectiveTestMode() ? TEST_BANNER_ID : PROD_BANNER_ID;
    }

    /** バナーサイズ（dp）。320x50 はスマホ標準のアンカーバナー。 */
    private static final int BANNER_WIDTH_DP = 320;
    private static final int BANNER_HEIGHT_DP = 50;

    /** リワードの在庫が無いときに load を再試行する間隔。 */
    private static final long REWARDED_RELOAD_DELAY_MS = 30_000;

    /** 表示中のフッターバナー（未表示なら null）。UI スレッドからのみ触る。 */
    private BannerView bannerView;

    /** プリロード済みリワードの在庫状態。Unity のコールバックスレッドからも触るので volatile。 */
    private volatile boolean rewardedLoaded = false;
    private volatile boolean rewardedLoading = false;

    // ── 診断情報（デバッグメニューの「広告ステータス」表示用） ──────
    /** SDK 初期化の進行状態：not_started / initializing / initialized / failed */
    private volatile String initState = "not_started";
    /** 初期化失敗の内容（"エラー種別: メッセージ"・成功時 null） */
    private volatile String initError = null;
    /** リワード load の試行回数（プリロード分のみ） */
    private volatile int rewardedLoadAttempts = 0;
    /** リワード load の最終試行時刻（epoch ms・未試行は 0） */
    private volatile long lastRewardedLoadAt = 0;
    /** リワード load の最終エラー（成功で null に戻す） */
    private volatile String lastRewardedError = null;
    /** バナー load の最終エラー（成功で null に戻す） */
    private volatile String lastBannerError = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** アプリ起動（プラグイン登録）時に SDK 初期化とリワードのプリロードを始めておく。 */
    @Override
    public void load() {
        whenInitialized(this::preloadRewarded, () -> {});
    }

    private void resolveOutcome(PluginCall call, String outcome, String detail) {
        JSObject ret = new JSObject();
        ret.put("outcome", outcome);
        if (detail != null) ret.put("detail", detail);
        call.resolve(ret);
    }

    /** SDK 初期化済みなら即 onReady。未初期化なら initialize して完了後に onReady を呼ぶ。 */
    private void whenInitialized(Runnable onReady, Runnable onFailed) {
        boolean testMode = storedTestMode();
        // テストモードは SDK の詳細ログを logcat に出す（load 失敗などの原因切り分け用）。
        UnityAds.setDebugMode(testMode);
        if (UnityAds.isInitialized()) {
            initState = "initialized";
            onReady.run();
            return;
        }
        initTestMode = testMode; // 以降このプロセスではこのモードで固定（再起動で切替反映）
        initState = "initializing";
        UnityAds.initialize(
            getContext().getApplicationContext(),
            gameId(),
            testMode,
            new IUnityAdsInitializationListener() {
                @Override
                public void onInitializationComplete() {
                    initState = "initialized";
                    initError = null;
                    onReady.run();
                }

                @Override
                public void onInitializationFailed(
                    UnityAds.UnityAdsInitializationError error,
                    String message
                ) {
                    initState = "failed";
                    initError = error + ": " + message;
                    onFailed.run();
                }
            }
        );
    }

    // ── リワードのプリロード・在庫通知 ────────────────────────────

    /** 在庫状態の変化を frontend（addListener "rewardedStatus"）へ知らせる。 */
    private void notifyRewardedStatus() {
        JSObject data = new JSObject();
        data.put("ready", rewardedLoaded);
        notifyListeners("rewardedStatus", data);
    }

    /**
     * リワードを1本プリロードする。失敗（在庫なし・ネットワーク不通）は
     * REWARDED_RELOAD_DELAY_MS 後に再試行し続ける（在庫が入り次第 ready を通知）。
     */
    private void preloadRewarded() {
        if (rewardedLoaded || rewardedLoading) return;
        rewardedLoading = true;
        rewardedLoadAttempts++;
        lastRewardedLoadAt = System.currentTimeMillis();
        UnityAds.load(
            rewardedPlacementId(),
            new IUnityAdsLoadListener() {
                @Override
                public void onUnityAdsAdLoaded(String placementId) {
                    rewardedLoading = false;
                    rewardedLoaded = true;
                    lastRewardedError = null;
                    notifyRewardedStatus();
                }

                @Override
                public void onUnityAdsFailedToLoad(
                    String placementId,
                    UnityAds.UnityAdsLoadError error,
                    String message
                ) {
                    rewardedLoading = false;
                    rewardedLoaded = false;
                    lastRewardedError = error + ": " + message;
                    notifyRewardedStatus();
                    mainHandler.postDelayed(
                        UnityAdsPlugin.this::preloadRewarded,
                        REWARDED_RELOAD_DELAY_MS
                    );
                }
            }
        );
    }

    /** リワードの在庫が表示可能か（frontend のボタン活性/非活性の判定用）。 */
    @PluginMethod
    public void getRewardedStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", rewardedLoaded);
        call.resolve(ret);
        // 万一プリロードが止まっていたら起こす（初期化失敗後の復帰など）。
        whenInitialized(this::preloadRewarded, () -> {});
    }

    /**
     * 広告の診断情報をまとめて返す（開発者デバッグメニューの「広告ステータス」表示用）。
     * 本番 Game ID で load が失敗する等の原因切り分けに使う。読み取りのみだが、
     * プリロードが止まっていたらついでに起こす（再試行の起点を兼ねる）。
     */
    @PluginMethod
    public void getAdDebugInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdkVersion", UnityAds.getVersion());
        ret.put("initState", UnityAds.isInitialized() ? "initialized" : initState);
        if (initError != null) ret.put("initError", initError);
        ret.put("testMode", storedTestMode());
        ret.put("effectiveTestMode", effectiveTestMode());
        ret.put("isDebugBuild", BuildConfig.DEBUG);
        ret.put("gameId", gameId());
        ret.put("rewardedPlacementId", rewardedPlacementId());
        ret.put("bannerPlacementId", bannerPlacementId());
        ret.put("rewardedReady", rewardedLoaded);
        ret.put("rewardedLoading", rewardedLoading);
        ret.put("rewardedLoadAttempts", rewardedLoadAttempts);
        if (lastRewardedLoadAt > 0) ret.put("lastRewardedLoadAt", lastRewardedLoadAt);
        if (lastRewardedError != null) ret.put("lastRewardedError", lastRewardedError);
        ret.put("bannerShown", bannerView != null);
        if (lastBannerError != null) ret.put("lastBannerError", lastBannerError);
        call.resolve(ret);
        whenInitialized(this::preloadRewarded, () -> {});
    }

    // ── テスト広告/本広告の切り替え（開発者デバッグ用） ─────────────

    /** 現在の広告モードを返す。requiresRestart=true なら保存値は次回起動から有効。 */
    @PluginMethod
    public void getAdTestMode(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("testMode", storedTestMode());
        ret.put("effectiveTestMode", effectiveTestMode());
        ret.put("requiresRestart", initTestMode != null && initTestMode != storedTestMode());
        ret.put("isDebugBuild", BuildConfig.DEBUG);
        call.resolve(ret);
    }

    /** テスト広告モードを設定する（永続化）。SDK 初期化後の変更はアプリ再起動で反映。 */
    @PluginMethod
    public void setAdTestMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_TEST_MODE, enabled)
            .apply();
        JSObject ret = new JSObject();
        ret.put("testMode", enabled);
        ret.put("requiresRestart", initTestMode != null && initTestMode != enabled);
        call.resolve(ret);
    }

    // ── リワード表示 ──────────────────────────────────────────────

    @PluginMethod
    public void showRewarded(PluginCall call) {
        whenInitialized(
            () -> {
                if (rewardedLoaded) {
                    // プリロード済みをそのまま表示（通常経路）。
                    showLoadedRewarded(call);
                } else {
                    // 在庫なしで押された場合（旧 frontend・レース）は従来どおり load→show。
                    loadAndShow(call);
                }
            },
            () -> resolveOutcome(call, "error", "init_failed")
        );
    }

    /** プリロード済みリワードを表示し、消費後に次の1本をプリロードする。 */
    private void showLoadedRewarded(PluginCall call) {
        rewardedLoaded = false;
        notifyRewardedStatus();
        getActivity().runOnUiThread(() ->
            UnityAds.show(
                getActivity(),
                rewardedPlacementId(),
                new UnityAdsShowOptions(),
                makeShowListener(call)
            )
        );
    }

    private IUnityAdsShowListener makeShowListener(PluginCall call) {
        return new IUnityAdsShowListener() {
            @Override
            public void onUnityAdsShowFailure(
                String pid,
                UnityAds.UnityAdsShowError error,
                String message
            ) {
                resolveOutcome(call, "unavailable", "show_failed");
                preloadRewarded();
            }

            @Override
            public void onUnityAdsShowStart(String pid) {}

            @Override
            public void onUnityAdsShowClick(String pid) {}

            @Override
            public void onUnityAdsShowComplete(
                String pid,
                UnityAds.UnityAdsShowCompletionState state
            ) {
                if (state == UnityAds.UnityAdsShowCompletionState.COMPLETED) {
                    resolveOutcome(call, "granted", null);
                } else {
                    // SKIPPED＝最後まで見ずに閉じた（報酬なし）
                    resolveOutcome(call, "dismissed", null);
                }
                preloadRewarded();
            }
        };
    }

    private void loadAndShow(PluginCall call) {
        UnityAds.load(
            rewardedPlacementId(),
            new IUnityAdsLoadListener() {
                @Override
                public void onUnityAdsAdLoaded(String placementId) {
                    // show は UI スレッド必須（プラグインメソッドはブリッジスレッドで走る）。
                    getActivity().runOnUiThread(() ->
                        UnityAds.show(
                            getActivity(),
                            placementId,
                            new UnityAdsShowOptions(),
                            makeShowListener(call)
                        )
                    );
                }

                @Override
                public void onUnityAdsFailedToLoad(
                    String placementId,
                    UnityAds.UnityAdsLoadError error,
                    String message
                ) {
                    // 在庫なし・ネットワーク不通など。Web 版の ready_timeout に相当。
                    resolveOutcome(call, "unavailable", "load_failed");
                }
            }
        );
    }

    // ── フッターバナー ────────────────────────────────────────────
    // 320x50 のバナーを画面下中央に固定表示する。WebView はバナーの高さぶん
    // bottomMargin で縮めて持ち上げる（Web 側の UI がバナーに隠れないように。
    // CSS 側の調整は不要）。戻り値は { shown: boolean, detail?: string }。

    @PluginMethod
    public void showBanner(PluginCall call) {
        whenInitialized(
            () -> getActivity().runOnUiThread(() -> {
                if (bannerView != null) {
                    // 既に表示中なら何もしない（多重呼び出し対策）。
                    JSObject ret = new JSObject();
                    ret.put("shown", true);
                    call.resolve(ret);
                    return;
                }
                BannerView banner = new BannerView(
                    getActivity(),
                    bannerPlacementId(),
                    new UnityBannerSize(BANNER_WIDTH_DP, BANNER_HEIGHT_DP)
                );
                banner.setListener(new BannerView.Listener() {
                    @Override
                    public void onBannerLoaded(BannerView view) {
                        // load 完了後にビュー階層へ載せる（在庫なしのとき空白を出さない）。
                        lastBannerError = null;
                        getActivity().runOnUiThread(() -> attachBanner(view));
                        JSObject ret = new JSObject();
                        ret.put("shown", true);
                        call.resolve(ret);
                    }

                    @Override
                    public void onBannerFailedToLoad(BannerView view, BannerErrorInfo error) {
                        lastBannerError =
                            error != null
                                ? error.errorCode + ": " + error.errorMessage
                                : "unknown";
                        getActivity().runOnUiThread(view::destroy);
                        JSObject ret = new JSObject();
                        ret.put("shown", false);
                        ret.put("detail", "load_failed");
                        call.resolve(ret);
                    }
                });
                banner.load();
            }),
            () -> {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                ret.put("detail", "init_failed");
                call.resolve(ret);
            }
        );
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (bannerView != null) {
                ViewGroup parent = (ViewGroup) bannerView.getParent();
                if (parent != null) parent.removeView(bannerView);
                bannerView.destroy();
                bannerView = null;
                setWebViewBottomMargin(0);
            }
            call.resolve();
        });
    }

    /** ロード済みバナーを CoordinatorLayout（WebView の親）の下中央に追加し、WebView を持ち上げる。 */
    private void attachBanner(BannerView banner) {
        if (bannerView != null) {
            // 競合でもう1枚来た場合は捨てる。
            banner.destroy();
            return;
        }
        WebView webView = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();
        float density = getContext().getResources().getDisplayMetrics().density;
        CoordinatorLayout.LayoutParams lp = new CoordinatorLayout.LayoutParams(
            Math.round(BANNER_WIDTH_DP * density),
            Math.round(BANNER_HEIGHT_DP * density)
        );
        lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        // バナーは 320dp 固定幅なので、左右に親レイアウトの背景が見える。白で揃える。
        parent.setBackgroundColor(Color.WHITE);
        parent.addView(banner, lp);
        bannerView = banner;
        setWebViewBottomMargin(Math.round(BANNER_HEIGHT_DP * density));
    }

    private void setWebViewBottomMargin(int px) {
        WebView webView = getBridge().getWebView();
        ViewGroup.MarginLayoutParams lp =
            (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
        lp.bottomMargin = px;
        webView.setLayoutParams(lp);
    }
}
