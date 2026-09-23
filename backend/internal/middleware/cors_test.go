package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	called := false
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), []string{"https://app.example.com"})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if !called || res.Code != http.StatusOK {
		t.Fatalf("allowed request was not forwarded: called=%v status=%d", called, res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("unexpected allowed origin: %q", got)
	}
	if got := res.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("credentials header missing: %q", got)
	}
}

func TestCORSRejectsUnconfiguredOrigin(t *testing.T) {
	called := false
	handler := CORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}), []string{"https://app.example.com", "*"})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://evil.example")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if called {
		t.Fatal("disallowed request reached the application handler")
	}
	if res.Code != http.StatusForbidden {
		t.Fatalf("unexpected status: %d", res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("disallowed origin was reflected: %q", got)
	}
	if got := res.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("credentials were allowed for a rejected origin: %q", got)
	}
}

func TestCORSUsesSafeClientDefaults(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), nil)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://appassets.androidplatform.net")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("known Android client origin was rejected: %d", res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "https://appassets.androidplatform.net" {
		t.Fatalf("unexpected allowed origin: %q", got)
	}
}

func TestCORSLeavesNonBrowserRequestUntouched(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}), nil)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))

	if res.Code != http.StatusCreated {
		t.Fatalf("unexpected status: %d", res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected CORS header: %q", got)
	}
}

func TestCORSHandlesAllowedPreflight(t *testing.T) {
	handler := CORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("preflight reached the application handler")
	}), []string{"tauri://localhost"})
	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "tauri://localhost")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", res.Code)
	}
}
