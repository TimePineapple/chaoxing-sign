import { SignMode } from '~/constants/cx'
import { createSignLog } from '~/server/utils/createSignLog'

interface Body {
  uid: string
  setting: CX.Setting
}

export default defineEventHandler(async (event) => {
  const { setting } = await readBody<Body>(event)

  const signResults = await event.context.cx.oneClickSign(setting)

  for (const data of signResults) {
    const { activity, result } = data

    await createSignLog(event.context.cx, event.context.prisma, {
      activityId: String(activity.id), activityName: activity.name,
      courseId: activity.course?.courseId || activity.courseId,
      classId: activity.course?.classId || activity.clazzId,
      courseName: activity.course?.name,
      type: Number(activity.otherId), result, mode: SignMode.Manual,
    })
  }

  return ResOp.success(signResults)
})
