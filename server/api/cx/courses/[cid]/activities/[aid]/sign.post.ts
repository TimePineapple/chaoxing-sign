import type { Activity, Course } from '~/types/account'
import { SignMode } from '~/constants/cx'
import { createSignLog } from '~/server/utils/createSignLog'
import { isQrCoordinates, type QrCoordinates } from '~/utils/qrLocation'

interface Body {
  course: Course
  activity: Activity
  uid: string
  location?: QrCoordinates | null
}

export default defineEventHandler(async (event) => {
  const { course, activity, location } = await readBody<Body>(event)
  if (location != null && !isQrCoordinates(location))
    throw createError({ statusCode: 400, statusMessage: '签到位置格式无效' })

  const data = await event.context.cx.signByActivity(course, activity, location ?? null)

  if (data.result !== '不是签到活动或活动已结束') {
    await createSignLog(event.context.cx, event.context.prisma, {
      activityId: String(data.activity.id), activityName: data.activity.name,
      courseId: course.courseId, classId: course.classId, courseName: course.name,
      type: Number(data.activity.otherId), mode: SignMode.Manual, result: data.result,
    })
  }

  return ResOp.success(data)
})
