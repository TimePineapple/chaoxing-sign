import { SignMode } from '~/constants/cx'
import { createSignLog } from '~/server/utils/createSignLog'
import { isQrCoordinates, type QrCoordinates } from '~/utils/qrLocation'

interface Body {
  course: Course
  uid: string
  location?: QrCoordinates | null
}

export default defineEventHandler(async (event) => {
  const { course, location } = await readBody<Body>(event)
  if (location != null && !isQrCoordinates(location))
    throw createError({ statusCode: 400, statusMessage: '签到位置格式无效' })

  const data = await event.context.cx.signByCourse(course, location ?? null)

  if (data.length > 0) {
    for (const item of data) {
      await createSignLog(event.context.cx, event.context.prisma, {
        activityId: String(item.activity.id),
        activityName: item.activity.name,
        courseName: course.name,
        courseId: course.courseId,
        classId: course.classId,
        type: Number(item.activity.otherId),
        mode: SignMode.Manual,
        result: item.result,
      })
    }
  }

  return ResOp.success(data)
})
