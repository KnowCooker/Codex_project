# 开发交接记录

更新时间：2026-09-13

本文件用于在新的电脑或新的 Codex 任务中恢复项目上下文。继续开发前请同时阅读 `README.md` 和策划书 `噪声分析小程序项目策划书_V2.md`。

## 仓库与分支

- GitHub：`https://github.com/KnowCooker/Codex_project.git`
- 当前开发分支：`master`
- 小程序类型：原生微信小程序，无 npm 依赖
- iOS 测试 AppID：`wx4e4e4dd771fc9421`
- `project.config.json` 已配置上述 AppID

## 已确定的测试环境

- 手机：iPhone 16 Pro
- iOS：26.6.1
- 微信：8.0.76
- 耳机：AirPods Pro 3，型号 A3065
- AirPods 固件：尚未记录
- 首轮开发仅针对 iOS；耳机输入在完成真机路由验证前保持“未验证”状态

## 当前实现状态

- 48 kHz 单通道 PCM 输入，连续 7 Hz 高通和 FIR 抗混叠滤波后降采样至 2 kHz。
- 1024 样本 Hann 数据窗，零填充至 2048 点 FFT；频点间隔约 0.98 Hz，有效分辨率约 1.95 Hz，数据窗约 512 ms。
- 20–500 Hz 实时频谱，支持对数/线性横轴、自动/手动纵轴、刻度、虚线网格和手机宽度自适应。
- 频谱支持 A 计权和线性计权；单位分别显示为 dBA 和 dB。当前读数未经设备校准，只能视为估计相对声压级。
- 20–60 Hz、70–150 Hz、160–240 Hz 三段半透明频带背景。
- 实时指标包括总声压级，以及上述低、中、高三个频段的峰值。
- 可将当前频谱设为会话内参考；参考曲线为橙色虚线，并显示对应的四项参考指标。切换计权时实时和参考曲线及指标同步重算。
- 分析与录音分离，用户单独开始/结束录音，每段录音最长 30 秒。
- 已通过固定缓冲区、FFT/Hann/旋转因子缓存、绘图请求合并和按屏幕像素合并绘图点降低延迟与垃圾回收卡顿。
- 暂停操作先更新 UI 并停止后续 PCM 计算；暂停和继续按钮有不同颜色。
- 分析页已解除 `disableScroll`，新增指标超出一屏时可以自然下滑。
- 本地历史记录、详情页及两次顺序测量频谱对比已经具备初版功能。

## 已完成的代码级验证

- 所有 JavaScript 文件通过 `node --check`。
- FFT 复用缓冲区后连续 50 帧输出稳定。
- 40 Hz、100 Hz、200 Hz 测试信号峰值分别约为 40.04 Hz、99.61 Hz、200.20 Hz。
- A 计权修正在 20 Hz、100 Hz、500 Hz、1000 Hz 分别约为 -50.39 dB、-19.14 dB、-3.25 dB、0 dB。

## 尚需真机确认

- 微信开发者工具的 CLI 服务端口此前处于关闭状态，因此最新界面尚未完成 CLI 预览编译。路径：`设置 -> 安全设置 -> 服务端口`。
- 微信真机返回 PCM 的实际位深、字节序、采样率，以及 `audioSource` 在 iPhone 和 AirPods 下的真实路由。
- AirPods 断开事件、左右耳输入位置和固件版本。
- 暂停响应、频谱帧率、偶发卡顿、丢帧和发热情况。
- PCM 临时文件是否能直接回放；若不能，后续需要流式 WAV 封装。
- 设备麦克风尚未校准，不应把当前 dB/dBA 数值用作合规声级计读数。

## 协作约定

- 普通修改只保存在本地。
- 只有用户明确要求“同步/更新 GitHub”时才提交并推送。
- 修改前先执行 `git status --short --branch`，避免覆盖用户尚未提交的改动。
- 修改后至少执行 JavaScript 语法检查和 `git diff --check`；涉及 DSP/计权时补做对应数值回归。

## 在另一台电脑恢复

```powershell
git clone https://github.com/KnowCooker/Codex_project.git "Mini noise"
Set-Location "Mini noise"
git switch master
git pull --ff-only origin master
git status --short --branch
```

然后在 Codex 中打开克隆得到的 `Mini noise` 文件夹，发送：

> 请先完整阅读 DEVELOPMENT_HANDOFF.md、README.md 和噪声分析小程序项目策划书_V2.md，检查 git status，然后基于当前 master 继续开发。除非我明确要求，否则不要提交或推送 GitHub。

最后在微信开发者工具中导入同一文件夹，登录有该 AppID 权限的微信账号，并使用真机调试继续验证。
