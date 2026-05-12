Fetches URL content.

<instruction>
- Use for web content retrieval when the standalone `fetch` tool is active.
- Supports transformed reading of web pages, feeds, JSON endpoints, and binary-backed document conversions.
- Use `raw: true` to inspect untouched HTML.
- Use `timeout` to bound slow network calls.
</instruction>

<critical>
- Prefer `fetch` over bash/curl/wget for URL retrieval when this tool is available.
- Returned content may be truncated; follow artifact references when present.
- Image and document responses may include transformed textual content plus metadata.
</critical>
