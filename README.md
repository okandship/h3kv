# @okandship/h3kv

[![JSR](https://jsr.io/badges/@okandship/h3kv)](https://jsr.io/@okandship/h3kv)
[![ci](https://github.com/okandship/H3KV/actions/workflows/ci.yml/badge.svg)](https://github.com/okandship/H3KV/actions/workflows/ci.yml)

<img width="1774" height="887" alt="H3KV: markdown headings as keys, content as values, validated by zod" src="https://github.com/user-attachments/assets/079829e6-c165-4954-bc8b-ede018ad5532" />

**H3KV** is a tiny, type-safe library for bidirectional conversion between a simple, human-readable markdown format and javascript/typescript data objects, powered by zod and the unified/remark ecosystem

### the format (H3KV)

use headings as keys and the following paragraph(s)/list(s) as the value:

```markdown
### name
Alice Smith

### age
30

### favorite colors
- blue
- green
- red

### email
alice@example.com
```

this is valid commonmark markdown. it renders beautifully while carrying structured data

### conversion to data object (schema validated)

```ts
{
  name: "Alice Smith",
  age: 30,
  "favorite colors": [ "blue", "green", "red" ],
  email: "alice@example.com",
}
```

### features

**🛡️ markdown → typed object**

> parse markdown and get a fully validated, typed object

---

**🔄 object → markdown**

> serialize an object back to clean H3KV markdown

---

**📝 built on remark-parse and remark-stringify**

> robust, standards-compliant parsing and generation

---

**💎 zod at the core**

> single source of truth for schema, validation, and typescript types

### installation

```bash
deno add jsr:@okandship/h3kv
```

```bash
pnpm i jsr:@okandship/h3kv
# or (using pnpm 10.8 or older)
pnpm dlx jsr add @okandship/h3kv
```

```bash
yarn add jsr:@okandship/h3kv
# or (using Yarn 4.8 or older)
yarn dlx jsr add @okandship/h3kv
```

```bash
vlt install jsr:@okandship/h3kv
```

```bash
npx jsr add @okandship/h3kv
```

```bash
bunx jsr add @okandship/h3kv
```

`zod` v4 is a peer dependency

### basic usage

```ts
import { z } from "zod";
import { dataObjectToMarkdown, markdownToDataObject } from "@okandship/h3kv";

// define your schema (single source of truth)
const ProfileSchema = z.object({
  name: z.string(),
  age: z.coerce.number().int().positive(),
  "favorite colors": z.array(z.string()),
  email: z.email(),
  phone: z.string().optional(),
});

const markdown = `
### Name
Alice Smith

### Age
30

### Favorite Colors
blue
green
red

### Email
alice@example.com
`;

// markdown → validated object
const data = markdownToDataObject(markdown, ProfileSchema);
console.log(data);
/* {
  name: "Alice Smith",
  age: 30,
  "favorite colors": [ "blue", "green", "red" ],
  email: "alice@example.com",
} */

// object → markdown
const roundtripMarkdown = dataObjectToMarkdown(data, ProfileSchema);
console.log(roundtripMarkdown);
/*
### name

Alice Smith

### age

30

### favorite colors

- blue
- green
- red

### email

alice@example.com
*/
```

### writing schemas for markdown

everything in markdown is text, so every value reaches zod as a `string` (or `string[]` for array fields). use zod's coercion helpers for anything else:

| you want      | use                                     | notes                                                      |
| ------------- | --------------------------------------- | ---------------------------------------------------------- |
| `number`      | `z.coerce.number()`                     |                                                            |
| `boolean`     | `z.stringbool()`                        | accepts `yes`/`no`, `true`/`false`, `1`/`0`, `on`/`off`, … |
| `Date`        | `z.coerce.date()`                       |                                                            |
| `string[]`    | `z.array(z.string())`                   | wrappers like `.optional()`, `.default([])`, `.nullish()` are fine |
| `number[]`    | `z.array(z.coerce.number())`            |                                                            |
| enum          | `z.enum([...])` / `z.nativeEnum(...)`   |                                                            |

> [!WARNING]
> avoid `z.coerce.boolean()`: it turns the string `"no"` into `true`. use `z.stringbool()` instead

### how markdown is read

- headings of any depth (`#` … `######`) are keys. they are matched to schema keys case-insensitively and with surrounding whitespace trimmed, so `### Favorite Colors` fills `"favorite colors"`
- content under an unknown heading, or before the first known heading, is ignored
- the same heading appearing twice appends to the earlier value
- inline formatting is reduced to plain text: `**bold**` → `bold`, `[text](url)` → `text`, `` `code` `` → `code`. inline html is kept as written
- hard line breaks (two trailing spaces or `\`) become `\n`

| block under a heading | string field                         | array field            |
| --------------------- | ------------------------------------ | ---------------------- |
| paragraph             | lines joined with `\n`               | one item per line      |
| list (`-`, `*`, `1.`) | items joined with `\n`               | one item per list item |
| blockquote            | lines joined with `\n`               | one item per line      |
| fenced code block     | content verbatim (indentation kept)  | one item per line      |
| heading with nothing under it | key is absent                | `[]`                   |
| `_No response_`       | key is absent (see options)          | key is absent (see options) |
| anything else (html block, `---`, …) | ignored               | ignored                |

### how objects are written

- one heading per key, in schema order (or `outputOrder`)
- strings: one paragraph per line, or a fenced code block when the string contains indentation or blank lines (so it reads back verbatim)
- arrays: a bullet list, one item per element. blank items are dropped
- booleans: `yes` / `no`
- dates: `YYYY-MM-DD` when the time is exactly midnight UTC, otherwise the full ISO string
- keys whose value is `null`, `undefined` or a blank string are omitted; an empty array is written as a bare heading so it reads back as `[]`. a bare heading means "explicitly empty", so it takes precedence over a `.default()`
- markdown syntax inside values is escaped, so output always parses back to the same text
- only primitives, `Date` and flat arrays of those are supported. nested objects or arrays throw a `TypeError`

### api

```ts
markdownToDataObject(markdown: string, schema: ZodObject, options?): z.output<typeof schema>
```

| option                           | default | description                                                                        |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `githubIssueFormNullValueSupport` | `true`  | treat a paragraph that is exactly `_No response_` (what github issue forms emit for unfilled optional fields) as empty |

throws a `ZodError` when the collected data does not satisfy the schema. both functions throw a plain `Error` if two schema keys differ only by case or surrounding whitespace, since such a schema can't be represented unambiguously

```ts
dataObjectToMarkdown(data: z.output<typeof schema>, schema: ZodObject, options?): string
```

| option         | default          | description                              |
| -------------- | ---------------- | ---------------------------------------- |
| `outputOrder`  | schema key order | which keys to emit, and in which order   |
| `headingDepth` | `3`              | heading level used for keys (`1` … `6`)  |

### use case: github issue forms

github renders [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) exactly as H3KV: each field label becomes a `### heading` and the answer follows as paragraphs, lists or code blocks. pair a zod schema with your form and parse `issue.body` straight into a typed object

### development

```bash
npm install
npm run check   # lint + typecheck + tests
node example.ts
```

### license

MIT © okandship
