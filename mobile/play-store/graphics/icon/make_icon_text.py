#!/usr/bin/env python3
"""アイコンに名前を載せた言語別ファイルを作る（日本語版・英語版）。"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "icon-512.original.png"

RED = (224, 49, 49)        # ピンの赤
JP_FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"
EN_FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

# (出力ファイル, テキスト, フォント, ttcのface index, 文字色, 開始フォントサイズ)
VARIANTS = [
    ("icon-512-ja.png", "ちずぬりえ",     JP_FONT, 0, RED, 96),
    ("icon-512-en.png", "Color the Map", EN_FONT, 0, RED, 80),
]

for out_name, text, font_path, idx, color, start_size in VARIANTS:
    im = Image.open(SRC).convert("RGBA")
    W, H = im.size  # 512x512

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # --- バナー（角丸の白帯）---
    bx0, by0, bx1, by1 = 22, 388, W - 22, 486
    radius = 30

    # 影
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    ds.rounded_rectangle([bx0, by0 + 6, bx1, by1 + 6], radius=radius, fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(6))
    overlay = Image.alpha_composite(overlay, shadow)
    d = ImageDraw.Draw(overlay)

    d.rounded_rectangle([bx0, by0, bx1, by1], radius=radius, fill=(255, 255, 255, 255))

    inner_w = (bx1 - bx0) - 40

    def fit_font(path, txt, max_w, size, idx=0):
        while size > 8:
            f = ImageFont.truetype(path, size, index=idx)
            if d.textlength(txt, font=f) <= max_w:
                return f
            size -= 1
        return ImageFont.truetype(path, 8, index=idx)

    font = fit_font(font_path, text, inner_w, start_size, idx)
    tw = d.textlength(text, font=font)
    asc, desc = font.getmetrics()
    cx = (bx0 + bx1) / 2
    cy = (by0 + by1) / 2
    # 視覚的に中央へ（ベースライン基準のずれを descender 分で補正）
    ty = cy - (asc + desc) / 2
    d.text((cx - tw / 2, ty), text, font=font, fill=color + (255,))

    out = Image.alpha_composite(im, overlay).convert("RGB")
    out.save(out_name)
    print("saved", out_name, "size", font.size)
