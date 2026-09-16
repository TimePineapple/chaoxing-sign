<script lang="ts" setup>
definePageMeta({
  auth: {
    unauthenticatedOnly: true,
    navigateAuthenticatedTo: '/',
  },
})
</script>

<template>
  <div class="login-page">
    <div class="page-intro"><span class="eyebrow">欢迎回来</span><h1>你的签到小助手</h1><p>登录本站账号，管理你的某星账号。</p></div>
    <LoginCard />
  </div>
</template>
