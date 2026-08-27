<script setup lang="ts">
/**
 * 确认弹窗: 基于 BaseDialog 封装, 支持危险确认 / 加载态
 */
import {computed} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"
import Icon from "./Icon.vue"
import BaseDialog from "./BaseDialog.vue"

const I18N = computed(() => useLanguages().common.confirm)

withDefaults(defineProps<{
	open: boolean
	title: string
	message: string
	confirmText: string
	danger?: boolean
	loading?: boolean
}>(), {
	danger: false,
	loading: false,
})

const emit = defineEmits<{
	(e: "update:open", value: boolean): void
	(e: "confirm"): void
	(e: "cancel"): void
}>()

const close = (): void => {
	emit("update:open", false)
	emit("cancel")
}
</script>

<template>
	<BaseDialog :open="open" :title="title" :message="message" @close="close">
		<template #icon>
			<Icon name="error" :size="18" class="dialog-warn-icon"/>
		</template>
		<template #actions>
			<button class="confirm-btn ghost" :disabled="loading" @click="close">{{ I18N.cancel }}</button>
			<button
				class="confirm-btn"
				:class="danger ? 'danger' : 'primary'"
				:disabled="loading"
				@click="emit('confirm')"
			>
				<Icon v-if="loading" name="loading" class="spin" :size="14"/>
				{{ confirmText }}
			</button>
		</template>
	</BaseDialog>
</template>
