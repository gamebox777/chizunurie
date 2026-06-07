// ひらがな読み → ローマ字（ヘボン式・簡易）。世界版の英語表示で日本の地名を
// ローマ字で見せるために使う。muni-kana.json の読み（ひらがな）を変換する。

const TWO: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
};

const ONE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ー: '',
};

// カタカナ → ひらがな（読みがカタカナで来た場合の保険）
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

// ひらがな（またはカタカナ）の読みをローマ字へ。先頭を大文字にする。
export function kanaToRomaji(kana: string): string {
  if (!kana) return '';
  const s = kataToHira(kana.trim());
  let out = '';
  let i = 0;
  while (i < s.length) {
    const pair = s.slice(i, i + 2);
    if (TWO[pair]) {
      out += TWO[pair];
      i += 2;
      continue;
    }
    const ch = s[i];
    // 促音「っ」：次の音の子音を重ねる
    if (ch === 'っ' || ch === 'ッ') {
      const next = s.slice(i + 1, i + 3);
      const nr = TWO[next] || ONE[s[i + 1]] || '';
      if (nr) out += nr[0];
      i += 1;
      continue;
    }
    if (ONE[ch] !== undefined) {
      out += ONE[ch];
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch;
    }
    i += 1;
  }
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

// 都道府県名（日本語）→ ローマ字（接尾辞 都/道/府/県 は付けない）
export const PREF_ROMAJI: Record<string, string> = {
  北海道: 'Hokkaido', 青森県: 'Aomori', 岩手県: 'Iwate', 宮城県: 'Miyagi',
  秋田県: 'Akita', 山形県: 'Yamagata', 福島県: 'Fukushima', 茨城県: 'Ibaraki',
  栃木県: 'Tochigi', 群馬県: 'Gunma', 埼玉県: 'Saitama', 千葉県: 'Chiba',
  東京都: 'Tokyo', 神奈川県: 'Kanagawa', 新潟県: 'Niigata', 富山県: 'Toyama',
  石川県: 'Ishikawa', 福井県: 'Fukui', 山梨県: 'Yamanashi', 長野県: 'Nagano',
  岐阜県: 'Gifu', 静岡県: 'Shizuoka', 愛知県: 'Aichi', 三重県: 'Mie',
  滋賀県: 'Shiga', 京都府: 'Kyoto', 大阪府: 'Osaka', 兵庫県: 'Hyogo',
  奈良県: 'Nara', 和歌山県: 'Wakayama', 鳥取県: 'Tottori', 島根県: 'Shimane',
  岡山県: 'Okayama', 広島県: 'Hiroshima', 山口県: 'Yamaguchi', 徳島県: 'Tokushima',
  香川県: 'Kagawa', 愛媛県: 'Ehime', 高知県: 'Kochi', 福岡県: 'Fukuoka',
  佐賀県: 'Saga', 長崎県: 'Nagasaki', 熊本県: 'Kumamoto', 大分県: 'Oita',
  宮崎県: 'Miyazaki', 鹿児島県: 'Kagoshima', 沖縄県: 'Okinawa',
};

export function prefRomaji(name: string): string {
  return PREF_ROMAJI[name] ?? name;
}
