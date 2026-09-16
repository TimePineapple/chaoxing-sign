# 🌟某星签到(网页版)

<a href="https://www.npmjs.com/package/nuxt/v/rc"><img alt="size" src="https://img.shields.io/github/package-json/dependency-version/kuizuo/chaoxing-sign/dev/nuxt?style=flat&colorA=002438&colorB=28CF8D"></a> <a href="https://github.com/kuizuo/chaoxing-sign/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kuizuo/chaoxing-sign/ci.yml?style=flat&colorA=002438&colorB=28CF8D"></a>  <a href="https://github.com/kuizuo/chaoxing-sign/tree/HEAD/LICENSED"><img alt="License" src="https://img.shields.io/github/license/kuizuo/chaoxing-sign?style=flat&colorA=002438&colorB=28CF8D" /></a>

在这里你可以在摆脱客户端繁琐的签到流程，让签到不再是你的烦恼。

## ✨功能

- [x] 普通签到
- [x] 拍照签到
- [x] 位置签到
- [x] 手势签到
- [x] 签到码签到
- [x] 二维码签到
- [x] 监听签到任务,自动完成
- [x] 支持多用户批量签到

[更多帮助](./content/help.md)

## 🛠 运行

```shell
git clone https://github.com/kuizuo/chaoxing-sign.git
cd chaoxing-sign
pnpm install
```

你需要一个 PostgreSQL 数据库地址（用于存储账号信息以及自动监控签到），然后将项目根目录下 `.env.example` 文件更改成 `.env` 并替换 `DATABASE_URL` 为数据库地址(通常是远程地址)。运行如下命令用于同步数据库：

```shell
npx prisma db push
```

```shell
pnpm run dev
```

打包

```shell
pnpm run build
pnpm run preview
```

## 部署

### 网页账户注册窗口

默认禁止注册本站网页账户。需要注册时，在部署根目录的 `.env` 中添加或修改：

```dotenv
ALLOW_WEB_REGISTRATION=true
```

然后**重启服务端进程**。从服务启动起的五分钟内，可注册多个网页账户；到期后服务端立即拒绝注册，并自动把 `.env` 这一行改回 `ALLOW_WEB_REGISTRATION=false`。修改 `.env` 后不重启不会开放注册；窗口内重启也不会延长截止时间。登录页会在窗口关闭时隐藏“注册”，直接调用注册接口同样会收到 403。此开关不限制已登录用户添加学习通账户。

使用 `node --env-file=.env .output/server/index.mjs` 启动时，`.env` 必须与 `.output` 同级，且运行 Node 的账户需要对 `.env` 及其所在目录有写入权限。首次使用需部署包含此功能的新构建；以后切换开关只需修改 `.env` 并重启。

### 学习通请求代理（可选）

在部署根目录的 .env 中增加一行（端口按实际代理配置填写）：

```dotenv
CX_PROXY_URL=http://127.0.0.1:7890
```

支持 HTTP、HTTPS 代理及用户名/密码认证，例如 `http://user:password@proxy.example:8080`。
用户名、密码中的 @、:、# 等特殊字符需要 URL 编码；代理地址不接受路径、查询参数或片段。
未配置或留空时直连；配置代理后连接失败会报错，不会自动回退直连。HTTPS 证书仍会正常校验。

代理覆盖学习通登录、资料、课程、签到、云盘和获取监听凭据等 Cx HTTP/HTTPS 请求。
环信 WebSocket 及其内部请求不使用这项代理设置。

Windows Server 的目录示例为 `C:\apps\chaoxing-sign\.env`，与 .output 文件夹同级。
从该目录启动：

```powershell
node --env-file=.env .output/server/index.mjs
```

首次需要部署包含代理支持的新构建；以后修改代理只需重启，无需重新 build。
127.0.0.1 指运行后端的服务器自身，不是访问网页的电脑。
代理需由服务器可达，并支持 HTTPS CONNECT。代理 URL 含密码时不要公开分享。
代理认证失败、连接失败和学习通返回的 403 拒绝访问分别处理；配置代理不保证该出口能够访问学习通。

### PM2 + Nginx (推荐)

本项目已经编写好了 `ecosystem.config.js` 文件，具体请根据实际情况修改环境变量，你可以直接使用 PM2 来启动项目。

```shell
npm run start:pm2
```

此时已经启动好了本地端口为 `8050` 的服务，要注意，如果你使用了 Nginx 的反向代理，那么你需要将 `AUTH_ORIGIN` 环境变量设置为你的域名，否则将无法正常使用。并在 Nginx 中添加如下配置：

```nginx
    location / {
      proxy_pass http://127.0.0.1:8050;
    }
```

此外可能还需要配置 SSL 证书，因为要调用摄像头权限就必须是在安全环境下（即https下），否则你将无法使用扫一扫功能，这也是无奈之举。

### Docker

本项目已经编写好了 docker 相关文件，你可以直接使用 Docker 来启动项目。

> ⚠️ 注意: 需要将 node_modules 复制到镜像内, 因为 prisma client 产物存在 node_modules 内.

如果你有自己的 postgresql (远程)数据库，那么你需要在 Dockerfile 中修改 `DATABASE_URL` 环境变量为你的数据库地址，执行下方命令即可构建镜像。

```shell
docker buildx build . -t chaoxing-sign:latest
```

### Vercel or Netlify（不推荐）

由于采用 Nuxt.js 框架，所以非常容易部署在 Vercel 或 Netlify 等平台上，但还是不推荐部署，理由如下：

Vercel 或 Netlify 的服务器设立在国外，用户需要通过一些特殊手段能够访问，并且由于某星的服务器设立在国内，数据请求需要多一道障碍来访问，将导致响应速度过慢，网站体验效果极其不佳，已亲测，因此不推荐使用（无奈之举）。

## 🤝 免责声明

本项目仅作为个人技术专研，仅供学习参考。不得用于商业用途。

## 📝 License

MIT License © 2023-PRESENT Kuizuo
