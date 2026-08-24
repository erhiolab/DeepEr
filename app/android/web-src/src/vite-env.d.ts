

declare module "*.vue" {
	import type {DefineComponent} from "vue"
	const component: DefineComponent<{}, {}, any>
	export default component
}

declare module "*.webp" {
	const src: string
	export default src
}

declare module "*.png" {
	const src: string
	export default src
}

declare module "*.md?raw" {
	const src: string
	export default src
}
