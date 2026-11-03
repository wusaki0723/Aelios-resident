# DSH 集成 spec 审阅与落地门槛

审阅对象为 [原始 spec v0.1](dsh-integration-spec-v0.1.md)。该文件按用户提供的版本原样保存，SHA-256 为 `eb149f361f59ba90a16c66d248e5bf7f85c8c14a7b5b7a2dad3dab74712b3179`。本文是对它的实现审阅和待验证事项，不改写原文，也不代表所有设计已经通过验收。

审阅基线为 Resident `4e6fc4e`。此前桌面聊天 PoC 保留在独立本地分支 `feat/dsh-resident-desktop` 的 `cdda6fa`，本 PR 不包含该实现，不把它合入 Resident 正式架构。本次只提交设计材料及 PR 规则，不修改 Worker、任务存储、部署配置或已安装插件。

## 结论

采用 spec 的职责划分作为后续验证方向：Resident 管理产品主会话、人格、任务与主线程汇报；Aelios 保持长期记忆入口；插件提供 Resident UI 容器、设备连接、本机授权与 ACP Client；具体 Agent 在自己的 Harness 内推理。

首先执行 Phase 0。只有“原有 Resident UI 可以作为主要界面使用”和“插件可以驱动一个经过验证、权限受控的 ACP Agent”两项都通过，才进入 Resident Core 的数据结构和设备协议实现。

所有 Resident 改动通过独立分支提交 PR。未经用户对相应合并的明确授权，不直接推送 `main`、不合并、不启用自动合并。

## 既有 PoC 与目标的差距

| 范围 | 已有聊天 PoC | spec 目标 / 当前结论 |
|---|---|---|
| 代码归属 | 插件暂存 Resident 仓库子目录 | 正式插件独立仓库；Resident 仅提交自身接口与必要 UI 改动 |
| 桌面界面 | 自行绘制精简聊天面板 | 复用 Resident 完整界面，验证主要界面呈现和可退出模式 |
| 会话归属 | 复用云端同一聊天 | 方向一致；不得改成 DSH Session 承担产品身份 |
| 认证 | 使用网站 `WEB_KEY` 访问现有网页 API | 只能作为旧聊天入口 PoC；本地执行必须走每住户独立的设备配对和 scoped credential |
| 本地执行 | 没有 | 新增 Executor Adapter、设备领取、ACP Client、可信本机审批 |
| 线程 | 原网页链接 | 同一 Thread 下管理 Job 与外部会话，不把三者当作同一个 ID |
| 恢复 | 聊天轮询与草稿恢复 | 需要租约、持久 outbox、事件 ACK、reconcile 和取消状态机 |
| 验证 | Host 加载、15 项桥接测试、本地 Worker 双向聊天联调 | 不证明 root UI 复用、真实 ACP、设备权限或执行闭环成立 |

## 当前源码对照

以下模块应渐进扩展，不能按建议目录一次性搬家。

- [`src/cloud-tasks.ts`](../src/cloud-tasks.ts) 已定义任务记录、`root` / `follows` 关联、执行位置、卡片、额度与结果处理；现有 `TaskExecution = "local" | "linux" | "external"` 中，`local` 特指云端 Think 线程。新增设备执行不能把旧 `local` 值改解释为本机。
- [`src/resident.ts`](../src/resident.ts) 的 `cloud_task` / `sendTask` / `startTask` 是既有入口；应保留用户触发条件、每日及每轮限制、角色规则和读到外部内容后的派活限制。
- 同一模块的 `runLocalTask`、`taskReport`、`taskQuiet` 和 `tellAboutTask` 分别涉及 Think 线程、回报、失联检查和主会话提交。新设备事件应接入既有任务视图及汇报语义，但不能直接复用旧任务 code 作为设备长期身份。
- [`src/index.ts`](../src/index.ts) 的网页鉴权与住户路径分流、[`src/residents.ts`](../src/residents.ts) 的 `/r/<id>` 边界需要一起审计。新协议不能只因路径含住户 ID 就认为已鉴权；设备绑定、任务、租约和会话归属需要服务端联合检查。
- [`public/app.js`](../public/app.js) 当前注册根作用域 `/sw.js`，并按 `/` 查找 Service Worker。把前端资源搬到 DSH 同源时，必须先处理资源根路径、Service Worker scope、网页 API 地址和凭据存储边界。
- [`src/task-worker.ts`](../src/task-worker.ts)、[`src/task-roles.ts`](../src/task-roles.ts)、[`src/find-tools.ts`](../src/find-tools.ts) 以及已有任务回归套件继续作为兼容性约束。

## 正式编码前需补齐的协议细节

### 1. 配对必须证明“绑定的是哪台设备、哪个住户”

spec 已要求一次性配对、短 TTL 和 scoped token，但端点样例还不足以形成实现契约。需要明确挑战创建者、设备侧随机量或公钥的绑定、用户确认页显示的范围、兑换顺序、并发兑换冲突及失败响应。仅知道挑战 ID 不能自动成为已授权设备。

每个设备与住户的绑定独立存储、轮换与撤销。设备不能自报任意 `residentId` 取得访问权，云端权限也不能扩大本机工作区授权。网站钥匙不进入新执行器的常驻领取/回报链路。

### 2. 事件字段与 ACK 规则需要唯一契约

R5 要求 `deviceId` 等字段，示例事件没有全部展开；Job 类型和事件示例对住户、attempt、session generation 的承载也不完全相同。实现前定义统一 envelope，说明哪些字段由鉴权和数据库绑定推导，哪些必须由设备上送并比对。任何受信归属都不能仅采信客户端字符串。

至少覆盖 `deployment / resident binding / job / attempt / lease / sessionGeneration / eventId / seq` 的校验关系。区分以下情况：相同 ID 的相同事件、相同 ID 但 payload 冲突、乱序、缺失 seq、终态之后的进度、旧 generation 的迟到完成，以及撤销后的回报。

ACK 应明确是已持久化的事件 ID 集合、连续游标，还是其他形式。若采用连续游标，需要定义缺口如何补齐；进度合并、限流或丢弃也必须能得到明确 ACK/拒绝结果，避免 outbox 永久堆积或误删未提交事件。

### 3. 报告去重与外部副作用去重分开验证

事件 Inbox 可以实现幂等接收，不能因此承诺本机文件修改、Shell 或远端 Git 操作天然 exactly-once。网络断开或 lease 过期只说明云端失去确认，不证明旧进程停止。

`unknown → reconcile` 不能自动变成“创建新 Job 再执行一次”。先确认旧进程、Agent Session 和本机持久执行记录的状态，不能确认时需要人工决策或保持阻塞。相同任务的续做还应有 Thread / Session 级串行约束，防止同一外部会话被并发 prompt。

终态入库与待汇报 outbox 应一起持久化；主会话汇报使用稳定业务标识。当前 `tellAboutTask` 按当前时间构造消息 ID，这个路径本身不能作为新 Device Protocol 的跨重启去重证明。新增实现必须测试“终态已提交但汇报未入队”和“汇报已入队但 ACK 丢失”两个崩溃窗口。

### 4. 取消、租约与终态优先级需要明确

spec 正确地区分 `cancel_requested` 与 `cancelled`，但状态图还需要补充 `expired` 的终态定义，以及取消请求和成功完成同时到达时采用的规则。`expired` 不能在后续实现中一边算终态、一边无记录地重新领取。

设备轮换和撤销后应拒绝新的领取、续租和状态写入；已执行但未回传结果如何保留为审计信息，需要与“不得恢复该任务的有效状态”区分。重试时保持同一逻辑意图标识，新的 attempt、lease 和 generation 必须明确更新，不能复用旧身份覆盖新状态。

### 5. UI 复用要验证实际资源和退出路径

优先验证完整前端资源的复用。已有 UI 的根路径请求、Service Worker、通知、存储和媒体链接都需要在候选容器中实际运行。不能简单把网页 HTML 放进 DSH 根页面就认定完成。

远程 UI 是不可信的浏览器内容。它只能访问经校验的窄接口，不能共享任意本机工具或桥接凭据。配对设备权限与“用网页钥匙访问完整聊天/设置”的身份范围也应明确区分。

Gate 必须同时证明禁用插件或退出 Resident Mode 后可恢复原 DSH 页面，插件管理入口可达，不留下抢占根页面的注册或全站 Service Worker。若 root 替换在目标版本不能稳定支持，先调整容器方案，不提前重构云端任务表。

### 6. ACP 能力名称和安全保证必须来自实测

锁定 DSH 构建、Agent 实现与协议版本，保存 initialize 的真实协商结果。逐项测 new、prompt、更新事件、权限、取消和持久恢复，不因名为 ACP 就假设能 resume，也不把 draft 文档里的名称直接写死为已支持接口。

只读任务首先用假的 ACP Agent 验证消息和失败路径，再用明确允许的 Agent 验证真实工作区限制。`cwd` 或 UI 中选择了某个目录，不等于任意 Shell 已受该目录约束。若 Agent 能绕过客户端文件接口自行执行 Shell，必须证明其 sandbox/权限层同样生效；证明不了就不提供对应高权限能力。

对本机已有 Claude Desktop/Code 的测试继续遵守用户原有约束，不能因 spec 举例或 Agent 自动发现就擅自启动它们做验证。

## Phase 0 验收矩阵

| Gate | 所需证据 | 目前状态 |
|---|---|---|
| G0 版本与 API | 固定 DSH / Agent / ACP 版本及具体能力；记录实际 Service/Slot 契约 | 待本轮验证，旧 PoC 的版本事实仅供参考 |
| G1 原生 UI | 原有住户、聊天、线程、设置；刷新、登录、媒体、文件选择；真实桌面和窄屏检查 | 未通过；旧面板不构成替代证据 |
| G2 容器边界 | CSP、origin、资源根路径、Service Worker、凭据与窄桥接权限验证 | 未通过 |
| G3 本地 ACP | 一个经允许的 Agent 完成只读任务；事件、权限拒绝、取消和结束语义可复现 | 未通过 |
| G4 恢复能力 | 恢复真实支持则复用；不支持则明确 fallback；重启与断线后不重复执行 | 未通过 |
| G5 可退出 | 退出 Resident Mode、禁用插件、恢复 DSH 与插件管理入口 | 未通过 |

在 G1、G2、G3 和 G5 的核心路径通过之前，不推进 Resident Core 重构；G4 的恢复能力可以判定为不支持，但必须验证安全 fallback，而非假定存在恢复能力。

## 建议 PR 顺序

1. 本 PR 仅保存 spec、差距审阅与门槛，供人工评审；保持草稿，不合并。
2. 插件独立仓库的 Phase 0 PoC，验证 UI 容器和可退出模式，并记录原前端复用方式。
3. 插件的 ACP / 权限 Gate，与上一项并行研究，未通过不宣称本地任务可用。
4. Gate 通过后，Resident 的增量设备配对、虚拟执行器、事件 Inbox PR；完整保留三种旧后端语义。
5. 插件真实 ACP 和最终闭环联调分开 PR，新增离线、撤销、乱序、重复事件、恢复与旧后端回归测试。

## 本 PR 验证范围

仅文档与维护规则变更，无生产部署，无数据库迁移，无新 API，无 ACP 进程启动。检查原 spec 副本哈希、文档链接、diff 格式和项目类型检查；功能测试结果不能据此算作 Phase 0 已通过。
