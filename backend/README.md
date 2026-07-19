# LiveCalc backends

Each implementation serves the static LiveCalc app and the same credential-safe provider gateway. The browser contract is identical across backends:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Provider configuration status without credentials |
| `GET /api/ai/:provider/models` | Models for `openai`, `local`, or `custom` |
| `POST /api/ai/:provider/responses` | Validated Responses API request with SSE relay |
| `POST /api/ai/:provider/chat/completions` | Validated Chat Completions request with SSE relay |

Provider URLs and credentials are read from the shared repository-root `.env` file or process environment. Browser requests cannot set either value.

## Node.js

```bash
npm run start:node
```

The Node implementation uses the built-in HTTP server and requires Node.js 18 or newer.

## Go

```bash
cd backend/golang
go run .
```

The Go implementation uses only the standard library and requires Go 1.22 or newer. Set `LIVECALC_STATIC_DIR` when running the compiled binary from a directory where the repository root cannot be discovered automatically.
