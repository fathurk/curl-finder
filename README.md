# ⚡ cURL Finder

> A fast, local Node.js web application to extract HTTP requests from server & application logs and generate clean, runnable `curl` commands.

![cURL Finder](https://img.shields.io/badge/Node.js-v18+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Zero External Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)

---

## ✨ Features

- **Multi-Format Log Parser**:
  - 📄 **JSON / Structured Logs**: Pino, Winston, Bunyan, CloudWatch, Docker/K8s JSON format.
  - 🌐 **Web Server & Access Logs**: Nginx Combined, Apache Common Log Format (CLF), Envoy / Kubernetes Ingress.
  - 🐞 **Debug Logs & HTTP Clients**: Axios request debug logs, Logfmt key-value logs (`method=POST path=...`).
  - 🔌 **Raw HTTP Wire Format**: Multiline RFC 7230 headers & body dumps.
  - 🔄 **Embedded cURL Extractor**: Extracts and re-formats existing cURL commands from debug traces.
- **cURL Generator Options**:
  - **Base URL Fallback**: Auto-prefixes relative paths (e.g. `/api/v1/checkout` $\rightarrow$ `https://api.example.com/api/v1/checkout`).
  - **Single-line & Multiline**: Toggle between compact 1-line or readable multi-line with backslashes (`\`).
  - **Sensitive Token Masking**: Mask `Bearer` tokens, Cookies, and API keys with a single click.
  - **Flags Support**: Toggle `--compressed`, `-k` (`--insecure`), and `-L` (`--location`).
- **Interactive UI**:
  - ⚡ **Live Auto-Parsing**: Updates in real-time as you type/paste with `Cmd/Ctrl + Enter` quick shortcut.
  - 📂 **Drag & Drop Upload**: Ingest `.log`, `.txt`, `.json`, `.har`, and `.ndjson` files up to 50MB.
  - 🔍 **Real-time Filter & Search**: Filter by HTTP Verb (`GET`, `POST`, `PUT`, `DELETE`) or search by URL, headers, and payloads.
  - 📋 **1-Click Copy**: Copy individual cURLs or click **"Copy All cURLs"**.
  - 💾 **Export Bash Script**: Download all extracted requests as an executable `.sh` script.
  - 🌙 **Dark & Light Mode**: Clean, developer-tailored theme with automatic persistence.

---

## 🚀 Getting Started

No external npm packages needed to run — uses native Node.js standard library!

```bash
# 1. Start the web application
npm start

# Or with auto-reload during development:
npm run dev
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

---

## 🧪 Running Tests

Run the native test suite (100% pass rate across parser and server integration):

```bash
npm test
```

---

## 📖 Supported Log Formats & Examples

### 1. JSON / Pino / Winston Structured Logs
```json
{"time":"2026-08-28T10:00:00Z","req":{"method":"POST","url":"/api/v1/users","headers":{"authorization":"Bearer token123","content-type":"application/json"},"body":{"name":"Alice"}}}
```
**Generated cURL:**
```bash
curl \
  -X POST \
  'http://localhost:3000/api/v1/users' \
  -H 'authorization: Bearer token123' \
  -H 'content-type: application/json' \
  -d '{"name":"Alice"}'
```

### 2. Nginx & Apache Access Logs
```text
192.168.1.100 - - [28/Aug/2026:14:00:00 +0000] "POST /api/v2/cart/items HTTP/1.1" 201 312 "https://store.example.com" "Mozilla/5.0"
```
**Generated cURL:**
```bash
curl \
  -X POST \
  'https://store.example.com/api/v2/cart/items' \
  -H 'User-Agent: Mozilla/5.0' \
  -H 'Referer: https://store.example.com'
```

### 3. Axios Debug Logs
```text
[Axios Request] POST https://api.payments.com/v1/charges Headers: {"Authorization":"Bearer sec_123"} Data: {"amount":4900,"currency":"usd"}
```
**Generated cURL:**
```bash
curl \
  -X POST \
  'https://api.payments.com/v1/charges' \
  -H 'Authorization: Bearer sec_123' \
  -H 'Content-Type: application/json' \
  -d '{"amount":4900,"currency":"usd"}'
```

### 4. Raw HTTP Wire Format (RFC 7230)
```http
POST /api/v1/checkout HTTP/1.1
Host: api.shop.com
Content-Type: application/json
Authorization: Bearer secret-tok

{"items":[{"id":1,"qty":2}]}
```

---

## 🛠️ Configuration

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the web server to listen on |

---

## 📄 License
MIT
