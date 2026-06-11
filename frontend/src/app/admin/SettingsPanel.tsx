'use client';

import { useEffect, useState } from 'react';
import {
  fetchGameSettings,
  saveGameSettings,
  DEFAULT_RIPPLE,
  DEFAULT_VIDEO_REWARD,
  DEFAULT_WEB_ADS,
  resolveRipple,
  resolveVideoReward,
  resolveWebAds,
  rippleRgba,
  type ResolvedRipple,
  type ResolvedRippleMode,
  type ResolvedVideoReward,
  type ResolvedWebAds,
} from '@/lib/gameSettings';

// 塗りの波紋（paint-ripple）演出を調整する管理画面パネル（開発者専用）。
// 塗り方（隣塗り＝manual／GPS塗り＝gps）ごとに、広がるスピード・サイズ・表示時間・色・
// 半透明値を別々に設定できる。値は app_settings の ripple キーに保存し、全クライアントが
// 起動時に1回だけ取得してキャッシュする（波紋を出すたびに DB を読みにこない）。保存はトップ
// レベルキーの浅いマージなので、移動スピードなど他の共通設定は消さない。

// 数値スライダー1本ぶんの定義（最小・最大・刻み・単位・説明）。
type NumField = {
  key: 'durationMs' | 'maxScale' | 'lifetimeMs';
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
};

const NUM_FIELDS: NumField[] = [
  {
    key: 'durationMs',
    label: '広がるスピード',
    min: 100,
    max: 3000,
    step: 50,
    unit: 'ms',
    hint: '波紋（リング）が広がりきるまでの時間。小さいほど速く弾ける。',
  },
  {
    key: 'maxScale',
    label: 'サイズ（最大倍率）',
    min: 2,
    max: 40,
    step: 1,
    unit: '倍',
    hint: 'リングがセル幅の何倍まで広がるか。大きいほど大きな波紋になる。',
  },
  {
    key: 'lifetimeMs',
    label: '表示時間',
    min: 300,
    max: 5000,
    step: 50,
    unit: 'ms',
    hint: '波紋を画面から消すまでの時間。広がるスピードより短いと途中で消える。',
  },
];

const MODES: { key: 'manual' | 'gps'; title: string; desc: string }[] = [
  { key: 'manual', title: '隣塗り（手動・となり塗り）', desc: 'マウス／タップで塗ったときの波紋。' },
  { key: 'gps', title: 'GPS塗り（現地訪問）', desc: '実際に訪れて塗ったときの波紋。' },
];

// 1つの塗り方（manual / gps）ぶんの編集 UI＋プレビュー。
function ModeEditor({
  title,
  desc,
  cfg,
  onChange,
}: {
  title: string;
  desc: string;
  cfg: ResolvedRippleMode;
  onChange: (next: ResolvedRippleMode) => void;
}) {
  const [previewKey, setPreviewKey] = useState(0);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <p className="mt-1 text-xs text-gray-400">{desc}</p>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div className="space-y-5">
          {NUM_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="flex items-baseline justify-between">
                <label className="text-sm font-medium text-gray-700">{f.label}</label>
                <span className="font-mono text-sm text-gray-700">
                  {cfg[f.key]} {f.unit}
                </span>
              </div>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={cfg[f.key]}
                onChange={(e) => onChange({ ...cfg, [f.key]: Number(e.target.value) })}
                className="mt-2 w-full accent-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">{f.hint}</p>
            </div>
          ))}

          {/* 色 */}
          <div>
            <label className="text-sm font-medium text-gray-700">色</label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="color"
                value={cfg.color}
                onChange={(e) => onChange({ ...cfg, color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
              />
              <span className="font-mono text-sm text-gray-600">{cfg.color}</span>
            </div>
          </div>

          {/* 半透明値 */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium text-gray-700">半透明値（不透明度）</label>
              <span className="font-mono text-sm text-gray-700">{cfg.alpha.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={cfg.alpha}
              onChange={(e) => onChange({ ...cfg, alpha: Number(e.target.value) })}
              className="mt-2 w-full accent-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">0で透明・1で不透明。</p>
          </div>
        </div>

        {/* プレビュー */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">プレビュー</span>
            <button
              onClick={() => setPreviewKey((k) => k + 1)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              ▶ 再生
            </button>
          </div>
          <div className="mt-3 flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-gray-900 py-10">
            {/* 実際の Map と同じ .paint-ripple クラス＋CSS 変数で描画する。key 変更で再生し直す。 */}
            <div
              key={previewKey}
              className="paint-ripple"
              style={
                {
                  position: 'relative',
                  '--c': rippleRgba(cfg.color, cfg.alpha),
                  '--size': '40px',
                  '--dur': `${cfg.durationMs}ms`,
                  '--scale': `${cfg.maxScale}`,
                } as React.CSSProperties
              }
            >
              <span className="paint-ripple-flash" />
              <span className="paint-ripple-ring r1" />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            現在の値で1回再生します（実地図では塗ったセルの大きさが基準になります）。
          </p>
        </div>
      </div>
    </section>
  );
}

// Web 広告配信の全体 ON/OFF を編集するセクション。自動広告（AdSense スクリプト）と
// 「広告で回復」（リワード）を別々に切り替えられる。全ユーザーに効くが、ユーザー個別の
// 上書き（ユーザー管理タブから設定・個別＞全体）があるユーザーにはそちらが優先される。
// アプリ版（Unity Ads）は対象外。
function WebAdsEditor({
  cfg,
  onChange,
}: {
  cfg: ResolvedWebAds;
  onChange: (next: ResolvedWebAds) => void;
}) {
  const ITEMS: {
    key: keyof ResolvedWebAds;
    label: string;
    desc: string;
  }[] = [
    {
      key: 'autoEnabled',
      label: '自動広告（AdSense）',
      desc: 'ページ内の自動広告。OFF にすると adsbygoogle.js 自体を読み込みません。',
    },
    {
      key: 'rewardEnabled',
      label: '広告で回復（リワード）',
      desc: 'Web 版の「広告を見て回復」ボタン。OFF にするとボタンを表示せず、サーバーでも報酬請求を拒否します。',
    },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700">Web 広告配信（全ユーザー）</h3>
      <p className="mt-1 text-xs text-gray-400">
        Web 版の広告配信の全体スイッチです（アプリ版の Unity Ads は対象外）。ユーザー個別の
        上書き設定（ユーザー管理タブ）がある場合はそちらが優先されます。反映は各端末の
        次回読み込み時から。
      </p>

      <div className="mt-5 space-y-4">
        {ITEMS.map((item) => (
          <label key={item.key} className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={cfg[item.key]}
              onChange={(e) => onChange({ ...cfg, [item.key]: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-blue-500"
            />
            <span>
              <span className="text-sm text-gray-700">
                {item.label}
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-xs font-bold ${
                    cfg[item.key]
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {cfg[item.key] ? '配信中' : '停止中'}
                </span>
              </span>
              <span className="block text-xs text-gray-400">{item.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

// 動画リワード（広告を見て回復）の運用設定を編集するセクション。
// クールダウンは Web 版のみに効く（アプリは Unity Ads のプリロード制御＋1日上限に任せる）。
// 回復量はプラットフォーム共通。保存すると即・全ユーザーに反映される（backend が
// リワード系リクエストのたびに app_settings を読み直す）。
function VideoRewardEditor({
  cfg,
  onChange,
}: {
  cfg: ResolvedVideoReward;
  onChange: (next: ResolvedVideoReward) => void;
}) {
  const AMOUNT_MODES: {
    key: ResolvedVideoReward['amountMode'];
    label: string;
    desc: string;
  }[] = [
    { key: 'full', label: 'フル回復（満タン分）', desc: 'そのレベルの最大塗りポイントと同量を加算（従来挙動）。' },
    { key: 'half', label: '50%（満タンの半分）', desc: '最大塗りポイントの半分（切り上げ）を加算。' },
    { key: 'fixed', label: '固定値', desc: 'レベルに関係なく、下で指定したポイントを加算。' },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700">動画リワード（広告を見て回復）</h3>
      <p className="mt-1 text-xs text-gray-400">
        クールタイムは Web 版のみに効きます（アプリ版は広告在庫のプリロードと1日上限で抑制）。
        回復量は Web・アプリ共通。保存すると全ユーザーに即反映されます。
      </p>

      <div className="mt-5 space-y-5">
        {/* クールタイム（Web のみ） */}
        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium text-gray-700">クールタイム（Web 版・秒）</label>
            <span className="font-mono text-sm text-gray-700">
              {cfg.cooldownWebSec} 秒（{(cfg.cooldownWebSec / 60).toFixed(1)} 分）
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={10}
            value={cfg.cooldownWebSec}
            onChange={(e) =>
              onChange({
                ...cfg,
                cooldownWebSec: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
            className="mt-2 w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            広告を見てから次に見られるまでの待ち時間。0 でクールタイムなし。既定 300（5分）。
          </p>
        </div>

        {/* 回復量 */}
        <div>
          <label className="text-sm font-medium text-gray-700">回復量</label>
          <div className="mt-2 space-y-2">
            {AMOUNT_MODES.map((m) => (
              <label key={m.key} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="videoRewardAmountMode"
                  checked={cfg.amountMode === m.key}
                  onChange={() => onChange({ ...cfg, amountMode: m.key })}
                  className="mt-0.5 accent-blue-500"
                />
                <span>
                  <span className="text-sm text-gray-700">{m.label}</span>
                  <span className="block text-xs text-gray-400">{m.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {cfg.amountMode === 'fixed' && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                value={cfg.fixedAmount}
                onChange={(e) =>
                  onChange({
                    ...cfg,
                    fixedAmount: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                  })
                }
                className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <span className="text-sm text-gray-600">ポイント</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function SettingsPanel() {
  const [cfg, setCfg] = useState<ResolvedRipple>(() => resolveRipple(undefined));
  const [videoReward, setVideoReward] = useState<ResolvedVideoReward>(() =>
    resolveVideoReward(undefined)
  );
  const [webAds, setWebAds] = useState<ResolvedWebAds>(() => resolveWebAds(undefined));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetchGameSettings()
      .then((s) => {
        setCfg(resolveRipple(s.ripple));
        setVideoReward(resolveVideoReward(s.videoReward));
        setWebAds(resolveWebAds(s.webAds));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // このパネルが扱うキーだけ送る（サーバーが既存設定に浅くマージするので移動スピード等は消えない）。
      await saveGameSettings({ ripple: cfg, videoReward, webAds });
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">読み込み中…</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-xs text-gray-400">
        ゲーム全体に効く共通設定です。保存すると全ユーザーに反映されます
        （波紋は各端末の次回読み込み時・動画リワードは次のリクエストから）。
      </p>

      <WebAdsEditor cfg={webAds} onChange={(next) => {
        setWebAds(next);
        setSavedAt(null);
      }} />

      <VideoRewardEditor cfg={videoReward} onChange={(next) => {
        setVideoReward(next);
        setSavedAt(null);
      }} />

      {MODES.map((m) => (
        <ModeEditor
          key={m.key}
          title={m.title}
          desc={m.desc}
          cfg={cfg[m.key]}
          onChange={(next) => {
            setCfg((prev) => ({ ...prev, [m.key]: next }));
            setSavedAt(null);
          }}
        />
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={() => {
            setCfg({ manual: { ...DEFAULT_RIPPLE.manual }, gps: { ...DEFAULT_RIPPLE.gps } });
            setVideoReward({ ...DEFAULT_VIDEO_REWARD });
            setWebAds({ ...DEFAULT_WEB_ADS });
            setSavedAt(null);
          }}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          初期値に戻す
        </button>
        {savedAt && <span className="text-sm text-green-600">保存しました</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
