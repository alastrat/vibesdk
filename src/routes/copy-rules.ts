/** Names the public pages must never contain, lowercase. */
export const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'] as const;

/** AI assistants and their makers: naming them would imply integrations that don't exist. */
/** Dropshipping suppliers: the catalog promises vetted suppliers, and naming one would imply a partnership we don't have. */
export const SUPPLIER_NAMES = ['cjdropshipping', 'cj dropshipping', 'zendrop', 'aliexpress', 'spocket', 'dsers', 'printful', 'printify'] as const;

export const AI_ASSISTANT_NAMES = ['chatgpt', 'openai', 'gemini', 'copilot', 'anthropic', 'claude', 'perplexity', 'google'] as const;
