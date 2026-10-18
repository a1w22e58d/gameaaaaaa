# -*- coding: utf-8 -*-
"""
tools/make-enemy-sprite.py —— 把 主角/gpt.jpg 加工成小怪共用的贴图

这张图和前两张都不一样，有三处必须特殊处理：

  1. **白底 + 白衣人物**：人物的头发、裙子本身就是白的，和底色几乎同色，
     所以**不能按「离底色多远」抠**（那样衣服会被打成透明窟窿）。这里改成
     「**连通性**」抠底：从画面四边往里洪泛，只把**和边框连在一起**的底色抹掉；
     衣服内部的白像素虽然颜色像底色，但被人物包住、洪泛进不去，于是完整保留。
  2. **右下角水印**：洪泛也进不去水印笔画，但它和人物不连通，所以只保留
     「离画面中心最近的那一整块连通区域」（＝人物），水印、杂点自动丢掉。
  3. **软边**：只有紧贴底色那一两圈像素才按颜色距离做半透明渐变，
     免得衣服边缘被啃掉、也不留白色锯齿。

用法：
    python tools/make-enemy-sprite.py

输出：
    主角/enemy-gpt.png —— 带透明通道的小怪贴图（原图不动）。
    游戏里所有小怪共用这一张，靠 game.js 按各自的颜色**实时染色**。
"""

import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CONFIG = {
    "src": os.path.join(ROOT, "主角", "gpt.jpg"),
    "dst": os.path.join(ROOT, "主角", "enemy-gpt.png"),
    # 软边阈值：离底色 <= LO 的边圈像素全透明，>= HI 全不透明
    "lo": 14,
    "hi": 46,
    # 颜色距离小于它就当作「背景候选」（洪泛只在这个集合里走）
    "bg_lo": 26.0,
    # 贴近背景的这一圈像素才做羽化（像素）
    "rim": 2,
    # 去边（把混进底色的半透明像素反解回纯色）
    "defringe": 0.7,
    # 输出高度（像素）；游戏里按「敌人半径 × 2.9」缩放显示
    "out_h": 160,
    # 取内容最下方 5% 的行来估计双脚中心
    "feet_band": 0.05,
    # 兜底底色（自动估计失败时用）
    "bg_fallback": [252.0, 250.0, 252.0],
}


def dilate1(m):
    """4 邻域膨胀一格（不走 np.roll，避免绕回对边）。"""
    out = m.copy()
    out[1:, :] |= m[:-1, :]
    out[:-1, :] |= m[1:, :]
    out[:, 1:] |= m[:, :-1]
    out[:, :-1] |= m[:, 1:]
    return out


def dilate8(m):
    """8 邻域膨胀一格。"""
    out = dilate1(m)
    out[1:, 1:] |= m[:-1, :-1]
    out[:-1, :-1] |= m[1:, 1:]
    out[1:, :-1] |= m[:-1, 1:]
    out[:-1, 1:] |= m[1:, :-1]
    return out


def grow(seed, allowed, conn8=False, limit=20000):
    """在 allowed 里从 seed 洪泛，返回连通区域。"""
    m = seed & allowed
    step = dilate8 if conn8 else dilate1
    for _ in range(limit):
        n = step(m) & allowed
        if n.sum() == m.sum():
            return m
        m = n
    raise SystemExit("洪泛没有收敛，检查 bg_lo 是否太大")


def build_one(src, dst, out_h, feet_band=0.05, label=""):
    """把一张「白底人物图」加工成底部中点对齐的透明贴图。"""
    cfg = dict(CONFIG)
    cfg["src"] = src
    cfg["dst"] = dst
    cfg["out_h"] = out_h
    cfg["feet_band"] = feet_band
    if label:
        print("\n=== " + label + " ===")
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

    dist = np.abs(a - bg).max(axis=2)
    soft = np.clip((dist - cfg["lo"]) / max(1.0, cfg["hi"] - cfg["lo"]), 0.0, 1.0)
    cand = dist < cfg["bg_lo"]

    # ---- 1. 从四边洪泛：只吃掉「和边框连通」的底色 ----
    seed = np.zeros((h, w), dtype=bool)
    seed[0, :] = cand[0, :]
    seed[-1, :] = cand[-1, :]
    seed[:, 0] = cand[:, 0]
    seed[:, -1] = cand[:, -1]
    bgt = grow(seed, cand, conn8=False)
    print("外围底色 %d 像素（%.1f%%）" % (int(bgt.sum()), 100.0 * bgt.sum() / (h * w)))

    # ---- 2. 从画面中心附近洪泛：只保留人物那一整块（水印/杂点自动丢掉）----
    free = ~bgt
    ys, xs = np.where(free)
    if len(xs) == 0:
        raise SystemExit("整张图都被当成底色了，检查 bg_lo")
    i = int(np.argmin((ys - h / 2.0) ** 2 + (xs - w / 2.0) ** 2))
    seed2 = np.zeros((h, w), dtype=bool)
    seed2[ys[i], xs[i]] = True
    keep = grow(seed2, free, conn8=True)
    print("人物连通域 %d 像素（占非底色 %.1f%%），丢弃 %d 像素的水印/杂点"
          % (int(keep.sum()), 100.0 * keep.sum() / max(1, int(free.sum())),
             int(free.sum() - keep.sum())))

    # ---- 3. 只给紧贴底色的那一圈做软边，衣服内部一律不透明 ----
    rim = keep.copy()
    for _ in range(cfg["rim"]):
        rim = dilate8(rim)
    rim &= keep
    edge_ring = rim & (bgt | dilate8(bgt))
    alpha = np.where(keep, np.where(edge_ring, soft, 1.0), 0.0)

    # ---- 4. 裁剪到内容 ----
    solid = alpha > 0.06
    ys, xs = np.where(solid)
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
    build_one(CONFIG["src"], CONFIG["dst"], CONFIG["out_h"], CONFIG["feet_band"], "小怪 gpt")
