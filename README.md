# Steam Bot Management

在 macOS 上查看和维护一批 Steam 机器人账号：登录名、密码、Steam Guard 验证码、SteamID、昵称，以及平台标记和备注。验证码按 30 秒窗口本地生成，底色会随剩余时间从右往左收回。

窗口关掉，进程就退出。程序只读本机的账号文件，不提供网络服务。

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
cp app/index.html app/crypto.js "$APP/Contents/Resources/"
swiftc -O -o "$APP/Contents/MacOS/SteamRobot" app/main.swift -framework Cocoa -framework WebKit
codesign --force --sign - "$APP"
open "$APP"
```

应用优先读取与 `Steam机器人.app` 同级的 `data/steam-bot-management.json`。请把编出来的 `.app` 放在项目根目录，账号文件放在 `data/` 下。

## 账号文件

`data/steam-bot-management.json` 是一个数组。字段都是明文，由使用者自己填写：

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
| `tags` | 已点亮的平台，取值只能是 `900`、`uu`、`c5`、`buff` |
| `remark` | 备注。窗口里的备注框支持剪切、复制、粘贴和全选 |
| `steam_id` | 17 位 SteamID。可由下面的脚本补全 |
| `persona_name` | 社区昵称 |

页面上的标记和备注会写回这个文件。登录脚本补全资料时也会写它。两边共用 `data/.write.lock`，避免互相覆盖。

## 补全 SteamID 和昵称

脚本用账号、密码和当前验证码，经 HTTP 代理登录 Steam，再读取社区昵称。已经有 `steam_id` 和 `persona_name` 的记录会跳过；只有昵称为空的会再试一次。

在项目根目录创建 `proxy.local.json`：

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
| `FETCH_CONCURRENCY` | `4` | 同时登录的账号数。代理会轮换出口时可以提高 |
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

以下路径已在 `.gitignore` 中排除，推送到公开仓库前请再确认工作区里没有它们：

- `data/`：账号、密码、`shared_secret`、SteamID、昵称
- `proxy.local.json` 以及其他 `proxy*.json`：代理主机和账号密码
- `*.app`：本地编出来的应用
- `.idea/`、`.DS_Store`、`*.log`、`*.tmp`

公开仓库里只应有源码和这份说明。代理和账号都由拿到代码的人在自己的机器上填写。
