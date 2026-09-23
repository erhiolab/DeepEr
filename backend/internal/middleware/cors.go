package middleware

import (
	"net/http"
	"strings"
)

var defaultAllowedOrigins = []string{
	"http://tauri.localhost",
	"https://tauri.localhost",
	"tauri://localhost",
	"http://localhost:1420",
	"https://appassets.androidplatform.net",
}

// CORS 跨域中间件.仅允许配置中精确列出的来源携带凭证访问
func CORS(next http.Handler, allowedOrigins []string) http.Handler {
	// 旧配置没有 allowed-origins 时仅放行已知客户端来源，避免升级后回退到开放 CORS。
	if len(allowedOrigins) == 0 {
		allowedOrigins = defaultAllowedOrigins
	}
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin != "" && origin != "*" {
			allowed[origin] = struct{}{}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Add("Vary", "Origin")
		if _, ok := allowed[origin]; !ok {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Timestamp, X-Nonce, X-Signature")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
