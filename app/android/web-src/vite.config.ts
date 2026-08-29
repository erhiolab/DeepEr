import {defineConfig} from "vite"
import vue from "@vitejs/plugin-vue"
import legacy from "@vitejs/plugin-legacy"
import path from "node:path"

const OUT_DIR = path.resolve(__dirname, "../app/src/main/assets/web")

export default defineConfig({
	plugins: [
		vue(),
		legacy({
			targets: ["Chrome >= 49", "Android >= 5"],
			modernPolyfills: true,
		}),
	],
	base: "./",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		host: "0.0.0.0",
		port: 5174,
	},
	build: {
		outDir: OUT_DIR,
		emptyOutDir: true,
		assetsInlineLimit: 0,
		chunkSizeWarningLimit: 10000,
		rollupOptions: {
			output: {
				manualChunks: {
					live2d: ["live2d-easy-control"],
				},
			},
		},
	},
})
