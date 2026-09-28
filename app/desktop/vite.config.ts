import {readFileSync} from "node:fs"
import {defineConfig} from "vite"
import vue from "@vitejs/plugin-vue"

// Preload the Cubism 2 runtime before l2d evaluates its classes in WebView2.
const L2D_SOURCE = readFileSync(new URL("./node_modules/l2d/dist/index.js", import.meta.url), "utf8")
const L2D_RUNTIME_CALL = /document\.head\.append\(t\)\s*,\s*t\.append\(("(?:\\[\s\S]|[^"\\])*")\s*\)/m.exec(L2D_SOURCE)
if (!L2D_RUNTIME_CALL) throw new Error("Unable to extract the l2d runtime script")
const L2D_RUNTIME = Function("return " + L2D_RUNTIME_CALL[1])()

const PRELOAD_L2D_RUNTIME = () => ({
	name: "preload-l2d-runtime",
	buildStart() {
		this.emitFile({
			type: "asset",
			fileName: "l2d-runtime.js",
			source: L2D_RUNTIME
		})
	},
	configureServer(server: any) {
		server.middlewares.use((request: any, response: any, next: () => void) => {
			if (request.url?.split("?")[0] !== "/l2d-runtime.js") return next()

			response.setHeader("Content-Type", "application/javascript; charset=utf-8")
			response.end(L2D_RUNTIME)
		})
	},
	transform(code: string, id: string) {
		if (!id.replace(/\\/g, "/").endsWith("/l2d/dist/index.js")) return null

		const MATCH = /document\.head\.append\(t\)\s*,\s*t\.append\(/.exec(code)
		if (!MATCH || MATCH.index === undefined) {
			throw new Error("Unable to remove the bundled l2d runtime script")
		}
		const START = MATCH.index + MATCH[0].length
		const SCRIPT_BODY = /^"(?:\\[\s\S]|[^"\\])*"\s*\)/.exec(code.slice(START))
		if (!SCRIPT_BODY) throw new Error("Unable to locate the bundled l2d runtime script")
		const END = START + SCRIPT_BODY[0].length

		return code.slice(0, MATCH.index) + "void 0" + code.slice(END)
	}
})

/**
 * l2d 2.1.1 ships the Cubism 2 runtime as an inline script, but appends the
 * empty script element before assigning its text. Chromium/WebView2 does not
 * execute code added to a script after it is connected, leaving globals such
 * as `AMotion` undefined in production builds. Populate it first, then attach
 * it to the document so the runtime executes synchronously.
 */
const FIX_L2D_RUNTIME_SCRIPT = () => ({
	name: "fix-l2d-runtime-script",
	transform(code: string, id: string) {
		if (!id.replace(/\\/g, "/").endsWith("/l2d/dist/index.js")) return null

		const MATCH = /document\.head\.append\(t\)\s*,\s*t\.append\(/.exec(code)
		if (!MATCH || MATCH.index === undefined) {
			throw new Error("Unable to apply the l2d runtime script compatibility fix")
		}

		const START = MATCH.index + MATCH[0].length
		const SCRIPT_BODY = /^"(?:\\[\s\S]|[^"\\])*"\s*\)/.exec(code.slice(START))
		if (!SCRIPT_BODY) {
			throw new Error("Unable to locate the l2d runtime script body")
		}
		const END = START + SCRIPT_BODY[0].length

		return `${code.slice(0, MATCH.index)}t.append(${code.slice(START, END)};document.head.append(t)${code.slice(END)}`
	}
})

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [PRELOAD_L2D_RUNTIME(), vue()],
	// Tauri 桌面端使用现代 WebView(WebView2/系统 webview), 放宽构建目标以支持
	// import.meta.glob 等生成的 top-level await, 避免 es2020 转译失败
	build: {
		target: "esnext"
	},
	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
				protocol: "ws",
				host,
				port: 1421
			}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"]
		}
	}
}))
