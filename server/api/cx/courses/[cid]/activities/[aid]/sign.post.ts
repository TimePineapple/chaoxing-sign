import type { Activity, Course } from '~/types/account'
import { SignMode } from '~/constants/cx'
import { createSignLog } from '~/server/utils/createSignLog'

interface Body {
  course: Course
  activity: Activity
  uid: string
}

export default defineEventHandler(async (event) => {
  const { course, activity } = await readBody<Body>(event)

  const data = await event.context.cx.signByActivity(course, activity)

  if (data.result !== '不是签到活动或活动已结束') {
    await createSignLog(event.context.cx, event.context.prisma, {
      activityId: String(data.activity.id), activityName: data.activity.name,
      courseId: course.courseId, classId: course.classId, courseName: course.name,
      type: Number(data.activity.otherId), mode: SignMode.Manual, result: data.result,
    })
  }

  return ResOp.success(data)
})
