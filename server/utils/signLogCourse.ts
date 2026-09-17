import type { PrismaClient } from '@prisma/client'
import type { Cx } from '~/server/protocol/cx'

interface CourseIdentity {
  courseId?: string | number | null
  classId?: string | number | null
}

// Course names are display metadata. A lookup failure must not turn a completed
// Chaoxing sign request into a failed request or prevent its log from being saved.
export async function resolveSignCourseName(
  cx: Cx,
  prisma: PrismaClient,
  identity: CourseIdentity,
  fallbackName?: string | null,
): Promise<string | null> {
  const courseId = String(identity.courseId ?? '').trim()
  const classId = String(identity.classId ?? '').trim()
  const matches = (course: { courseId: string; classId: string }) =>
    (!courseId || course.courseId === courseId) && (!classId || course.classId === classId)
  const cached = courseId || classId ? cx.courseList?.find(matches)?.name?.trim() : null

  // A successful sign triggers one fresh Chaoxing course-list lookup. If it is
  // unavailable, keep the best name already known to this account.
  try {
    const live = await cx.getCourseList()
    const name = courseId || classId ? live.find(matches)?.name?.trim() : null
    if (name)
      return name
  }
  catch {
    // Name enrichment is best effort.
  }

  if (cached)
    return cached
  if (!courseId && !classId)
    return fallbackName?.trim() || null

  try {
    const saved = await prisma.course.findFirst({
      where: {
        ...(courseId && { courseId }),
        ...(classId && { classId }),
        accounts: { some: { uid: cx.user.uid } },
      },
      select: { name: true },
    })
    if (saved?.name?.trim())
      return saved.name.trim()
  }
  catch {
    // The live course list is still worth trying.
  }

  return fallbackName?.trim() || null
}
