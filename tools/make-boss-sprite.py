# -*- coding: utf-8 -*-
"""
tools/make-boss-sprite.py —— 把 主角/豆包.jpg 加工成游戏里「首领」的贴图

和主角那张（黑底 PNG）不一样，这张是 **浅蓝底的 JPG**，直接抠亮度会全灭，所以这里按
「颜色离底色多远」来抠，并且多处理两件脏活：

  1. 抠底：底色是边缘采样出来的浅蓝（≈ 201,227,253），按 `max|p-bg|` 做软边 alpha；
  2. 抹水印：右下角「豆包 AI 生成」的水印在框里，直接把那块矩形置成全透明；
  3. 抹影子：原图脚下有一圈「底色变暗」的软阴影（≈底色 ×0.84，和黑衣服不是一回事）。
     判定方法是把像素投到底色射线上：`k = dot(p,bg)/dot(bg,bg)`，
     `k∈(0.55,0.995)` 且离射线很近（残差 < 34）的像素就是「被压暗的底色」→ 透明。
     纯黑衣服的 k≈0.02，落在区间外，不会被误伤。
  4. 裁剪 + 对齐：去掉四周空白，把**双脚中心**对齐到贴图底部正中；
  5. 缩放 + 去蓝边：按 alpha 反解出未与底色混合的颜色（unpremultiply），
     免得草地上留一圈浅蓝描边。

用法：
    python tools/make-boss-sprite.py

输出：
    主角/boss-doubao.png     —— 带透明通道的首领贴图（原图不动）
"""

import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CONFIG = {
    "src": os.path.join(ROOT, "主角", "豆包.jpg"),
    "dst": os.path.join(ROOT, "主角", "boss-doubao.png"),
    # 软边阈值：离底色 <= LO 全透明，>= HI 全不透明
    "lo": 20,
    "hi": 58,
    # 去边（把混进底色的半透明像素反解回纯色）
    "defringe": 0.7,
    # 输出高度（像素）；游戏里按 BOSS_SPRITE.h 缩放显示
    "out_h": 200,
    # 取内容最下方 5% 的行来估计双脚中心
    "feet_band": 0.05,
    # 右下角水印矩形 [x0, y0, x1, y1)（原图坐标），这块一律透明
    "watermark": [1030, 1820, 1280, 1920],
    # 影子判定：底色射线残差上限 / 亮度比例区间
    "shadow_res": 34.0,
    "shadow_k": [0.55, 0.995],
    # 兜底底色（自动估计失败时用）
    "bg_fallback": [201.0, 227.0, 253.0],
}


def main():
    cfg = CONFIG
    im = Image.open(cfg["src"]).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape

    # ---- 0. 估计底色：四边 4 像素的中位数 ----
    edge = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3),
                           a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    if float(np.abs(bg).max()) < 1.0:
        bg = np.array(cfg["bg_fallback"], dtype=np.float32)
    print("原图 %dx%d，底色 = (%.0f, %.0f, %.0f)" % (w, h, bg[0], bg[1], bg[2]))

    # ---- 1. 按「离底色多远」做软边 alpha ----
    dist = np.abs(a - bg).max(axis=2)
    alpha = np.clip((dist - cfg["lo"]) / max(1.0, cfg["hi"] - cfg["lo"]), 0.0, 1.0)

    # ---- 2. 抹掉右下角水印 ----
    wx0, wy0, wx1, wy1 = cfg["watermark"]
    alpha[wy0:wy1, wx0:wx1] = 0.0
    print("已抹水印矩形 x[%d,%d) y[%d,%d)" % (wx0, wx1, wy0, wy1))

    # ---- 3. 抹掉脚下的软阴影（底色被压暗，方向仍沿底色） ----
    flat = a.reshape(-1, 3)
    k = (flat @ bg) / float(bg @ bg)
    res = np.linalg.norm(flat - k[:, None] * bg[None, :], axis=1).reshape(h, w)
    k = k.reshape(h, w)
    shadow = (res < cfg["shadow_res"]) & (k > cfg["shadow_k"][0]) & (k < cfg["shadow_k"][1])
    n_shadow = int(shadow.sum())
    alpha[shadow] = 0.0
    print("抹掉疑似阴影 %d 像素（%.1f%%）" % (n_shadow, 100.0 * n_shadow / (h * w)))

    # ---- 4. 裁剪到内容 ----
    solid = alpha > 0.06
    ys, xs = np.where(solid)
    if len(xs) == 0:
        raise SystemExit("抠底之后什么都没剩下，检查 LO/HI 与底色估计")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    print("内容框 x[%d,%d) y[%d,%d) = %dx%d" % (x0, x1, y0, y1, x1 - x0, y1 - y0))

    rgb = a[y0:y1, x0:x1]
    alp = alpha[y0:y1, x0:x1]
    ch, cw = alp.shape

    # ---- 5. 去边：按 alpha 反解出没混底色的颜色 ----
    kk = cfg["defringe"]
    if kk > 0:
        an = np.clip(alp, 1e-3, 1.0)[:, :, None]
        pure = np.clip((rgb - (1.0 - an) * bg[None, None, :]) / an, 0, 255)
        weak = (alp > 0.02) & (alp < 0.98)
        rgb = np.where(weak[:, :, None], rgb * (1 - kk) + pure * kk, rgb)

    # ---- 6. 双脚中心对齐到贴图底部正中 ----
    band = max(4, int(round(ch * cfg["feet_band"])))
    sub = alp[ch - band:, :]
    cols = sub.sum(axis=0)
    lo_c, hi_c = int(cw * 0.15), int(cw * 0.85)
    core = cols[lo_c:hi_c]
    if core.sum() <= 0:
        core = cols
        lo_c = 0
    feet_x = float(np.dot(np.arange(lo_c, lo_c + len(core)), core) / core.sum())
    print("双脚中心 x = %.1f（内容宽 %d，占比 %.3f）" % (feet_x, cw, feet_x / cw))

    half = max(feet_x, cw - feet_x)
    out_w = int(round(half * 2))
    canvas = np.zeros((ch, out_w, 4), dtype=np.float32)
    off = int(round(out_w / 2 - feet_x))
    canvas[:, off:off + cw, 0:3] = rgb
    canvas[:, off:off + cw, 3] = alp * 255.0

    sprite = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGBA")

    # ---- 7. 缩放到目标高度 ----
    scale = cfg["out_h"] / sprite.height
    sprite = sprite.resize((max(1, int(round(sprite.width * scale))), cfg["out_h"]), Image.LANCZOS)

    arr = np.asarray(sprite).copy()
    arr[:, :, 3] = np.where(arr[:, :, 3] < 6, 0, arr[:, :, 3])
    sprite = Image.fromarray(arr, "RGBA")

    sprite.save(cfg["dst"], optimize=True)
    print("输出 %s —— %dx%d，%.1f KB（底部中点＝双脚，游戏里按底部中点定位）"
          % (os.path.relpath(cfg["dst"], ROOT), sprite.width, sprite.height,
             os.path.getsize(cfg["dst"]) / 1024.0))


if __name__ == "__main__":
    main()
