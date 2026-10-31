TenSaint73OS · iPhone / iPad 安装说明
=====================================

先说清楚：这不是 IPA。iOS 不能安装 APK，也不能把 APK 直接"转"成 IPA；
真正的 IPA 必须在 Mac + Xcode 上编译并用 Apple 账号签名，Windows 做不了。
这个包是把你的 Node.js 主程序和网页界面做成 iOS 可运行版：
在 iPhone 上用 iSH（App Store 免费）运行 Node，Safari 打开界面，
再"添加到主屏幕"，图标和全屏效果与 App 一样。

A. 本机运行（iSH，完全在手机沙箱内）
-----------------------------------
1. App Store 安装 iSH。
2. 把 TenSaint73OS-iPhone-iSH.zip 传到手机（任选一种）：
   · iCloud Drive / OneDrive：把 zip 放进手机"文件"App 能看到的目录；
     然后在 iSH 里执行：
       mkdir -p ~/ios
       mount -t ios . ~/ios        # 会弹出目录选择器，选 zip 所在目录
   · 电脑同 Wi-Fi：电脑上在 zip 所在目录运行
       python -m http.server 8899
     然后在 iSH 里：
       wget http://电脑局域网IP:8899/TenSaint73OS-iPhone-iSH.zip
3. 在 iSH 里解压并一键启动（推荐）：
     cd ~
     apk add --no-cache unzip
     unzip TenSaint73OS-iPhone-iSH.zip -d ~
     sh ~/启动-TenSaint73OS-iPhone.sh
   启动器会自动安装 Node.js（首次需要联网）并启动服务。
   也可以手动分步安装：
     cd ~/TenSaint73OS
     sh ios-install.sh          # 只需一次，安装 nodejs / npm
     sh ios-start.sh
4. 看到 "核心已上线" 后，切到 Safari 打开：
     http://127.0.0.1:7373
   本公开发行包是会员版：登录页点「注册」即可创建普通会员，
   每个账号自动获得独立的加密文件目录与私有数据库，互相不可见；
   包内没有管理员账号，也不能通过注册获得管理员权限。
   实例拥有者可从原设备导出 .tsowner，运行
     sh owner/import-owner-key.sh
   导入最高管理员身份，再用原密码 + 绑定手机号登录。
   登录后点 Safari 分享按钮 → "添加到主屏幕"。
   这个主屏幕图标就是 iPhone 端的启动器；以后先运行一键启动脚本，
   再点主屏幕图标即可。

注意：iOS 会在你切到 Safari 后挂起 iSH，服务可能随之断开。
可选的社区办法（耗电，不保证所有版本有效）：
  先在 设置 → 隐私与安全性 → 定位服务 里给 iSH"使用 App 期间"权限，
  然后在 iSH 里运行：
     sh ios-keepalive.sh
再切 Safari。用完回 iSH 按 Ctrl+C 结束 keepalive。

其他平台（Android / Linux / Windows）不在本说明范围内，
请看压缩包根目录的 先读我.txt。

B. 电脑托管（最稳，推荐长期用）
------------------------------
Windows 上直接双击压缩包根目录的 TenSaint73OS-Launcher.exe：
启动器会自动启动服务并打开浏览器，自带 runtime\node.exe，
不需要另装 Node.js。手机浏览器默认用隧道地址访问（见下），
不需要把端口暴露到局域网。

仅在同一可信局域网内临时直连时，才考虑：
  cd TenSaint73OS
  TS_BIND=0.0.0.0 node server.js
手机 Safari 打开 http://电脑局域网IP:7373 。
注意：这是明文 HTTP，且会暴露给同网段设备，只在可信网络短时使用；
公网访问必须走 HTTPS 隧道，不要把 7373 端口映射到公网。
Windows 防火墙需放行时，只允许专用网络。
电脑关机/睡眠时隧道和页面都会失效；数据仍在电脑的 data 目录。
隧道可以在管理员页面「网络矩阵 → 隧道控制」开启，也可以运行
run-online.sh（cloudflared 快速隧道）。
「安装隧道组件」在 iSH 里同样可用: 会自动下载 linux-386 版本并自检,
装好直接开启并显示 https://xxxx.trycloudflare.com 随机地址;
若 iSH 跑不动 cloudflared, 就改用 Windows / Linux 电脑开隧道。
替换或升级程序文件后, 需完全退出 iSH 里的 node 再重新启动。

数据与安全
----------
· 多用户隔离：管理员控制全局数据库；每位会员有独立的 data/users/<hash>.db
  和 data/files/users/<workspace>/ 目录，接口层强制校验归属，不能越界读取。
· 注册默认开放，管理员可在 设置 → 用户注册 随时关闭；密码至少 8 位。
· 安全手机号（可选）：在 账户安全 中绑定后，登录必须同时提交密码和该号码。
  号码用 AES-256-GCM 单独加密保存（密钥由 install.salt 派生，与登录密码无关），
  只有本人通过 /api/me/phone 能取回完整号码；管理员界面只显示"已绑定"。
  更新或解绑需要密码 + 当前号码，并会自动作废其他终端的会话。
· 公开发行包不含管理员账号或真实数据库，首次启动只会创建空的加密存储。
  管理员来源：已有认证库 / 首次启动前配置 data/admin.env / 导入 .tsowner。
· 运行后 data 目录会含加密认证库、数据库和 install.salt；不要发到公开网盘
  或群聊。备份时必须把 install.salt 与数据库一起保存。
· 端口默认 7373，且只监听 127.0.0.1；只有显式设置 TS_BIND=0.0.0.0
  才会被局域网访问，明文 HTTP 风险自负。
· iSH 内不要运行来历不明的脚本；本项目零 npm 依赖，ios-install.sh 只装
  nodejs / npm / unzip 三个 Alpine 包。

已知限制
--------
· 没有 systemd、没有 Docker；这是 Alpine + Node，不是真 Ubuntu。
· iSH 是 x86 模拟，加解密和页面响应会比电脑慢，但本系统数据量小，可用。
· iSH 切到后台会被 iOS 挂起，隧道随之断开；因此不建议用 iPhone/iSH 当
  长期隧道主机。cloudflared 在 iSH 内不保证可运行。
  推荐：Windows / Linux 开机当主机开隧道，iPhone 只用 Safari 访问该地址。
· 手机端界面已加窄屏布局（侧栏改为顶部横向导航）；iPad 横屏体验更好。
