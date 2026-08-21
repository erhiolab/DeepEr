<script setup lang="ts">
import {computed, ref, watch} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"

const I18N = computed(() => useLanguages().components.main.modelGate)

// 正确校验答案
const GATE_ANSWER = "水母是水里的月亮"

// 打开状态 (受控)
const props = defineProps<{
	open: boolean
	/**
	 * 待授权的模型 id
	 */
	modelId: string | null
}>()

const emit = defineEmits<{
	(e: "update:open", value: boolean): void
	(e: "confirm", modelId: string): void
}>()

// 验证答案输入
const gateAnswer = ref("")

// 验证错误提示
const gateError = ref("")

// 验证提交状态
const gateSubmitting = ref(false)

// 每次打开时重置
watch(() => props.open, (open) => {
	if (open) {
		gateAnswer.value = ""
		gateError.value = ""
		gateSubmitting.value = false
	}
})

// 关闭弹窗
const closeGate = (): void => {
	emit("update:open", false)
}

// 提交验证答案
const submitGate = async (): Promise<void> => {
	if (gateSubmitting.value) return
	const ANSWER = gateAnswer.value.trim()
	if (ANSWER !== GATE_ANSWER) {
		gateError.value = I18N.value.wrong
		return
	}
	const ID = props.modelId
	closeGate()
	if (ID) {
		gateSubmitting.value = true
		try {
			emit("confirm", ID)
		} finally {
			gateSubmitting.value = false
		}
	}
}
</script>

<template>
	<Teleport to="body">
		<Transition name="gate">
			<div v-if="open" class="gate-overlay" @click.self="closeGate">
				<div class="gate-panel">
					<header class="gate-head">
						<h3 class="gate-title">{{ I18N.title }}</h3>
						<button class="gate-close" @click="closeGate">✕</button>
					</header>
					<p class="gate-desc">{{ I18N.desc }}</p>
					<label class="gate-question">{{ I18N.question }}</label>
					<input
						v-model="gateAnswer"
						class="gate-input"
						type="text"
						:placeholder="I18N.placeholder"
						autocomplete="off"
						@keyup.enter="submitGate"
					/>
					<p v-if="gateError" class="gate-error">{{ gateError }}</p>
					<footer class="gate-actions">
						<button class="gate-btn ghost" @click="closeGate">{{ I18N.cancel }}</button>
						<button class="gate-btn primary" :disabled="!gateAnswer.trim()" @click="submitGate">
							{{ I18N.submit }}
						</button>
					</footer>
					<p class="gate-foot">{{ I18N.foot }}</p>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped lang="less">
.gate-overlay {
	position: fixed;
	padding: 2rem;
	inset: 0;
	z-index: 9999;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(5, 7, 10, 0.72);
	backdrop-filter: blur(0.4rem);
}

.gate-panel {
	padding: 1.6rem 1.8rem 1.3rem;
	width: min(40rem, 100%);
	display: flex;
	flex-direction: column;
	gap: 1rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-md);
	background: linear-gradient(160deg, var(--bg-panel), var(--bg-abyss));
	box-shadow: var(--shadow-soft), 0 0 3rem var(--glow-teal-soft);
}

.gate-head {
	display: flex;
	align-items: center;
	justify-content: space-between;

	.gate-title {
		margin: 0;
		font-size: 1.55rem;
		font-weight: 700;
		color: var(--deep-teal-bright);
	}

	.gate-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		border: none;
		border-radius: 50%;
		background-color: transparent;
		color: var(--text-faint);
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			background-color: rgba(251, 44, 54, 0.12);
			color: var(--danger);
		}
	}
}

.gate-desc {
	margin: 0;
	font-size: 1.15rem;
	line-height: 1.7;
	color: var(--text-body);
}

.gate-question {
	font-size: 1.2rem;
	font-weight: 600;
	color: var(--text-primary);
	letter-spacing: 0.02rem;
}

.gate-input {
	padding: 0.7rem 1rem;
	width: 100%;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-primary);
	font-family: inherit;
	font-size: 1.15rem;
	transition: all 0.2s ease;

	&::placeholder {
		color: var(--text-faint);
	}

	&:focus {
		outline: none;
		border-color: var(--deep-teal);
		box-shadow: 0 0 0 0.25rem var(--glow-teal-soft);
	}
}

.gate-error {
	margin: -0.4rem 0 0;
	font-size: 1.05rem;
	color: var(--danger);
}

.gate-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.9rem;

	.gate-btn {
		padding: 0.7rem 1.6rem;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: 1.2rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;

		&.ghost {
			border: 0.1rem solid var(--line-strong);
			background-color: transparent;
			color: var(--text-muted);

			&:hover {
				border-color: var(--line-strong);
				color: var(--text-body);
				background-color: rgba(255, 255, 255, 0.04);
			}
		}

		&.primary {
			border: none;
			color: #05121a;
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));

			&:hover:not(:disabled) {
				box-shadow: 0 0 1.4rem var(--glow-teal-soft);
			}

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
	}
}

.gate-foot {
	padding-top: 0.7rem;
	margin: 0;
	border-top: 0.1rem solid var(--line-subtle);
	font-size: 1.05rem;
	line-height: 1.6;
	color: var(--text-faint);
}

.gate-enter-active,
.gate-leave-active {
	transition: opacity 0.2s ease;
}

.gate-enter-active .gate-panel,
.gate-leave-active .gate-panel {
	transition: transform 0.2s ease;
}

.gate-enter-from,
.gate-leave-to {
	opacity: 0;
}

.gate-enter-from .gate-panel,
.gate-leave-to .gate-panel {
	transform: translateY(0.6rem) scale(0.98);
}
</style>
