/**
 * live2d-easy-control 补丁脚本
 */
import {readFileSync, writeFileSync, existsSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const TARGET = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/live2d-easy-control/live2dEasyControl.js")

if (!existsSync(TARGET)) {
	console.error(`[patch-live2d] 找不到库文件: ${TARGET}`)
	process.exit(1)
}

let source = readFileSync(TARGET, "utf-8")

const CLEANUP_OLD = `    if (s.getSize() > 1 && this.getFadeWeight(
      this._fadeWeights.getSize() - 1
    ) >= 1)
      for (let o = s.getSize() - 2; o >= 0; --o) {
        const u = s.at(o);
        xt(u), s.remove(o), this._fadeWeights.remove(o);
      }`
const CLEANUP_NEW = `    // [patch] allow expression stacking`

const STOP_OLD = `  stopAllExpressions() {
    this._expressionManager != null && this._expressionManager.stopAllMotions();
  }`
const STOP_NEW = `  stopAllExpressions() {
    if (this._expressionManager == null) return;
    const values = this._expressionManager._expressionParameterValues;
    if (values) {
      for (let i = 0; i < values.getSize(); i++) {
        const p = values.at(i);
        if (p != null && p.parameterId != null) this._model.setParameterValueById(p.parameterId, p.overwriteValue, 1);
      }
    }
    this._expressionManager.stopAllMotions();
  }`

const GL_OLD = `getContext("webgl2")`
const GL_NEW = `getContext("webgl2", { preserveDrawingBuffer: true })`

const LOAD_ASSETS_OLD = `}).catch((e) => {
      F(` + "`Failed to load file ${this._modelHomeDir}.model3.json`" + `);
    });`
const LOAD_ASSETS_NEW = `}).catch((e) => {
      F(` + "`Failed to load file ${this._modelHomeDir}.model3.json`" + `);
      this._loadFailed = !0;
    });`

const WAITING_OLD = `  waiting() {
    return new Promise((t) => {
      const e = () => {
        this._model.getLoadState() ? t() : setTimeout(e, 10);
      };
      e();
    });
  }`
const WAITING_NEW = `  waiting() {
    return new Promise((t, r) => {
      let n = 0;
      const e = () => {
        if (this._model.getLoadState()) t();
        else if (this._model._loadFailed) r(new Error("模型加载失败"));
        else if (++n > 6000) r(new Error("模型加载超时"));
        else setTimeout(e, 10);
      };
      e();
    });
  }`

const TEX_IMG_OLD = `a.ptr().img = new Image(), a.ptr().img.addEventListener("load", () => i(a.ptr()), {
          passive: !0
        }), a.ptr().img.src = t;`
const TEX_IMG_NEW = `a.ptr().img = new Image(), a.ptr().img.crossOrigin = "anonymous", a.ptr().img.addEventListener("load", () => i(a.ptr()), {
          passive: !0
        }), a.ptr().img.src = t;`

const TEX_NEW_OLD = `    const s = new Image();
    s.addEventListener(`
const TEX_NEW_NEW = `    const s = new Image();
    s.crossOrigin = "anonymous";
    s.addEventListener(`

let changed = false
const apply = (n, o, n2) => {
	if (source.includes(o)) { source = source.replace(o, n2); changed = true; console.log(`[patch-live2d] ${n} ok`) }
	else console.log(`[patch-live2d] ${n} skip`)
}
const applyAll = (n, o, n2) => {
	const c = source.split(o).length - 1
	if (c > 0) { source = source.split(o).join(n2); changed = true; console.log(`[patch-live2d] ${n} ok (${c})`) }
	else console.log(`[patch-live2d] ${n} skip`)
}

apply("多表情叠加", CLEANUP_OLD, CLEANUP_NEW)
apply("表情参数还原", STOP_OLD, STOP_NEW)
applyAll("preserveDrawingBuffer", GL_OLD, GL_NEW)
apply("加载失败标记", LOAD_ASSETS_OLD, LOAD_ASSETS_NEW)
apply("加载超时reject", WAITING_OLD, WAITING_NEW)
apply("纹理CORS1", TEX_IMG_OLD, TEX_IMG_NEW)
apply("纹理CORS2", TEX_NEW_OLD, TEX_NEW_NEW)
// CubismCore 从远程 CDN 改为本地内置, 避免离线/网络受限时挂起
apply("本地CubismCore", CAMERA_CORE_OLD, CAMERA_CORE_NEW)

if (changed) writeFileSync(TARGET, source)
