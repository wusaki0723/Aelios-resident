# Android 原生通知（FCM）

Capacitor 原生壳使用 `window.Capacitor.Plugins.PushNotifications`，普通浏览器和 PWA 继续使用 Web Push。网页构建不需要安装 Capacitor 包。原生壳必须安装与 Capacitor 主版本匹配的 `@capacitor/push-notifications`，并同步 Android 工程。

## Firebase 配置

1. 在 Firebase 控制台创建项目，添加 Android 应用，填写壳的实际 applicationId。比如本地 Resident 壳使用 `si.dan9.resident`。
2. 下载 `google-services.json`，放到壳项目的 `android/app/google-services.json`，不要放在 Worker 仓库。Android 工程应保留 Capacitor 模板的条件配置：文件缺失时不应用 Google Services 插件，仍能构建，但该 APK 无法取得 FCM token。
3. 在同一 Firebase 项目确认 Firebase Cloud Messaging API（HTTP v1）已启用。
4. Firebase 控制台 → 项目设置 → 服务账号 → Firebase Admin SDK → 生成新的私钥。JSON 是服务端密钥，放在仓库外妥善保管，不发到聊天、不提交 Git、不放进 APK。使用具有发送 FCM 消息权限的服务账号。
5. 在 Worker 仓库目录执行以下命令，把文件作为一个完整的 JSON secret 上传（自行替换路径）：

   ```sh
   npx wrangler secret put FCM_SERVICE_ACCOUNT < /absolute/path/to/firebase-service-account.json
   ```

   这是线上操作，只在你准备上线时执行。Worker 名称来自仓库的 `wrangler.jsonc`。未设置 secret 时会直接跳过 FCM，Web Push 继续发送。配置错误则报告固定的发送失败信息，不回显账号、私钥、设备 token 或服务端原文。

6. 在壳目录重新执行构建脚本，例如 `./build-debug.sh`（先运行 `npm ci` 恢复依赖）。`cap sync android` 将插件配置同步到工程。安装新 APK 后，在通知设置里开启系统权限（Android 13 及以上需要授权）。
7. Worker 已关联 Git 仓库并启用自动部署时，将原生推送改动通过 PR 合并到 Cloudflare Builds 配置的生产分支（通常为 `main`），然后在 Cloudflare 控制台确认该提交构建、部署成功。这个流程不需要在本机执行 `npm run deploy`；本地提交、功能分支或未合并的 PR 不代表生产环境已经更新，非生产分支可能只生成预览版本。未配置自动部署的项目，才按仓库约定从已验证的版本执行 `npm run deploy`。

代码上线和 Firebase 配置是两步：`FCM_SERVICE_ACCOUNT` 要设置在实际运行的 Worker 的运行时 Secrets 中，仅放在 Builds 的构建环境变量里无法供运行时发送推送使用。Android 端也必须放好同一 Firebase 项目的 `google-services.json` 并重打 APK。两端就绪后，在 App 的通知设置里启用并点击“试一下”，确认真实送达；单纯合并 PR 不会自动补齐 Firebase 配置。

## 接口与设备名单

接口沿用网页门认证，默认住户为 `/web/...`，其他住户也可用 `/r/<id>/web/...`。所有住户共用默认住户的 `res_push_targets` SQLite 表，不需要新增 DO migration。Web Push 仍按原格式保存；FCM 使用内部 `fcm:<token>` endpoint、空的加密 key 列。共用现有 10 台设备上限，重复登记更新同一条，不多算设备。

- `POST /web/push/native/subscribe`：`{ "token": "...", "previousToken": "..." }`，`previousToken` 可省略；刷新令牌时删除旧值再登记新值。
- `POST /web/push/native/unsubscribe`：`{ "token": "..." }`，注销这台原生设备。
- 两个接口与 `GET /web/push` 一样返回 `{ publicKey, devices, mode }`，`devices` 包括两种设备。参数错误返回 400。
- “推什么”继续由当前住户的 `WEB_PUSH` 设置控制。主动找你、线程回报、闹钟、离开页面后的回复都经过原有统一发送路径，两种通道使用同一份标题、正文和目标 URL。“试一下”保持原有测试发送行为。

Worker 用 WebCrypto 的 RS256 签 JWT，以 `firebase.messaging` scope 向固定的 Google OAuth token endpoint 换 access token。每个默认住户对象只缓存已完成的 token 结果，过期前刷新；服务账号变更会使缓存失效。发送走 FCM HTTP v1，`notification` 带标题和正文，`data` 带 `title/body/url/tag/icon`。Android 壳负责点击后打开同源 `data.url`，没有地址时正常打开 App。FCM 返回 404 或 UNREGISTERED 会删除该设备；其他失败保留，以便后续重试。

## 本地验证

```sh
npm run typecheck
node test/fcm.mjs
node test/native-push.mjs
node test/native-push-ui.mjs
node test/web-push.mjs
node test/web-ui.mjs
```

`fcm.mjs` 使用内存里生成的临时 RSA 密钥和假的 Google HTTP 响应，验证签名、缓存、消息格式和失效处理；`native-push.mjs` 提取实际 Resident 方法，在 Node SQLite 上验证共用名单、上限、跨住户、通知策略和两通道发送。它们不向 Firebase 发请求。

`native-push-worker.mjs` 需要一个全新状态的本地测试 Worker，可用 `TEST_BASE_URL=http://127.0.0.1:8787 node test/native-push-worker.mjs`。仅连接 loopback，验证真实鉴权、参数校验、去重、令牌轮换、跨住户共享和未配置 secret 的跳过。启动 Wrangler 时应使用隔离的测试工作目录和 `wrangler.test.jsonc`，不要加载个人 `.env` / `.dev.vars`。

真正的 Firebase 送达、Android 前后台、系统杀进程后的通知和点击跳转，需要配置 Firebase 并在有 Google Play Services 的真机上验收。没有 Firebase 配置的可构建 APK 不能用于验证实际推送。
