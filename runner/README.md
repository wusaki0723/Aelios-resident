# aelios-runner

在一台机器上替住户干活。可以不开界面长期跑，本地电脑和 VPS 装法一样。

```
云端住户 ──(runner 往外连)── runner ──(ACP，stdio)── 帮手：Kiro / DSH / 任何说 ACP 的命令
```

runner 不开端口，只往云端发请求。协议见 [PROTOCOL.md](PROTOCOL.md)。云端那一半在 `src/machine.ts`。

## 装

要 Node 22 或更新。没有依赖。

```sh
cd runner
npm link          # 得到 aelios-runner 命令；不想 link 就用 node bin/aelios-runner.mjs
```

## 配对

在住户的设置页（后台帮忙 → 机器）点「生成配对码」，把码用 `--code pc_…` 给 runner（10 分钟内有效，用一次就作废）。也可以不用配对码，改给住户的网页钥匙（`WEB_KEY`）：它只在配对这一刻用，不会写到硬盘，用环境变量给，或者按提示输入。

```sh
aelios-runner pair --code pc_… \
  --url https://你的住户.workers.dev \
  --workspace /home/me/work \
  --access edit \
  --plugin kiro
```

| 选项 | 意思 |
|---|---|
| `--url` | 住户地址，要 https（本机测试可用 http://127.0.0.1） |
| `--code` | 设置页给的配对码；不给就要网页钥匙 |
| `--resident` | 住户代号，默认 `default` |
| `--workspace` | 帮手开工的固定目录，绝对路径。每个线程第一次用时记下，之后不变 |
| `--access` | 这台机器最高允许的权限档位：`read`（只读）、`edit`（可改工作目录里的文件）、`full`（全部）。默认 `read` |
| `--plugin` | 用哪个帮手：`kiro`、`dsh`、`command`。默认 `kiro` |

配置在 `~/.aelios-runner/config.json`，凭据和线程记录在同目录的 `state.json`（只有你自己能读）。目录可用 `AELIOS_RUNNER_HOME` 改。

## 选帮手

帮手只由这台机器的配置定，云端的消息改不了。

- `kiro`：运行 `kiro-cli acp`。`--access full` 时会多带 `--trust-all-tools`。要先在这台机器上 `kiro-cli login`，runner 不登录任何账号。
- `dsh`：运行 `dsh --profile acp`（DeepSeek Harness 的 ACP 服务）。先在 `PATH` 里找 `dsh`；macOS 上找不到时用 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。DSH 用 `session/resume` 接回会话。provider 和模型要先在 DSH 的 `acp` profile 里配好。
- `command`（实验）：任何说 ACP 的命令，比如 Claude Code 的适配器 `claude-agent-acp`。在 `config.json` 里写 `"plugin": "command", "command": ["claude-agent-acp"]`。Claude 订阅登录在 Anthropic 条款上有争议，长期无人值守请用 API key。
- 可选配置：`bin`（换可执行文件路径）、`args`（多带的参数）、`env`（多带的环境变量）、`turnTimeoutMs`（一轮最长，默认 30 分钟）、`pollMs`（取活间隔，默认 5 秒）。

## 运行

```sh
aelios-runner start      # 前台跑；Ctrl-C 停。VPS 上放进 systemd 或 tmux
aelios-runner status     # 配对、队列、没发出去的回执
aelios-runner unpair     # 撤销配对（要再给一次网页钥匙）
```

停止时正在跑的一轮会交 `needs_you`，不会自动重做。

## 权限档位能拦什么、拦不住什么

runner 只能回答帮手**主动来问**的权限请求，并且只看帮手自己报的类型和路径：

- `read`：只许读、搜索、思考。`edit`：再加工作目录里的编辑，**也允许 `fetch`（联网）**。`full`：都许。
- 除 `full` 外，请求里带的路径只要有一个在工作目录外（符号链接指出去的也算），一律拒绝。
- 拦不住的：帮手不问就直接做的事（比如它自己的工具不需要确认就能读 `~/.ssh`），和没写路径的请求。被注入的任务可能借此读出本机文件再带回云端。要真隔离，请用专门的系统账号，或一台没有敏感文件的 VPS 跑 runner，并在帮手自己的设置里收紧它能读写的范围。
- 帮手要用户拍板时，必须把回复的最后一行写成 `ASK:` 开头的一句话（runner 在每个任务后面加了一句英文约定）。只有这个标记和被拒的权限请求会变成「等你」；回复以问号结尾不算。

## 同时只能一个 start

同一个目录下只能有一个 `aelios-runner start`（用 `runner.lock` 锁着）。`aelios-runner unpair` 会先让正在跑的 `start` 停下（取消正在跑的一轮），再撤销配对；撤销后排着的活和没发出去的回执都丢掉。服务端撤销配对时，runner 也一样停下并退出。

## 测试

```sh
npm test                                              # 假云端 + 假帮手，Kiro 和 DSH 各跑一遍
AELIOS_REAL_KIRO=1 node --test test/kiro-real.test.mjs   # 真的 kiro-cli，只做到 initialize，不发提示
```

## 已知没做的

- 真实 DSH 还没有接过；DSH 的接法是按它的 ACP 文档和 `dsh --profile acp --help` 写的，用假帮手测过。
- 真实 Kiro 只验证到 initialize。它会不会发 `session/request_permission`、`--trust-all-tools` 的效果，都没测。
- 云端暂时没有"停下"以外的本机入口；`Runner.cancel(thread)` 已经留好。
