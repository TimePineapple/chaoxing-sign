import { ActivityStatusEnum, ActivityTypeEnum, SignMode } from '~/constants/cx'
import { getQrSignTraceId } from '~/server/utils/qrSignTrace'

interface Body {
  uid: string
  courseId?: string
  activityId: string
  enc: string
  code: string
  url: string
}

export default defineEventHandler(async (event) => {
  const traceId = getQrSignTraceId(event)
  const startedAt = Date.now()
  let stage = '读取请求'
  const trace = (step: string, details: Record<string, string | number | boolean> = {}) => {
    console.info(`[qr-code-sign][${traceId}] ${step}`, { ...details, elapsedMs: Date.now() - startedAt })
  }
  trace('request received')
  try {
    const { courseId, activityId, code, enc } = await readBody<Body>(event)
    stage = '读取活动详情'
    trace('activity detail start')
    const activity = await event.context.cx.getActivityDetail(activityId)

    if (!activity?.id) {
      trace('activity detail missing')
      return ResOp.error(502, '未获取到活动详情，请检查该账号登录状态或活动是否存在')
    }
    trace('activity detail complete', {
      activeType: activity.activeType,
      status: activity.status,
      hasCourseId: Boolean(activity.courseId),
      hasClassId: Boolean(activity.clazzId),
    })

    if (!(activity.activeType === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)) {
      trace('activity not active sign')
      return ResOp.success({ activity, result: '不是签到活动或活动已结束' })
    }

    stage = '匹配签到课程'
    const classId = String(activity.clazzId ?? '').trim()
    let resolvedCourseId = String(activity.courseId ?? '').trim()
    let courseSource = resolvedCourseId ? 'activity' : ''

    if (!resolvedCourseId && classId) {
      const cached = event.context.cx.courseList?.find(course => String(course.classId) === classId && course.courseId)
      if (cached) {
        resolvedCourseId = String(cached.courseId)
        courseSource = 'account-cache'
      }
    }

    if (!resolvedCourseId && classId) {
      trace('course database lookup start')
      const saved = await event.context.prisma.course.findFirst({
        where: {
          classId,
          accounts: { some: { uid: event.context.cx.user.uid } },
        },
        select: { courseId: true },
      })
      if (saved?.courseId) {
        resolvedCourseId = saved.courseId
        courseSource = 'account-database'
      }
    }

    if (!resolvedCourseId && courseId) {
      resolvedCourseId = String(courseId).trim()
      courseSource = 'matched-client-activity'
    }

    if (!resolvedCourseId && classId) {
      trace('course live lookup start')
      const courses = await event.context.cx.getCourseList()
      const matched = courses.find(course => String(course.classId) === classId && course.courseId)
      if (matched) {
        resolvedCourseId = String(matched.courseId)
        courseSource = 'account-live-list'
      }
    }

    if (!resolvedCourseId) {
      trace('course id missing', { hasClassId: Boolean(classId) })
      return ResOp.error(502, classId
        ? '未能在该账号的课程列表中匹配签到班级，请先同步课程后重试'
        : '活动详情缺少班级 ID 和课程 ID，无法预签到')
    }
    trace('course resolved', { source: courseSource })

    const course = {
      classId: activity.clazzId,
      courseId: resolvedCourseId,
    }

    activity.code = code
    activity.enc = enc

    stage = '预签到'
    trace('pre-sign start')
    const status = await event.context.cx.preSign(course as unknown as CX.Course, activity)
    trace('pre-sign complete', { hasResult: Boolean(status) })
    let result = status
    if (!result) {
      stage = '提交签到'
      trace('sign submit start')
      result = await event.context.cx.signQrCode(activity, enc)
      trace('sign submit complete', { hasResult: Boolean(result) })
    }
    if (typeof result !== 'string' || !result.trim()) {
      trace('sign result empty')
      return ResOp.error(502, '学习通返回了空的签到结果，请检查账号状态及服务端日志')
    }

    stage = '保存签到记录（签到请求已发送，请先核对签到状态）'
    trace('sign log save start', { success: result === '签到成功' })
    await event.context.prisma.signLog.create({
      data: {
        activityId: String(activity.id),
        activityName: activity.name,
        type: activity.otherId,
        mode: SignMode.Manual,
        result,
        time: new Date(),
        accountId: event.context.cx.user.uid,
      },
    })
    trace('request complete', { success: result === '签到成功' })
    return ResOp.success({ activity, result })
  }
  catch (error) {
    // Report the failing step without logging request options, cookies or QR tokens.
    const failure = error as { code?: string; response?: { statusCode?: number } }
    const errorCode = typeof failure?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(failure.code)
      ? failure.code
      : 'UNKNOWN_ERROR'
    const status = failure?.response?.statusCode
    console.error(`[qr-code-sign][${traceId}] request failed`, {
      stage,
      code: errorCode,
      status,
      elapsedMs: Date.now() - startedAt,
    })
    return ResOp.error(502, `${stage}失败（${errorCode}${status ? `，HTTP ${status}` : ''}）`)
  }
})
