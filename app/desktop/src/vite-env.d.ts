/// <reference types="vite/client" />

declare module "*.vue" {
	import type {DefineComponent} from "vue"
	const component: DefineComponent<{}, {}, any>
	export default component
}

declare module "*.m4a" {
	const src: string
	export default src
}
