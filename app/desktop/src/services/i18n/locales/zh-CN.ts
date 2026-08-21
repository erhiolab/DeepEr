export default {
	common: {
		action: {
			closeApp: "退出",
			closeWin: "关闭"
		},
		label: {
			petGroup: "伙伴",
			settingGroup: "设置",
			home: "主页",
			talk: "对话",
			language: "语言",
			model: "Live2D",
			llm: "LLM",
			tts: "TTS",
			exception: "异常",
			about: "关于",
			touch: "触摸",
			installed: "已安装",
			notInstalled: "未安装",
			apply: "应用",
			delete: "删除",
			download: "下载",
			refresh: "刷新",
		},
		live2d: {
			loading: "加载中...",
			empty: "暂无模型",
			noTouchArea: "该模型没有可触摸区域，可到「触摸」页自定义",
			tagSwipe: "磨蹭",
			tagFrenzy: "狂点",
			touchedName: "用户触摸了{name}",
			touchedSwipe: "用户在{name}上来回磨蹭",
			touchedFrenzy: "用户疯狂点击{name}",
		},
		download: {
			downloading: "正在下载...",
			downloadDone: "下载完成",
			extracting: "正在解压...",
			downloadReady: "就绪",
			downloadFailed: "下载失败"
		},
		toast: {
			firstRunFailed: "首次运行失败",
			openLinkFailed: "打开链接失败",
			copyFailed: "复制失败",
			loadLanguagesFailed: "加载语言列表失败",
			switchLanguageFailed: "切换语言失败",
			loadModelsFailed: "加载模型列表失败",
			applyModelFailed: "应用模型失败",
			deleteModelFailed: "删除模型失败",
			refreshFailed: "刷新 Live2D 模型失败",
		},
	},
	components: {
		firstRun: {
			welcome: {
				title: "欢迎来到 澄渊",
				subtitle: "一只会陪你上班/学习/摸鱼的桌面伙伴 (以下为游戏推广).",
				links: {
					steam: {
						label: "Steam 页面",
						sub: "加入愿望单支持老大!",
					},
					noriOS: {
						label: "Nori 先导页",
						sub: "在 NoriOS 上体验 Nori 的世界",
					},
					bilibili: {
						label: "Bilibili",
						sub: "关注老大的更新和开发日志",
					}
				}
			},
			about: {
				title: "关于 DeepEr",
				subtitle: "致谢与联系方式",
				thanksPlaceholder: "感谢每一位让 DeepEr 变得更好的伙伴. ",
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
			}
		},
		main: {
			modelSelect: {
				officialTitle: "官方模型",
				customTitle: "自定义模型",
				importModel: "导入模型",
				selectFolder: "选择模型文件夹",
				importing: "正在导入...",
				importReady: "导入完成",
				importFailed: "导入失败",
				customEmpty: "还没有导入模型",
				gate: {
					title: "模型授权验证",
					desc: "该模型由 inori 提供, 因模型特殊性不可分发, 但是你可以回答这个问题获得下载资格",
					question: "Nori写的诗第一句？8字",
					placeholder: "请输入答案",
					cancel: "取消",
					submit: "验证并下载",
					wrong: "答案不正确, 再想想~",
					foot: "你或许可以去群里找找答案, 如果感兴趣可以加个愿望单, 谢谢~"
				}
			},
			languageSelect: {
				title: "语言",
				subtitle: "选择你偏好的界面语言，切换后立即生效",
				current: "当前语言",
				langEmpty: "暂无可用语言"
			},
			exception: {
				title: "异常处理",
				subtitle: "遇到问题时可在这里手动恢复",
				refreshLive2d: "刷新 Live2D 模型",
				refreshLive2dDesc: "重新加载当前应用的 Live2D 模型",
				showHitAreas: "显示可触摸区域",
				showHitAreasDesc: "以覆盖层标注模型中可触摸区域的边界",
				show: "显示",
				hide: "隐藏",
				noModel: "尚未应用任何 Live2D 模型",
			},
			touch: {
				title: "触摸区域",
				subtitle: "为当前模型自定义可触摸区域，拖拽画布添加",
				loadingModel: "模型加载中，稍后在此绘制…",
				draftLabel: "新",
				defaultName: "区域 {n}",
				untitled: "未命名",
				name: "名称",
				namePlaceholder: "给这个区域起个名字（如：头、手、肚子）",
				type: "触摸类型",
				typeTap: "点击",
				typeSwipe: "磨蹭",
				typeFrenzy: "狂点",
				prompt: "AI 提示词（可选）",
				promptPlaceholder: "触发时告诉 AI 用户触摸了哪里",
				add: "添加",
				save: "保存",
				cancel: "取消",
				empty: "还没有自定义触摸区域，在上方画布中拖拽添加",
			},
		}
	},
	views: {
		firstRun: {
			back: "上一步",
			next: "下一步",
			start: "开始"
		},
		pet: {
			passthrough: "穿透 (点击后鼠标穿透到背后, 通过托盘恢复)",
			resize: "调整大小",
			resizing: "取消调整"
		}
	},
}
