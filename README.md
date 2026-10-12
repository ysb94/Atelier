# React + TypeScript + Vite

## Project architecture

Before any Supabase, PostgreSQL, Auth, Storage, RLS or database migration work,
read [`docs/architecture/SUPABASE.md`](docs/architecture/SUPABASE.md).
AI assistants must also follow [`AGENTS.md`](AGENTS.md).

## Production build

Run `npm run build` for the TypeScript check and the production Vite build.
On Windows, `scripts/vite-windows-output-cleanup.ts` uses asynchronous removal
to clear existing build output. In this Node 24 Windows environment, recursive
`fs.rmSync` terminates the process, including Vite's normal output cleanup.
The workaround applies only to build output inside the project, checks resolved
paths, and preserves `.git`. Other platforms retain Vite's normal cleanup.
Build arguments still work, for example `npm run build -- --outDir dist-preview`.
This changes only the local build process; application data, authentication,
RLS, dependencies, and production minification are unchanged.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
