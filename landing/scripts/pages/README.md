Each `*.mjs` here builds one page: `export default async ({ outDir, here, readJson, facts, chromeCss, transform, build, common })`.
`chromeCss` is the minified plain chrome (tokens + fonts + chrome) to inline; `facts` is chain-facts.json;
`build`/`transform`/`common` are esbuild's, so a page bundles its own script the way the
network page does. Modules run in name order after the core build.
