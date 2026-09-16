<template>
  <div class="app-layout">
    <AppHeader />
    <div class="mobile-main">
      <article class="help-article prose prose-gray dark:prose-invert">
        <slot />
      </article>
    </div>
    <AppFooter />
  </div>
</template>
