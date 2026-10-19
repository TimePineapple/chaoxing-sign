import { skipHydrate } from 'pinia'
import { createDiscreteApi } from 'naive-ui'
import { signTypeMap } from '~/constants/cx'
import type { Body as LoginForm } from '~/server/api/cx/login.post'
import type { Account, Activity, Course, Setting } from '~/types/account'
import type { RecentSign, RecentSignEvent } from '~/types/recentSign'
import type { AccountRecoveryResult, AccountSessionEvent } from '~/types/accountSession'
import { createQrSignTraceId, parseQrCodeSignLink } from '~/utils/qrCodeSign'
import type { QrSubmitDecision } from '~/utils/qrSignProtocol'
import type { QrCoordinates } from '~/utils/qrLocation'
import { getFreshClientLocationForSign } from '~/utils/clientLocation.client'
import { getQrSignClientId } from '~/utils/qrSignClient.client'

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const recentSigns = ref<Record<string, RecentSign>>({})
  let recentSignRequestId = 0
  let pushGeneration = 0
  const pushedAtGeneration = new Map<string, number>()

  const selectAccounts = computed(() => accounts.value.filter(a => a.selected === true && !a.loginExpired))
  const sessionStates = new Map<string, AccountSessionEvent>()
  const renewingUids = new Set<string>()

  function applyAccountSession(event: AccountSessionEvent) {
    if (!event?.uid || typeof event.loginExpired !== 'boolean' || !Number.isFinite(Date.parse(event.lastLoginTime)))
      return
    const previous = sessionStates.get(event.uid)
    if (previous && Date.parse(previous.lastLoginTime) > Date.parse(event.lastLoginTime))
      return
    if (previous?.loginExpired && !event.loginExpired && previous.lastLoginTime === event.lastLoginTime)
      event = previous
    const account = accounts.value.find(item => item.uid === event.uid)
    if (account && Date.parse(account.lastLoginTime) > Date.parse(event.lastLoginTime))
      return
    sessionStates.set(event.uid, event)
    if (account) {
      account.loginExpired = event.loginExpired
      account.info.logged = !event.loginExpired
      if (event.loginExpired)
        account.selected = false
      account.lastLoginTime = event.lastLoginTime
    }
  }

  const loading = ref(false)
  const accountSyncLoading = ref(false)
  const courseSyncLoading = ref(false)
  const { message: ms } = createDiscreteApi(['message'])

  const { log } = useLogStore()

  function getAccount(uid: string) {
    const account = accounts.value.find(a => a.uid === uid)

    if (!account) {
      ms.error('账号不存在')
      throw new Error('账号不存在')
    }

    return account
  }

  function setAccount(uid: string, setting: CX.Setting) {
    const index = accounts.value.findIndex(a => a.uid === uid)
    if (index !== -1)
      accounts.value[index].setting = setting
  }

  async function syncAccounts() {
    if (accountSyncLoading.value || courseSyncLoading.value)
      return
    accountSyncLoading.value = true
    try {
      const { data } = await request('/api/cx/accounts')
      accounts.value = data as unknown as Account[]
      for (const account of accounts.value) {
        const state = sessionStates.get(account.uid)
        if (state)
          applyAccountSession(state)
        if (account.loginExpired)
          account.selected = false
      }
      log('账户信息同步成功', { type: 'success' })
    }
    finally {
      accountSyncLoading.value = false
    }
  }

  async function refreshRecentSigns() {
    const requestId = ++recentSignRequestId
    const generation = pushGeneration
    const { data } = await request('/api/cx/recent-signs')
    if (requestId === recentSignRequestId) {
      const next = (data || {}) as Record<string, RecentSign>
      for (const [uid, pushedAt] of pushedAtGeneration) {
        if (pushedAt > generation && recentSigns.value[uid])
          next[uid] = recentSigns.value[uid]
      }
      recentSigns.value = next
    }
  }

  function applyRecentSign(event: RecentSignEvent) {
    const previous = recentSigns.value[event.uid]
    if (previous && Date.parse(previous.time) > Date.parse(event.sign.time))
      return
    pushedAtGeneration.set(event.uid, ++pushGeneration)
    recentSigns.value = { ...recentSigns.value, [event.uid]: event.sign }
  }

  async function login(form: LoginForm) {
    const { code, message, data } = await request('/api/cx/login', { method: 'POST', body: form })
    if (code !== 200 || !data?.uid || !data?.info) {
      const failureMessage = message || '添加学习通账号失败，请稍后重试'
      log(`${form.username} ${failureMessage}`, { type: 'error' })
      throw new Error(failureMessage)
    }

    log(`${data.info.username || form.username} ${data.info.realname} ${message}`, { type: 'success' })

    const existing = accounts.value.findIndex(account => account.uid === data.uid)
    const next = {
      ...data,
      courses: existing >= 0 ? accounts.value[existing].courses : [],
      selected: existing < 0,
      loginExpired: false,
    } as unknown as Account
    if (existing >= 0)
      accounts.value[existing] = next
    else
      accounts.value.push(next)
    applyAccountSession({ uid: data.uid, loginExpired: false, lastLoginTime: data.lastLoginTime })

    return data
  }

  async function relogin(uid: string, password?: string) {
    if (renewingUids.has(uid))
      throw new Error('该账号正在重新登录，请稍候')
    renewingUids.add(uid)
    try {
      const endpoint: string = `/api/cx/accounts/${encodeURIComponent(uid)}/relogin`
      const { code, message, data } = await request<{ code: number; message: string; data: AccountRecoveryResult }>(endpoint, {
        method: 'POST', body: { uid, mode: password === undefined ? 'saved' : 'manual',
          ...(password === undefined ? {} : { password }) },
      })
      if (code !== 200 || data?.uid !== uid)
        throw new Error(message || '重新登录失败，请稍后重试')
      const account = getAccount(uid)
      Object.assign(account, data, { courses: data.courses || account.courses, selected: false, loginExpired: false })
      applyAccountSession({ uid, loginExpired: false, lastLoginTime: data.lastLoginTime })
      return data
    }
    finally { renewingUids.delete(uid) }
  }

  async function logout(uid: string) {
    const account = getAccount(uid)

    await request('/api/cx/logout', { method: 'POST', body: { uid } })

    accounts.value = accounts.value.filter(a => a.uid !== uid)
    delete recentSigns.value[uid]
    pushedAtGeneration.delete(uid)
    sessionStates.delete(uid)

    log(`${account.info.realname} 退出成功`, { type: 'success' })
  }

  /*
    获取指定账号的所有课程
  */
  async function getCourses(uid: string) {
    const account = getAccount(uid)
    if (account.loginExpired)
      throw new Error('登陆状态失效，请重新登录')

    const { code, message, data } = await request('/api/cx/courses', { method: 'GET', params: { uid } })
    if (code !== 200 || !Array.isArray(data))
      throw new Error(message || '课程接口返回异常，请稍后重试')

    account.courses = data

    log(`${account.info.realname} 课程获取成功`, { type: 'success' })
    return data
  }

  async function syncCourses(uids: string[]) {
    if (courseSyncLoading.value || accountSyncLoading.value)
      return []

    const targets = [...new Set(uids)].map(uid => accounts.value.find(account => account.uid === uid))
      .filter((account): account is Account => Boolean(account) && !account!.loginExpired)
      .map(account => ({ uid: account.uid, name: account.info?.realname || account.uid }))
    const results: { uid: string; success: boolean }[] = []
    if (!targets.length)
      return results

    courseSyncLoading.value = true
    try {
      for (const { uid, name } of targets) {
        try {
          await getCourses(uid)
          results.push({ uid, success: true })
        }
        catch (error) {
          const message = (error as { data?: { message?: string }; message?: string })?.data?.message
            || (error as Error)?.message || '请求失败，请稍后重试'
          log(`${name} (${uid}) 课程同步失败：${message}`, { type: 'error' })
          results.push({ uid, success: false })
        }
      }
      return results
    }
    finally {
      courseSyncLoading.value = false
    }
  }

  /*
    获取指定课程的所有活动
  */
  async function getActivityList(uid: string, course: Course) {
    const { data } = await request(`/api/cx/courses/${course.courseId}/activities`, {
      method: 'POST',
      body: { uid, course },
    })

    return data
  }

  /*
    根据课程签到
  */
  async function signByCourse(uid: string, course: Course) {
    const location = await getFreshClientLocationForSign()
    const { data } = await request(`/api/cx/courses/${course.courseId}/sign`, {
      method: 'POST',
      body: { uid, course, location },
    })

    if (data.length === 0) {
      log(`课程: ${course.name} 无签到活动`, { type: 'warning' })
    }
    else {
      ms.success(`${course.name} 共有${data.length}个正在的签到活动`)
      data.forEach(({ activity, result }) => {
        const signType = signTypeMap[activity.otherId] ?? '未知'
        const activityName = activity.name || signType
        log(`课程: ${course?.name} 活动: ${activityName} [${signType}]结果: ${result}`, { type: result === '签到成功' ? 'success' : 'error' })
      })
    }

    return data
  }

  /*
    根据指定(签到)活动签到
   */
  async function signByActivity(uid: string, course: Course, activity: Activity) {
    const location = Number(activity.otherId) === 4 ? await getFreshClientLocationForSign() : undefined
    const { data } = await request(`/api/cx/courses/${course.courseId}/activities/${activity.id}/sign`, {
      method: 'POST',
      body: { uid, course, activity, location },
    })

    const signType = signTypeMap[activity.otherId] ?? '未知'
    const activityName = activity.name || signType
    log(`课程: ${course.name} 活动: ${activityName} [${signType}]结果: ${data?.result || ms}`, { type: data?.result === '签到成功' ? 'success' : 'error' })

    return data
  }

  /*
    签到码签到
  */
  async function signByCode(uid: string, courseId: string, activityId: string, signCode: string) {
    const { data } = await request(`/api/cx/accounts/${uid}/sign_by_code`, {
      method: 'POST',
      body: { uid, courseId, activityId, signCode },
    })

    const { activity } = data!
    const signType = signTypeMap[activity.otherId] ?? '未知'
    const activityName = activity.name || signType
    log(`活动: ${activityName} [${signType}]结果: ${data?.result || ms}`, { type: data?.result === '签到成功' ? 'success' : 'error' })

    return data
  }

  /*
    手势签到
  */
  async function signByGesture(uid: string, courseId: string, activityId: string, signCode: string) {
    const { data } = await request(`/api/cx/accounts/${uid}/sign_by_gesture`, {
      method: 'POST',
      body: { uid, courseId, activityId, signCode },
    })

    const { activity } = data!
    const signType = signTypeMap[activity.otherId] ?? '未知'
    const activityName = activity.name || signType
    log(`活动: ${activityName} [${signType}]结果: ${data?.result || ms}`, { type: data?.result === '签到成功' ? 'success' : 'error' })

    return data
  }

  /*
    二维码签到
  */
  async function signByQrCode(uid: string, link: string, courseId?: string, traceId = createQrSignTraceId(), location?: QrCoordinates | null): Promise<QrSubmitDecision> {
    // 提取 activityId 和 enc
    // https://mobilelearn.chaoxing.com/widget/sign/e?id=8000063022220&c=529773&enc=A5BC081D895B41540E129437F6B4180F&DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=id

    const parsed = parseQrCodeSignLink(link)
    if (!parsed)
      throw new Error('无效的签到链接')

    const { activityId, code, enc } = parsed
    const startedAt = Date.now()
    console.info(`[qr-code-sign][${traceId}] 客户端发送请求`, {
      locationProvided: Boolean(location),
      locationIsDefault: location?.latitude === -1 && location?.longitude === -1,
    })
    let response: API.Result<QrSubmitDecision>
    try {
      response = await request(`/api/cx/accounts/${uid}/sign_by_qrcode`, {
        method: 'POST',
        timeout: 10_000,
        retry: 0,
        headers: { 'x-qr-sign-trace-id': traceId, 'x-qr-client-id': getQrSignClientId() },
        body: { uid, courseId, activityId, enc, code, url: link, location: location ?? undefined },
      })
      console.info(`[qr-code-sign][${traceId}] 客户端收到响应`, { code: response?.code, elapsedMs: Date.now() - startedAt })
    }
    catch (error) {
      const failure = error as { statusCode?: number; status?: number; cause?: { name?: string } }
      console.error(`[qr-code-sign][${traceId}] 客户端请求异常`, {
        status: failure?.statusCode ?? failure?.status,
        cause: failure?.cause?.name,
        elapsedMs: Date.now() - startedAt,
      })
      throw error
    }

    if (response?.code !== 200) {
      console.warn(`[qr-code-sign][${traceId}] 服务端返回业务错误`, { code: response?.code })
      throw new Error(response?.message || '签到接口返回错误或空响应')
    }

    if (!response.data?.job || !response.data.state)
      throw new Error('签到任务状态为空，请检查服务端日志')
    return response.data
  }

  /*
    一键签到
  */
  async function oneClickSign(uid: string) {
    const account = getAccount(uid)

    const { data } = await request(`/api/cx/accounts/${uid}/sign_all`, {
      method: 'POST',
      body: {
        uid,
        setting: account.setting,
      },
    })

    ms.success(`${account.info.realname} 共有${data.length}个正在的签到活动`, { type: 'warning' })
    data.forEach(({ activity, result }) => {
      const signType = signTypeMap[activity.otherId] ?? '未知'
      const activityName = activity.name || signType

      log(`课程: ${activity.course?.name} 活动: ${activityName} [${signType}]结果: ${result}`,
        { type: result === '签到成功' ? 'success' : 'error' })
    })

    return data
  }

  /*
    添加监听账号
  */
  async function monitorAccount(uid: string) {
    const account = getAccount(uid)
    const { data } = await request(`/api/cx/accounts/${uid}/monitor`, {
      method: 'POST',
      body: { uid },
    })

    if (data.data?.isOpened)
      log(`${account.info.realname} 监听成功`, { type: 'success' })

    else
      log(`${account.info.realname} 监听失败`, { type: 'error' })
  }

  /*
    移除监听账号
  */
  async function unMonitorAccount(uid: string) {
    const account = getAccount(uid)
    const { data } = await request(`/api/cx/accounts/${uid}/unmonitor`, {
      method: 'POST',
      body: { uid },
    })

    if (!data.data?.isOpened)
      log(`${account.info.realname} 取消监听成功`, { type: 'success' })

    else
      log(`${account.info.realname} 取消监听失败`, { type: 'error' })
  }

  async function updateSetting(uid: string, setting: Setting) {
    const account = getAccount(uid)

    const { data } = await request(`/api/cx/accounts/${uid}/update_setting`, {
      method: 'POST',
      body: { uid, setting },
    })

    log(`${account.info.realname} 保存成功`, { type: 'success' })

    const index = accounts.value.findIndex(a => a.uid === uid)
    accounts.value[index].setting = data!
  }

  watch(accounts, (accounts) => {
    localStorage.setItem('accounts', JSON.stringify(accounts))
  })

  return {
    accounts: skipHydrate(accounts),
    recentSigns: skipHydrate(recentSigns),
    selectAccounts,
    loading,
    accountSyncLoading,
    courseSyncLoading,
    login,
    logout,
    syncAccounts,
    refreshRecentSigns,
    applyRecentSign,
    getAccount,
    setAccount,
    getCourses,
    relogin,
    applyAccountSession,
    syncCourses,
    getActivityList,
    signByCourse,
    signByActivity,
    signByCode,
    signByGesture,
    signByQrCode,
    oneClickSign,
    monitorAccount,
    unMonitorAccount,
    updateSetting,
  }
})
