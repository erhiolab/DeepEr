import {i18n} from "./index"

export default () => {
	const t = i18n.global.t
	return {
		common: {
			download: {
				downloadFailed: t("common.download.downloadFailed"),
			},
		},
		components: {
			live2d: {
				loading: t("common.live2d.loading"),
				empty: t("common.live2d.empty"),
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
				modelSelect: {
					officialTitle: t("components.main.modelSelect.officialTitle"),
					customTitle: t("components.main.modelSelect.customTitle"),
					importModel: t("components.main.modelSelect.importModel"),
					selectFolder: t("components.main.modelSelect.selectFolder"),
					importing: t("components.main.modelSelect.importing"),
					importReady: t("components.main.modelSelect.importReady"),
					importFailed: t("components.main.modelSelect.importFailed"),
					customEmpty: t("components.main.modelSelect.customEmpty"),
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
					refresh: t("common.label.refresh"),
					refreshFailed: t("common.toast.refreshFailed"),
					noModel: t("components.main.exception.noModel"),
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
				petGroup: t("common.label.petGroup"),
				settingGroup: t("common.label.settingGroup"),
				home: t("common.label.home"),
				talk: t("common.label.talk"),
				language: t("common.label.language"),
				model: t("common.label.model"),
				llm: t("common.label.llm"),
				tts: t("common.label.tts"),
				exception: t("common.label.exception"),
				about: t("common.label.about"),
			}
		},
	}
}
