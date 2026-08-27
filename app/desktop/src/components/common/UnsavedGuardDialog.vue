<script setup lang="ts">
/**
 * 未保存修改守卫弹窗: 基于 BaseDialog 封装, 由全局 unsaved guard store 驱动
 */
import {useUnsavedGuard} from "../../services/store/unsaved.ts"
import Icon from "./Icon.vue"
import BaseDialog from "./BaseDialog.vue"

const GUARD = useUnsavedGuard()
</script>

<template>
	<BaseDialog :open="GUARD.open" :title="GUARD.title" :message="GUARD.message" @close="GUARD.cancel">
		<template #icon>
			<Icon name="info" :size="18" class="dialog-warn-icon"/>
		</template>
		<template #actions>
			<button class="confirm-btn danger-ghost" @click="GUARD.discard">{{ GUARD.dangerLabel }}</button>
			<button class="confirm-btn primary" @click="GUARD.save">{{ GUARD.primaryLabel }}</button>
		</template>
	</BaseDialog>
</template>
