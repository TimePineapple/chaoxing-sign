# 前端接口契约（当前实现）

基线：`1aacb32`，2026-09-15。下面是现有代码的契约，不是重新设计后的接口，也没有经过真实网络联调。源码路径可在 [JSON 目录](frontend-api.inventory.json) 查到。

**二维码接口更新：**下文第 5 节的旧同步扫码描述及 JSON 目录仍是 2026-09-15 基线快照；当前扫码契约以本段为准。`POST /api/cx/accounts/:uid/sign_by_qrcode` 校验网站会话、账号归属及 URL 与提交字段的一致性，接收 `{uid,activityId,code,enc,url,courseId?}`。成功响应的 `data` 是 `{state,job}`；`state` 为 `accepted`（已入队）或 `busy`（同账号有排队中或执行中的任务）。任务结束立即释放账号占位；再次扫描同活动会创建新任务，不复用旧结果，也不要求确认。`job` 含任务 ID、学习通 uid、活动 ID、状态和脱敏消息，不含完整签到 URL 或 Cookie。POST 不等待最终结果。

扫码弹窗打开时连接 `GET /api/cx/qr-events`（需网站会话），以 SSE 接收 `snapshot` 与 `job` 事件。`snapshot.active` 供中途打开的弹窗恢复排队/处理中状态；新打开的弹窗不展示旧结果。`job` 包含递增 `sequence`，浏览器断线重连可通过 `Last-Event-ID` 补收短暂保留的事件；这段传输记录不参与新提交的判断。服务端按网站账号隔离事件。45 秒超时从任务实际启动计时，反馈“结果未确认”；进程重启会丢失内存任务，此时应核对签到历史。服务端全局任务启动间隔至少 200ms，批量入口不在浏览器延迟提交。

## 1. 通用规则

- 默认同源相对路径；普通业务 POST 使用 JSON，GET 使用 query。
- `/api/cx/**` 全部要求网站会话 Cookie，包括超星账号登录和账号列表；没有实现 Bearer token 注入。
- **所有操作超星账号的 POST 都要在 body 再传 `uid`**，即使路径已有 `:uid`。中间件从 body 取账号，不以路径 uid 为准。
- GET 课程列表传 `?uid=…`。账号列表是精确排除项，调用 `/api/cx/accounts` 不附加 query 或尾斜线，以免当前中间件误要求 uid。
- `:cid` 在当前调用中是 courseId；课程内部主键还需要 classId。课程/活动路由实际读取 body.course/body.activity，不校验其与路径 cid/aid 是否一致。
- `ResOp` 返回 `{code,message,data}`；code 是 JSON 业务码，并不自动改变 HTTP 状态。
- `code=200` 只代表接口层返回成功。签到成功要再检查 `data.result` 或每项 result；“失败”“不是签到活动或活动已结束”也可能放在 code=200 内。
- `throw/return createError` 走 H3 错误响应，不保证具有业务包装；客户端应兼容 `message`、`statusMessage`、HTTP 状态。
- 没有分页、搜索、统一超时、幂等键、取消后台操作、任务进度 API。对签到 POST 不应设置自动重试。

普通响应示例（合成数据）：

```json
{"code":200,"message":"success","data":[]}
```

监听接口的特殊包装：

```json
{"code":200,"message":"success","data":{"data":{"isOpened":true}}}
```

## 2. 网站认证

### 2.1 自定义注册接口

| 方法/路径 | 输入 | 当前返回 | 调用方 |
| --- | --- | --- | --- |
| GET `/api/auth/registration-status` | 无 | `{enabled:boolean,expiresAt:string\|null}`，`Cache-Control: no-store` | `components/global/LoginCard.vue` |
| POST `/api/auth/signUp` | `{email:string,password:string}` | 包装后的 `{id,email,name}` | `components/global/LoginCard.vue` |

现有前端还发送 `reenteredPassword`、`privatePolicy`，后端只读取 email/password；没有邮件验证、验证码或重置密码实现。邮箱格式错误/重复时抛 H3 错误，未显式设置业务 HTTP 状态。注册成功不自动登录。网页账户注册默认关闭；只在服务端启动后的五分钟窗口内开放，到期 POST 返回 403。此开关与学习通账户绑定无关。

### 2.2 NextAuth 通配认证

处理器：`server/api/auth/[...].ts`；不是 ResOp 协议。下列子路径已对照本地 `node_modules/@sidebase/nuxt-auth/dist/runtime/composables/authjs/useAuth.js` 和 `node_modules/next-auth/core/index.js` 检查。

| 方法/路径 | 作用/输入 | 返回/注意 |
| --- | --- | --- |
| GET `/api/auth/providers` | 查询 provider | 以 provider ID 为 key 的对象；当前配置只有 credentials |
| GET `/api/auth/csrf` | 获取 CSRF token | `{csrfToken}`，同时维持对应 Cookie |
| POST `/api/auth/callback/credentials` | 表单编码 email/password/csrfToken/callbackUrl/json | `json=true` 模式返回含 url 的响应；失败信息可能编码在 url，SDK 转为 error；成功建立网站会话 |
| GET `/api/auth/session` | 读取会话 | 会话对象含 user、expires、uid、role；未登录值通过 SDK 状态判断，不能当作 ResOp |
| POST `/api/auth/signout` | 表单编码 csrfToken/callbackUrl/json | 退出会话，返回或重定向到 url |

`useAuth().signIn('credentials', {email,password,redirect:false})` 返回 SDK 层结果（error/url/status/ok），不是业务 data；`useAuth().signOut()` 处理退出。SDK 会执行 providers/CSRF/会话刷新。继续使用 Nuxt 时应保留这层适配；迁出 Nuxt 时实现并验证完整 Cookie/CSRF 流程。

框架还处理 signin/signout 页面、错误和其他认证动作，这些不单列为自定义业务 API。只有一个通配源文件，不能把其子路径数量与业务文件计数相加。

## 3. 账号接口

下表“返回”均指 ResOp 的 data。

| 方法/路径 | 输入 | 返回 | 副作用/异常 | 调用方 |
| --- | --- | --- | --- | --- |
| GET `/api/cx/accounts` | 无 | AccountSnapshot[]，含 courses/signlogs | 查询当前网站用户；过 7 天尝试重登；本次响应仍可能是刷新前快照；不含 selected | store.syncAccounts |
| POST `/api/cx/login` | `{username,password}`，当前只支持手机号 | AccountLoginSnapshot | 绑定/更新账号；无账号数量限制；失败为业务 code=201、data=null；成功 message=登录成功 | store.login |
| GET `/api/cx/connectivity` | 无 | `{ok:boolean,message?:string}` | 客户端每次加载网站并进入已登录状态时，服务端经 `CX_PROXY_URL` 访问学习通登录页；失败时客户端显示持续通知 | `CxConnectivityCheck.client` |
| POST `/api/cx/logout` | `{uid}` | null | **删除绑定及其本站签到历史**，关闭监听/清 Cookie；不是网站 signOut | store.logout |
| POST `/api/cx/accounts/:uid/update_setting` | `{uid,setting}` | Setting | 整体覆盖 setting，不是 patch；未同步进程内 Cx.setting；账号不存在 code=204 | store.updateSetting |
| POST `/api/cx/accounts/:uid/monitor` | `{uid}` | `{data:{isOpened:boolean}}` | 建立服务端监听；已在 Map 中直接返回 true；无独立健康状态接口 | store.monitorAccount |
| POST `/api/cx/accounts/:uid/unmonitor` | `{uid}` | `{data:{isOpened:false}}` | 更新 monitor=false，关闭连接并删 Map；重连行为待联调 | store.unMonitorAccount |
| POST `/api/cx/accounts/:uid/sign_history` | `{uid}` | SignLog[] | 无分页，无显式排序，无官方签到核对；空时 [] | `components/SignHistory.vue` |

账号列表 select 字段：uid/username/info/courses/setting/lastLoginTime/signlogs（顶层 password 被移除）。`info` 是不受严格 schema 限制的 JSON，当前可能仍有密码字段。

登录响应：数据库账号字段去掉顶层 password，info 单独去掉 password，lastLoginTime 转 ISO 字符串；仍包括 cookies、userId，不自动包含 courses/signlogs。现有 store 自行添加 courses=[] 和 selected=true。两种账号响应不能视为相同的完整 Account 类型。

## 4. 课程与活动接口

| 方法/路径 | 输入 | 返回 data | 重要约束 | 调用方 |
| --- | --- | --- | --- | --- |
| GET `/api/cx/courses` | query `{uid}` | Course[] | 实时拉取并更新数据库课程关联；响应有 cpi，数据库 Course 未存该字段 | store.getCourses |
| POST `/api/cx/courses/:cid/activities` | `{uid,course}` | ActivityItem[] | 包含不同类型活动；无分页/过滤参数 | store.getActivityList |
| POST `/api/cx/courses/:cid/sign` | `{uid,course}` | SignResult[] | 挑选 type=2,status=1；日志写入与 schema 不匹配，响应可靠性待修复 | store.signByCourse |
| POST `/api/cx/courses/:cid/activities/:aid/sign` | `{uid,course,activity}` | `{activity,result}` | 检查 activeType=2,status=1；不另拉活动详情，不落本站日志 | store.signByActivity |
| GET `/api/cx/courses/:cid` | **未实现** | 无已定义契约 | 对应文件为空，没有前端调用，不应接入 | 无 |

前端现有 course 请求发送整个课程对象；协议主要读取 courseId/classId，展示与日志用 name。活动列表 UI 用 type，而单活动签到校验 activeType，因此新前端不能只依据 status=1 开放所有活动的签到按钮。

课程/单活动路径调用 `handleSign` 未传入账号设置；与显式传 setting 的 sign_all 行为不同，不应承诺它们会使用同一位置或类型过滤。

## 5. 签到接口

所有请求都需要网站会话和 body.uid。以下输入描述现有前端实际调用，ID 当前混用字符串和数字；服务端没有统一运行时验证或转换。

| 方法/路径 | JSON body | 返回 data | 当前行为 |
| --- | --- | --- | --- |
| POST `/api/cx/accounts/:uid/sign_all` | `{uid,setting}` | SignResult[] | 遍历课程活动并提交；每项保存手动记录；无活动为 []；已签到过结果可能被过滤 |
| POST `/api/cx/accounts/:uid/sign_by_code` | `{uid,courseId,activityId,signCode}` | `{activity,result}` | 获取详情，检查活动，预签到后提交；courseId/body 声明 number，store 发送 string |
| POST `/api/cx/accounts/:uid/sign_by_gesture` | `{uid,courseId,activityId,signCode}` | `{activity,result}` | signCode 是手势轨迹文本；其余同签到码 |
| POST `/api/cx/accounts/:uid/sign_by_qrcode` | `{uid,courseId,activityId,enc,code,url}` | `{activity,result}` | url 被声明但处理器未使用；服务端使用 activityId/code/enc，详情提供 classId；courseId 类型拼写错误 |

后三项活动不存在：业务 code=204、data=null；活动已结束/非签到：code=200、result 文本且提前返回，不写日志。正常执行分支保存手动 SignLog；如果写数据库失败，外部操作可能已经发生。

二维码适配：当前 store 从链接 query 的 `id`、`c`、`enc` 提取 activityId/code/enc，courseId 来自活动上下文。新前端可用 URL/URLSearchParams 做有校验的解析，但不能把链接内未提供的 courseId 当作已知；直接扫码入口需明确获取上下文的方式。

批量扫码按选中账号顺序错峰启动：每发起一个账号请求后等待 200ms，再发起下一个账号请求；无需等待前一个账号返回。每个账号使用独立 HTTP 请求，响应到达后立即更新客户端对应账号的结果，不生成统一汇总结果。

签到结果文本常见：`签到成功`、`已签到过`、`签到已过期`、`失败`、`未知签到类型`、`该账号不支持此签到类型`、`不是签到活动或活动已结束`，以及原样透传的上游文本。文本不是封闭枚举，界面应保留未知结果。

## 6. 数据模型摘要

以下是供前端适配层理解的字段摘要，**不是已提交到业务源码的类型定义**。当前声明把 ActivityDetail/ActivityItem 混合得很宽泛，不能据此假设每种响应都包含全部字段。

```ts
type ApiResult<T> = { code: number; message: string; data: T }
type Id = string // 新前端内部统一；边界转换必须与服务端联调

type Setting = {
  signType: (string | number)[]
  location: { text: string; latitude: string; longitude: string }
  monitor: boolean
  delay: number // 毫秒；现有 UI 范围 0..10000，步长 100
}

type Course = {
  courseId: string; classId: string; name: string
  image: string; link: string
  cpi?: string // 实时课程响应包含，数据库缓存中缺失
  id?: string // 数据库课程响应的组合主键
}

type ActivityView = {
  id: string | number
  status: number
  type?: number; activeType?: number; otherId?: number
  name?: string; nameOne?: string; nameFour?: string; logo?: string
  ifPhoto?: number; ifRefreshEwm?: number; clazzId?: number
  course?: Course // 一键活动附加上下文；详情响应不能假设存在
}

type SignResult = {
  activity: ActivityView
  signType?: string | number // 数组结果有，专用/单活动结果无顶层 signType
  result: string
}

type SignLog = {
  id: string; activityName: string; activityId: string
  type: number; mode: number; result: string; time: string; accountId: string
}

type AccountView = {
  uid: string; username: string
  info: { realname?: string; avatar?: string; siteName?: string; school?: string }
  setting: Setting; lastLoginTime: string
  courses: Course[]; selected: boolean
}
// AccountView 是建议的最小视图；当前接口还有多余敏感字段，需适配/后端脱敏。
```

默认设置：location.text 为空、latitude/longitude 为字符串 `-1`、monitor=false、signType=`["0","2","3","4","5"]`、delay=200。后台延迟用 `cx.setting?.delay || 随机延迟`，所以 0 当前不会表达“无延迟”。手动签到内部还存在固定等待，不能把 delay 视为所有请求的统一计时参数。

| 字段 | 值 |
| --- | --- |
| 活动类型 | 2 签到、4 抢答、5 讨论、6 投票、11 选人、19 作业、23 评分、42 随堂练习、43 投票、45 通知（按现有映射） |
| 活动状态 | 1 进行中、2 已结束 |
| 签到类型 otherId | 0 普通、2 二维码、3 手势、4 位置、5 签到码；0 且 ifPhoto=1 为拍照 |
| 历史模式 mode | 1 手动、2 自动 |

## 7. 没有后端支持的前端能力

- 网站找回密码、邮箱验证、资料更新、账号搜索与分页。
- 单账号详情查询、有效的单课程详情查询、独立活动详情业务 API。
- 监听健康状态查询、签到进度推送、任务取消。
- 文件/照片上传到本站、照片管理、批量请求聚合接口。
- 官方完整签到历史、历史删除/导出 API。

浏览器还加载头像、课程图片、图标、字体和帮助内容；这些是资源依赖，不是业务接口。超星上游登录、课程、活动、签到、云盘及 IM 请求封装在 `server/protocol`，新前端应通过本站 API 使用，不能把服务端 Cookie 或上游调用搬到浏览器。

## 8. 接入检查

1. 为每个响应建立合成样例：空列表、业务失败、HTTP 失败、未知签到结果、双层 data。
2. 校验 body.uid 与选择账号一致，课程主键同时考虑 classId，活动上下文逐项保存。
3. 对新页面实现会话加载、缺少账号、同步中、失败、空结果和操作中状态。
4. 优先修复架构文档列出的授权/字段泄露/日志写入缺陷，再做真实账号联调；本次没有执行这些修复。
5. 本轮接口目录包含所有 18 个服务端 API 源文件；框架认证子路径单独列出，空路由标记为未实现。
