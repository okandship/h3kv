# @okandship/h3kv

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

### license

MIT © okandship
