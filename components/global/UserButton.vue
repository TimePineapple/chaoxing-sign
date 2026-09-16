<script  setup lang="ts">
const { status, data, signOut } = useAuth()
const router = useRouter()

const showModal = ref(false)
const ms = useMessage()
const user = computed(() => data.value?.user)

const options = [
  {
    label: '用户资料',
    key: 'profile',
    icon: renderIcon('ri:user-3-line'),
  },
  {
    label: '退出登录',
    key: 'logout',
    icon: renderIcon('ri:logout-box-r-line'),
  },
]

async function handleSelect(key: string) {
  switch (key) {
    case 'profile':
      router.push({ name: 'profile' })
      break
    case 'logout':
      await signOut()
      ms.success('退出成功')
      break
  }
}

async function handleSuccess() {
  showModal.value = false
}
</script>

<template>
  <div>
    <div v-if="status === 'authenticated'" class="flex">
      <n-dropdown trigger="click" :options="options" @select="handleSelect">
        <button class="icon-button" type="button" aria-label="用户菜单">
          <n-avatar size="small" round :src="user?.image!">
          <span v-if="!user?.image">{{ user?.name }}</span>
          </n-avatar>
        </button>
      </n-dropdown>
    </div>
    <div v-else>
      <n-button type="primary" @click="showModal = true">
        登录
      </n-button>
      <ClientOnly>
        <n-modal
          v-model:show="showModal"
          :mask-closable="true"
          preset="card"
          size="large"
          :bordered="false"
          :closable="false"
          class="mobile-sheet login-sheet"
          transform-origin="bottom"
        >
          <LoginCard @success="handleSuccess" />
        </n-modal>
      </ClientOnly>
    </div>
  </div>
</template>
