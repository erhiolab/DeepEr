export default {
	app: {
		title: "Nori"
	},
	common: {
		action: {
			closeApp: "退出",
			closeWin: "关闭"
		},
		label: {
			home: "主页",
			talk: "对话",
			model: "模型",
			settings: "设置",
		},
		live2d: {
			loading: "加载中...",
			empty: "暂无模型",
		}
	},
	components: {
		firstRun: {
			welcome: {
				title: "欢迎来到 Nori",
				subtitle: "一只会陪你上班/学习/摸鱼的桌面伙伴. 先认识一下它吧. ",
				links: {
					steam: {
						label: "Steam 页面",
						sub: "加入愿望单支持老大!",
					},
					noriOS: {
						label: "Nori 先导页",
						sub: "在 NoriOS 上体验 Nori 的世界",
					},
					qq: {
						label: "QQ 交流群",
						sub: "点击复制群号: 1041616195",
					},
					bilibili: {
						label: "Bilibili",
						sub: "关注老大的更新和开发日志",
					}
				}
			},
			about: {
				title: "关于 Nori",
				subtitle: "致谢与联系方式",
				thanksPlaceholder: "感谢每一位让 Nori 变得更好的伙伴. ",
				linksTitle: "了解更多",
				source: {
					label: "GitHub 仓库",
					sub: "开源仓库, 欢迎 Star",
				},
				issues: {
					label: "反馈问题",
					sub: "有任何问题欢迎提交 Issue",
				}
			},
			agreement: {
				title: "协议声明",
				subtitle: "请阅读以下声明后继续",
				agree: "我已阅读并同意以上声明"
			}
		},
		main: {
			modelSelect: {
			},
		}
	},
	views: {
		firstRun: {
			back: "上一步",
			next: "下一步",
			start: "开始"
		},
		main: {
		}
	},
	no: {
		pet: {
			hint: "点击小宠物聊聊天吧",
		},
		init: {
			title: "正在初始化...",
			live2d: "正在初始化 Live2D 模型..."
		},
		download: {
			downloading: "正在下载...",
			downloadDone: "下载完成",
			extracting: "正在解压...",
			ready: "初始化完成",
			installed: "安装完成",
			downloadFailed: "下载失败",
			check: "正在检查..."
		},
		languageSelect: {
			title: "选择语言",
			langEmpty: "暂无可用语言"
		},
		llmConnect: {
			error: {
				apiBaseUrl: "请填写 API 地址",
				apiKey: "请填写 API Key",
			},
			title: "连接 LLM 模型",
			sub: "仅支持 OpenAI 协议接口",
			apiBaseUrl: "API 地址",
			apiKey: "API Key",
			model: "模型",
			modelEmpty: "暂无可用模型",
			getModel: "获取模型",
			getting: "获取中...",
		},
	}
}