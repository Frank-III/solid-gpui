import { extname } from "node:path";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export interface SourceToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

export interface HighlightedSource {
  language: string;
  lines: SourceToken[][];
}

const languageLoaders = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  prisma: () => import("shiki/langs/prisma.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
} as const;

type SourceLanguage = keyof typeof languageLoaders;

const LANGUAGE_BY_EXTENSION: Record<string, SourceLanguage> = {
  ".bash": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".diff": "diff",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".lua": "lua",
  ".md": "markdown",
  ".mdx": "mdx",
  ".php": "php",
  ".prisma": "prisma",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "bash",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zig": "zig",
};

const LANGUAGE_BY_FILENAME: Record<string, SourceLanguage> = {
  dockerfile: "dockerfile",
  makefile: "make",
};

const LANGUAGE_BY_HINT: Record<string, SourceLanguage> = {
  c: "c", cpp: "cpp", "c++": "cpp", cs: "csharp", csharp: "csharp",
  css: "css", diff: "diff", docker: "dockerfile", dockerfile: "dockerfile",
  go: "go", graphql: "graphql", html: "html", java: "java", js: "javascript",
  javascript: "javascript", json: "json", jsx: "jsx", kotlin: "kotlin", kt: "kotlin",
  lua: "lua", make: "make", makefile: "make", markdown: "markdown", md: "markdown",
  mdx: "mdx", php: "php", prisma: "prisma", py: "python", python: "python",
  rb: "ruby", ruby: "ruby", rs: "rust", rust: "rust", sass: "scss", scss: "scss",
  sh: "bash", shell: "bash", bash: "bash", sql: "sql", svelte: "svelte", swift: "swift",
  toml: "toml", ts: "typescript", typescript: "typescript", tsx: "tsx", vue: "vue",
  xml: "xml", yaml: "yaml", yml: "yaml", zig: "zig",
};

const cache = new Map<string, Promise<HighlightedSource>>();
const loaded = new Map<SourceLanguage, Promise<void>>();
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export function sourceLanguage(path: string): SourceLanguage | undefined {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return LANGUAGE_BY_FILENAME[name] ?? LANGUAGE_BY_EXTENSION[extname(name)];
}

function plainSource(content: string): HighlightedSource {
  return { language: "text", lines: content.split("\n").map((line) => [{ content: line }]) };
}

async function instance() {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-dark-default.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function ensureLanguage(language: SourceLanguage): Promise<void> {
  let promise = loaded.get(language);
  if (!promise) {
    promise = instance().then(async (value) => { await value.loadLanguage(languageLoaders[language]()); });
    loaded.set(language, promise);
  }
  await promise;
}

function highlight(language: SourceLanguage | undefined, content: string): Promise<HighlightedSource> {
  if (!language) return Promise.resolve(plainSource(content));
  const key = `${language}\0${content}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try {
      await ensureLanguage(language);
      const result = (await instance()).codeToTokens(content, { lang: language, theme: "github-dark-default" });
      return {
        language,
        lines: result.tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle }))),
      };
    } catch {
      return { ...plainSource(content), language };
    }
  })();
  cache.set(key, pending);
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Cached, progressively loaded Shiki tokenization. Unknown languages stay plain text. */
export function highlightSource(path: string, content: string): Promise<HighlightedSource> {
  return highlight(sourceLanguage(path), content);
}

/** Highlights a fenced Markdown block from its language hint. */
export function highlightCode(language: string, content: string): Promise<HighlightedSource> {
  return highlight(LANGUAGE_BY_HINT[language.trim().toLowerCase()], content);
}
