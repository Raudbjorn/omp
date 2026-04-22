Execute raw Python code that can call other registered tools as regular functions.

Use this tool when a task requires calling the same tool multiple times, chaining outputs between tools, or looping over a set of items — situations that would otherwise require many separate tool calls and LLM round-trips.

## Available functions

Every registered tool whose name is a valid Python identifier is available as a named function. Common ones:

```python
bash({"command": "git status", "timeout": 30})
read({"path": "src/main.ts", "offset": 1, "limit": 50})
write({"path": "out.txt", "content": "hello"})
edit({"path": "file.ts", "edits": [...]})
grep({"pattern": "TODO", "path": "src/"})
find({"pattern": "src/**/*.ts", "limit": 100})
fetch({"url": "https://example.com"})
web_search({"query": "TypeScript AST", "limit": 5})
lsp({"action": "definition", "file": "src/main.ts", "line": 10, "symbol": "foo"})
browser({"action": "visit", "url": "https://example.com"})
```

All functions return the tool's text output as a string. Errors raise Python exceptions.

## Dynamic and MCP tools

Tools loaded at runtime (MCP servers, dynamically activated servers) are accessible through the `tools` proxy. This works even for tools not present at script startup:

```python
tools.mcp_github_search({"query": "issue"})
tools.mcp_postgres_query({"sql": "SELECT 1"})
tools.any_tool_name({...})
```

To discover what tools are currently registered (including those activated mid-script):

```python
available = list_tools()
# [{"name": "bash", "description": "..."}, {"name": "mcp_postgres_query", ...}, ...]
```

## Output
- `print(...)` output is streamed and returned
- If you assign a non-`None` value to global `result`, it is appended after printed output
- Errors raised by the script or by tool calls surface as tool errors
- Default timeout is **30 seconds**. For scripts that read many files, run shell commands, or call slow tools, set `timeout` explicitly: `{ code: "...", timeout: 120 }`. Maximum useful values are task-dependent; large codebase scans may need 120–300s.

## Patterns
**Sequential pipeline:**
```python
files = find({"pattern": "src/**/*.ts"}).splitlines()
count = 0
for file_path in files:
    src = read({"path": file_path})
    if "TODO" in src:
        print(f"Found TODO in {file_path}")
        count += 1
result = f"{count} files have TODOs"
```

**Collecting results:**
```python
files = find({"pattern": "*.md"}).splitlines()
results = [read({"path": file_path}) for file_path in files]
result = f"{sum(1 for content in results if 'deprecated' in content)} files mention deprecated"
```

**Conditional logic on tool output:**
```python
status = bash({"command": "git status --porcelain"})
if not status.strip():
    result = "Working tree clean — nothing to do"
else:
    result = bash({"command": "git diff HEAD"})
```

**Using a dynamically activated MCP tool:**
```python
available = list_tools()
if any(tool["name"] == "mcp_postgres_query" for tool in available):
    result = tools.mcp_postgres_query({"sql": "SELECT count(*) FROM users"})
else:
    result = "Database tool not available"
```