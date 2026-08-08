// Minimal OpenAI-compatible client for the OmniRoute gateway (self-hosted,
// server 47). No SDK needed — plain fetch, Node 22 has it built in.
// `||` not `??`: GitHub Actions renders an unset `vars.X` as an empty string
// (not undefined), which `??` would happily pass through.
const BASE = process.env.OMNI_BASE_URL || 'https://omni.paibao.ai/v1'
const KEY = process.env.OMNI_API_KEY

function stripJsonFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : text.trim()
}

async function chatCompletion({ model, system, user, maxTokens, temperature = 0.3, jsonMode = false }) {
  if (!KEY) throw new Error('OMNI_API_KEY is not set')
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  }
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    let res
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
    } catch (err) {
      lastErr = err
      continue
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      lastErr = new Error(`omni_${res.status}: ${text.slice(0, 300)}`)
      if (res.status === 429 || res.status >= 500) continue
      throw lastErr
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('omni: empty response content')
    return content
  }
  throw lastErr ?? new Error('omni: exhausted retries')
}

// Research pass — plain text/markdown, no JSON parsing. Model should be a
// genuinely web-search-grounded one (e.g. tllm/sonar-pro) registered on the
// OmniRoute gateway; verify via GET /v1/models before assuming capability.
export async function research({ model, system, user, maxTokens = 8000 }) {
  return chatCompletion({ model, system, user, maxTokens, temperature: 0.2 })
}

// Structured pass — JSON mode with retry-on-parse-failure. jsonSchemaHint is
// appended to the user prompt as a description (OmniRoute's JSON mode is
// loose "valid JSON" enforcement, not Anthropic-style strict schema
// validation) — the caller must still zod-parse the result.
export async function chatJSON({ model, system, user, maxTokens = 16000 }) {
  let lastErr
  let currentUser = user
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatCompletion({ model, system, user: currentUser, maxTokens, jsonMode: true })
    try {
      return JSON.parse(stripJsonFences(raw))
    } catch (err) {
      lastErr = err
      currentUser = `${user}\n\nYour previous response failed JSON.parse with: ${err.message}\nReturn ONLY valid JSON, no markdown fences, no commentary.`
    }
  }
  throw new Error(`omni: model did not return valid JSON after retry: ${lastErr.message}`)
}
