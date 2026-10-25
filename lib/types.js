/**
 * Structural shapes this plugin reads, and the configuration it accepts.
 *
 * The request-extension registry lives in `@deepseek-ai/dsh-deepseek-llm-api-extensions`.
 * This plugin deliberately does **not** import it: the guard works one layer below
 * anything that package's types describe, it calls none of its methods (it wraps
 * the provider objects the registry stores), and a package named only in a type
 * position still has to be carried as a runtime peer, because the emitted `.d.ts`
 * would reference it. Reading the one field it needs structurally keeps the
 * declared dependency set equal to the import closure — `@deepseek-ai/cordis`, and
 * nothing else — and lets the guard mount in a composition that pins a different
 * build of the registry.
 *
 * @module @argszero/cordis-plugin-request-extension-guard
 */
export {};
