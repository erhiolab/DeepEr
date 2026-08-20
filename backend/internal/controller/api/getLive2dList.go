package api

import (
	"backend/internal/utils"
	"net/http"
)

// GetLive2dList 获取Live2D列表
func GetLive2dList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, map[string]any{
			"list": []any{
				map[string]any{
					"id": "ARGNori",
					"name": "ARGNori",
				},
				map[string]any{
					"id": "Nori",
					"name": "Nori",
				},
			},
		})
	}
}
