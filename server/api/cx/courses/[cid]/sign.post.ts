import { SignMode } from '~/constants/cx'
import { createSignLog } from '~/server/utils/createSignLog'

interface Body {
  course: Course
  uid: string
}

export default defineEventHandler(async (event) => {
  const { course } = await readBody<Body>(event)

  const data = await event.context.cx.signByCourse(course)

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
