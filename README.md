# ComfyUI Gemini Lighting Expert

这是一个只针对原图光影优化的单节点工作台。配置 Gemini API Key 后，节点会将输入图像发送给
`gemini-3-flash-preview` 进行光影诊断，再把人工灯位控制和专家建议合并为可直接接入采样器的
CLIP 条件，在节点内部执行参考潜在、Flux 编辑与原图结构锁定。最终输出的内容、人物与背景细节只来自传入的工作图像，
Flux 结果只提供受控的光照变化。

## 节点

```text
qwen/cinematic-lighting/Gemini Lighting Expert
```

## 安装

在 ComfyUI 的 `custom_nodes` 目录执行：

```bash
git clone https://github.com/kuangrenaigc-stack/ComfyUI-Qwen-Cinematic-Lighting.git
```

然后重新启动 ComfyUI。

## 功能

- 输入工作图像、Flux 模型、`CLIP`、`VAE`、噪声、采样器、`SIGMAS` 与 Flux2 空潜图，直接输出保护后的打光成图。
- 节点内部编码正向与负向 `CFG` 条件，并输出真正的 `CONDITIONING` 数据，而不是提示词字符串。
- 节点内部保留 `VAEEncode`、`ReferenceLatent`、`CFGGuider`、采样执行、解码和结构锁定；缩放、噪声、采样器、`SIGMAS` 与空潜图保持外部可控接口。
- Gemini 光影专家只优化光线方向、阴影结构、层次分离和环境填充。
- 内置 `Flux Lock` 以原图为内容底板，仅从 Flux 建议图转移平滑光照场。
- 光位只保留主光、环境漫射/天光补光、主光投影附件，以及 `Fill`、`Rim`、`Back` 三盏辅助灯。
- 不包含洗图模式、摄影机参数或摄影机相关开关。

## 连接

1. `Scale Image to Total Pixels` 输出连接到本节点 `Working Image / Scaled Original`。
2. `UNETLoader` 的 Flux 模型输出连接到本节点 `Flux Model`。
3. `CLIPLoader` 的输出连接到本节点 `CLIP`。
4. `VAELoader` 的输出连接到本节点 `VAE`。
5. `RandomNoise` 输出连接到本节点 `Noise`。
6. `KSamplerSelect` 输出连接到本节点 `Sampler`。
7. `Flux2Scheduler` 输出连接到本节点 `Sigmas`。
8. `EmptyFlux2LatentImage` 输出连接到本节点 `Flux2 Empty Latent`。
9. 本节点 `Protected Relit Image` 直接连接到 `SaveImage` 或 `PreviewImage`。

将同一张缩放图像分支连接到 `GetImageSize`，再将宽高输出连接到外部
`Flux2Scheduler` 与 `EmptyFlux2LatentImage`，即可由外部尺寸链控制输出分辨率。

`ReferenceLatent`、`CFGGuider`、采样执行与 `VAEDecode` 在主节点内部用于生成受保护成图。
`Positive Conditioning (CFG)` 与 `Negative Conditioning (CFG)` 端口保留，内容已经包含 CLIP 编码和
工作图像的 Flux 参考潜在，不需要再接 `CLIPTextEncode` 或 `ReferenceLatent`。如果将这两个输出接到
外部 `CFGGuider` 后另行保存外部解码结果，该结果不会经过本节点的结构锁定。
光影元数据和 Gemini 专家报告输出可用于检查分析结果。

## Flux 严格保留原图

Flux 的参考图条件和提示词能够降低内容漂移，但不能单独保证人物和背景完全不被重新生成。
主节点会在内部生成 Flux 光照建议图后立即执行结构锁定：

```text
缩放后的工作图像 + Flux Model + CLIP + VAE + 外部 Noise/Sampler/Sigmas/Empty Latent
    -> Gemini Lighting Expert
       (Gemini 分析 -> CFG/ReferenceLatent -> 受控采样 -> 解码 -> Flux Lock)
    -> Protected Relit Image
```

`Working Image / Scaled Original` 是最终画面的唯一内容来源；节点不把 Flux 生成的人脸、纹理、
物体或背景像素混入输出，而是把 Flux 的低频照度变化乘回工作图像。光影优化本来就会改变明暗像素，
因此这里的“保留”指场景内容和纹理结构不被重绘。

- 缩放节点继续放在外部：它用于设置输出分辨率，主节点不再擅自调整图片尺寸或结构。
- `Flux CFG` 仍在工作台内可调；采样器、随机噪声和调度步数由外部节点设置。
- `Structure Lock Radius` 默认 `64`，数值越大越只保留宽泛、自然的布光变化，保护更严格。
- `Transfer Low-Frequency Light Color` 默认关闭，以避免材质颜色被模型偏色影响；需要暖光或冷光染色时再开启。
- 清晰的百叶窗或 Gobo 投影需要降低 `Structure Lock Radius`，这会允许更细的光纹进入输出，应只在原图主体保护可接受时使用。

旧工作流如果仍包含 `QwenCinematicLightingStudioV8Node`，请替换为 `Gemini Lighting Expert`，
将外部采样控制节点连接到主节点，并直接保存主节点的保护图像输出。工作流可能保存 API Key，不应提交到仓库。

## Gemini 配置

可以在工作台内的 `Gemini API Key` 密码框直接填写密钥。该值会随 ComfyUI 工作流保存，请不要
分享或提交包含密钥的工作流文件。仓库已忽略 `.env` 与常见工作流目录，但工作流文件位于其他
位置时仍应在上传前检查。

也可在启动 ComfyUI 前通过环境变量配置，节点填写值为空时会使用环境变量：

```bash
export GEMINI_API_KEY="your-api-key"
```

未提供密钥时，节点仍会根据手动灯位生成 CFG 条件，但不会将原图发送到 Gemini 做视觉分析。

## 终端日志

运行时可在 ComfyUI 控制台看到 `[Gemini Lighting Expert]` 日志：

- `Sending source image to gemini-3-flash-preview` 表示已开始发送原图进行分析。
- `Gemini lighting analysis applied` 表示专家分析已经并入 CFG 条件。
- `Gemini skipped` 或 `Gemini request failed` 表示本次使用了手动灯光规则回退。

## 设计原则

- 只改变光影，不替换主体、背景、道具、构图或透视。
- 手动灯位表达创作意图，Gemini 根据原图补充更合理的光影策略。
- 辅助灯限制为补光、轮廓光和背光，避免重复控制和过量光源。

## 现实灯光约束

- `环境漫射/天光补光` 表达天空散射光与场景反射形成的柔和填充，不是独立的大气特效，也不应生成新的硬阴影方向。
- `自然天光色温估算` 以开放天空补光为假设：暖色主光旁的环境填充默认偏冷；室内暖反射或特殊色光请关闭该选项并手动设定填充色温。
- 主光投影附件只保留六类可对应片场器材的效果：`百叶窗影`、`窗框投影`、`格栅影`、`树叶 Breakup`、`水纹效果投影`、`彩色效果玻璃`。
- `百叶窗影`、窗框、格栅与叶片 breakup 可由金属遮片或 Gobo 实现。纹理越清晰，光源越需要硬且可聚焦；大面积柔光下只应保留柔化后的光影分割。
- `水纹效果投影` 表达效果片或投影附件产生的动态/静态光纹，不会引入水面、潮湿材质或水下场景；`彩色效果玻璃` 只投射克制的彩色光，不会创建新的彩窗建筑。
- 旧工作流中的 `竹影`、`棕榈叶影` 自动归并为 `树叶 Breakup`，`几何阴影` 自动归并为 `格栅影`，以删除功能重复且动机不明确的控制项。
- `Fill` 默认较弱且柔和，`Rim` 默认从后侧分离轮廓，`Back` 默认从后方建立背光层次；启用后仍可按原图方向调整。
