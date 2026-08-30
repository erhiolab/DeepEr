// 临时冒烟测试用的最小 MCP stdio 服务器
import readline from "node:readline"
import http from "node:http"

const SERVER_INFO = {
	protocolVersion: "2025-06-18",
	capabilities: {tools: {listChanged: false}},
	serverInfo: {name: "probe-server", version: "1.0.0"},
}

const TOOLS = [
	{
		name: "echo",
		title: "回显",
		description: "把传入的 text 原样返回",
		inputSchema: {
			type: "object",
			properties: {text: {type: "string", description: "要回显的文本"}},
			required: ["text"],
		},
	},
	{
		name: "add",
		title: "加法",
		description: "计算 a + b",
		inputSchema: {
			type: "object",
			properties: {a: {type: "number"}, b: {type: "number"}},
			required: ["a", "b"],
		},
	},
]

const respond = (id, result) => {
	process.stdout.write(JSON.stringify({jsonrpc: "2.0", id, result}) + "\n")
}

const respondError = (id, error) => {
	process.stdout.write(JSON.stringify({jsonrpc: "2.0", id, error}) + "\n")
}

const rl = readline.createInterface({input: process.stdin})

rl.on("line", line => {
	const trimmed = line.trim()
	if (!trimmed) return
	let message
	try {
		message = JSON.parse(trimmed)
	} catch {
		return
	}
	const {id, method, params} = message
	if (method === "initialize") {
		respond(id, SERVER_INFO)
		return
	}
	if (method === "notifications/initialized" || method === "ping") {
		if (id !== undefined) respond(id, {})
		return
	}
	if (method === "tools/list") {
		respond(id, {tools: TOOLS})
		return
	}
	if (method === "tools/call") {
		const name = params?.name
		const args = params?.arguments ?? {}
		if (name === "echo") {
			respond(id, {content: [{type: "text", text: String(args.text ?? "")}]})
			return
		}
		if (name === "add") {
			const sum = Number(args.a ?? 0) + Number(args.b ?? 0)
			respond(id, {structuredContent: {sum}, content: [{type: "text", text: `sum=${sum}`}]})
			return
		}
		respondError(id, {code: -32602, message: `unknown tool: ${name}`})
		return
	}
	respondError(id ?? 0, {code: -32601, message: `method not found: ${method}`})
})

// ---- SSE 模式: node __probe_fake_mcp.mjs --sse ----
if (process.argv.includes("--sse")) {
	const PORT = 18789
	const streams = new Set()

	const handle = (message, id, result) => {
		const payload = JSON.stringify({jsonrpc: "2.0", id, result})
		for (const res of streams) {
			res.write(`event: message\ndata: ${payload}\n\n`)
		}
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
		if (req.method === "GET" && url.searchParams.has("event")) {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			})
			res.write(`event: endpoint\ndata: http://127.0.0.1:${PORT}/mcp?message\n\n`)
			streams.add(res)
			req.on("close", () => streams.delete(res))
			return
		}
		if (req.method === "POST" && url.searchParams.has("message")) {
			let body = ""
			req.on("data", chunk => { body += chunk })
			req.on("end", () => {
				res.writeHead(202, {"Content-Type": "application/json"})
				res.end("Accepted")
				let message
				try {
					message = JSON.parse(body)
				} catch {
					return
				}
				const {id, method, params} = message
				if (method === "initialize") {
					handle(message, id, SERVER_INFO)
				} else if (method === "tools/list") {
					handle(message, id, {tools: TOOLS})
				} else if (method === "tools/call") {
					const name = params?.name
					const args = params?.arguments ?? {}
					if (name === "echo") {
						handle(message, id, {content: [{type: "text", text: String(args.text ?? "")}]})
					} else if (name === "add") {
						const sum = Number(args.a ?? 0) + Number(args.b ?? 0)
						handle(message, id, {structuredContent: {sum}, content: [{type: "text", text: `sum=${sum}`}]})
					} else {
						handle(message, id, {content: [], isError: true})
					}
				} else {
					handle(message, id ?? 0, {})
				}
			})
			return
		}
		res.writeHead(404)
		res.end()
	})
	server.listen(PORT, "127.0.0.1")
	process.stdout.write(`sse listening on ${PORT}\n`)
}
