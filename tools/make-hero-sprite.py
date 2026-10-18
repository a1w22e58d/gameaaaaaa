# -*- coding: utf-8 -*-
"""
tools/make-hero-sprite.py —— 把 主角/deepseek.png 加工成游戏用的主角贴图

原图是「黑底、无透明通道（RGB）」的像素风立绘，直接用会在草地上糊出一块黑方块。
这个脚本只做三件事：

  1. 抠底：按亮度做软边 alpha（纯黑→全透明，边缘保留半透明，避免锯齿）；
  2. 裁剪：去掉四周空白，并把**双脚中心**对齐到贴图的**底部正中**，
     这样游戏里只要把「贴图底部中点」放在主角坐标上，转身/缩放/旋转都自然；
  3. 缩放：缩到 200px 高（游戏里画成 ~52px，DPR 1.5 下仍然清晰），并做轻微去黑边。

用法：
    python tools/make-hero-sprite.py

输出：
    主角/hero-deepseek.png     —— 带透明通道的主角贴图（原图不动）

参数都在下面 CONFIG 里，想换尺寸/软边强度改这里就行。
"""

import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CONFIG = {
    "src": os.path.join(ROOT, "主角", "deepseek.png"),
    "dst": os.path.join(ROOT, "主角", "hero-deepseek.png"),
    # 亮度 <= LO 全透明，>= HI 全不透明（原图底色是最亮的通道都 <20 的近黑）
    "lo": 10,
    "hi": 30,
    # 去黑边：把半透明像素的颜色往「纯色」方向拉一点，草地上不会有一圈灰边
    "defringe": 0.55,
    # 输出高度（像素）；游戏里按 HERO_SPRITE_H 缩放显示
    "out_h": 200,
    # 顺带导出一张封面用的大图（同一个裁剪，只是不缩小）
    "cover_dst": os.path.join(ROOT, "主角", "hero-deepseek-big.png"),
    "cover_h": 620,
    # 双脚中心相对「内容水平中心」的偏移容差检查用，不参与计算
    "feet_band": 0.055,   # 取内容最下方 5.5% 的行来估计双脚中心
}


def main():
    cfg = CONFIG
    im = Image.open(cfg["src"]).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    lum = a.max(axis=2)

    # ---- 1. 软边 alpha ----
    alpha = np.clip((lum - cfg["lo"]) / max(1.0, cfg["hi"] - cfg["lo"]), 0.0, 1.0)

    # ---- 2. 裁剪到内容 ----
    solid = alpha > 0.06
    ys, xs = np.where(solid)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    print("原图 %dx%d，内容框 x[%d,%d) y[%d,%d) = %dx%d"
          % (im.width, im.height, x0, x1, y0, y1, x1 - x0, y1 - y0))

    rgb = a[y0:y1, x0:x1]
    alp = alpha[y0:y1, x0:x1]
    h, w = alp.shape

    # 双脚中心：最下面一条横带里，只取「靠近画面水平中心 70%」的部分（排除右下角的金色光效）
    band = max(4, int(round(h * cfg["feet_band"])))
    sub = alp[h - band:, :]
    cols = sub.sum(axis=0)
    lo_c, hi_c = int(w * 0.15), int(w * 0.85)
    core = cols[lo_c:hi_c]
    if core.sum() <= 0:                     # 兜底：整幅的 alpha 质心
        core = cols
        lo_c = 0
    feet_x = float(np.dot(np.arange(lo_c, lo_c + len(core)), core) / core.sum())
    print("双脚中心 x = %.1f（内容宽 %d，占比 %.3f）" % (feet_x, w, feet_x / w))

    # ---- 3. 双脚中心对齐到贴图底部正中 ----
    half = max(feet_x, w - feet_x)
    out_w = int(round(half * 2))
    canvas = np.zeros((h, out_w, 4), dtype=np.float32)
    off = int(round(out_w / 2 - feet_x))
    canvas[:, off:off + w, 0:3] = rgb
    canvas[:, off:off + w, 3] = alp * 255.0

    # 去黑边：半透明像素的颜色里混了底色黑，按 alpha 反推一点回去
    k = cfg["defringe"]
    if k > 0:
        a_n = canvas[:, :, 3:4] / 255.0
        weak = (a_n > 0.02) & (a_n < 0.98)
        boosted = np.clip(canvas[:, :, 0:3] / np.maximum(a_n, 0.25), 0, 255)
        canvas[:, :, 0:3] = np.where(weak, canvas[:, :, 0:3] * (1 - k) + boosted * k, canvas[:, :, 0:3])

    sprite = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGBA")

    # ---- 4. 缩放到目标高度 ----
    scale = cfg["out_h"] / sprite.height
    sprite = sprite.resize((max(1, int(round(sprite.width * scale))), cfg["out_h"]), Image.LANCZOS)

    # 再收一次几乎全透明的边（LANCZOS 会在最外圈留一圈 alpha≈1 的像素）
    arr = np.asarray(sprite).copy()
    arr[:, :, 3] = np.where(arr[:, :, 3] < 6, 0, arr[:, :, 3])
    sprite = Image.fromarray(arr, "RGBA")

    sprite.save(cfg["dst"], optimize=True)
    print("输出 %s —— %dx%d，%.1f KB（底部中点＝双脚，游戏里按底部中点定位）"
          % (os.path.relpath(cfg["dst"], ROOT), sprite.width, sprite.height,
             os.path.getsize(cfg["dst"]) / 1024.0))

    # ---- 5. 封面尺寸的大图（裁剪/对齐完全一样，只是不缩小到 200） ----
    big = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGBA")
    scale = cfg["cover_h"] / big.height
    big = big.resize((max(1, int(round(big.width * scale))), cfg["cover_h"]), Image.LANCZOS)
    barr = np.asarray(big).copy()
    barr[:, :, 3] = np.where(barr[:, :, 3] < 6, 0, barr[:, :, 3])
    big = Image.fromarray(barr, "RGBA")
    big.save(cfg["cover_dst"], optimize=True)
    print("输出 %s —— %dx%d，%.1f KB（封面/头像用）"
          % (os.path.relpath(cfg["cover_dst"], ROOT), big.width, big.height,
             os.path.getsize(cfg["cover_dst"]) / 1024.0))


if __name__ == "__main__":
    main()
