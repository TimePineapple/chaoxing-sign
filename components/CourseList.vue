<script setup lang="ts">
import type { Account, Activity, Course } from '~/types/account'
import { activityTypeMap } from '~/constants/cx'

const props = defineProps<{
  account: Account
  courses: Course[]
}>()

const accountStore = useAccountStore()

const isSyncLoading = ref(false)
const showModal = ref(false)

const currentCourse = ref<Course>()
const activities = ref<Activity[]>([])

function syncCourse() {
  isSyncLoading.value = true
  accountStore.getCourses(props.account.uid).finally(() => {
    isSyncLoading.value = false
  })
}

async function lookActivities(course: Course) {
  course.isLoadActivity = true
  currentCourse.value = course
  activities.value = []
  try {
    activities.value = await accountStore.getActivityList(props.account.uid, course)
    showModal.value = true
  }
  finally {
    course.isLoadActivity = false
  }
}

async function signByCourse(course: Course) {
  course.isSigning = true
  try {
    await accountStore.signByCourse(props.account.uid, course)
  }
  finally {
    course.isSigning = false
  }
}

async function signByActivity(course: Course, activity: Activity) {
  await accountStore.signByActivity(props.account.uid, course, activity)
}
</script>

<template>
  <div class="section-heading course-heading">
    <h2>课程 <span class="count">{{ account?.courses?.length || 0 }}</span></h2>
    <n-button secondary :loading="isSyncLoading" @click="syncCourse()"><template #icon><Icon name="material-symbols:cloud-sync-outline-rounded" /></template>同步课程</n-button>
  </div>
  <div v-if="courses?.length > 0" class="course-stack">
    <n-grid :cols="1" :y-gap="12">
      <n-grid-item v-for="course in courses" :key="course.courseId">
        <n-card class="course-card">
          <template #header>
            <h2 class="course-name">
              {{ course.name }}
            </h2>
          </template>
          <template #cover>
            <img :src="course.image" :alt="course.name" class="course-cover">
          </template>
          <template #action>
            <div class="primary-actions">
              <n-button secondary :loading="course.isLoadActivity" @click="lookActivities(course)"><template #icon><Icon name="material-symbols:grid-view-outline-rounded" /></template>活动列表</n-button>
              <n-button type="primary" :loading="course.isSigning" @click="signByCourse(course)"><template #icon><Icon name="material-symbols:swipe-up-outline" /></template>一键签到</n-button>
            </div>
          </template>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
  <div v-else class="empty-card">
    <n-empty description="暂无课程" size="small" />
  </div>
  <n-modal
    v-model:show="showModal"
    title="活动列表"
    preset="card"
    size="medium"
    :bordered="false"
    :closable="true"
    class="mobile-sheet activity-sheet"
    transform-origin="bottom"
  >
    <div v-if="activities.length > 0">
      <n-list hoverable clickable>
        <n-list-item v-for="activity in activities" :key="activity.id">
          <n-thing>
            <template v-if="activity.logo" #avatar>
              <n-avatar :size="50" :src="activity.logo" style="--n-color: rgb(255 255 255 / 0%);" />
            </template>
            <template #header>
              <div class="activity-title">
                <h2 text-lg>
                  {{ activity.nameOne }}
                </h2>
                <p class="muted">
                  {{ activity.nameFour }}
                </p>
              </div>
            </template>
            <template #description>
              <n-tag :bordered="false" type="info" size="small">
                {{ activityTypeMap[activity.type] }}
              </n-tag>
            </template>
          </n-thing>
          <template #suffix>
            <n-button v-if="activity.status === 1" type="primary" @click="signByActivity(currentCourse!, activity)">
              签到
            </n-button>
          </template>
        </n-list-item>
      </n-list>
    </div>
    <div v-else>
      <n-empty description="暂无活动" size="small" />
    </div>
  </n-modal>
</template>

<style scoped>
.icon{
  --at-apply: cursor-pointer transition hover:text-red-4
}
</style>
