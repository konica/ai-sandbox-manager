// Canonical service → env-var → API-domain map. Domains mirror Docker Sandboxes'
// built-in service kits (docs.docker.com/ai/sandboxes/security/credentials). For
// built-in services the base `claude` kit owns the authoritative serviceAuth; the
// app uses these domains for the network allowlist and env import only.
export interface KnownService {
  id: string
  label: string
  envVars: string[]
  domains: string[]
}

export const KNOWN_SERVICES: KnownService[] = [
  { id: 'anthropic', label: 'Anthropic', envVars: ['ANTHROPIC_API_KEY'], domains: ['api.anthropic.com', 'console.anthropic.com', 'claude.ai', 'mcp-proxy.anthropic.com'] },
  { id: 'openai', label: 'OpenAI', envVars: ['OPENAI_API_KEY'], domains: ['api.openai.com', 'openai.com', 'chatgpt.com', 'www.chatgpt.com'] },
  { id: 'github', label: 'GitHub', envVars: ['GH_TOKEN', 'GITHUB_TOKEN'], domains: ['api.github.com', 'github.com'] },
  { id: 'google', label: 'Google', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], domains: ['generativelanguage.googleapis.com'] },
  { id: 'groq', label: 'Groq', envVars: ['GROQ_API_KEY'], domains: ['api.groq.com'] },
  { id: 'mistral', label: 'Mistral', envVars: ['MISTRAL_API_KEY'], domains: ['api.mistral.ai'] },
  { id: 'nebius', label: 'Nebius', envVars: ['NEBIUS_API_KEY'], domains: ['api.studio.nebius.ai'] },
  { id: 'openrouter', label: 'OpenRouter', envVars: ['OPENROUTER_API_KEY'], domains: ['openrouter.ai'] },
  { id: 'xai', label: 'xAI', envVars: ['XAI_API_KEY'], domains: ['api.x.ai'] },
  { id: 'cursor', label: 'Cursor', envVars: ['CURSOR_API_KEY'], domains: ['api.cursor.com'] },
  { id: 'droid', label: 'Droid (Factory)', envVars: ['FACTORY_API_KEY'], domains: ['app.factory.ai'] }
]

export function serviceById(id: string): KnownService | undefined {
  return KNOWN_SERVICES.find((s) => s.id === id)
}

export function serviceForEnvVar(name: string): KnownService | undefined {
  return KNOWN_SERVICES.find((s) => s.envVars.includes(name))
}
