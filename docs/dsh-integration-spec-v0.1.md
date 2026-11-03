# Aelios-resident × DeepSeek Harness：桌面插件与 Resident 本体改造 Spec

> **版本**：v0.1 · 2026-11-03  
> **状态**：Implementation Proposal / 待 PoC 验证  
> **覆盖仓库**：`wusaki0723/Aelios-resident`（必改）、新仓库 `dsh-plugin-aelios-resident`（新建）  
> **原则**：**一个 Resident、同一段主对话、多个可插拔执行环境。主线程轻量，副线程干活。**

## 0. 决策摘要（先读）

1. **桌面呈现 Resident 原生 UI**。安装并启用 DSH 插件后，用户进入 Resident 的住户列表、聊天、线程卡片和设置；不要求用户使用 DSH 原生聊天界面。参考 DS Bot 的产品交付方式，但不复制它的数据模型。
2. **Resident 保留唯一的产品级主会话与全局记忆入口**。Cloudflare Think Harness 继续负责人格、全局上下文、任务分派、事件收敛和最终用户交互；不把外部 Harness 的工作日志塞回主会话。
3. **修改 Resident 本体**，扩展现有 `cloud_task` 体系：从“按少数固定后端分派”演进成“Executor Adapter + Device Registry + Task/Session Mapping + Event Inbox”。保留所有既有云端执行方式。
4. **DSH 插件同时承担 UI Shell 与本机执行桥接**。它负责配对本机设备、发现可用 ACP Agent、建立/恢复会话、处理本地权限审批和上传必要任务事件；本地 Agent 的推理循环留在它自己的 Harness 内。
5. **ACP 只用在插件 ↔ 本地 Agent 的边界**。Resident 云端 ↔ 插件使用独立、版本化、鉴权的设备任务协议。此处无需让 Cloudflare Worker 直接启动 ACP 子进程。
6. **Aelios 不作为第一阶段改造对象**。它继续提供长期记忆 API、身份/记忆空间和 Dreaming；本次只定义 Resident 派发给副线程时的记忆上下文策略，不更改 Aelios 核心数据模型。
7. **同一线程 ≠ 同一底层会话**。Resident 线程是产品级任务容器；每次执行是 Job；ACP Session 只是某个 Job/Executor 可恢复的内部会话。

### 明确不做

- 不移植整套 Resident Cloudflare 逻辑到桌面，不要求本机常驻才可聊天。
- 不让 DSH 的 Session 成为 Resident 的用户身份或主要记忆来源。
- 不一次性把 GitHub Actions、claude.ai Routine、CF Think 线程全部迁移成 ACP。
- 不在 MVP 做跨 Agent Session 的无损迁移、不做通用远程 Shell API、不做自动静默删除文件。
- 不以 iframe/Remote WebView 能嵌入为既定事实；必须先验证 DSH UI 机制和目标页面 CSP。

---

## 1. 背景与现状

目前 Resident 运行在用户自己的 Cloudflare Worker / Durable Object 中。Web、Telegram、WeCom 共用住户主对话；Resident 接入 Aelios 长期记忆，支持多住户、主动消息、手写人设、云端后台任务。

现有后台能力（以 2026-11-03 README 为准）：

| 后端 | 当前特征 | 此次策略 |
|---|---|---|
| Resident / CF Think 线程 | 独立对话、文件；可在线程页面续聊；无本机 Shell | **保留**，Adapter 化但不改变现有语义 |
| GitHub Actions | 每次新机器，侧重代码、命令和 PR；复用结果但后续通常新 Job | **保留**一次性 Job 语义 |
| claude.ai Routine | 发起云端 Claude Code；相关会话可在 claude.ai 继续 | **保留**外部会话 URL / 回调 |
| DSH Local ACP（新增） | 用户设备在线；可访问用户授权本机工作区；部分 Agent 支持持续 Session | **新增** local executor |

已有的 `cloud_task`、角色（`coder` / `reviewer` / `researcher`）、`find`、线程卡片、结果回传队列、限额和触发安全条件是改造的兼容性约束。MVP 尽量扩展这些路径，不建设平行第二套任务系统。

### 用户故事

- **仅有手机**：用户无需电脑，在 Resident 内正常聊天，继续使用 CF 线程、GitHub Actions 或 claude.ai Routine。
- **已经安装 DSH 的电脑用户**：启用插件、配对已有 Resident 后，打开的主界面就是 Resident UI；与手机/Telegram 是同一段对话。
- **本地文件任务**：用户说“整理我电脑上授权的 `Documents/Reports`”；Resident 选择已在线的本机 Executor，创建副线程；操作需要批准时弹出本机授权；完成后同一 Resident 对话出现结果卡片。
- **续做**：用户说“把刚才的脚本再改一下”；Resident 找到原线程，优先复用同设备、同 Agent、同工作区的可恢复 Session。
- **离线**：电脑休眠后 Resident 仍可聊天；本地任务状态显示 `waiting_device`，设备恢复连接后可自动领取之前明确授权的任务（受过期策略限制）。
- **跨端查询**：用户在 Telegram 询问之前本地任务结果，可以查看报告；不能从 Telegram 绕过本机文件审批。

---

## 2. 逻辑架构与数据归属

```text
                         Web / Telegram / WeCom / DSH 桌面 UI
                                           │
                                           ▼
                            Resident 主会话（CF Think）
                           人格 · Aelios · 路由 · 最终回复
                                           │
                                           ▼
                              Resident Task Service
           Thread / Job / Executor / Device / Lease / Event Inbox
                           │                          │
             Cloud Adapters │                          │ Device Protocol v1
                           │                          │  HTTPS polling / WSS(可选)
      ┌────────────────────┼───────────────────┐      ▼
      │                    │                   │   DSH Plugin Host
  CF Think Thread    GitHub Actions     claude.ai     配对 · Agent Registry
      │                    │                   │    ACP Client · Permission Gate
      └────────────────────┴───────────────────┘      │
                                                     ▼
                                      DSH ACP / Codex ACP / 其他 ACP Agent
                                                     │
                                        用户授权的本机 Workspace

                       Aelios = 独立长期记忆 API（主会话使用）
```

**权威来源（Source of Truth）**

| 资源 | 权威归属 | 同步规则 |
|---|---|---|
| 住户身份、人设、主对话、跨渠道消息 | Resident | 桌面只读取/提交至现有 Resident |
| 长期记忆/夜间 Dreaming | Aelios | 本次保持现状 |
| Thread、Job、状态、任务与外部 Session 映射 | Resident Durable Object | 客户端只上报事件，服务端归并状态 |
| ACP 过程、工具日志、原始 Session | 本地 Harness / DSH | 仅上报进度摘要、权限请求和必要产物引用 |
| 设备身份、允许工作区、权限策略 | Resident 保存设备关联；**本机保存实际授权根路径与审批状态** | 云端不能扩大本机权限；本机二次校验 |
| 本机文件内容 | 用户电脑 | 默认不复制到云端；只有明确授权后上传所选产物 |

**多住户边界**：设备可配对某一 Resident 部署中的一个或多个住户，但每个绑定有独立授权；`resident_id` 必须在所有任务、设备、线程、事件和审计记录里参与鉴权。不得因为同一台设备上登录了两个住户就交叉提供文件权限。

---

## 3. Resident 本体改造（核心范围）

### R1. Executor Registry 与能力声明（P0）

引入轻量注册表；执行器可以是固定云端适配器，或由已配对设备动态上报。

```ts
export type ExecutionLocation = 'cloud' | 'device';
export type ExecutorKind = 'cf-think' | 'github-actions' | 'claude-routine' | 'acp';

export interface ExecutorDescriptor {
  executorId: string;         // 稳定、租户隔离；如 device:abc:codex
  kind: ExecutorKind;
  location: ExecutionLocation;
  deviceId?: string;
  displayName: string;
  online: boolean;
  capabilities: {
    shell: boolean;
    filesystem: boolean;
    resume: boolean;          // 真实能力探测，不能假设所有 ACP Agent 都支持
    cancel: boolean;
    progress: boolean;
    permissions: boolean;
    supportedArtifacts?: string[];
  };
  workspaceIds?: string[];    // 仅暴露不敏感的授权工作区标识，不发云端真实绝对路径
  lastSeenAt?: string;
  protocolVersion: number;
}
```

- Registry 不随每次主线程推理改变系统工具描述，避免破坏主线程提示词缓存。主模型仅看到精简且稳定的 `cloud_task` 接口；具体可用执行器由服务端策略计算。
- 自动路由基于**任务所需能力、数据所在位置、在线状态、已绑定线程和用户偏好**。不可只按 `coder/researcher` 角色硬编码。
- 用户明确指定“本机”“这台电脑”“云端”时优先尊重；权限不足或设备离线必须返回清晰错误/候选方案，不能悄悄换执行环境。
- 现有安全规则维持：发起任务的主会话用户触发限制、并发/额度上限、工具读取过外部不可信内容之后不得直接发起新高权限任务；设备配对不提升主线程权限。

### R2. Thread / Job / External Session 三层标识（P0）

```ts
interface ResidentThread {
  threadId: string;           // 用户可见、长寿的产品任务
  residentId: string;
  title: string;
  role?: string;
  defaultExecutorId?: string;
  lastJobId?: string;
  createdAt: number;
  updatedAt: number;
}

interface ResidentJob {
  jobId: string;              // 每次执行的唯一 ID
  threadId: string;
  executorId: string;
  deviceId?: string;
  state: JobState;
  attempt: number;
  leaseUntil?: number;
  idempotencyKey: string;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
}

type JobState =
  | 'queued' | 'waiting_device' | 'claimed' | 'running'
  | 'waiting_approval' | 'completed' | 'failed'
  | 'cancel_requested' | 'cancelled' | 'expired' | 'unknown';

interface ExternalSessionRef {
  jobId: string;
  executorId: string;
  deviceId?: string;
  agentId?: string;
  opaqueSessionId?: string;    // ACP ID 原样保存，禁止拼装或猜测
  resumable: boolean;
  sessionGeneration: number;   // 用于防止旧 session 的回调覆盖新会话
}
```

- 旧数据保留，采用 additive migration；读取旧记录时转换成统一视图，不要求一次性迁走旧线程。
- 历史任务的恢复规则由 Adapter 提供：CF 原生线程继续；Actions 新建关联 Job；claude.ai 保留原有外部继续行为；ACP 依据握手能力与持久化状态判断。
- 不允许后台进度更新直接覆盖用户消息；由 Resident 主会话在适当时机进行最终汇报。

### R3. 统一 Executor Adapter（P0）

```ts
interface ExecutorAdapter {
  kind: ExecutorKind;
  describe(): Promise<ExecutorDescriptor[]>;
  start(job: ResidentJob, payload: TaskPayload): Promise<DispatchReceipt>;
  resume?(job: ResidentJob, input: TaskPayload): Promise<DispatchReceipt>;
  cancel?(job: ResidentJob): Promise<void>;
  reconcile?(job: ResidentJob): Promise<JobReconcileResult>;
}

interface TaskPayload {
  task: string;
  role?: string;
  contextSummary?: string;    // 只含任务必要背景
  allowedMemoryRefs?: string[];
  workspaceId?: string;
  artifactPolicy?: 'metadata-only' | 'selected-files';
}
```

- 新增 `acp-device` Adapter，云端注册表中对应本机代理；其他三类保持原有实现、外包到适配接口。
- `cloud_task` **保持外部模型可见名称和参数向后兼容**；若确需加可选 `execution_preference`，须有默认值，先不改老字段语义。
- 对模型的描述只说任务委派能力，不注入所有设备清单；设备路由放在工具实现内部。
- `find`、角色配置、线程列表与原有卡片都读同一 Thread/Job 视图。

### R4. 设备配对 / 设备状态（P0）

- 设置页新增“本地设备”区域：创建短时配对挑战 → DSH 插件确认 → 绑定到当前 Resident / 住户 → 查看/撤销授权。
- 本机为每个绑定持有独立设备凭据，存放系统安全存储或等效受保护存储；云端仅保存其可验证摘要/公钥及权限范围，不在 URL、聊天、任务日志中输出凭据。
- 设备上报 `protocolVersion`、插件版本、Agent 列表、在线状态、最大并发；**不上传系统用户名、全盘路径、环境变量或文件列表**。
- 设备离线阈值由服务端心跳和租约判断，前端显示“最近在线”而非假装实时在线。
- 可撤销设备、轮换凭据，撤销后拒绝一切新领取和事件提交。

### R5. 统一任务事件与主线程收敛（P0）

事件类型：`accepted`、`started`、`progress`、`permission_required`、`permission_resolved`、`artifact_added`、`completed`、`failed`、`cancelled`、`heartbeat`。

- 每事件包含 `eventId`、`jobId`、`deviceId`、`seq`、`timestamp`、`type`、版本号和经裁剪的 payload。
- Resident 事件 Inbox 根据 `eventId` 去重，根据 `seq` 做单 Job 单调状态合并，拒绝过期 lease / 已失效 generation 的结果。
- `progress` 合并并限流；`completed/failed/cancelled` 为终态，终态需要原子落库再通知主会话。不得重复汇报。
- 推送给 Web/Telegram/WeCom 的内容由 Resident 控制；副线程不能绕过住户直接向用户发消息。
- 不为每个进度事件触发主线程模型推理；只有“需要用户决定”“完成/失败”等关键事件进入低频汇报队列。

### R6. 统一线程 UI 数据（P1）

扩展已有卡片而不重做 UI 体系：

- 显示 Executor 名称、设备在线状态、当前任务进度、已授权工作区名称。
- 显示“继续 / 停止 / 重试 / 打开文件所在位置”（动作受能力约束）。
- 可展开执行摘要、变更文件列表和 Diff/预览；本地路径转换由插件实现，不直接把 `file://` 链接当成远端浏览器链接。
- 在普通 Web / 手机上，“打开本机文件”提示需在原设备操作；可查看已回传的报告摘要。
- 桌面 UI 仍沿用同一消息、搜索、住户、记忆和线程 API。

---

## 4. DSH 插件设计

### P1. 插件包装与 UI 模式

建议包名：`dsh-plugin-aelios-resident`（最终按 DSH 包名规范确定）。

安装后用户在 DSH 中启用 **Resident Mode**，呈现 Resident 原有的住户页面：

- 一级导航：住户 / 聊天 / 线程 / 设置（复用 Resident 原 UI 的组织与风格）。
- 初次启动：填写自己的 Resident HTTPS 地址 → 配对设备 → 授权必要工作区 → 选择默认 ACP Agent。
- 有多个 Resident/住户：切换时不重用其他住户的授权令牌或工作区策略。
- 用户关闭 DSH 或断网后，云端 Resident 和手机端保持可用。

**UI 技术路线（设为 Gate，不预设已验证）**：

A. 首选验证 DSH `root` Slot / Profile patch 是否能将默认 AppFrame 替换成 Resident UI 容器。DSH 的 Slot 系统支持 single priority 和根插槽，但具体替换范围以及 Desktop 版本必须实测。

B. 资源复用顺序：**完整复用 Resident 前端构建产物** ＞ 复用同源 WebView 导航至已有 Web door ＞ 从头重写。若使用远程 WebView，验证 CSP / X-Frame-Options、Cookie、授权、文件选择、通知以及窗口刷新；不要把全部原生能力直接暴露给远端网页。

C. 可信本机 Host 与远端 UI 必须隔离。Native Bridge 使用有 origin 校验、schema 校验与权限隔离的狭窄 API；敏感文件访问必须由插件 Host 控制，不能依靠前端隐藏按钮。

D. 实现可关闭/退出 Resident Mode，恢复 DSH 原有页面；避免无法进入插件管理页的“锁死”模式。

### P2. 插件 Host 服务

职责：

1. 管理设备注册、心跳、凭据轮换、断线重连。
2. 托管本地 ACP Client，发现、启动、重连允许的 ACP Agent；控制其子进程生命周期。
3. 将 Resident Job 映射到本地 `agentId + sessionId + cwd + permissionContext`。
4. 管理工作区允许列表、文件读写、Shell 权限审批和审计记录。
5. 将 ACP 更新转换为 Device Protocol 事件；对速率、payload 大小、日志中的敏感字段做裁剪。
6. 保存尚未确认上传的事件游标；重连时重发并按 ACK 裁剪。

不承担：Resident 人格、主聊天推理、全局长期记忆决策；默认不把全部 DSH 聊天历史同步给 Aelios。

### P3. ACP 能力适配

插件作为 **ACP Client**，本地 Harness 作为 **ACP Agent**。

必测能力：`initialize`、认证（如有）、`session/new`、`session/prompt`、更新事件、权限请求、`session/cancel`；针对会话恢复探测 `session/load` 或 `session/resume` 及具体版本的支持情况。

**注意**：ACP v1 草案与 v2 在 `session/prompt` 的接受/结束语义、`session/load`/`session/resume`、cancel 完成事件上存在显著差异。**协议版本由握手决定，不能根据“支持 ACP”就假设支持 v2 的 API 或持久恢复**。插件内部实现 `AcpVersionAdapter`，对 Resident 统一输出标准事件。

- Agent 声明可续跑且会话可恢复时复用旧 session；否则在同一 Resident Thread 下启动新的 Job，把上一次的简短任务摘要作为输入。
- 停止只在 Agent 确认取消或超时回收后标记终态；`cancel_requested` 与 `cancelled` 必须区分。
- Agent 报告“需要权限”时，阻塞该工具调用并等待授权，绝不静默放行。
- 初期只支持一个经过验证的 DSH ACP Agent；第二个 Agent 用来测试适配器通用性。

### P4. 本地权限模型

最小权限是产品要求，不仅仅是底层 Sandbox 的选择。

- 用户选择工作区，默认只读；首次需要写入时按动作类别提示提升授权。
- `cwd`、`additionalDirectories` 只能从本机授权列表生成；真实路径解析后校验 symlink / 路径穿越，拒绝越界。
- 删除、批量覆盖、Git push、安装软件、执行外部脚本、读取凭据或访问超出授权目录：必须明确审批或拒绝。
- 允许针对单次操作、一次任务、受信工作区的分级授权；“永久允许所有 Shell”不能作为默认选项。
- API Key、SSH Key、浏览器 Cookie、系统钥匙串等机密不进入 Resident 任务正文、Aelios 记忆或工具日志。
- 云端主线程或 Telegram 的普通指令不得替代本机审批。审批应显示具体设备/工作区/操作/影响范围。

---

## 5. Resident ↔ 本机插件：Device Protocol v1

### 5.1 传输选择

**MVP：由本机主动发起 HTTPS 长轮询 + POST 事件**。这样无需公网 IP、开放入站端口、Cloudflare Tunnel 或始终在线的 WebSocket。

有真实延迟需求时升级为 WSS 双向连接（可使用 Durable Object 管理在线连接），保留相同消息语义、幂等逻辑与鉴权。传输与语义解耦。

### 5.2 拟议 REST 端点

> 以下是**建议新增**的 API，当前仓库未证实已有这些路径。

| 端点 | 调用方 | 用途 |
|---|---|---|
| `POST /api/device-pairing/start` | 已登录 Resident Web UI | 建立一次性短时配对挑战 |
| `POST /api/device-pairing/confirm` | DSH 插件 Host | 确认用户已批准的挑战，绑定设备 |
| `GET /api/devices` | Resident UI | 列出已绑定设备 / 状态 |
| `POST /api/devices/{deviceId}/revoke` | Resident UI | 撤销授权 |
| `POST /api/device/v1/heartbeat` | 设备 | 上报在线、能力摘要和当前负载 |
| `POST /api/device/v1/claim` | 设备 | 获取一个已可领取任务，创建租约 |
| `POST /api/device/v1/jobs/{jobId}/events` | 设备 | 幂等批量上报事件 |
| `POST /api/device/v1/jobs/{jobId}/renew` | 设备 | 延续 lease，避免重复执行 |
| `GET /api/device/v1/jobs/{jobId}/commands` | 设备 | 获取取消、继续等命令（或附在 claim/heartbeat 响应） |
| `POST /api/threads/{threadId}/followup` | Resident UI | 对原线程追加新指令（内部选择恢复或新 Job） |

身份鉴权：设备 scoped token（或公钥签名请求），包含 `deploymentId/residentId/deviceId` 绑定；所有服务端设备路由必须验证身份和资源归属。配对 token 一次性使用、短 TTL；轮换 / 撤销后立即失效。对设备来源限流，不依赖客户端自行声明的 `residentId` 作为可信事实。

### 5.3 消息示例

```json
{
  "protocol": "resident-device/1",
  "jobId": "job_01",
  "threadId": "thread_42",
  "executorId": "device:dev_8:agent_dsh",
  "workspaceId": "ws_reports",
  "leaseId": "lease_a1",
  "attempt": 1,
  "task": {
    "instruction": "列出已授权报告目录中的文件并给出分类建议",
    "role": "researcher",
    "contextSummary": "只整理文件元数据，不修改文件",
    "artifactPolicy": "metadata-only"
  }
}
```

```json
{
  "protocol": "resident-device/1",
  "eventId": "evt_0007",
  "jobId": "job_01",
  "leaseId": "lease_a1",
  "seq": 7,
  "type": "completed",
  "timestamp": 1793700000000,
  "payload": {
    "summary": "发现 12 个文件，已按类型列出建议；未进行写入",
    "artifacts": []
  }
}
```

### 5.4 状态与重试

```text
queued --设备离线--> waiting_device --上线并领取--> claimed --> running
   |                         |                           |          |
   └-----取消/过期----------> expired                     |          ├--> waiting_approval --> running
                                                         |          ├--> completed
                                                         |          ├--> failed
                                                         |          └--> cancel_requested --> cancelled
                                                         └--租约失效 / 进程崩溃--> unknown → reconcile
```

规则：

- Job `idempotencyKey` 在重试时保持不变，领取动作必须 CAS/事务化；事件采用 `eventId + seq + leaseId` 幂等。
- 网络断开 ≠ 任务停止。租约超时的任务先进入 `unknown` 并 reconcile；**禁止在同一有副作用任务上直接并行重放**。
- Agent 断线恢复：验证本地 session 存在且可恢复，才能继续；恢复失败时保留 Thread、创建新关联 Job，并标明之前任务可能已有部分文件修改。
- 桌面端仅在明确用户授权“离线后继续”且任务未超过 TTL 时自动领取；对删除类任务重新审批。
- 产物上报：默认摘要、哈希、大小、相对路径或本机 artifactId。只有用户明确请求、适配器支持且文件大小在允许范围内才上传文件内容。

---

## 6. UI 行为与交互准则

### 6.1 初次安装

1. 安装 / 启用插件 → Resident Mode 欢迎页。
2. 输入 Resident 域名（仅 HTTPS；localhost 开发模式例外）。
3. 在原 Resident 设置页发起配对或使用浏览器安全确认；显示待配对的设备名称与请求权限，用户确认。
4. 显示设备已连接；选择 `Downloads`、某项目目录等工作区。
5. 选择已发现的 ACP Agent，执行只读测试任务。
6. 进入原 Resident 主界面，能够看到已有对话、住户、记忆、线程卡片。

### 6.2 任务卡片（建议）

```text
[正在处理] 整理季度报表
DSH Desktop · 本机电脑 · Reports 工作区
进度：正在读取 12 个文件（概要）
[查看任务]  [暂停/停止]

如果需要写入：
[需要你的批准] 移动 8 个文件到 Archive 文件夹
[查看变更] [批准一次] [拒绝]

完成后：
[已完成] 已整理 8 个文件，4 个未改动
[查看变更] [在本机打开] [继续这个任务]
```

注意审批是**本地 Host 的可信窗口**，聊天卡片只显示待审批状态并可引导打开本机审批。一个远程 Web UI/移动端按钮不能直接提升本机权限。

### 6.3 兼容原 UI

- 住户切换、原聊天流、引用、检索、语音、贴纸、handoff letter、模型切换仍按现有 Resident API 工作。
- 不因桌面插件上线而修改 Telegram / WeCom 的聊天方式；结果回传沿用原有队列和主会话汇报语义。
- 任务详情可展开本地执行信息，但默认只给用户看摘要；日志及工具详情按需加载。

---

## 7. 安全与隐私验收（阻断项）

1. 未配对设备不能登记 Executor 或领取任务；撤销立即失效。
2. 任意一个住户不能访问其他住户的设备、工作区、任务、ACP session、产物。
3. 所有本机操作由可信 Host 校验权限；云端/模型生成的路径与命令均为不可信输入。
4. Symlink、`..`、UNC、符号路径别名、大小写差异等绕过路径边界的尝试被拒绝。
5. 远程 UI / iframe / 站点 JS 不能直接调用任意 Shell 或读取本机敏感文件。
6. 任何来自文件内容、MCP 结果、网页、Agent stdout 的提示注入不能取得授权升级。
7. 机密字符串不进入普通任务日志、线程卡片、Aelios 记忆或错误栈。
8. 重试/断线不会重复执行不可逆操作；取消与最终完成的竞态正确处理。
9. Cloudflare / DSH 版本变化不能导致静默权限放宽；降级时宁可拒绝执行。
10. 审计可追溯：用户批准时间、设备、工作区、操作类别、Job ID；审计摘要不泄露敏感内容。

---

## 8. 实施顺序与验收标准

### Phase 0：接口可行性验证（Gate，先于正式开发）

**目标**：验证技术约束，避免先重构 Resident 后才发现 DSH UI/ACP 不可行。

- [ ] 锁定 DSH Desktop 版本，确认插件包结构、Host 生命周期、Client `root` 替换能力。
- [ ] 打开 Resident 原生页面或挂载其构建产物；验证 UI 可独立呈现及刷新、登录、CSP、文件选择。
- [ ] 从插件 Host 建立本地 ACP 会话，执行只读命令，捕获进度、权限请求、结束事件。
- [ ] 检查 ACP Agent 的协议版本及 `resume` 能力；不支持时记录准确的 fallback。
- [ ] 证明 Host / Remote UI 隔离、关闭插件后 DSH 原界面可恢复。

**Gate 通过条件**：现有 Resident UI 能作为 DSH 的主要界面使用，且 DSH 插件可驱动至少一个 ACP Agent；如任一失败，先修改桌面技术方案，不推进数据库重构。

### Phase 1：Resident Core 最小改造

- [ ] 新增 Executor Registry + `acp-device` Adapter（不变更现有三个后端结果）。
- [ ] Thread / Job / SessionRef 统一映射，提供旧数据兼容读取。
- [ ] Device Pairing / Device Claim / Event Inbox APIs，协议版本号、验证、幂等。
- [ ] 保留旧 `cloud_task` 调用入口、主会话工具数量和安全触发限制。
- [ ] 测试中设备离线时 CF / Actions / Routine 仍可正常使用。

### Phase 2：插件闭环 MVP

- [ ] 原生 Resident UI 作为 DSH 主要界面，完成配对和住户切换。
- [ ] DSH 插件发现一个 ACP Agent，允许选择只读本地目录。
- [ ] Resident 创建 Job → 插件领取 → ACP 执行 → 回传 → 线程卡片显示结果 → 主会话汇报。
- [ ] 用户在原线程追加指令；能恢复则续跑，不能恢复则保留 Thread 创建新 Job。
- [ ] 设备离线/重连/取消/权限拒绝/错误/撤销等异常路径全部覆盖。

### Phase 3：体验与扩展

- [ ] 多 ACP Agent、多授权工作区、多设备（须显式选择设备或按策略路由）。
- [ ] Task Diff、变更预览、本机打开文件，进度可视化。
- [ ] WSS 低延迟通道（若长轮询实测不满足体验）。
- [ ] 能力驱动自动路由与偏好设置；基于效果再考虑云端 Think 推理 + 远程本机 Tool Bridge。
- [ ] 视需要推出“自带 DSH 的 Resident 桌面安装包”；仍支持插件安装形态。

### 关键端到端验收场景

1. **同一聊天**：手机、Telegram、DSH Desktop 显示同一个住户会话；从任意端发出的消息在原有同步机制下可见。
2. **本机只读任务**：主线程响应不被后台 ACP 阻塞；任务在同一线程卡片中完成并准确报告。
3. **追加任务**：前一个 Thread 上的“继续”能恢复 ACP 会话（若 Agent 支持）；否则创建关联 Job，用户不必管理 sessionId。
4. **拒绝权限**：未经批准不得移动文件；拒绝后任务明确暂停/失败，主线程收到真实状态。
5. **断网恢复**：执行完成但事件未送达时重新连接，只补报一次结果；任务不重复执行。
6. **手机用户不回归**：从未安装 DSH 的用户继续使用现有云端任务；没有设备概念的情况下 UI 不报错。
7. **旧任务不回归**：CF 原生线程直连继续；Actions 保持一次性；claude.ai 保持外部会话行为。
8. **隔离**：两住户与两设备之间，跨租户访问和未经授权工作区访问全部拒绝。

---

## 9. 建议的代码组织（目标结构，不代表现有路径已存在）

### `Aelios-resident`

```text
src/
  tasks/
    executor-registry.ts
    adapters/{cf-think,github-actions,claude-routine,acp-device}.ts
    task-service.ts
    task-events.ts
    session-mapping.ts
  devices/
    pairing.ts
    registry.ts
    auth.ts
    device-routes.ts
  web/
    [沿用原有聊天与线程 UI；只增设备状态/扩展卡片]
test/
  task-adapter-compat.test.ts
  device-auth.test.ts
  device-event-idempotency.test.ts
  thread-continuation.test.ts
```

**落地前先做代码审计**：找到当前 `cloud_task`、背景任务表/存储、Web 路由、事件回调和角色系统的实际文件；优先在原模块内渐进重构，不按此目录机械搬家。

### 新 `dsh-plugin-aelios-resident`

```text
src/
  host/
    device-client.ts
    pairing.ts
    acp-manager.ts
    acp-version-adapters.ts
    workspace-policy.ts
    permission-gate.ts
    event-outbox.ts
  client/
    resident-root.tsx
    pairing-view.tsx
    device-settings.tsx
    trusted-bridge.ts
  shared/
    device-protocol.ts
    task-events.ts
    schemas.ts
  test/
    fake-acp-agent.ts
    bridge-auth.test.ts
    resumability.test.ts
```

### 建议测试命令

Resident 先按仓库 `AGENTS.md` 运行 `npm ci`、`npm run typecheck`，再跑 `docs/testing.md` 中对应模块的本地假服务测试。插件侧新增契约测试，确保无需真实 Cloudflare 账号、真实模型额度即可验证失败/恢复分支。

---

## 10. 待验证技术风险 / 决策记录

| ID | 风险 / 未确认事实 | 处理方式 |
|---|---|---|
| D-01 | DSH `root` Slot 是否能完整替换 Desktop 主界面 | Phase 0 验证，准备 Profile override / 自定义 Bundle 备选 |
| D-02 | 现有 Resident Web 前端能否复用而不触发跨域/CSP/认证问题 | 同源容器 PoC；必要时从原仓库打包 UI 构建资源 |
| D-03 | DSH 现有 ACP Server 是否可供插件直接使用，还是须独立拉起子进程 | 源码 + 版本锁定 + 实测；不能仅凭文档名称推断 |
| D-04 | ACP v1/v2 与不同 Agent 的恢复、取消、权限差异 | 版本适配，Capability handshake，契约测试 |
| D-05 | Durable Object 的任务队列和设备连接开销 | MVP HTTPS 长轮询，测量后再决定是否 WSS |
| D-06 | 用户 `WEB_KEY` 的现有认证与设备凭据的最小权限关系 | 设备专用 token；禁止把 `WEB_KEY` 当永久设备 token |
| D-07 | 本地路径 / Diff / Artifact 的安全展示 | Host 按授权工作区映射 `artifactId`；不信任远程 URL |
| D-08 | 现有云端后台任务安全护栏能否完整复用 | 新增回归测试并对 `acp-device` 使用更严格策略 |
| D-09 | DSH 插件升级破坏 Client Slots 和 Host API | 锁版本、冒烟测试、用户可回退 Resident Mode |

### 推荐的第一条 PR 拆分

- **PR-1（DSH 插件）**：仅做 UI Root 替换 + 连接状态假数据；验证原生 Resident 界面的复用。
- **PR-2（Resident）**：设备配对/注册/一个虚拟 Executor + 事件 Inbox，不接真实 ACP。
- **PR-3（插件）**：本机 ACP 执行和权限审批，通过假 Resident 接口完成测试。
- **PR-4（联调）**：打通真实 Resident `cloud_task` → Device Job → ACP → Thread report；添加回归测试。

**完成定义**：用户可在原 Resident 对话下达本机文件任务，DSH 插件在授权目录内完成任务，并在原线程与主对话看到准确结果；没有电脑的用户完全不受影响。

---

## 参考资料（2026-11-03 检索）

- [Aelios-resident README](https://github.com/wusaki0723/Aelios-resident)
- [Aelios-resident AGENTS.md](https://raw.githubusercontent.com/wusaki0723/Aelios-resident/main/AGENTS.md)
- [Aelios](https://github.com/wusaki0723/Aelios)
- [DeepSeek Harness Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DeepSeek Harness Web Client Slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md)
- [DS Bot（产品参考）](https://github.com/Fei2411/DS-Bot)
- [Agent Client Protocol v1 Overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/draft/overview.mdx)
- [Agent Client Protocol v2 Overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx)
- 用户分享的《Exploring Super-agent Design: Towards a More Autonomous Agent System》（2026-11-01；重点第 2、4、5、8 节）

> **实现提醒**：这是以公开仓库 README、维护指南、协议文档和用户需求为依据的设计 Spec。尚未在 DSH Desktop 中编译插件或验证完整 UI 替换，也尚未逐文件审计 Resident 源码。所有“建议新增”的接口、文件路径与类型都是目标设计，不能被误写成现有实现。
