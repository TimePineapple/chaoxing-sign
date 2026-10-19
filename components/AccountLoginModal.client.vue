<script setup lang="ts">
import type { FormInst, FormItemRule, FormRules } from 'naive-ui'

const props = defineProps<{ account?: { uid: string; username: string } }>()

const emit = defineEmits< {
  (e: 'success', name: string): void
}>()

const accountStore = useAccountStore()
const loading = ref(false)
const errorMessage = ref('')

const formRef = ref<FormInst | null>(null)
const form = reactive({
  username: '',
  password: '',
})
watch(() => props.account, (account) => {
  form.username = account?.username || ''
  form.password = ''
  errorMessage.value = ''
}, { immediate: true })

const rules: FormRules = {
  username: [
    {
      required: true,
      validator(rule: FormItemRule, value: string) {
        if (!isPhone(value))
          return new Error('请输入正确的手机号')

        return true
      },
      trigger: ['input', 'blur'],
    },
  ],
  password: [
    {
      required: true,
      message: '请输入密码',
    },
  ],
}

async function addAccount() {
  if (loading.value)
    return

  errorMessage.value = ''
  try {
    await formRef.value?.validate()
  }
  catch {
    return
  }

  if (!props.account && accountStore.accounts?.some(a => a.username === form.username)) {
    errorMessage.value = '账号已存在，无需添加'
    return
  }

  loading.value = true
  let account: { info: { realname?: string } }
  try {
    account = props.account
      ? await accountStore.relogin(props.account.uid, form.password)
      : await accountStore.login(form)
  }
  catch (error) {
    const failure = error as { data?: { message?: string }, response?: { _data?: { message?: string } }, message?: string }
    errorMessage.value = failure?.data?.message || failure?.response?._data?.message || failure?.message || '添加学习通账号失败，请稍后重试'
    return
  }
  finally {
    loading.value = false
  }

  emit('success', account.info.realname || form.username)
  if (!props.account)
    form.username = ''
  form.password = ''
  await navigateTo('/')
}
</script>

<template>
  <n-modal
    :mask-closable="!loading"
    :close-on-esc="!loading"
    preset="card"
    size="large"
    :bordered="false"
    :closable="false"
    class="mobile-sheet"
    :title="account ? '重新登录学习通账号' : '添加某星账号'"
    transform-origin="bottom"
    @after-leave="errorMessage = ''; form.password = ''"
  >
    <n-spin :show="loading">
      <n-form ref="formRef" :model="form" :rules="rules" :show-label="false">
        <div class="text-sm text-gray-400 my-4 flex justify-center">
          <img src="/img/cx.png" alt="cx">
        </div>
        <n-form-item label="账号" path="username">
          <n-input v-model:value="form.username" placeholder="账号" :disabled="Boolean(account) || loading">
            <template #prefix>
              <i i-ri:user-3-line />
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="密码" path="password">
          <n-input
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="密码"
            :maxlength="16"
            :disabled="loading"
            @keyup.enter="addAccount()"
          >
            <template #prefix>
              <i i-ri:lock-2-line />
            </template>
          </n-input>
        </n-form-item>
        <n-alert v-if="errorMessage" type="error" :title="account ? '重新登录失败' : '添加失败'" class="mb-4" role="alert">
          {{ errorMessage }}
        </n-alert>
        <n-form-item>
          <n-button type="primary" class="!w-full" :loading="loading" @click="addAccount()">
            登录
          </n-button>
        </n-form-item>
      </n-form>
    </n-spin>
  </n-modal>
</template>
