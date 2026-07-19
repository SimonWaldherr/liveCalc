package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultTimeout     = 120 * time.Second
	defaultMaxBodySize = int64(1024 * 1024)
	defaultRateLimit   = 60
	defaultRateWindow  = time.Minute
)

var (
	modelPattern     = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	reasoningEfforts = map[string]bool{"none": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}
	textVerbosities  = map[string]bool{"low": true, "medium": true, "high": true}
	mimeTypes        = map[string]string{
		".css":  "text/css; charset=utf-8",
		".csv":  "text/csv; charset=utf-8",
		".html": "text/html; charset=utf-8",
		".ico":  "image/x-icon",
		".js":   "application/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".png":  "image/png",
		".svg":  "image/svg+xml",
		".txt":  "text/plain; charset=utf-8",
		".xml":  "application/xml; charset=utf-8",
	}
)

type provider struct {
	ID                   string   `json:"id"`
	Label                string   `json:"label"`
	BaseURL              string   `json:"-"`
	APIKey               string   `json:"-"`
	DefaultModel         string   `json:"defaultModel"`
	Models               []string `json:"configuredModels"`
	SupportsResponsesAPI bool     `json:"supportsResponsesApi"`
	SupportsChat         bool     `json:"supportsChatCompletions"`
	Configured           bool     `json:"configured"`
}

type config struct {
	Providers       map[string]provider
	Host            string
	Port            int
	Timeout         time.Duration
	MaxBodySize     int64
	RateLimit       int
	RateWindow      time.Duration
	AllowedOrigins  map[string]bool
	StaticDirectory string
}

type rateEntry struct {
	Count   int
	ResetAt time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
	limit   int
	window  time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{entries: make(map[string]rateEntry), limit: limit, window: window}
}

func (l *rateLimiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	entry, ok := l.entries[key]
	if !ok || !now.Before(entry.ResetAt) {
		l.entries[key] = rateEntry{Count: 1, ResetAt: now.Add(l.window)}
		return true, 0
	}
	if entry.Count >= l.limit {
		return false, time.Until(entry.ResetAt)
	}
	entry.Count++
	l.entries[key] = entry
	return true, 0
}

type app struct {
	config config
	client *http.Client
	limit  *rateLimiter
}

func main() {
	root := findProjectRoot()
	loadDotEnv(filepath.Join(root, ".env"))
	cfg, err := createConfig(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "LiveCalc configuration error:", err)
		os.Exit(1)
	}

	application := &app{
		config: cfg,
		client: &http.Client{Timeout: cfg.Timeout},
		limit:  newRateLimiter(cfg.RateLimit, cfg.RateWindow),
	}
	configured := make([]string, 0, len(cfg.Providers))
	for _, item := range cfg.Providers {
		if item.Configured {
			configured = append(configured, item.ID)
		}
	}
	if len(configured) == 0 {
		configured = []string{"none configured"}
	}

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler:           application,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      cfg.Timeout + 15*time.Second,
		IdleTimeout:       60 * time.Second,
	}
	fmt.Printf("LiveCalc Go backend is running at http://%s (AI providers: %s)\n", server.Addr, strings.Join(configured, ", "))
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "LiveCalc server error:", err)
		os.Exit(1)
	}
}

func findProjectRoot() string {
	if configured := strings.TrimSpace(os.Getenv("LIVECALC_STATIC_DIR")); configured != "" {
		if absolute, err := filepath.Abs(configured); err == nil {
			return absolute
		}
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "."
	}
	current := cwd
	for i := 0; i < 5; i++ {
		if stat, err := os.Stat(filepath.Join(current, "index.html")); err == nil && !stat.IsDir() {
			return current
		}
		next := filepath.Dir(current)
		if next == current {
			break
		}
		current = next
	}
	return cwd
}

func createConfig(root string) (config, error) {
	openAIBase, err := cleanBaseURL(envOr("OPENAI_BASE_URL", "https://api.openai.com/v1"))
	if err != nil {
		return config{}, err
	}
	localBase, err := optionalBaseURL(os.Getenv("LOCAL_LLM_BASE_URL"))
	if err != nil {
		return config{}, err
	}
	customBase, err := optionalBaseURL(os.Getenv("CUSTOM_LLM_BASE_URL"))
	if err != nil {
		return config{}, err
	}

	openAIKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	localKey := strings.TrimSpace(os.Getenv("LOCAL_LLM_API_KEY"))
	customKey := strings.TrimSpace(os.Getenv("CUSTOM_LLM_API_KEY"))
	providers := map[string]provider{
		"openai": {
			ID: "openai", Label: "OpenAI", BaseURL: openAIBase, APIKey: openAIKey,
			DefaultModel:         envOr("OPENAI_MODEL", "gpt-5.6-terra"),
			Models:               csv(envOr("OPENAI_MODELS", "gpt-5.6-terra,gpt-5.6,gpt-5.6-sol,gpt-5.6-luna")),
			SupportsResponsesAPI: true, SupportsChat: true, Configured: openAIKey != "",
		},
		"local": {
			ID: "local", Label: "Local OpenAI-compatible", BaseURL: localBase, APIKey: localKey,
			DefaultModel: envOr("LOCAL_LLM_MODEL", "llama3.1"), Models: csv(os.Getenv("LOCAL_LLM_MODELS")),
			SupportsResponsesAPI: envBool("LOCAL_LLM_SUPPORTS_RESPONSES"), SupportsChat: true, Configured: localBase != "",
		},
		"custom": {
			ID: "custom", Label: "Custom OpenAI-compatible", BaseURL: customBase, APIKey: customKey,
			DefaultModel: strings.TrimSpace(os.Getenv("CUSTOM_LLM_MODEL")), Models: csv(os.Getenv("CUSTOM_LLM_MODELS")),
			SupportsResponsesAPI: envBool("CUSTOM_LLM_SUPPORTS_RESPONSES"), SupportsChat: true, Configured: customBase != "",
		},
	}

	return config{
		Providers:       providers,
		Host:            envOr("HOST", "127.0.0.1"),
		Port:            envPositiveInt("PORT", 3000, 65535),
		Timeout:         time.Duration(envPositiveInt("LIVECALC_AI_TIMEOUT_MS", int(defaultTimeout/time.Millisecond), 300000)) * time.Millisecond,
		MaxBodySize:     int64(envPositiveInt("LIVECALC_MAX_REQUEST_BYTES", int(defaultMaxBodySize), 5*1024*1024)),
		RateLimit:       envPositiveInt("LIVECALC_RATE_LIMIT", defaultRateLimit, 10000),
		RateWindow:      time.Duration(envPositiveInt("LIVECALC_RATE_WINDOW_MS", int(defaultRateWindow/time.Millisecond), 3600000)) * time.Millisecond,
		AllowedOrigins:  toSet(csv(os.Getenv("LIVECALC_ALLOWED_ORIGINS"))),
		StaticDirectory: root,
	}, nil
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.applyCORS(w, r)
	if r.Method == http.MethodOptions && strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.URL.Path == "/api/health" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "providers": a.publicProviders()})
		return
	}
	if r.URL.Path == "/api/ai/providers" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"providers": a.publicProviders()})
		return
	}

	providerID, operation, isAIRoute := parseAIRoute(r.URL.Path)
	if isAIRoute {
		a.handleAI(w, r, providerID, operation)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "API route not found.", "not_found")
		return
	}
	a.serveStatic(w, r)
}

func (a *app) handleAI(w http.ResponseWriter, r *http.Request, providerID, operation string) {
	allowed, retryAfter := a.limit.allow(clientAddress(r))
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(maxInt(1, int(retryAfter.Seconds()))))
		writeError(w, http.StatusTooManyRequests, "Too many AI requests. Please try again shortly.", "rate_limit")
		return
	}

	item, exists := a.config.Providers[providerID]
	if !exists || !item.Configured {
		name := "This provider"
		if providerID == "openai" {
			name = "OpenAI"
		}
		writeError(w, http.StatusServiceUnavailable, name+" is not configured on this LiveCalc server.", "provider_not_configured")
		return
	}

	if operation == "models" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", "method_not_allowed")
			return
		}
		a.listModels(w, r, item)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", "method_not_allowed")
		return
	}
	if operation == "responses" && !item.SupportsResponsesAPI {
		writeError(w, http.StatusNotImplemented, "This provider is not configured for the Responses API.", "unsupported")
		return
	}

	body, err := decodeBody(w, r, a.config.MaxBodySize)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errBodyTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error(), "invalid_request")
		return
	}

	var upstreamBody map[string]any
	if operation == "responses" {
		upstreamBody, err = buildResponsesBody(body, item)
	} else {
		upstreamBody, err = buildChatBody(body, item)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "invalid_request")
		return
	}

	suffix := "/responses"
	if operation == "chat/completions" {
		suffix = "/chat/completions"
	}
	a.proxy(w, r, item, suffix, upstreamBody)
}

func (a *app) listModels(w http.ResponseWriter, r *http.Request, item provider) {
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstreamURL(item, "/models"), nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Could not reach the configured provider.", "provider_unavailable")
		return
	}
	addUpstreamHeaders(request, item, false)
	response, err := a.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Could not reach the configured provider.", "provider_unavailable")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeError(w, response.StatusCode, upstreamErrorMessage(response), "provider_error")
		return
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, a.config.MaxBodySize)).Decode(&result); err != nil {
		writeError(w, http.StatusBadGateway, "The provider returned an invalid model list.", "provider_error")
		return
	}
	models := make([]map[string]string, 0, len(result.Data))
	for _, model := range result.Data {
		if model.ID != "" && (len(item.Models) == 0 || contains(item.Models, model.ID)) {
			models = append(models, map[string]string{"id": model.ID, "object": "model"})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": models})
}

func (a *app) proxy(w http.ResponseWriter, r *http.Request, item provider, suffix string, body map[string]any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Request body could not be encoded.", "invalid_request")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL(item, suffix), strings.NewReader(string(encoded)))
	if err != nil {
		writeError(w, http.StatusBadGateway, "Could not reach the configured provider.", "provider_unavailable")
		return
	}
	stream, _ := body["stream"].(bool)
	addUpstreamHeaders(request, item, stream)
	response, err := a.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Could not reach the configured provider.", "provider_unavailable")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeError(w, response.StatusCode, upstreamErrorMessage(response), "provider_error")
		return
	}

	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(response.StatusCode)
	flusher, _ := w.(http.Flusher)
	buffer := make([]byte, 32*1024)
	for {
		count, readErr := response.Body.Read(buffer)
		if count > 0 {
			if _, writeErr := w.Write(buffer[:count]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr == io.EOF {
			return
		}
		if readErr != nil {
			return
		}
	}
}

func (a *app) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", "method_not_allowed")
		return
	}
	decoded, err := url.PathUnescape(r.URL.EscapedPath())
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid URL path.", "invalid_path")
		return
	}
	if decoded == "/" {
		decoded = "/index.html"
	}
	if !safeStaticPath(decoded) {
		writeError(w, http.StatusNotFound, "Not found.", "not_found")
		return
	}
	cleaned := path.Clean("/" + decoded)
	relative := strings.TrimPrefix(cleaned, "/")
	target := filepath.Join(a.config.StaticDirectory, filepath.FromSlash(relative))
	projectRelative, err := filepath.Rel(a.config.StaticDirectory, target)
	if err != nil || projectRelative == ".." || strings.HasPrefix(projectRelative, ".."+string(filepath.Separator)) {
		writeError(w, http.StatusNotFound, "Not found.", "not_found")
		return
	}
	file, err := os.Open(target)
	if err != nil {
		writeError(w, http.StatusNotFound, "Not found.", "not_found")
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.IsDir() {
		writeError(w, http.StatusNotFound, "Not found.", "not_found")
		return
	}
	if contentType := mimeTypes[strings.ToLower(filepath.Ext(target))]; contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	if filepath.Ext(target) == ".html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, stat.Name(), stat.ModTime(), file)
}

func (a *app) publicProviders() []provider {
	result := make([]provider, 0, len(a.config.Providers))
	for _, id := range []string{"openai", "local", "custom"} {
		if item, ok := a.config.Providers[id]; ok {
			item.BaseURL = ""
			item.APIKey = ""
			result = append(result, item)
		}
	}
	return result
}

func (a *app) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" || !a.config.AllowedOrigins[origin] {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

func parseAIRoute(requestPath string) (string, string, bool) {
	parts := strings.Split(strings.TrimPrefix(requestPath, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "ai" {
		return "", "", false
	}
	providerID := parts[2]
	if providerID != "openai" && providerID != "local" && providerID != "custom" {
		return "", "", false
	}
	operation := strings.Join(parts[3:], "/")
	if operation != "models" && operation != "responses" && operation != "chat/completions" {
		return "", "", false
	}
	return providerID, operation, true
}

var errBodyTooLarge = errors.New("Request body is too large.")

func decodeBody(w http.ResponseWriter, r *http.Request, maximum int64) (map[string]any, error) {
	reader := http.MaxBytesReader(w, r.Body, maximum)
	defer reader.Close()
	decoder := json.NewDecoder(reader)
	decoder.UseNumber()
	var body map[string]any
	if err := decoder.Decode(&body); err != nil {
		var maxError *http.MaxBytesError
		if errors.As(err, &maxError) {
			return nil, errBodyTooLarge
		}
		return nil, errors.New("Request body must be valid JSON.")
	}
	if body == nil {
		return nil, errors.New("Request body must be a JSON object.")
	}
	return body, nil
}

func buildResponsesBody(body map[string]any, item provider) (map[string]any, error) {
	model, err := validateModel(body["model"], item)
	if err != nil {
		return nil, err
	}
	input, ok := body["input"]
	if !ok || !nonEmptyInput(input) {
		return nil, errors.New("input must be a non-empty string or array.")
	}
	stream, err := optionalBool(body, "stream")
	if err != nil {
		return nil, err
	}
	result := map[string]any{"model": model, "input": input, "stream": stream}
	if instructions, exists := body["instructions"]; exists {
		text, ok := instructions.(string)
		if !ok || strings.TrimSpace(text) == "" || len(text) > 250000 {
			return nil, errors.New("instructions must be a non-empty string shorter than 250000 characters.")
		}
		result["instructions"] = text
	}
	if reasoning, exists := body["reasoning"]; exists {
		normalized, err := normalizeReasoning(reasoning)
		if err != nil {
			return nil, err
		}
		if len(normalized) > 0 {
			result["reasoning"] = normalized
		}
	}
	if text, exists := body["text"]; exists {
		normalized, err := normalizeText(text)
		if err != nil {
			return nil, err
		}
		if len(normalized) > 0 {
			result["text"] = normalized
		}
	}
	return result, nil
}

func buildChatBody(body map[string]any, item provider) (map[string]any, error) {
	model, err := validateModel(body["model"], item)
	if err != nil {
		return nil, err
	}
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 || len(messages) > 80 {
		return nil, errors.New("messages must be a non-empty array with at most 80 entries.")
	}
	stream, err := optionalBool(body, "stream")
	if err != nil {
		return nil, err
	}
	result := map[string]any{"model": model, "messages": messages, "stream": stream}
	if effort, exists := body["reasoning_effort"]; exists {
		value, ok := effort.(string)
		if !ok || !reasoningEfforts[value] {
			return nil, errors.New("Unsupported reasoning effort.")
		}
		result["reasoning_effort"] = value
	}
	return result, nil
}

func validateModel(value any, item provider) (string, error) {
	model := item.DefaultModel
	if input, ok := value.(string); ok && strings.TrimSpace(input) != "" {
		model = strings.TrimSpace(input)
	}
	if !modelPattern.MatchString(model) {
		return "", errors.New("A valid model name is required.")
	}
	if len(item.Models) > 0 && !contains(item.Models, model) {
		return "", fmt.Errorf("The model %q is not enabled for this provider.", model)
	}
	return model, nil
}

func optionalBool(body map[string]any, key string) (bool, error) {
	value, exists := body[key]
	if !exists {
		return false, nil
	}
	boolean, ok := value.(bool)
	if !ok {
		return false, fmt.Errorf("%s must be a boolean.", key)
	}
	return boolean, nil
}

func normalizeReasoning(value any) (map[string]string, error) {
	input, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("reasoning must be an object.")
	}
	result := map[string]string{}
	if effort, exists := input["effort"]; exists {
		value, ok := effort.(string)
		if !ok || !reasoningEfforts[value] {
			return nil, errors.New("Unsupported reasoning effort.")
		}
		result["effort"] = value
	}
	if mode, exists := input["mode"]; exists {
		value, ok := mode.(string)
		if !ok || value != "pro" {
			return nil, errors.New("Unsupported reasoning mode.")
		}
		result["mode"] = value
	}
	return result, nil
}

func normalizeText(value any) (map[string]string, error) {
	input, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("text must be an object.")
	}
	result := map[string]string{}
	if verbosity, exists := input["verbosity"]; exists {
		value, ok := verbosity.(string)
		if !ok || !textVerbosities[value] {
			return nil, errors.New("Unsupported text verbosity.")
		}
		result["verbosity"] = value
	}
	return result, nil
}

func nonEmptyInput(value any) bool {
	switch input := value.(type) {
	case string:
		return strings.TrimSpace(input) != ""
	case []any:
		return len(input) > 0
	default:
		return false
	}
}

func addUpstreamHeaders(request *http.Request, item provider, stream bool) {
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	} else {
		request.Header.Set("Accept", "application/json")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "LiveCalc-AI-Proxy/1.0")
	if item.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+item.APIKey)
	}
}

func upstreamURL(item provider, suffix string) string {
	return strings.TrimRight(item.BaseURL, "/") + suffix
}

func upstreamErrorMessage(response *http.Response) string {
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return "The selected provider rejected the server credentials."
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return "The selected provider is rate limiting requests. Please try again shortly."
	}
	data, _ := io.ReadAll(io.LimitReader(response.Body, 32*1024))
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &payload) == nil && strings.TrimSpace(payload.Error.Message) != "" {
		return payload.Error.Message[:minInt(len(payload.Error.Message), 500)]
	}
	return fmt.Sprintf("The selected provider returned HTTP %d.", response.StatusCode)
}

func safeStaticPath(requestPath string) bool {
	for _, segment := range strings.Split(requestPath, "/") {
		if len(segment) > 1 && strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return true
}

func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		encoded = []byte(`{"error":{"message":"Response serialization failed.","type":"internal_error","status":500}}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

func writeError(w http.ResponseWriter, status int, message, errorType string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"message": message, "type": errorType, "status": status}})
}

func cleanBaseURL(raw string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return "", nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("invalid provider base URL: %s", trimmed)
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func optionalBaseURL(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	return cleanBaseURL(raw)
}

func loadDotEnv(file string) {
	data, err := os.ReadFile(file)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(strings.TrimSpace(key)) {
			continue
		}
		key = strings.TrimSpace(key)
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) || (strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'"))) {
			value = value[1 : len(value)-1]
		} else if comment := strings.Index(value, " #"); comment >= 0 {
			value = strings.TrimSpace(value[:comment])
		}
		_ = os.Setenv(key, value)
	}
}

func csv(value string) []string {
	result := make([]string, 0)
	for _, part := range strings.Split(value, ",") {
		if normalized := strings.TrimSpace(part); normalized != "" {
			result = append(result, normalized)
		}
	}
	return result
}

func toSet(items []string) map[string]bool {
	result := make(map[string]bool, len(items))
	for _, item := range items {
		result[item] = true
	}
	return result
}

func contains(items []string, wanted string) bool {
	for _, item := range items {
		if item == wanted {
			return true
		}
	}
	return false
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func envPositiveInt(key string, fallback, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
