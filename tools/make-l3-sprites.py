#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第三关（图3）新素材：蹦极 / 靶子 / 保护伞

三张原图都是「白底 + 右下角水印」的像素图，抠底逻辑和 make-enemy-sprite.py
完全一样（四边估底色 → 连通性洪泛 → 只保留人物那一块 → 只给贴边的一圈羽化 →
去边反解 → 裁到内容 → 底部中点对齐），所以直接复用那边的 build_one()，
只是换输入输出和高度。

用法：
  python tools/make-l3-sprites.py
产物（都在 主角/ 下）：
  sprite-bungee.png    蹦极僵尸（吊着绳子，底部中点＝脚）
  sprite-target.png    靶子（扔在塔上的标记，底部中点＝图心正下方）
  sprite-umbrella.png  保护伞（一片大叶子，底部中点＝叶柄）
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

spec = importlib.util.spec_from_file_location(
    "make_enemy_sprite", os.path.join(HERE, "make-enemy-sprite.py"))
mk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mk)          # __name__ != "__main__"，不会触发它自己的 main

# (原图, 输出, 高度, 双脚/底边取样带)
JOBS = [
    ("蹦极.jpg", "sprite-bungee.png", 64, 0.08),
    ("靶子.jpg", "sprite-target.png", 52, 0.10),
    ("保护伞.jpg", "sprite-umbrella.png", 50, 0.14),
]

for src, dst, h, band in JOBS:
    mk.build_one(os.path.join(ROOT, "主角", src),
                 os.path.join(ROOT, "主角", dst), h, band, src)

print("\n完成。")
