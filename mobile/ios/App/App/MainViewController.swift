import UIKit
import Capacitor

/**
 * アプリ内（app target）に直接実装したカスタム Capacitor プラグインを登録するための
 * ブリッジ ViewController。
 *
 * Capacitor 7 の iOS は「バイナリ内の全クラス走査」ではなく、`cap sync` が
 * capacitor.config.json の packageClassList に書き出した npm プラグインだけを自動登録する。
 * UnityAdsPlugin は npm パッケージではなく app target に直接置いているため自動登録されない
 * （Android で MainActivity に registerPlugin(UnityAdsPlugin.class) を書くのと同じ事情）。
 * そこで capacitorDidLoad()（bridge 生成直後に呼ばれる公式の登録ポイント）で
 * registerPluginInstance() を使って明示登録する。
 *
 * Main.storyboard の Bridge View Controller の customClass をこのクラスに差し替えてある。
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(UnityAdsPlugin())
    }
}
