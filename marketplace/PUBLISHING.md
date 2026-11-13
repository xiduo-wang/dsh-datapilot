# 发布与上架 DataPilot

本插件已具备发布所需的全部文件（LICENSE / README / package.json 元数据 / cordis.patch.yml / 双面包 / 市场条目）。以下两步都需要你的账号凭据，我无法代办。

## 1. npm 发布（需要 2FA）

`dsh-datapilot` 尚未发布到 npm。npm 对新账号发布**强制要求 2FA**（`two-factor auth: disabled` 时也会被拦）：

```
E403 403 Forbidden - Two-factor authentication or granular access token
with bypass 2fa enabled is required to publish packages.
```

二选一：

- **方式 A（推荐）**：开启 2FA 后带 OTP 发布
  1. `npm profile enable-2fa auth-and-writes`（按提示用认证器扫码）
  2. `npm publish --otp=123456`（每次发布填当前动态码）

- **方式 B**：用「bypass 2FA」的细粒度令牌
  1. npmjs.com → Access Tokens → Generate New Token → Granular Access Token，
     勾选 **Packages and releases: Read and write**，并开启 **"bypass 2FA"**
  2. `npm config set //registry.npmjs.org/:_authToken=<令牌>`
  3. `npm publish`

发布后验证：`npm view dsh-datapilot version` 应返回 `0.1.0`。

## 2. 注册到插件市场（GitHub PR）

社区市场的目录来自 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
由 `scripts/build-site.mjs` 自动构建，**不要**给 `dsh-plugin-catalog` npm 包提 PR。

1. **推源码到 GitHub**（本仓库尚未建远程）：
   ```bash
   git remote add origin https://github.com/xiduo-wang/dsh-datapilot.git
   git push -u origin main
   ```
2. **提 PR** 到 `awesome-dsh-plugin/awesome-dsh-plugin`，加入一条目录条目——
   内容就是本目录的 [`marketplace/catalog-entry.json`](./catalog-entry.json)
   （schema 对齐 `plugins.json` 里的 `name/owner/url/page/category/description/npm/install/added/capabilities` 字段）。
3. 合并后插件会出现在 DSH 社区市场「Tools & Capabilities」（工具与能力）分类，
   `index.json`（DSH 0.2.1+ 的「发现 → 索引源」读取的格式）会由构建脚本自动生成。

## 3. 市场条目字段说明

- `capabilities`：本插件只读本地数据集（`fs-read`）与写上传目录/状态文件（`fs-write`），
  无 shell / 无网络 / 无 env。
- `install`：`dsh plugin add dsh-datapilot`（npm 发布后生效）。
- 可选：在 GitHub 仓库放 `assets/screenshot-*.png` 后填 `screenshots` 数组。
