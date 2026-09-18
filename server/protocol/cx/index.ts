import { qsParse, qsStringify, sleep, timestamp } from '@kuizuo/utils'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mapLimit } from 'async'
import type { Got } from 'got'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import got from 'got'
import { CxProxyError, getCxProxyOptions } from './proxy'
import { cxRequestStartQueue } from '~/server/utils/cxRequestStartQueue'
import { qrCookieSnapshot, qrSetCookieNames, safeQrContentType, summarizeQrCookieChanges, summarizeQrUpstreamBody } from '~/server/utils/qrUpstreamFeedback'
import { resolveClientSignLocation } from '~/server/utils/resolveClientSignLocation'
import type { QrCoordinates } from '~/utils/qrLocation'

export enum ActivityTypeEnum {
  Sign = 2, // 签到
  Answer = 4, // 抢答
  Talk = 5, // 主题谈论
  Question = 6, // 投票
  Pick = 11, // 选人
  Homework = 19, // 作业
  Evaluation = 23, // 评分
  Practice = 42, //  随堂练习
  Vote = 43, // 投票
  Notice = 45, // 通知
}

export enum ActivityStatusEnum {
  Doing = 1,
  Done = 2,
}

export enum SignTypeEnum {
  Normal = 0, // 普通签到
  QRCode = 2, // 二维码签到
  Gesture = 3, // 手势签到
  Location = 4, // 位置签到
  Code = 5, // 签到码签到
}

export const signTypeMap: Record<number, string> = {
  0: '普通签到',
  2: '二维码签到',
  3: '手势签到',
  4: '位置签到',
  5: '签到码签到',
} as const

export class CxLoginError extends Error {
  constructor(public stage: '认证' | '读取资料', public code: string) {
    const reason = code === 'ERR_CX_ACCESS_DENIED'
      ? '请求被拒绝（403），请检查服务器出口网络或联系学习通支持'
      : code === 'ERR_TOO_MANY_REDIRECTS'
        ? '发生循环重定向，请稍后重试'
        : code === 'ETIMEDOUT'
          ? '请求超时，请稍后重试'
          : '请求失败，请查看服务端日志'
    super(`学习通${stage}${reason}`)
    this.name = 'CxLoginError'
  }
}

export class Cx {
  public http!: Got
  public cookieJar: CookieJar
  public currentUrl = ''
  private readonly deviceCode = (() => {
    const seed = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
    const digest = createHash('sha256').update(seed).digest()
    return Buffer.concat([digest, digest]).toString('base64')
  })()

  public user!: CX.User
  public setting!: CX.Setting
  public courseList: CX.Course[] = []

  constructor(user: Partial<CX.User>) {
    this.cookieJar = new CookieJar()
    const proxyOptions = getCxProxyOptions()

    this.http = got.extend({
      ...proxyOptions,
      responseType: 'json',
      cookieJar: this.cookieJar,
      hooks: {
        ...proxyOptions.hooks,
        beforeRequest: [options => cxRequestStartQueue.waitTurn(options.signal)],
        afterResponse: [
          (response) => {
            this.currentUrl = response.url
            return response
          },
        ],
      },
    })

    this.user = user as CX.User
    return this
  }

  getCookie<T extends 'json' | 'string' = 'string'>(key?: string, type?: T, url?: string): T | string {
    if (this.cookieJar && (url || this.currentUrl)) {
      if (key) {
        const cookies = this.cookieJar.getCookiesSync(url || this.currentUrl).find(c => c.key === key)
        return cookies ? cookies.value : '' as string
      }

      if (type === 'json') {
        const cookies = this.cookieJar.getCookiesSync(url || this.currentUrl)
        return cookies as unknown as any
      }

      else {
        const cookieString = this.cookieJar.getCookieStringSync(url || this.currentUrl)
        return cookieString
      }
    }

    return ''
  }

  setCookie(cookie: string, url?: string) {
    if (this.cookieJar && cookie)
      this.cookieJar.setCookieSync(cookie, url || this.currentUrl)
  }

  async login(): Promise<string | null> {
    this.user.logged = false
    let stage: '认证' | '读取资料' = '认证'
    try {
      if (/^1[3-9]\d{9}$/.test(this.user.username)) {
        const { body: data } = await this.http.get<CX.LoginResult>('https://passport2.chaoxing.com/api/login', {
          timeout: { request: 15000 },
          retry: { limit: 0 },
          hooks: {
            beforeRedirect: [
              (options) => {
                const target = options.url
                if (target?.hostname.endsWith('.chaoxing.com')
                  && target.pathname === '/views/error/passport403.html')
                  throw new CxLoginError('认证', 'ERR_CX_ACCESS_DENIED')
              },
            ],
          },
          searchParams: {
            name: this.user.username,
            pwd: this.user.password,
            schoolid: '',
            verify: '',
          },
        })

        if (!data.result)
          return data.errorMsg

        stage = '读取资料'
        await this.parseUserInfo(data)
        this.user.logged = true
        return '登录成功'
      }
      else {
        return '账号密码格式不正确'
      }
    }
    catch (error) {
      // Do not log got errors directly: request URLs contain login credentials.
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'UPSTREAM_ERROR'
      console.warn('[cx.login]', { stage, code })
      if (error instanceof CxProxyError && code.startsWith('ERR_CX_PROXY_'))
        throw error
      throw new CxLoginError(stage, code)
    }
  }

  async logout() {
    this.user = {} as CX.User
    this.courseList = []
    this.cookieJar.removeAllCookiesSync()
  }

  async parseUserInfo(data: CX.LoginResult) {
    this.user = {
      ...this.user,
      ...data,
      uid: String(data.uid),
    } as unknown as CX.User

    const { body: html } = await this.http.get(`https://i.chaoxing.com/base?t=${timestamp()}`, {
      responseType: 'text',
      timeout: { request: 15000 },
      retry: { limit: 0 },
    })

    const $ = cheerio.load(html)
    this.user.avatar = `${$('.head-img').attr('src')! + this.user.uid}_80`
    this.user.siteName = $('#siteName').attr('title')
  }

  async getCourseList(signal?: AbortSignal): Promise<CX.Course[]> {
    interface CourseBody {
      courseType: string
      courseFolderId: string
      courseFolderSize: string
    }

    const body: CourseBody = { courseType: '1', courseFolderId: '0', courseFolderSize: '0' }
    const html = await this.http.post(
      'http://mooc1-1.chaoxing.com/visit/courselistdata',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: qsStringify(body as any),
        responseType: 'text',
        signal,
      },
    ).text()

    const $ = cheerio.load(html)

    const courseList = $('.course').map((i, el) => {
      const image = $(el).find('img').attr('src')!
      const href = $(el).find('.course-info a').attr('href')!
      const name = $(el).find('.course-name').attr('title')!
      const { courseid, clazzid, cpi } = qsParse(href.substring(href.indexOf('?') + 1))!

      return {
        name,
        courseId: courseid,
        classId: clazzid,
        cpi,
        image,
        link: href,
      }
    }).get() as CX.Course[]

    this.courseList = courseList
    return courseList
  }

  async getActivityList(course: CX.Course) {
    const { body: data } = await this.http.get<CX.ActivityListResponse>('https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist', {
      searchParams: {
        fid: this.user.schoolid,
        courseId: course.courseId,
        classId: course.classId,
        _: timestamp(),
      },
    })

    return data.data.activeList ?? []
  }

  /*
    根据 aid 获取活动详情
  */
  async getActivityDetail(activeId: string | number, signal?: AbortSignal) {
    const { body: data } = await this.http.get<CX.ActivityDetail>('https://mobilelearn.chaoxing.com/newsign/signDetail', {
      searchParams: {
        activePrimaryId: activeId,
        type: 1,
      },
      signal,
    })

    return data
  }

  async getQrSignLocationRequirement(activeId: string | number, signal?: AbortSignal): Promise<boolean | undefined> {
    const { body } = await this.http.get<{ data?: { ifopenAddress?: number | string } }>(
      'https://mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo',
      { searchParams: { activeId }, signal },
    )
    const flag = body?.data?.ifopenAddress
    if (flag === 1 || flag === '1')
      return true
    if (flag === 0 || flag === '0')
      return false
    return undefined
  }

  /*
    需要先发送预签到请求 才能够正常记录签到记录
  */
  async preSign(course: CX.Course, activity: CX.ActivityDetail, signal?: AbortSignal, traceId?: string) {
    const upstreamUrl = 'https://mobilelearn.chaoxing.com/newsign/preSign'
    const cookiesBefore = traceId ? qrCookieSnapshot(this.cookieJar, upstreamUrl) : undefined
    const preSignParams = {
      courseId: course.courseId || '',
      classId: course.classId,
      activePrimaryId: activity.id,
      general: '1',
      sys: '1',
      ls: '1',
      appType: '15',
      uid: this.user.uid,
      isTeacherViewOpen: 0,
      // 是否为刷新二维码的
      ...((activity.ifRefreshEwm) && { rcode: encodeURIComponent(`SIGNIN:aid=${activity.id}&source=15&Code=${activity.code}&enc=${activity.enc}`) }),
    }
    if (traceId) {
      console.info(`[qr-code-sign][${traceId}] pre-sign request`, {
        requestKeys: Object.keys(preSignParams).sort(),
        courseIdPresent: Boolean(preSignParams.courseId),
        classIdPresent: Boolean(preSignParams.classId),
        activePrimaryIdPresent: Boolean(preSignParams.activePrimaryId),
        uidPresent: Boolean(preSignParams.uid),
        utPresent: Object.hasOwn(preSignParams, 'ut'),
      })
    }
    const preSignResponse = await this.http.get(upstreamUrl, {
      searchParams: preSignParams,
      responseType: 'text',
      signal,
    })
    const html = preSignResponse.body
    const $ = cheerio.load(html)
    const status = $('#statuscontent').text().trim().replaceAll(/[\n\s]/g, '')
    if (traceId && cookiesBefore) {
      console.info(`[qr-code-sign][${traceId}] pre-sign HTTP response`, {
        status: preSignResponse.statusCode,
        contentType: safeQrContentType(preSignResponse.headers['content-type']),
        redirectCount: preSignResponse.redirectUrls?.length ?? 0,
        locationHeaderPresent: Boolean(preSignResponse.headers.location),
        setCookieNames: qrSetCookieNames(preSignResponse.headers['set-cookie']),
        ...summarizeQrCookieChanges(cookiesBefore, qrCookieSnapshot(this.cookieJar, upstreamUrl)),
        bodyLength: html.length,
        statusElementPresent: $('#statuscontent').length > 0,
        statusSummary: summarizeQrUpstreamBody(status),
      })
    }

    if (signal)
      await delay(500, undefined, { signal })
    else
      await sleep(500)

    // 两条必要请求!  位置签到必备
    const analysisResponse = await this.http.get(
      'https://mobilelearn.chaoxing.com/pptSign/analysis',
      {
        searchParams: {
          vs: 1,
          DB_STRATEGY: 'RANDOM',
          aid: activity.id,
        },
        responseType: 'text',
        signal,
      },
    )
    const data = analysisResponse.body
    const code = data.match(/code='\+'(.*?)'/)?.[1]
    if (traceId) {
      console.info(`[qr-code-sign][${traceId}] analysis HTTP response`, {
        status: analysisResponse.statusCode,
        contentType: safeQrContentType(analysisResponse.headers['content-type']),
        redirectCount: analysisResponse.redirectUrls?.length ?? 0,
        bodyLength: data.length,
        codePresent: Boolean(code),
      })
    }
    const analysis2Response = await this.http.get(
      'https://mobilelearn.chaoxing.com/pptSign/analysis2',
      {
        searchParams: {
          DB_STRATEGY: 'RANDOM',
          code,
        },
        responseType: 'text',
        signal,
      },
    )
    if (traceId) {
      console.info(`[qr-code-sign][${traceId}] analysis2 HTTP response`, {
        status: analysis2Response.statusCode,
        contentType: safeQrContentType(analysis2Response.headers['content-type']),
        redirectCount: analysis2Response.redirectUrls?.length ?? 0,
        ...summarizeQrUpstreamBody(analysis2Response.body),
      })
    }
    if (signal)
      await delay(500, undefined, { signal })
    else
      await sleep(500)

    if (!traceId)
      console.log(`${course.name} ${signTypeMap[activity.otherId]} 预签到状态: `, status)
    if (status)
      return status
  }

  /*
    签到请求
  */
  async stuSign(query: string, signal?: AbortSignal, traceId?: string, method: 'GET' | 'POST' = 'GET') {
    const url = 'https://mobilelearn.chaoxing.com/pptSign/stuSignajax'
    const response = method === 'POST'
      ? await this.http.post<string>(url, {
          body: query,
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            origin: 'https://mobilelearn.chaoxing.com',
          },
          responseType: 'text',
          signal,
        })
      : await this.http.get<string>(url, {
          searchParams: query,
          responseType: 'text',
          signal,
        })
    const data = response.body
    if (traceId) {
      console.info(`[qr-code-sign][${traceId}] upstream HTTP response`, {
        status: response.statusCode,
        contentType: safeQrContentType(response.headers['content-type']),
        ...summarizeQrUpstreamBody(data),
      })
    }

    if (data === 'success' || data === '您已签到过了')
      return '签到成功'
    else if (data === 'success2')
      return '签到已过期'

    return data
  }

  async signNormal(activity: CX.ActivityDetail) {
    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '-1',
      longitude: '-1',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signCode(activity: CX.ActivityDetail, signCode: string) {
    const { body: data } = await this.http.get<{ result: number; errorMsg: string }>(
      'https://mobilelearn.chaoxing.com/widget/sign/pcStuSignController/checkSignCode',
      {
        searchParams: {
          activeId: activity.id,
          signCode,
        },
        responseType: 'json',
      },
    )

    if (data.result !== 1)
      return data.errorMsg

    await sleep(200)

    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '',
      longitude: '',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      signCode,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signGesture(activity: CX.ActivityDetail, signCode: string) {
    const { body: data } = await this.http.get<{ result: number; errorMsg: string }>(
      'https://mobilelearn.chaoxing.com/widget/sign/pcStuSignController/checkSignCode',
      {
        searchParams: {
          activeId: activity.id,
          signCode,
        },
        responseType: 'json',
      },
    )

    if (data.result !== 1)
      return data.errorMsg

    await sleep(200)

    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '',
      longitude: '',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      signCode,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signPhoto(activity: CX.ActivityDetail, photo?: CX.YunPanFile) {
    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '-1',
      longitude: '-1',
      appType: '15',
      fid: this.user.schoolid,
      objectId: photo?.objectId ?? '',
      name: this.user.realname,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signLocation(activity: CX.ActivityDetail,
    location: CX.SignLocation = {
      text: '',
      latitude: '-1',
      longitude: '-1',
    }) {
    // 位置 https://api.map.baidu.com/lbsapi/getpoint/index.html
    const query = new URLSearchParams(Object.entries({
      activeId: activity.id,
      address: location.text,
      uid: this.user.uid,
      clientip: '',
      latitude: location.latitude,
      longitude: location.longitude,
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      ifTiJiao: 1,
      validate: '',
    }).map(([key, value]) => [key, String(value)])).toString()

    return this.stuSign(query)
  }

  async signQrCode(activity: CX.ActivityDetail, enc: string, courseId: string, signal?: AbortSignal, location?: { latitude: number; longitude: number; address: string }, traceId?: string) {
    const locationData = location
      ? {
          result: 1,
          address: location.address,
          longitude: Number(location.longitude.toFixed(6)),
          latitude: Number(location.latitude.toFixed(6)),
        }
      : undefined
    const locationResult = locationData
      ? {
          result: 1,
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          mockData: { strategy: 500, probability: 1 },
        }
      : undefined
    const params = {
      enc,
      name: this.user.realname,
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      ...(locationData ? { location: JSON.stringify(locationData) } : {}),
      ...(locationResult ? { locationResult: JSON.stringify(locationResult) } : {}),
      latitude: '-1',
      longitude: '-1',
      fid: this.user.schoolid,
      appType: '15',
      vpProbability: 1,
      vpStrategy: '500',
      deviceCode: this.deviceCode,
      currentFaceId: '',
      ifCFP: '0',
      courseId,
      faceEnc: '',
      faceCode: '',
      faceEncAid: '',
    }
    if (traceId) {
      console.info(`[qr-code-sign][${traceId}] sign submit request`, {
        method: locationData ? 'POST' : 'GET',
        requestKeys: Object.keys(params).sort(),
        topLevelCoordinatesDefault: params.latitude === '-1' && params.longitude === '-1',
        nestedLocationProvided: Boolean(locationData),
        nestedLocationIsDefault: locationData?.latitude === -1 && locationData?.longitude === -1,
        courseIdPresent: Boolean(courseId),
        cookieNames: [...qrCookieSnapshot(this.cookieJar, 'https://mobilelearn.chaoxing.com/pptSign/stuSignajax').keys()].sort(),
      })
      console.info(`[qr-code-sign][${traceId}] sign submit location fields`, {
        addressPresent: Object.hasOwn(params, 'address'),
        nestedAddressPresent: locationData !== undefined,
        nestedAddressNonEmpty: Boolean(locationData?.address),
        locationPresent: Object.hasOwn(params, 'location'),
        locationResultPresent: Object.hasOwn(params, 'locationResult'),
        latitudePresent: Object.hasOwn(params, 'latitude'),
        longitudePresent: Object.hasOwn(params, 'longitude'),
        courseIdPresent: Boolean(params.courseId),
        faceFieldsPresent: ['currentFaceId', 'ifCFP', 'faceEnc', 'faceCode', 'faceEncAid'].every(key => Object.hasOwn(params, key)),
        encPresent: Boolean(enc),
        encLength: enc.length,
        deviceCodePresent: Boolean(this.deviceCode),
        deviceCodeLength: this.deviceCode.length,
        vpProbabilityType: typeof params.vpProbability,
        vpStrategyEmpty: !params.vpStrategy,
      })
    }
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()
    if (traceId) {
      const decoded = new URLSearchParams(query)
      console.info(`[qr-code-sign][${traceId}] sign submit encoding`, {
        deviceCodePreserved: decoded.get('deviceCode') === this.deviceCode,
        locationPreserved: decoded.get('location') === (locationData ? JSON.stringify(locationData) : null),
        locationResultPreserved: decoded.get('locationResult') === (locationResult ? JSON.stringify(locationResult) : null),
      })
    }

    return this.stuSign(query, signal, traceId, locationData ? 'POST' : 'GET')
  }

  async getAllActivity(type?: ActivityTypeEnum, status?: ActivityStatusEnum) {
    const courseList = this.courseList.length > 0 ? this.courseList : await this.getCourseList()

    const activityArr = await mapLimit(courseList, 5, async (course: CX.Course) => (await this.getActivityList(course)).map(a => ({ course, ...a })))

    return activityArr.flat(1)
      .filter((activity: { type: number; status: number }) => (type ? activity.type === type : true) && (status ? activity.status === status : true))
      .map(a => ({
        ...a,
        ...({
          name: a.name || a.nameOne,
        }),
      }))
  }

  async signByCourse(course: CX.Course, clientLocation?: QrCoordinates | null) {
    const activityList = await this.getActivityList(course)

    const signActivityList = activityList.filter(activity => activity.type === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)

    const signResults: CX.SignResult[] = []

    for await (const a of signActivityList) {
      if (a.type === ActivityTypeEnum.Sign) {
        const activity = await this.getActivityDetail(a.id)
        const result = await this.handleSign(course, activity, undefined, clientLocation)

        console.log(`课程: ${course.name} 签到结果: ${result}`)

        signResults.push({
          activity: {
            ...a,
            ...activity,
          },
          signType: activity.otherId,
          result,
        })
      }
    }

    return signResults
  }

  async signByActivity(course: CX.Course, activity: CX.ActivityDetail, clientLocation?: QrCoordinates | null) {
    if (!(activity.activeType === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)) {
      return {
        activity,
        result: '不是签到活动或活动已结束',
      }
    }
    const result = await this.handleSign(course, activity, undefined, clientLocation)

    console.log(`课程: ${course.name} 签到结果: ${result}`)

    return {
      activity,
      result,
    }
  }

  /*
  * 一键签到 (检测所有课程, 所有签到活动, 比较耗时)
  */
  async oneClickSign(setting?: CX.Setting) {
    const signActivityList = await this.getAllActivity(ActivityTypeEnum.Sign, ActivityStatusEnum.Doing)

    const signResults: CX.SignResult[] = []
    for await (const a of signActivityList) {
      if (a.type === ActivityTypeEnum.Sign) {
        const activity = await this.getActivityDetail(a.id)
        const result = await this.handleSign(a.course, activity, setting)

        // 如果已签到过, 则不返回
        if (result === '已签到过')
          continue

        signResults.push({
          activity: {
            ...a,
            ...activity,
          },
          signType: activity.otherId,
          result,
        })
      }
    }
    return signResults
  }

  async handleSign(course: CX.Course, activity: CX.ActivityDetail, setting?: CX.Setting, clientLocation?: QrCoordinates | null) {
    const status = await this.preSign(course, activity)

    if (status === '签到成功')
      return '已签到过'

    if (setting?.signType && !setting?.signType?.map(type => Number(type))?.includes(activity.otherId))
      return '该账号不支持此签到类型'

    switch (Number(activity.otherId)) {
      case SignTypeEnum.Normal:
        if (activity.ifPhoto === 1) {
          const file = await this.getPhotoFile()
          return await this.signPhoto(activity, file)
        }
        else { return await this.signNormal(activity) }

      case SignTypeEnum.Gesture:
        return '失败'

      case SignTypeEnum.Code:
        return '失败'

      case SignTypeEnum.Location:
        if (clientLocation === null)
          return '浏览器定位不可用，未提交位置签到'
        await sleep(500)
        if (clientLocation)
          return await this.signLocation(activity, await resolveClientSignLocation(clientLocation))
        return await this.signLocation(activity, setting?.location)

      case SignTypeEnum.QRCode:
        return '失败'

      default:
        return '未知签到类型'
    }
  }

  async getWebIM() {
    const { body: html } = await this.http.get('https://im.chaoxing.com/webim/me', {
      responseType: 'text',
    })

    const $ = cheerio.load(html)

    return {
      token: $('#myToken').text(),
      uid: $('#myTuid').text(),
      name: $('#myName').text(),
    }
  }

  async getPhotoFile() {
    const { body: { data } } = await this.http.get<CX.Response<CX.YunPanFile[]>>('https://pan-yz.chaoxing.com/api/getMyDirAndFiles?puid=42736002&fldid=&page=1&size=100&addrec=0&showCollect=1&_token=3d44eb8928f52b391398035f530c4155m', {})

    return data.find(d => d.name === '0.png' || d.name === '0.jpg')
  }
}

export const CXMap = new Map<string | number, Cx>()

export const getCx = (uid: string | number) => CXMap.get(uid)

export const setCx = (uid: string | number, cx: Cx) => CXMap.set(uid, cx)
