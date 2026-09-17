import type { PrismaClient } from '@prisma/client'
import { ActivityStatusEnum, ActivityTypeEnum, SignMode } from '~/constants/cx'
import type { Cx } from '~/server/protocol/cx'
import { createSignLog } from '~/server/utils/createSignLog'

export interface QrSignInput {
  uid: string
  activityId: string
  code: string
  enc: string
  courseId?: string
}

class QrSignExecutionError extends Error {
  constructor(public readonly publicMessage: string, public readonly code: string) {
    super(publicMessage)
  }
}

export async function executeQrSign(
  cx: Cx,
  prisma: PrismaClient,
  body: QrSignInput,
  signal: AbortSignal,
  traceId: string,
): Promise<{ result: string; activityName?: string }> {
  const startedAt = Date.now()
  let stage = '读取活动详情'
  const trace = (step: string, details: Record<string, string | number | boolean> = {}) => {
    console.info(`[qr-code-sign][${traceId}] ${step}`, { ...details, elapsedMs: Date.now() - startedAt })
  }
  try {
    trace('activity detail start')
    const activity = await cx.getActivityDetail(body.activityId, signal)
    signal.throwIfAborted()
    if (!activity?.id)
      throw new QrSignExecutionError('未获取到活动详情，请检查账号登录状态或活动是否存在', 'ACTIVITY_MISSING')
    trace('activity detail complete', { hasCourseId: Boolean(activity.courseId), hasClassId: Boolean(activity.clazzId) })

    if (!(activity.activeType === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing))
      return { result: '不是签到活动或活动已结束', activityName: activity.name }

    stage = '匹配签到课程'
    const classId = String(activity.clazzId ?? '').trim()
    let resolvedCourseId = String(activity.courseId ?? '').trim()
    if (resolvedCourseId && body.courseId && resolvedCourseId !== String(body.courseId).trim())
      throw new QrSignExecutionError('二维码活动与当前课程不一致，请核对后重试', 'COURSE_MISMATCH')

    if (!resolvedCourseId && classId)
      resolvedCourseId = String(cx.courseList?.find(course => String(course.classId) === classId)?.courseId ?? '')

    if (!resolvedCourseId && classId) {
      trace('course database lookup start')
      const saved = await prisma.course.findFirst({
        where: { classId, accounts: { some: { uid: cx.user.uid } } },
        select: { courseId: true },
      })
      signal.throwIfAborted()
      resolvedCourseId = saved?.courseId || ''
    }

    if (!resolvedCourseId && body.courseId)
      resolvedCourseId = String(body.courseId).trim()

    if (!resolvedCourseId && classId) {
      trace('course live lookup start')
      const courses = await cx.getCourseList(signal)
      signal.throwIfAborted()
      resolvedCourseId = String(courses.find(course => String(course.classId) === classId)?.courseId ?? '')
    }

    if (resolvedCourseId && body.courseId && resolvedCourseId !== String(body.courseId).trim())
      throw new QrSignExecutionError('二维码活动与当前课程不一致，请核对后重试', 'COURSE_MISMATCH')

    if (!resolvedCourseId)
      throw new QrSignExecutionError(classId
        ? '未能在该账号的课程列表中匹配签到班级，请先同步课程后重试'
        : '活动详情缺少班级 ID 和课程 ID，无法预签到', 'COURSE_MISSING')

    activity.code = body.code
    activity.enc = body.enc
    stage = '预签到'
    trace('pre-sign start')
    const status = await cx.preSign({ classId: activity.clazzId, courseId: resolvedCourseId } as CX.Course, activity, signal)
    signal.throwIfAborted()
    trace('pre-sign complete', { hasResult: Boolean(status) })

    let result = status
    if (!result) {
      stage = '提交签到'
      trace('sign submit start')
      result = await cx.signQrCode(activity, body.enc, signal)
      signal.throwIfAborted()
      trace('sign submit complete', { hasResult: Boolean(result) })
    }
    if (typeof result !== 'string' || !result.trim())
      throw new QrSignExecutionError('学习通返回了空的签到结果，请检查账号状态及服务端日志', 'EMPTY_RESULT')

    stage = '保存签到记录（签到请求已发送，请先核对签到状态）'
    trace('sign log save start', { success: result === '签到成功' })
    signal.throwIfAborted()
    await createSignLog(cx, prisma, {
      activityId: String(activity.id), activityName: activity.name,
      courseId: resolvedCourseId, classId,
      type: activity.otherId, mode: SignMode.Manual, result,
    })
    trace('request complete', { success: result === '签到成功' })
    return { result, activityName: activity.name }
  }
  catch (error) {
    const failure = error as { code?: string; response?: { statusCode?: number } }
    const code = error instanceof QrSignExecutionError ? error.code
      : typeof failure?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(failure.code)
        ? failure.code : 'UNKNOWN_ERROR'
    const status = failure?.response?.statusCode
    console.error(`[qr-code-sign][${traceId}] request failed`, { stage, code, status, elapsedMs: Date.now() - startedAt })
    if (error instanceof QrSignExecutionError)
      throw error
    throw new QrSignExecutionError(`${stage}失败（${code}${status ? `，HTTP ${status}` : ''}）`, code)
  }
}
