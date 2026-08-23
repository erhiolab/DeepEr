package api

import (
	"backend/internal/logger"
	"backend/internal/service"
	"backend/internal/utils"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

// GetLive2dCover 获取 Live2D 模型封面图
func GetLive2dCover() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := utils.NewQueryParser(r)
		modelID := q.String("id")
		if modelID == "" {
			utils.BadRequest(w, "id 不能为空")
			return
		}

		// 创建OSS服务
		ossService, err := service.NewOSSService()
		if err != nil {
			logger.WithRequestLogCtx(r.Context()).Error("创建OSS服务失败",
				zap.String("modelID", modelID), zap.Error(err))
			utils.InternalServerError(w, "创建OSS服务失败")
			return
		}

		// 打开封面对象
		body, meta, err := ossService.OpenCover(modelID)
		if err != nil {
			logger.WithRequestLogCtx(r.Context()).Error("打开封面对象失败",
				zap.String("modelID", modelID), zap.Error(err))
			utils.Error(w, http.StatusNotFound, err.Error())
			return
		}
		defer body.Close()

		// 浏览器缓存时间
		cacheControl := fmt.Sprintf("public, max-age=%d", meta.CacheSeconds)

		// 条件请求: If-None-Match 命中 → 命中浏览器缓存, 返回 304
		if meta.ETag != "" {
			if match := r.Header.Get("If-None-Match"); match != "" && coverETagMatch(match, meta.ETag) {
				w.Header().Set("Cache-Control", cacheControl)
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}

		// 正常响应: 返回图片并携带缓存相关响应头
		contentType := meta.ContentType
		if contentType == "" {
			contentType = "image/webp"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", cacheControl)
		if meta.ETag != "" {
			w.Header().Set("ETag", meta.ETag)
		}
		if meta.LastModified != "" {
			w.Header().Set("Last-Modified", meta.LastModified)
		}
		if meta.Size > 0 {
			w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
		}
		_, _ = io.Copy(w, body)
	}
}

// coverETagMatch 判断 If-None-Match 是否命中给定 ETag
// 支持 "*"(任意) 与逗号分隔的多个 ETag("etag1", "etag2")
func coverETagMatch(ifNoneMatch string, etag string) bool {
	if strings.TrimSpace(ifNoneMatch) == "*" {
		return true
	}
	for _, part := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimSpace(part) == etag {
			return true
		}
	}
	return false
}
