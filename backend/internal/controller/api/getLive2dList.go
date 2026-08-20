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
				map[string]any{
					"id": "Haru",
					"name": "Haru",
				},
				map[string]any{
					"id": "Hiyori",
					"name": "Hiyori",
				},
				map[string]any{
					"id": "Mao",
					"name": "Mao",
				},
				map[string]any{
					"id": "Mark",
					"name": "Mark",
				},
				map[string]any{
					"id": "Natori",
					"name": "Natori",
				},
				map[string]any{
					"id": "Ren",
					"name": "Ren",
				},
				map[string]any{
					"id": "Rice",
					"name": "Rice",
				},
				map[string]any{
					"id": "Wanko",
					"name": "Wanko",
				},
			},
		})
	}
}
