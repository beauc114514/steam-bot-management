# Steam Bot Management

在 macOS 上管理一批 Steam 机器人账号。可以查看登录名、密码、当前 Steam Guard 验证码、SteamID 和昵称，并记录平台标记和备注。

## 环境要求

- macOS 12 或更高版本
- Xcode 命令行工具（提供 `swiftc`）
- Node.js 18 或更高版本
- `curl`、`python3`（补全 SteamID 和昵称时使用）

## 构建并打开

在项目根目录执行：

```bash
APP="Steam机器人.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp app/Info.plist "$APP/Contents/Info.plist"
cp app/index.html app/crypto.js app/AppIcon.icns "$APP/Contents/Resources/"
swiftc -O -o "$APP/Contents/MacOS/SteamRobot" app/main.swift -framework Cocoa -framework WebKit
codesign --force --sign - "$APP"
open "$APP"
```

把编出来的 `.app` 放在项目根目录。程序读取同级目录下的 `data/steam-bot-management.json`。

## 账号文件

`data/steam-bot-management.json` 是一个数组，内容为明文，由使用者自己填写：

```json
[
  {
    "id": 1,
    "steam_account": "登录名",
    "pass_word": "密码",
    "shared_secret": "Steam Guard 的 shared_secret，Base64",
    "is_used": 0,
    "update_time": "",
    "tags": [],
    "remark": "",
    "steam_id": "",
    "persona_name": ""
  }
]
```

| 字段 | 说明 |
| --- | --- |
| `id` | 正整数，文件内唯一 |
| `steam_account` | Steam 登录名 |
| `pass_word` | 密码 |
| `shared_secret` | 用于生成 5 位 Steam Guard 验证码 |
| `tags` | 平台标记，取值只能是 `900`、`uu`、`c5`、`buff` |
| `remark` | 备注 |
| `steam_id` | 17 位 SteamID，可由下面的脚本补全 |
| `persona_name` | 社区昵称，可由下面的脚本补全 |

在页面上修改标记或备注后，会写回这个文件。

## 补全 SteamID 和昵称

脚本使用账号、密码和当前验证码，通过 HTTP 代理登录 Steam，并写入 `steam_id` 和 `persona_name`。已有这两项的记录会跳过；只有昵称为空的会再试一次。

在项目根目录创建 `proxy.local.json`。可以复制 `proxy.example.json`：

```json
{
  "host": "代理主机",
  "port": "端口",
  "username": "代理用户名",
  "password": "代理密码"
}
```

然后执行：

```bash
node fetch-steam-profile.js
```

可选环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FETCH_CONCURRENCY` | `4` | 同时登录的账号数 |
| `FETCH_LIMIT` | `0` | 本次最多处理多少条。`0` 表示不限制 |

## 项目结构

```text
app/main.swift            macOS 窗口
app/index.html            界面
app/crypto.js             Steam Guard 验证码
app/Info.plist            应用信息
fetch-steam-profile.js    登录并补全 SteamID、昵称
data/                     本机账号文件，不进入版本库
```

## 不要提交的内容

以下路径已在 `.gitignore` 中排除：

- `data/`：账号、密码、`shared_secret`、SteamID、昵称
- `proxy.local.json`：代理主机和账号密码
- `*.app`：本地编出来的应用
- `.idea/`、`.DS_Store`、`*.log`、`*.tmp`

## 许可证

本项目以 [MIT License](LICENSE) 发布。

