#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// UnityAdsPlugin.swift（@objc(UnityAdsPlugin) の CAPPlugin）を Capacitor に登録する。
// frontend は window.Capacitor.Plugins.UnityAds 経由でこれらのメソッドを呼ぶ。
// Android 版（UnityAdsPlugin.java の @PluginMethod）と同じメソッド名・同じ JS API。
CAP_PLUGIN(UnityAdsPlugin, "UnityAds",
    CAP_PLUGIN_METHOD(showRewarded, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getRewardedStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getAdDebugInfo, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getAdTestMode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setAdTestMode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(showBanner, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(hideBanner, CAPPluginReturnPromise);
)
