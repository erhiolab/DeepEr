import {defineConfig} from "vite"
import vue from "@vitejs/plugin-vue"
import legacy from "@vitejs/plugin-legacy"
import path from "node:path"

const OUT_DIR = process.env.WEB_OUT_DIR
	? path.resolve(process.env.WEB_OUT_DIR)
	: path.resolve(__dirname, "../app/build/generated/web-assets/dev/web")
const TTS_ENABLED = process.env.VITE_TTS_ENABLED !== "false"

export default defineConfig({
	define: {
		__TTS_ENABLED__: JSON.stringify(TTS_ENABLED),
	},
	plugins: [
		vue(),
		legacy({
			targets: ["Chrome >= 61", "Android >= 7"],
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
		target: "es2015",
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
