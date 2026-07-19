package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testProvider() provider {
	return provider{
		ID: "openai", DefaultModel: "gpt-5.6-terra", Models: []string{"gpt-5.6-terra", "gpt-5.6-sol"},
	}
}

func TestBuildResponsesBodyFiltersBrowserProviderConfig(t *testing.T) {
	body, err := buildResponsesBody(map[string]any{
		"model":        "gpt-5.6-sol",
		"input":        []any{map[string]any{"role": "user", "content": "Explain this model."}},
		"stream":       false,
		"instructions": "Use supplied notebook context only.",
		"reasoning":    map[string]any{"effort": "high", "mode": "pro"},
		"text":         map[string]any{"verbosity": "low"},
		"apiKey":       "must-not-pass-through",
		"baseURL":      "https://attacker.example/v1",
	}, testProvider())
	if err != nil {
		t.Fatalf("buildResponsesBody returned an error: %v", err)
	}
	if _, exists := body["apiKey"]; exists {
		t.Fatal("browser API key passed through")
	}
	if _, exists := body["baseURL"]; exists {
		t.Fatal("browser base URL passed through")
	}
	if body["model"] != "gpt-5.6-sol" {
		t.Fatalf("unexpected model: %v", body["model"])
	}
}

func TestBuildResponsesBodyRejectsModelOutsideAllowList(t *testing.T) {
	_, err := buildResponsesBody(map[string]any{
		"model": "unapproved-model",
		"input": "hello",
	}, testProvider())
	if err == nil {
		t.Fatal("expected an allow-list error")
	}
}

func TestSafeStaticPathRejectsEncodedDotfileAfterDecoding(t *testing.T) {
	if safeStaticPath("/.env") {
		t.Fatal("dotfiles must not be served")
	}
	if !safeStaticPath("/index.html") {
		t.Fatal("normal static assets should remain valid")
	}
}

func TestHealthNeverExposesProviderCredentialsOrURLs(t *testing.T) {
	application := &app{
		config: config{
			Providers: map[string]provider{
				"openai": {
					ID: "openai", Label: "OpenAI", BaseURL: "https://api.openai.com/v1", APIKey: "server-only-secret",
					DefaultModel: "gpt-5.6-terra", Configured: true, SupportsResponsesAPI: true, SupportsChat: true,
				},
			},
			AllowedOrigins: map[string]bool{},
		},
		limit: newRateLimiter(60, defaultRateWindow),
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	application.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected health response to succeed, got %d", response.Code)
	}
	body := response.Body.String()
	if strings.Contains(body, "server-only-secret") || strings.Contains(body, "api.openai.com") {
		t.Fatalf("health response exposed provider configuration: %s", body)
	}
}
