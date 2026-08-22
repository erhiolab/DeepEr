export interface CanvasLayoutOptions {
	zIndex: string
	scale: number
	offsetX: number
	offsetY: number
	animate: boolean
	inset?: number
}

export const applyCanvasLayout = (
	canvas: HTMLCanvasElement | null,
	box: HTMLElement | null | undefined,
	options: CanvasLayoutOptions
): void => {
	if (!canvas) return
	canvas.style.position = "fixed"
	canvas.style.pointerEvents = "none"
	canvas.style.transformOrigin = "center"

	if (box) {
		canvas.style.transformOrigin = "bottom center"
		const rect = box.getBoundingClientRect()
		const inset = options.inset ?? 0
		canvas.style.left = `${rect.left + inset}px`
		canvas.style.top = `${rect.top + inset}px`
		canvas.style.width = `${Math.max(0, rect.width - inset * 2)}px`
		canvas.style.height = `${Math.max(0, rect.height - inset * 2)}px`
		canvas.style.zIndex = options.zIndex
	} else {
		canvas.style.left = "0"; canvas.style.top = "0"
		canvas.style.width = "100%"; canvas.style.height = "100%"
		canvas.style.zIndex = options.zIndex || "1"
	}
	canvas.style.transform = `scale(${options.scale}) translate(${options.offsetX}px, ${options.offsetY}px)`
	canvas.style.opacity = "1"

	if (options.animate) {
		const ease = "0.42s cubic-bezier(0.4, 0, 0.2, 1)"
		canvas.style.transition = `left ${ease}, top ${ease}, width ${ease}, height ${ease}, opacity 0.3s ease`
	} else {
		canvas.style.transition = "none"
	}
}
