'use client';

import { useState } from 'react';
import { updateUser } from '@/lib/auth-client';

const inputClass =
  'border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400';

// ニックネームの文字数制限（DB制限はかけずフロントで判定する）。
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 12;

// 絵文字などのサロゲートペアを1文字として数える。
export const nicknameLength = (s: string) => [...s.trim()].length;

// 問題があればエラーメッセージ、なければ null を返す。
export function validateNickname(name: string): string | null {
  const len = nicknameLength(name);
  if (len < NICKNAME_MIN) return `ニックネームは${NICKNAME_MIN}文字以上で入力してください`;
  if (len > NICKNAME_MAX) return `ニックネームは${NICKNAME_MAX}文字以内で入力してください`;
  return null;
}

type Props = {
  onDone: () => void;
  // 設定からの変更時は初期値とキャンセルを渡す。未設定ユーザーへの強制入力時は省略する。
  initialName?: string;
  onClose?: () => void;
};

// ニックネームを入力／変更してもらうモーダル。
// - 強制入力（Google ログイン等で name が空）：onClose を渡さず閉じられないようにする。
// - 設定からの変更：initialName と onClose を渡す。
export default function NicknameModal({ onDone, initialName = '', onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isEdit = onClose != null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateNickname(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await updateUser({ name: name.trim() });
      if (res.error) throw new Error(res.error.message ?? '保存に失敗しました');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">
          {isEdit ? 'ニックネームを変更' : 'ニックネームを決めてください'}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          ゲーム内ではこのニックネームが表示されます（{NICKNAME_MIN}〜{NICKNAME_MAX}文字）。
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="ニックネーム"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            maxLength={NICKNAME_MAX}
            className={inputClass}
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 mt-1">
            {isEdit && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {loading ? '保存中...' : isEdit ? '変更する' : '決定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
