import {computed, shallowRef, type ComputedRef} from "vue"
import {i18n} from "./index"

/**
 * 语言快照 (由 useLanguages 返回, 按 locale 记忆化)
 * 每个 locale 只构建一次, 组件重复调用不重建对象
 */
export type LanguageSnapshot = ReturnType<typeof buildSnapshot>

const buildSnapshot = () => {
	const t = i18n.global.t
	return {
			common: {
				label: {
					add: t("common.label.add"),
					save: t("common.label.save"),
					cancel: t("common.label.cancel"),
					delete: t("common.label.delete"),
					download: t("common.label.download"),
					refresh: t("common.label.refresh"),
					apply: t("common.label.apply"),
					redraw: t("common.label.redraw"),
					browse: t("common.label.browse"),
					url: t("common.label.url"),
					test: t("common.label.test"),
					back: t("common.label.back"),
					open: t("common.label.open"),
					close: t("common.label.close"),
					show: t("common.label.show"),
					hide: t("common.label.hide"),
					loading: t("common.label.loading"),
					testing: t("common.label.testing"),
					testOk: t("common.label.testOk"),
					testFail: t("common.label.testFail"),
					saving: t("common.label.saving"),
					saved: t("common.label.saved"),
					saveFailed: t("common.label.saveFailed"),
					importing: t("common.label.importing"),
					importDone: t("common.label.importDone"),
					importFailed: t("common.label.importFailed"),
					saveAndLeave: t("common.label.saveAndLeave"),
					discardLeave: t("common.label.discardLeave"),
					modelName: t("common.label.modelName"),
					topK: t("common.label.topK"),
					topP: t("common.label.topP"),
				temperature: t("common.label.temperature"),
				batchSize: t("common.label.batchSize"),
				textSplitMethod: t("common.label.textSplitMethod"),
				textLang: t("common.label.textLang"),
				promptLang: t("common.label.promptLang"),
				saveConfig: t("common.label.saveConfig"),
			},
			download: {
				downloadFailed: t("common.download.downloadFailed"),
			},
			confirm: {
				cancel: t("common.confirm.cancel"),
				confirm: t("common.confirm.confirm"),
			},
		},
		components: {
			live2d: {
				loading: t("common.live2d.loading"),
				empty: t("common.live2d.empty"),
				tagSwipe: t("common.live2d.tagSwipe"),
				tagFrenzy: t("common.live2d.tagFrenzy"),
				touchedName: (name: string) => t("common.live2d.touchedName", {name}),
				touchedSwipe: (name: string) => t("common.live2d.touchedSwipe", {name}),
				touchedFrenzy: (name: string) => t("common.live2d.touchedFrenzy", {name}),
			},
			firstRun: {
				welcome: {
					title: t("components.firstRun.welcome.title"),
					subtitle: t("components.firstRun.welcome.subtitle"),
					links: {
						steam: {
							label: t("components.firstRun.welcome.links.steam.label"),
							sub: t("components.firstRun.welcome.links.steam.sub"),
						},
						noriOS: {
							label: t("components.firstRun.welcome.links.noriOS.label"),
							sub: t("components.firstRun.welcome.links.noriOS.sub"),
						},
						bilibili: {
							label: t("components.firstRun.welcome.links.bilibili.label"),
							sub: t("components.firstRun.welcome.links.bilibili.sub"),
						}
					},
					copyFailed: t("common.toast.copyFailed"),
					openLinkFailed: t("common.toast.openLinkFailed"),
				},
				about: {
					title: t("components.firstRun.about.title"),
					subtitle: t("components.firstRun.about.subtitle"),
					thanksPlaceholder: t("components.firstRun.about.thanksPlaceholder"),
					linksTitle: t("components.firstRun.about.linksTitle"),
					source: {
						label: t("components.firstRun.about.source.label"),
						sub: t("components.firstRun.about.source.sub"),
					},
					issues: {
						label: t("components.firstRun.about.issues.label"),
						sub: t("components.firstRun.about.issues.sub"),
					},
					openLinkFailed: t("common.toast.openLinkFailed"),
					update: {
						title: t("components.firstRun.about.update.title"),
						hint: t("components.firstRun.about.update.hint"),
						check: t("components.firstRun.about.update.check"),
						checking: t("components.firstRun.about.update.checking"),
						updating: t("components.firstRun.about.update.updating"),
						upToDate: t("components.firstRun.about.update.upToDate"),
						latestVersion: t("components.firstRun.about.update.latestVersion"),
						manual: t("components.firstRun.about.update.manual"),
						retry: t("components.firstRun.about.update.retry"),
						restart: t("components.firstRun.about.update.restart"),
						done: t("components.firstRun.about.update.done"),
						autoFailed: t("components.firstRun.about.update.autoFailed"),
						checkFailed: t("components.firstRun.about.update.checkFailed"),
						restartFailed: t("components.firstRun.about.update.restartFailed"),
						currentVersion: t("components.firstRun.about.update.currentVersion"),
						latestVer: t("components.firstRun.about.update.latestVer"),
						checkingText: t("components.firstRun.about.update.checkingText"),
						updatingText: t("components.firstRun.about.update.updatingText"),
					},
				},
				agreement: {
					title: t("components.firstRun.agreement.title"),
					subtitle: t("components.firstRun.agreement.subtitle"),
					agree: t("components.firstRun.agreement.agree"),
				},
				llmConnect: {
					error: {
						apiBaseUrl: t("components.firstRun.llmConnect.error.apiBaseUrl"),
						apiKey: t("components.firstRun.llmConnect.error.apiKey"),
					},
					title: t("components.firstRun.llmConnect.title"),
					sub: t("components.firstRun.llmConnect.sub"),
					apiBaseUrl: t("components.firstRun.llmConnect.apiBaseUrl"),
					apiKey: t("components.firstRun.llmConnect.apiKey"),
					model: t("components.firstRun.llmConnect.model"),
					modelEmpty: t("components.firstRun.llmConnect.modelEmpty"),
					getModel: t("components.firstRun.llmConnect.getModel"),
					getting: t("components.firstRun.llmConnect.getting"),
				}
			},
			main: {
				llm: {
					title: t("components.main.llm.title"),
					subtitle: t("components.main.llm.subtitle"),
					disabledLabel: t("components.main.llm.disabledLabel"),
					disabledDesc: t("components.main.llm.disabledDesc"),
					disabledHint: t("components.main.llm.disabledHint"),
					serverTitle: t("components.main.llm.serverTitle"),
					apiKey: t("components.main.llm.apiKey"),
					keyPlaceholderEmpty: t("components.main.llm.keyPlaceholderEmpty"),
					keyPlaceholderSet: t("components.main.llm.keyPlaceholderSet"),
					keySaved: t("components.main.llm.keySaved"),
					keyNotSaved: t("components.main.llm.keyNotSaved"),
					clearKey: t("components.main.llm.clearKey"),
					showKey: t("components.main.llm.showKey"),
					hideKey: t("components.main.llm.hideKey"),
					testing: t("common.label.testing"),
					testOk: t("common.label.testOk"),
					testFail: t("common.label.testFail"),
					refreshModels: t("components.main.llm.refreshModels"),
					modelsLoading: t("components.main.llm.modelsLoading"),
					modelsEmpty: t("components.main.llm.modelsEmpty"),
					showModels: t("components.main.llm.showModels"),
					reasoningEffort: t("components.main.llm.reasoningEffort"),
					reasoningDefault: t("components.main.llm.reasoningDefault"),
					reasoningLow: t("components.main.llm.reasoningLow"),
					reasoningMedium: t("components.main.llm.reasoningMedium"),
					reasoningHigh: t("components.main.llm.reasoningHigh"),
					reasoningNone: t("components.main.llm.reasoningNone"),
					unenabledHint: t("components.main.llm.unenabledHint"),
					unsavedTitle: t("common.unsaved.title"),
					unsavedMessage: t("components.main.llm.unsavedMessage"),
					saveAndLeave: t("common.label.saveAndLeave"),
					discardLeave: t("common.label.discardLeave"),
				},
				modelSelect: {
					title: t("components.main.modelSelect.title"),
					subtitle: t("components.main.modelSelect.subtitle"),
					officialTitle: t("components.main.modelSelect.officialTitle"),
					installedTitle: t("components.main.modelSelect.installedTitle"),
					officialTag: t("components.main.modelSelect.officialTag"),
					importModel: t("components.main.modelSelect.importModel"),
					selectFolder: t("components.main.modelSelect.selectFolder"),
					importing: t("common.label.importing"),
					importReady: t("common.label.importDone"),
					importFailed: t("common.label.importFailed"),
					importDialogTitle: t("components.main.modelSelect.importDialogTitle"),
					importTypeFolder: t("components.main.modelSelect.importTypeFolder"),
					importTypeFolderDesc: t("components.main.modelSelect.importTypeFolderDesc"),
					importTypeZip: t("components.main.modelSelect.importTypeZip"),
					importTypeZipDesc: t("components.main.modelSelect.importTypeZipDesc"),
					importTypeModel: t("components.main.modelSelect.importTypeModel"),
					importTypeModelDesc: t("components.main.modelSelect.importTypeModelDesc"),
					importClose: t("common.label.cancel"),
					installedEmpty: t("components.main.modelSelect.installedEmpty"),
					officialLoading: t("components.main.modelSelect.officialLoading"),
					officialEmpty: t("components.main.modelSelect.officialEmpty"),
					officialAllInstalled: t("components.main.modelSelect.officialAllInstalled"),
					installed: t("common.label.installed"),
					notInstalled: t("common.label.notInstalled"),
					apply: t("common.label.apply"),
					delete: t("common.label.delete"),
					download: t("common.label.download"),
					downloading: t("common.download.downloading"),
					downloadDone: t("common.download.downloadDone"),
					extracting: t("common.download.extracting"),
					downloadReady: t("common.download.downloadReady"),
					downloadFailed: t("common.download.downloadFailed"),
					loadModelsFailed: t("common.toast.loadModelsFailed"),
					applyModelFailed: t("common.toast.applyModelFailed"),
					deleteModelFailed: t("common.toast.deleteModelFailed"),
					deleteConfirmTitle: t("components.main.modelSelect.deleteConfirmTitle"),
					deleteConfirmMessage: (name: string) => t("components.main.modelSelect.deleteConfirmMessage", {name}),
					configure: t("components.main.modelSelect.configure"),
				},
				modelConfig: {
					title: t("components.main.modelConfig.title"),
					subtitle: t("components.main.modelConfig.subtitle"),
					back: t("common.label.back"),
					name: t("components.main.modelConfig.name"),
					namePlaceholder: t("components.main.modelConfig.namePlaceholder"),
					nameHint: t("components.main.modelConfig.nameHint"),
					cover: t("components.main.modelConfig.cover"),
					uploadCover: t("common.label.upload"),
					removeCover: t("common.label.remove"),
					coverPick: t("components.main.modelConfig.coverPick"),
					coverHint: t("components.main.modelConfig.coverHint"),
					save: t("common.label.save"),
					reset: t("common.label.reset"),
					discard: t("common.label.discard"),
					unsavedTitle: t("common.unsaved.title"),
					unsavedMessage: t("components.main.modelConfig.unsavedMessage"),
					appearanceTitle: t("components.main.modelConfig.appearanceTitle"),
					renderTitle: t("components.main.modelConfig.renderTitle"),
					renderHint: t("components.main.modelConfig.renderHint"),
					scale: t("components.main.modelConfig.scale"),
					posX: t("components.main.modelConfig.posX"),
					posY: t("components.main.modelConfig.posY"),
					rotation: t("components.main.modelConfig.rotation"),
					qualityTitle: t("components.main.modelConfig.qualityTitle"),
					quality: t("components.main.modelConfig.quality"),
					qualityHint: t("components.main.modelConfig.qualityHint"),
					exportConfig: t("components.main.modelConfig.exportConfig"),
					importConfig: t("components.main.modelConfig.importConfig"),
					exportConfigDone: t("components.main.modelConfig.exportConfigDone"),
					importConfigDone: t("components.main.modelConfig.importConfigDone"),
					exportConfigFailed: t("components.main.modelConfig.exportConfigFailed"),
					importConfigFailed: t("components.main.modelConfig.importConfigFailed"),
					loadingModel: t("components.main.modelConfig.loadingModel"),
				},
				characterDesign: {
					title: t("components.main.characterDesign.title"),
					subtitle: t("components.main.characterDesign.subtitle"),
					newPersona: t("components.main.characterDesign.newPersona"),
					importCard: t("components.main.characterDesign.importCard"),
					importCardFilter: t("components.main.characterDesign.importCardFilter"),
					importing: t("common.label.importing"),
					importDone: t("common.label.importDone"),
					importFailed: t("common.label.importFailed"),
					empty: t("components.main.characterDesign.empty"),
					emptyHint: t("components.main.characterDesign.emptyHint"),
					selectHint: t("components.main.characterDesign.selectHint"),
					use: t("components.main.characterDesign.use"),
					used: t("components.main.characterDesign.used"),
					clear: t("components.main.characterDesign.clear"),
					name: t("components.main.characterDesign.name"),
					namePlaceholder: t("components.main.characterDesign.namePlaceholder"),
					personality: t("components.main.characterDesign.personality"),
					personalityPlaceholder: t("components.main.characterDesign.personalityPlaceholder"),
					firstMes: t("components.main.characterDesign.firstMes"),
					firstMesPlaceholder: t("components.main.characterDesign.firstMesPlaceholder"),
					sourceManual: t("components.main.characterDesign.sourceManual"),
					sourceCard: t("components.main.characterDesign.sourceCard"),
					save: t("common.label.save"),
					delete: t("common.label.delete"),
					cancel: t("common.label.cancel"),
					saving: t("common.label.saving"),
					saveDone: t("common.label.saved"),
					saveFailed: t("common.label.saveFailed"),
					nameEmpty: t("components.main.characterDesign.nameEmpty"),
					deleteConfirmTitle: t("components.main.characterDesign.deleteConfirmTitle"),
					deleteConfirmMessage: (name: string) => t("components.main.characterDesign.deleteConfirmMessage", {name}),
					unsavedTitle: t("common.unsaved.title"),
					unsavedMessage: t("components.main.characterDesign.unsavedMessage"),
					saveAndLeave: t("common.label.saveAndLeave"),
					discardLeave: t("common.label.discardLeave"),
				},
				modelGate: {
					title: t("components.main.modelGate.title"),
					desc: t("components.main.modelGate.desc"),
					question: t("components.main.modelGate.question"),
					placeholder: t("components.main.modelGate.placeholder"),
					cancel: t("common.label.cancel"),
					submit: t("components.main.modelGate.submit"),
					wrong: t("components.main.modelGate.wrong"),
					foot: t("components.main.modelGate.foot"),
				},
				languageSelect: {
					title: t("components.main.languageSelect.title"),
					subtitle: t("components.main.languageSelect.subtitle"),
					current: t("components.main.languageSelect.current"),
					langEmpty: t("components.main.languageSelect.langEmpty"),
					loadLanguagesFailed: t("common.toast.loadLanguagesFailed"),
					switchLanguageFailed: t("common.toast.switchLanguageFailed"),
				},
				exception: {
					title: t("components.main.exception.title"),
					subtitle: t("components.main.exception.subtitle"),
					refreshLive2d: t("components.main.exception.refreshLive2d"),
					refreshLive2dDesc: t("components.main.exception.refreshLive2dDesc"),
					showHitAreas: t("components.main.exception.showHitAreas"),
					showHitAreasDesc: t("components.main.exception.showHitAreasDesc"),
					show: t("common.label.show"),
					hide: t("common.label.hide"),
					refresh: t("common.label.refresh"),
					refreshFailed: t("common.toast.refreshFailed"),
					noModel: t("components.main.exception.noModel"),
					openDevtools: t("components.main.exception.openDevtools"),
					openDevtoolsDesc: t("components.main.exception.openDevtoolsDesc"),
					openTaskManager: t("components.main.exception.openTaskManager"),
					openTaskManagerDesc: t("components.main.exception.openTaskManagerDesc"),
					openTaskManagerFailed: t("components.main.exception.openTaskManagerFailed"),
					open: t("common.label.open"),
					close: t("common.label.close"),
					toggleDevtoolsFailed: t("components.main.exception.toggleDevtoolsFailed"),
				},
				touch: {
					title: t("components.main.touch.title"),
					subtitle: t("components.main.touch.subtitle"),
					loadingModel: t("components.main.touch.loadingModel"),
					draftLabel: t("components.main.touch.draftLabel"),
					defaultName: (n: number) => t("components.main.touch.defaultName", {n}),
					untitled: t("components.main.touch.untitled"),
					name: t("components.main.touch.name"),
					namePlaceholder: t("components.main.touch.namePlaceholder"),
					type: t("components.main.touch.type"),
					typeTap: t("components.main.touch.typeTap"),
					typeSwipe: t("components.main.touch.typeSwipe"),
					typeFrenzy: t("components.main.touch.typeFrenzy"),
					prompt: t("components.main.touch.prompt"),
					promptPlaceholder: t("components.main.touch.promptPlaceholder"),
					add: t("common.label.add"),
					save: t("common.label.save"),
					redraw: t("common.label.redraw"),
					cancel: t("common.label.cancel"),
					empty: t("components.main.touch.empty"),
					deleteConfirmTitle: t("components.main.touch.deleteConfirmTitle"),
					deleteConfirmMessage: (name: string) => t("components.main.touch.deleteConfirmMessage", {name}),
					delete: t("common.label.delete"),
				},
				tts: {
					title: t("components.main.tts.title"),
					subtitle: t("components.main.tts.subtitle"),
					disabledLabel: t("components.main.tts.disabledLabel"),
					disabledDesc: t("components.main.tts.disabledDesc"),
					disabledHint: t("components.main.tts.disabledHint"),
					serverTitle: t("components.main.tts.serverTitle"),
					testing: t("common.label.testing"),
					testOk: t("common.label.testOk"),
					testFail: t("common.label.testFail"),
					statusServerError: t("components.main.tts.statusServerError"),
					statusClientError: t("components.main.tts.statusClientError"),
					endpointReachable: t("components.main.tts.endpointReachable"),
					statusNotFound: t("components.main.tts.statusNotFound"),
					gatewayHint: t("components.main.tts.gatewayHint"),
					paramsTitle: t("components.main.tts.paramsTitle"),
					synthTitle: t("components.main.tts.synthTitle"),
					synthEmotion: t("components.main.tts.synthEmotion"),
					synthEmotionPlaceholder: t("components.main.tts.synthEmotionPlaceholder"),
					synthText: t("components.main.tts.synthText"),
					synthTextPlaceholder: t("components.main.tts.synthTextPlaceholder"),
					synthesize: t("components.main.tts.synthesize"),
					synthing: t("components.main.tts.synthing"),
					synthFail: t("components.main.tts.synthFail"),
					play: t("components.main.tts.play"),
					playing: t("components.main.tts.playing"),
					unsavedTitle: t("common.unsaved.title"),
					unsavedMessage: t("components.main.tts.unsavedMessage"),
					saveAndLeave: t("common.label.saveAndLeave"),
					discardLeave: t("common.label.discardLeave"),
					gptSovits: {
						emotionsTitle: t("components.main.tts.gptSovits.emotionsTitle"),
						scanDir: t("components.main.tts.gptSovits.scanDir"),
						emotionsEmpty: t("components.main.tts.gptSovits.emotionsEmpty"),
						editName: t("components.main.tts.gptSovits.editName"),
						editNamePlaceholder: t("components.main.tts.gptSovits.editNamePlaceholder"),
						editAudioPath: t("components.main.tts.gptSovits.editAudioPath"),
						pickAudioTitle: t("components.main.tts.gptSovits.pickAudioTitle"),
						audioFilter: t("components.main.tts.gptSovits.audioFilter"),
						editPromptText: t("components.main.tts.gptSovits.editPromptText"),
						editPromptTextPlaceholder: t("components.main.tts.gptSovits.editPromptTextPlaceholder"),
						errorNameEmpty: t("components.main.tts.gptSovits.errorNameEmpty"),
						errorNameDuplicate: t("components.main.tts.gptSovits.errorNameDuplicate"),
						errorAudioEmpty: t("components.main.tts.gptSovits.errorAudioEmpty"),
						scanDirTitle: t("components.main.tts.gptSovits.scanDirTitle"),
						scanEmpty: t("components.main.tts.gptSovits.scanEmpty"),
						scanDone: (n: number) => t("components.main.tts.gptSovits.scanDone", {n}),
						scanFail: t("components.main.tts.gptSovits.scanFail"),
						refDurationHint: t("components.main.tts.gptSovits.refDurationHint"),
						playRefAudio: t("components.main.tts.gptSovits.playRefAudio"),
						refPlayFileMissing: t("components.main.tts.gptSovits.refPlayFileMissing"),
					},
				},
				talk: {
					online: t("components.main.talk.online"),
					typing: t("components.main.talk.typing"),
					inputPlaceholder: t("components.main.talk.inputPlaceholder"),
					more: t("components.main.talk.more"),
				},
				toolList: {
					title: t("components.main.toolList.title"),
					subtitle: t("components.main.toolList.subtitle"),
					all: t("components.main.toolList.all"),
					refresh: t("components.main.toolList.refresh"),
					searchPlaceholder: t("components.main.toolList.searchPlaceholder"),
					searchEmpty: t("components.main.toolList.searchEmpty"),
					searchEmptyHint: t("components.main.toolList.searchEmptyHint"),
					empty: t("components.main.toolList.empty"),
					emptyHint: t("components.main.toolList.emptyHint"),
					total: (n: number) => t("components.main.toolList.total", {n}),
					builtin: t("components.main.toolList.builtin"),
					callName: t("components.main.toolList.callName"),
					registeredAt: t("components.main.toolList.registeredAt"),
					copyName: t("components.main.toolList.copyName"),
					copied: t("components.main.toolList.copied"),
					copyFailed: t("components.main.toolList.copyFailed"),
					agentHintBuiltin: t("components.main.toolList.agentHintBuiltin"),
				},
			}
		},
		views: {
			firstRun: {
				firstRunFailed: t("common.toast.firstRunFailed"),
				close: t("common.action.closeApp"),
				back: t("views.firstRun.back"),
				next: t("views.firstRun.next"),
				start: t("views.firstRun.start"),
			},
			main: {
				close: t("common.action.closeWin"),
				minimize: t("common.action.minimize"),
				maximize: t("common.action.maximize"),
				petGroup: t("common.label.petGroup"),
				live2dGroup: t("common.label.live2dGroup"),
				agentGroup: t("common.label.agentGroup"),
				settingGroup: t("common.label.settingGroup"),
				home: t("common.label.home"),
				talk: t("common.label.talk"),
				language: t("common.label.language"),
				model: t("common.label.model"),
				llm: t("common.label.llm"),
				touch: t("common.label.touch"),
				action: t("common.label.action"),
				tts: t("common.label.tts"),
				characterDesign: t("common.label.characterDesign"),
				tool: t("common.label.tool"),
				exception: t("common.label.exception"),
				about: t("common.label.about"),
			},
			pet: {
				home: t("views.pet.home"),
				passthrough: t("views.pet.passthrough"),
				resize: t("views.pet.resize"),
				resizing: t("views.pet.resizing"),
			},
		},
		errors: {
			missingApiKey: t("errors.missingApiKey"),
			missingModel: t("errors.missingModel"),
			networkError: t("errors.networkError"),
			httpError: (status?: number) => t("errors.httpError", {status: status ?? ""}),
			emptyText: t("errors.emptyText"),
			missingVoice: t("errors.missingVoice"),
			emptyAudio: t("errors.emptyAudio"),
		},
	}
}

/**
 * 当前 locale 的语言快照 (记忆化, 切换语言时重建一次)
 */
const snapshots = shallowRef<Record<string, LanguageSnapshot>>({})

const snapshot = computed<LanguageSnapshot>(() => {
	const LANG = i18n.global.locale.value
	const CACHED = snapshots.value[LANG]
	if (CACHED) return CACHED
	const NEXT = buildSnapshot()
	snapshots.value = {...snapshots.value, [LANG]: NEXT}
	return NEXT
})

/**
 * 读取完整语言快照 (按 locale 记忆化, 可安全在多个 computed 中重复调用)
 */
export default (): LanguageSnapshot => snapshot.value

/**
 * 语言组路径: useLangGroups 支持的取值路径
 */
export type LangGroupPath =
	| "common.label"
	| "common.confirm"
	| "common.unsaved"
	| "common.live2d"
	| "common.download"
	| "components.live2d"
	| "components.firstRun.welcome"
	| "components.firstRun.about"
	| "components.firstRun.agreement"
	| "components.firstRun.llmConnect"
	| "components.main.llm"
	| "components.main.modelSelect"
	| "components.main.modelConfig"
	| "components.main.characterDesign"
	| "components.main.modelGate"
	| "components.main.languageSelect"
	| "components.main.exception"
	| "components.main.touch"
	| "components.main.tts"
	| "components.main.tts.gptSovits"
	| "components.main.talk"
	| "components.main.toolList"
	| "views.firstRun"
	| "views.main"
	| "views.pet"
	| "errors"

// 按点分路径从快照中取子对象
const pick = (obj: unknown, path: string): unknown =>
	path.split(".").reduce<unknown>((acc, key) => {
		if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key]
		return undefined
	}, obj)

// 深层取类型: 从快照类型中取 Path 指向的子树类型
type DeepPick<T, Path extends string> = Path extends `${infer Head}.${infer Tail}`
	? Head extends keyof T
		? DeepPick<T[Head], Tail>
		: never
	: Path extends keyof T
		? T[Path]
		: never

/**
 * 引用多个语言组 (别名 → 路径), 返回每个组一个 computed ref.
 * 模板中可直接 `llm.title` (顶层 ref 自动解包), 脚本中用 `llm.value.title`.
 *
 * 例:
 *   const {llm, label: common, errors} = useLangGroups({
 *     llm: "components.main.llm",
 *     label: "common.label",
 *     errors: "errors",
 *   })
 *
 * 一个组件/页面可同时引用多个语言组, 减少重复声明与多份 computed.
 */
export const useLangGroups = <M extends Record<string, LangGroupPath>>(
	map: M,
): {[K in keyof M]: ComputedRef<DeepPick<LanguageSnapshot, M[K]>>} => {
	const RESULT = {} as Record<keyof M, ComputedRef<unknown>>
	for (const ALIAS of Object.keys(map) as (keyof M)[]) {
		const PATH = map[ALIAS]
		RESULT[ALIAS] = computed(() => pick(snapshot.value, PATH))
	}
	return RESULT as {[K in keyof M]: ComputedRef<DeepPick<LanguageSnapshot, M[K]>>}
}
