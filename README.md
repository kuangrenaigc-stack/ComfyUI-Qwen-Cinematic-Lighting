# ComfyUI Gemini Lighting Expert

这是一个只针对原图光影优化的单节点工作台。配置 Gemini API Key 后，节点会将输入图像发送给
`gemini-3-flash-preview` 进行光影诊断，再把人工灯位控制和专家建议合并为可直接接入采样器的
CLIP 条件。

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

- 输入原图并直通输出图像。
- 接收 `CLIP`，节点内部编码正向和负向提示词。
- 输出 `Positive Conditioning (CFG)` 与 `Negative Conditioning (CFG)`，直接接入采样器。
- Gemini 光影专家只优化光线方向、阴影结构、层次分离和环境填充。
- 光位只保留主光、环境漫射/天光补光、主光投影附件，以及 `Fill`、`Rim`、`Back` 三盏辅助灯。
- 不包含洗图模式、摄影机参数或摄影机相关开关。

## 连接

1. 原图连接到 `Source Image`。
2. 模型加载器的 `CLIP` 输出连接到本节点 `CLIP`。
3. 本节点 `Positive Conditioning (CFG)` 连接到采样器正向条件。
4. 本节点 `Negative Conditioning (CFG)` 连接到采样器负向条件。
5. `Image` 输出继续连接到图生图或预览链路。

提示词、光影元数据和 Gemini 专家报告输出可用于检查分析结果。

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
