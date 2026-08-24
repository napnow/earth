# The Circling 🌍

> 一个不断变成另一个世界的星球。阴极射线管里，一颗像素星球每隔几十秒碎成星尘，再重组为新世界。

基于 [changing-worlds.vercel.app](https://changing-worlds.vercel.app/) 的开源魔改版 —— 纯 Three.js、无框架、无构建，全部源码可读。

![demo](https://changing-worlds.vercel.app/favicon.svg)

## ✨ 这个版本加了什么

在原作「世界生灭」的基础上，新增两层叙事：

### 🏙 文明微光
约 **1/3 的世界是有人居住的**。转到夜面，你会看到几点暖黄色的城市灯火——成簇、微闪、像从万米高空俯瞰的小镇。
- 只出现在**夜面的陆地**上，永远不在海里
- 灯光随世界解体而熄灭：消逝的不只是大陆，是住过的人

### 📇 世界铭牌
每个新世界落定时，左下角的打字机逐字打出它的铭牌：

```
WORLD 003
THE AURORA ISLES
● INHABITed   ← 有文明的世界才有这行
```

世界开始解体时铭牌淡出，周而复始。

## 🚀 运行

零依赖，任意静态服务器即可：

```bash
# Windows：直接双击
start.bat

# 或者
python -m http.server 8899
```

打开 http://localhost:8899

> 必须走 HTTP 服务（`file://` 直开不行——ES Module 的 CORS 限制）。

## 🎛 参数调整

都在源码明面上：

| 想改什么 | 位置 |
|---|---|
| 有文明世界的概率 | `specs.js` → `r.chance(0.34)` |
| 聚落 / 城市数量 | `WorldBuilder.js` → `settlements`, `lightRng.int(2, 4)` |
| 灯光颜色 | `WorldBuilder.js` → `vec3(1.0, 0.78, 0.42)`（钠灯暖黄） |
| 铭牌打字速度 | `index.html` → `setTimeout(tick, 34)` |
| 世界存续时长 | `config.js` → `world.hold` |

## 🧱 结构

```
├── index.html          入口页（CRT 机壳 + 铭牌 DOM）
├── vendor/three/       Three.js r1xx（本地化，不走 CDN）
└── src/
    ├── main.js         渲染循环 + 铭牌触发
    ├── config.js       全局配置
    ├── sky.js          天空
    ├── render/
    │   ├── post.js     CRT 后期（扫描线/桶形失真/dither）
    │   └── toon.js     卡通着色
    └── world/
        ├── WorldCycle.js    生灭状态机（hold→change→hold）
        ├── WorldBuilder.js  程序化建球 + 文明灯光
        ├── PlanetPainter.js 地形绘制
        ├── specs.js         世界规格生成（名字/调色板/文明）
        └── ...              精灵/噪声/地面工具
```

## 🔒 已知边界

- 免费静态部署下 og:image 用相对路径，社交卡片需部署到公网域名才完整生效
- WebGL 必需；`prefers-reduced-motion` 未适配

## License

MIT（继承原作）。原作灵感致谢：[changing-worlds](https://changing-worlds.vercel.app/) · [Three.js](https://threejs.org/)
