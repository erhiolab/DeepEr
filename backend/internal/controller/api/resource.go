package api

import (
	"backend/internal/logger"
	"backend/internal/service"
	"backend/internal/utils"
	"net/http"

	"go.uber.org/zap"
)

// GetResourceDownloadURL 获取资源下载链接
func GetResourceDownloadURL() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := utils.NewQueryParser(r)
		resourceType := q.String("type")
		resourceName := q.String("name")

		if resourceType == "" {
			utils.BadRequest(w, "type 不能为空")
			return
		}
		if resourceName == "" {
			utils.BadRequest(w, "name 不能为空")
			return
		}

		// 创建OSS服务
		ossService, err := service.NewOSSService()
		if err != nil {
			logger.WithRequestLogCtx(r.Context()).Error("创建OSS服务失败",
				zap.String("type", resourceType), zap.String("name", resourceName), zap.Error(err))
			utils.InternalServerError(w, "创建OSS服务失败")
			return
		}

		// 获取签名URL
		signedURL, err := ossService.GetSignedURL(resourceType, resourceName)
		if err != nil {
			logger.WithRequestLogCtx(r.Context()).Error("获取签名URL失败",
				zap.String("type", resourceType), zap.String("name", resourceName), zap.Error(err))
			utils.Error(w, http.StatusNotFound, err.Error())
			return
		}

		utils.Success(w, map[string]any{
			"url": signedURL,
		})
	}
}
