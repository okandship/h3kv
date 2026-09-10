import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type DataObjectToMarkdownOptions,
  dataObjectToMarkdown,
  markdownToDataObject,
} from "./index";

const SERIALIZE_ERROR = /cannot serialize key "profile"/;
const KEY_COLLISION_ERROR = /both normalize to heading "name"/;

const MinimalSchema = z.strictObject({
  value: z.string(),
});

const ConfigSchema = z.strictObject({
  host: z.string(),
  port: z.coerce.number(),
  environment: z.string(),
});

// biome-ignore lint/style/noEnum: to test native enum support
enum KitchenStatusNative {
  Pending = "pending",
  Processing = "processing",
  Shipped = "shipped",
}

const KitchenPriorityEnum = z.enum(["low", "medium", "high", "critical"]);
const KitchenLabelEnum = z.enum(["bug", "feature", "docs", "refactor", "test"]);
const KitchenCategoryEnum = z.enum(["tech", "science", "culture", "news"]);

const KitchenSinkSchema = z.strictObject({
  // basic strings
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .transform((s) => s.trim().toLowerCase().replaceAll(/\s+/g, "-")),

  // common validation formats
  email: z.email().optional(),
  website: z.url().optional(),

  // numbers (including 0 + negatives)
  age: z.coerce.number().int().nonnegative(),
  temperature: z.coerce.number(),
  viewCount: z.coerce.number().int().default(0),
  rating: z.coerce.number().finite().min(0).max(10).catch(0),

  // booleans (extended coercion)
  isPublic: z.stringbool(),
  isAllDay: z.stringbool().default(false),

  // dates
  createdAt: z.coerce.date(),

  // enums (native + zod)
  status: z.nativeEnum(KitchenStatusNative),
  priority: KitchenPriorityEnum,

  // arrays + defaults
  tags: z.array(z.string()).default([]),
  labels: z.array(KitchenLabelEnum).default([]),
  categories: z.array(KitchenCategoryEnum).default([]),
  quantities: z.array(z.coerce.number()).default([]),

  // optional / nullish arrays (wrapped more than once)
  aliases: z.array(z.string()).optional(),
  mentions: z.array(z.string()).nullish(),

  // optional + transform
  notes: z
    .string()
    .transform((s) => s.trim())
    .optional(),
});
type KitchenSink = z.infer<typeof KitchenSinkSchema>;

const kitchenOptions: DataObjectToMarkdownOptions<typeof KitchenSinkSchema> = {
  outputOrder: [
    "title",
    "slug",
    "email",
    "website",
    "age",
    "temperature",
    "viewCount",
    "rating",
    "isPublic",
    "isAllDay",
    "createdAt",
    "status",
    "priority",
    "tags",
    "labels",
    "categories",
    "quantities",
    "aliases",
    "mentions",
    "notes",
  ] as const,
};

describe("KitchenSinkSchema", () => {
  describe("markdownToDataObject", () => {
    test("parses a full document with many Zod features", () => {
      const markdown = `
### title
Hello

### slug
  Hello World  

### email
test@example.com

### website
https://example.com

### age
0

### temperature
-15.5

### viewCount
0

### rating
not-a-number

### isPublic
yes

### isAllDay
false

### createdAt
2024-01-15T10:30:00.000Z

### status
shipped

### priority
critical

### tags
- one
- two

### labels
- bug
- docs

### categories
- tech
- news

### quantities
- 0
- 2

### aliases
- ally
- al

### mentions
- @bob

### notes
  some note  
`;

      const result = markdownToDataObject(markdown, KitchenSinkSchema);
      expect(result).toEqual<KitchenSink>({
        title: "Hello",
        slug: "hello-world",
        email: "test@example.com",
        website: "https://example.com",
        age: 0,
        temperature: -15.5,
        viewCount: 0,
        rating: 0, // .catch(0)
        isPublic: true, // yes -> true
        isAllDay: false, // false -> false
        createdAt: new Date("2024-01-15T10:30:00.000Z"),
        status: KitchenStatusNative.Shipped,
        priority: "critical",
        tags: ["one", "two"],
        labels: ["bug", "docs"],
        categories: ["tech", "news"],
        quantities: [0, 2],
        aliases: ["ally", "al"],
        mentions: ["@bob"],
        notes: "some note",
      });
    });

    test("applies defaults when fields are missing/empty", () => {
      const markdown = `
### title
Defaulted

### slug
Defaulted

### age
1

### temperature
0

### isPublic
true

### createdAt
2024-01-01

### status
pending

### priority
low

### tags

### labels

### categories

### quantities

### notes
`;

      const result = markdownToDataObject(markdown, KitchenSinkSchema);

      expect(result.tags).toEqual([]);
      expect(result.labels).toEqual([]);
      expect(result.categories).toEqual([]);
      expect(result.quantities).toEqual([]);
      expect(result.viewCount).toBe(0);
      expect(result.isAllDay).toBe(false);
    });

    test("extended boolean coercion: true/yes/1, false/no/0, unknown -> throw", () => {
      const schema = z.object({ enabled: z.stringbool() });

      expect(markdownToDataObject("### enabled\nyes", schema).enabled).toBe(
        true
      );
      expect(markdownToDataObject("### enabled\n1", schema).enabled).toBe(true);
      expect(markdownToDataObject("### enabled\nfalse", schema).enabled).toBe(
        false
      );
      expect(markdownToDataObject("### enabled\nno", schema).enabled).toBe(
        false
      );

      expect(() =>
        markdownToDataObject("### enabled\nmaybe", schema)
      ).toThrow();
    });

    test("throws on invalid enum values", () => {
      const markdown = `
### title
Bad enum

### slug
Bad enum

### age
1

### temperature
0

### isPublic
true

### createdAt
2024-01-01

### status
returned

### priority
low
`;

      expect(() => markdownToDataObject(markdown, KitchenSinkSchema)).toThrow();
    });
  });

  describe("dataObjectToMarkdown", () => {
    test("preserves 0 and false; only omits null/undefined/empty string", () => {
      const data: KitchenSink = {
        title: "T",
        slug: "t",
        email: undefined,
        website: undefined,
        age: 0,
        temperature: 0,
        viewCount: 0,
        rating: 0,
        isPublic: false,
        isAllDay: false,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        status: KitchenStatusNative.Pending,
        priority: "low",
        tags: [],
        labels: [],
        categories: [],
        quantities: [0],
        notes: "",
      };

      const markdown = dataObjectToMarkdown(
        data,
        KitchenSinkSchema,
        kitchenOptions
      );

      // scalar 0 and false must be rendered
      expect(markdown).toContain("### age");
      expect(markdown).toContain("\n0\n");
      expect(markdown).toContain("### isPublic");
      expect(markdown).toContain("\nno\n");

      // array items include 0
      expect(markdown).toContain("### quantities");
      expect(markdown).toContain("- 0");

      // empty arrays keep a bare heading (parses back to []), undefined arrays are omitted
      expect(markdown).toContain(
        "### tags\n\n### labels\n\n### categories\n\n### quantities"
      );
      expect(markdown).not.toContain("### aliases");
      expect(markdown).not.toContain("### mentions");

      // heading does not exist and empty string is not rendered as a paragraph
      expect(markdown).not.toContain("### notes");
      expect(markdown).not.toContain("\n\n\n");
    });
  });

  describe("round-trip", () => {
    test("preserves data (including 0/false) through conversion cycle", () => {
      const original: KitchenSink = {
        title: "Round Trip",
        slug: "round trip",
        email: "rt@example.com",
        website: "https://example.com",
        age: 0,
        temperature: -40,
        viewCount: 0,
        rating: 10,
        isPublic: false,
        isAllDay: true,
        createdAt: new Date("2024-06-15T12:00:00.000Z"),
        status: KitchenStatusNative.Processing,
        priority: "high",
        tags: ["a", "b"],
        labels: ["feature"],
        categories: ["science"],
        quantities: [1, 0, 2],
        notes: " ok ",
      };

      const markdown = dataObjectToMarkdown(
        original,
        KitchenSinkSchema,
        kitchenOptions
      );
      const parsed = markdownToDataObject(markdown, KitchenSinkSchema);

      expect(parsed).toEqual({
        ...original,
        slug: "round-trip",
        notes: "ok",
      });
    });
  });
});

describe("generic behavior", () => {
  describe("heading handling", () => {
    test("handles any heading depth", () => {
      const markdown = `
# value
H1 content
`;
      const result = markdownToDataObject(markdown, MinimalSchema);
      expect(result.value).toBe("H1 content");
    });

    test("handles mixed heading depths", () => {
      const markdown = `
## host
myhost

#### port
8080

# environment
dev
`;
      const result = markdownToDataObject(markdown, ConfigSchema);
      expect(result).toEqual({
        host: "myhost",
        port: 8080,
        environment: "dev",
      });
    });

    test("ignores unknown headings", () => {
      const markdown = `
### unknown
Ignored content

### value
Kept content

### also-unknown
More ignored
`;
      const result = markdownToDataObject(markdown, MinimalSchema);
      expect(result.value).toBe("Kept content");
    });

    test("ignores content before first valid heading", () => {
      const markdown = `
Some preamble text

More preamble

### value
Actual value
`;
      const result = markdownToDataObject(markdown, MinimalSchema);
      expect(result.value).toBe("Actual value");
    });
  });

  describe("list handling", () => {
    test("parses unordered lists into arrays", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const markdown = `
### items
- one
- two
- three
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.items).toEqual(["one", "two", "three"]);
    });

    test("parses ordered lists into arrays", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const markdown = `
### items
1. first
2. second
3. third
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.items).toEqual(["first", "second", "third"]);
    });

    test("concatenates list items as newlines for non-array fields", () => {
      const schema = z.object({ notes: z.string() });
      const markdown = `
### notes
- line one
- line two
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.notes).toBe("line one\nline two");
    });

    test("accumulates multiple lists for array fields", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const markdown = `
### items
- batch1

extra paragraph

- batch2
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.items).toEqual(["batch1", "extra paragraph", "batch2"]);
    });
  });

  describe("paragraph handling", () => {
    test("concatenates multiple paragraphs for non-array fields", () => {
      const schema = z.object({ content: z.string() });
      const markdown = `
### content
First paragraph.

Second paragraph.

Third paragraph.
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.content).toBe(
        "First paragraph.\nSecond paragraph.\nThird paragraph."
      );
    });

    test("splits paragraph lines for array fields", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const markdown = `
### items
line1
line2
line3
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.items).toEqual(["line1", "line2", "line3"]);
    });
  });

  describe("whitespace handling", () => {
    test("trims values", () => {
      const markdown = `
### value
   trimmed content   
`;
      const result = markdownToDataObject(markdown, MinimalSchema);
      expect(result.value).toBe("trimmed content");
    });

    test("filters empty list items", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const markdown = `
### items
- valid
-   
- another
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.items).toEqual(["valid", "another"]);
    });
  });

  describe("special characters", () => {
    test("escapes markdown characters in output", () => {
      const data = { value: "**bold** and _italic_" };
      const markdown = dataObjectToMarkdown(data, MinimalSchema);

      expect(markdown).toContain("\\*\\*bold\\*\\*");
      expect(markdown).toContain("\\_italic\\_");
    });

    test("round-trip preserves special characters", () => {
      const schema = z.object({ text: z.string() });
      const original = { text: "special_underscore" };

      const markdown = dataObjectToMarkdown(original, schema);
      const parsed = markdownToDataObject(markdown, schema);

      expect(parsed.text).toBe("special_underscore");
    });

    test("handles unicode", () => {
      const original = { value: "日本語 中文 한국어" };

      const markdown = dataObjectToMarkdown(original, MinimalSchema);
      const parsed = markdownToDataObject(markdown, MinimalSchema);

      expect(parsed.value).toBe("日本語 中文 한국어");
    });
  });

  describe("output order", () => {
    test("respects custom outputOrder", () => {
      const schema = z.object({
        a: z.string(),
        b: z.string(),
        c: z.string(),
      });
      const data = { a: "A", b: "B", c: "C" };

      const markdown = dataObjectToMarkdown(data, schema, {
        outputOrder: ["c", "a", "b"],
      });

      const cPos = markdown.indexOf("### c");
      const aPos = markdown.indexOf("### a");
      const bPos = markdown.indexOf("### b");

      expect(cPos).toBeLessThan(aPos);
      expect(aPos).toBeLessThan(bPos);
    });

    test("uses schema key order when outputOrder not specified", () => {
      const schema = z.object({
        first: z.string(),
        second: z.string(),
        third: z.string(),
      });
      const data = { first: "1", second: "2", third: "3" };

      const markdown = dataObjectToMarkdown(data, schema);

      expect(markdown).toContain("### first");
      expect(markdown).toContain("### second");
      expect(markdown).toContain("### third");
    });
  });

  describe("type coercion", () => {
    test("coerces string to number", () => {
      const schema = z.object({ count: z.coerce.number() });
      const markdown = `
### count
42
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.count).toBe(42);
      expect(typeof result.count).toBe("number");
    });

    test("coerces string to float", () => {
      const schema = z.object({ amount: z.coerce.number() });
      const markdown = `
### amount
123.456
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.amount).toBe(123.456);
    });

    test("coerces string to boolean true via extended coercion", () => {
      const schema = z.object({ enabled: z.stringbool() });
      const markdown = `
### enabled
yes
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.enabled).toBe(true);
      expect(typeof result.enabled).toBe("boolean");
    });

    test("coerces string to boolean false via extended coercion", () => {
      const schema = z.object({ enabled: z.stringbool() });
      const markdown = `
### enabled
false
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.enabled).toBe(false);
    });

    test("unknown boolean strings throw", () => {
      const schema = z.object({ enabled: z.stringbool() });
      expect(() =>
        markdownToDataObject("### enabled\nmaybe", schema)
      ).toThrow();
    });

    test("coerces string to date", () => {
      const schema = z.object({ createdAt: z.coerce.date() });
      const markdown = `
### createdAt
2024-06-15T12:00:00.000Z
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.createdAt).toEqual(new Date("2024-06-15T12:00:00.000Z"));
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test("coerces array of strings to numbers", () => {
      const schema = z.object({ values: z.array(z.coerce.number()) });
      const markdown = `
### values
- 1
- 2.5
- -3
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.values).toEqual([1, 2.5, -3]);
      expect(result.values.every((v) => typeof v === "number")).toBe(true);
    });

    test("coerces array of strings to dates", () => {
      const schema = z.object({ dates: z.array(z.coerce.date()) });
      const markdown = `
### dates
- 2024-01-01T00:00:00.000Z
- 2024-06-15T12:00:00.000Z
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.dates).toEqual([
        new Date("2024-01-01T00:00:00.000Z"),
        new Date("2024-06-15T12:00:00.000Z"),
      ]);
    });

    test("coerces negative numbers", () => {
      const schema = z.object({ value: z.coerce.number() });
      const markdown = `
### value
-42.5
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.value).toBe(-42.5);
    });

    test("coerces zero", () => {
      const schema = z.object({ value: z.coerce.number() });
      const markdown = `
### value
0
`;
      const result = markdownToDataObject(markdown, schema);
      expect(result.value).toBe(0);
    });
  });

  describe("array field formatting in output", () => {
    test("renders arrays as bullet lists", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const data = { items: ["a", "b", "c"] };

      const markdown = dataObjectToMarkdown(data, schema);

      expect(markdown).toContain("- a");
      expect(markdown).toContain("- b");
      expect(markdown).toContain("- c");
    });

    test("filters empty array items in output (but keeps 0/false)", () => {
      const schema = z.object({
        items: z.array(z.union([z.string(), z.number(), z.boolean()])),
      });
      const data = { items: ["valid", "", "  ", 0, false, "another"] };

      const markdown = dataObjectToMarkdown(data, schema);

      expect(markdown).toContain("- valid");
      expect(markdown).toContain("- 0");
      expect(markdown).toContain("- no");
      expect(markdown).toContain("- another");
    });
  });

  describe("edge cases", () => {
    test("handles large numbers", () => {
      const schema = z.object({ big: z.coerce.number() });
      const original = { big: 999_999_999 };

      const markdown = dataObjectToMarkdown(original, schema);
      const parsed = markdownToDataObject(markdown, schema);

      expect(parsed.big).toBe(999_999_999);
    });

    test("handles many array items", () => {
      const schema = z.object({ items: z.array(z.string()) });
      const items = Array.from({ length: 50 }, (_, i) => `item${i + 1}`);
      const original = { items };

      const markdown = dataObjectToMarkdown(original, schema);
      const parsed = markdownToDataObject(markdown, schema);

      expect(parsed.items).toEqual(items);
    });

    test("handles long string values", () => {
      const longValue = "A".repeat(1000);
      const original = { value: longValue };

      const markdown = dataObjectToMarkdown(original, MinimalSchema);
      const parsed = markdownToDataObject(markdown, MinimalSchema);

      expect(parsed.value).toBe(longValue);
    });

    test("multiple round-trips are stable", () => {
      const schema = z.object({
        text: z.string(),
        number: z.coerce.number(),
        list: z.array(z.string()),
      });
      const original = {
        text: "stable",
        number: 123,
        list: ["a", "b", "c"],
      };

      let data = original;
      for (let i = 0; i < 5; i++) {
        const markdown = dataObjectToMarkdown(data, schema);
        data = markdownToDataObject(markdown, schema);
      }

      expect(data).toEqual(original);
    });
  });
});

describe("wrapped array schemas", () => {
  const cases = {
    "optional()": z.array(z.string()).optional(),
    "nullable()": z.array(z.string()).nullable(),
    "nullish()": z.array(z.string()).nullish(),
    "optional().default([])": z.array(z.string()).optional().default([]),
    "default([]).optional()": z.array(z.string()).default([]).optional(),
    "catch([])": z.array(z.string()).catch([]),
    "readonly()": z.array(z.string()).readonly(),
    "nonoptional()": z.array(z.string()).optional().nonoptional(),
  };

  for (const [name, field] of Object.entries(cases)) {
    test(`detects z.array().${name} as an array field`, () => {
      const schema = z.object({ items: field });
      const result = markdownToDataObject("### items\n- a\n- b", schema);
      expect(result.items).toEqual(["a", "b"]);
    });
  }

  test("detects arrays behind a transform", () => {
    const schema = z.object({
      count: z.array(z.string()).transform((items) => items.length),
    });
    expect(markdownToDataObject("### count\n- a\n- b", schema).count).toBe(2);
  });

  test("a pipe whose input is a string is not treated as an array", () => {
    const schema = z.object({
      words: z.string().pipe(z.string().transform((s) => s.split(" "))),
    });
    expect(markdownToDataObject("### words\nfoo bar", schema).words).toEqual([
      "foo",
      "bar",
    ]);
  });
});

describe("empty arrays", () => {
  const schema = z.object({ title: z.string(), items: z.array(z.string()) });

  test("serialize as a bare heading instead of being dropped", () => {
    const markdown = dataObjectToMarkdown({ title: "x", items: [] }, schema);
    expect(markdown).toBe("### title\n\nx\n\n### items");
  });

  test("a bare heading parses to [] for an array field", () => {
    expect(markdownToDataObject("### title\nx\n\n### items", schema)).toEqual({
      title: "x",
      items: [],
    });
  });

  test("round-trip a required array field with no items", () => {
    const original = { title: "x", items: [] };
    const markdown = dataObjectToMarkdown(original, schema);
    expect(markdownToDataObject(markdown, schema)).toEqual(original);
  });

  test("a bare heading for a scalar field leaves the key undefined", () => {
    const optional = z.object({ note: z.string().optional() });
    expect(markdownToDataObject("### note", optional)).toEqual({});
  });
});

describe("line breaks and nesting", () => {
  test("hard line breaks (trailing spaces) become newlines, not glued words", () => {
    const schema = z.object({ text: z.string() });
    const result = markdownToDataObject("### text\nline a  \nline b", schema);
    expect(result.text).toBe("line a\nline b");
  });

  test("hard line breaks (backslash) become newlines", () => {
    const schema = z.object({ text: z.string() });
    const result = markdownToDataObject("### text\nline a\\\nline b", schema);
    expect(result.text).toBe("line a\nline b");
  });

  test("hard line breaks split array values", () => {
    const schema = z.object({ items: z.array(z.string()) });
    const result = markdownToDataObject("### items\na  \nb", schema);
    expect(result.items).toEqual(["a", "b"]);
  });

  test("nested list items are separated by newlines inside their parent item", () => {
    const schema = z.object({ items: z.array(z.string()) });
    const markdown = `
### items
- outer
  - nested
- second
`;
    const result = markdownToDataObject(markdown, schema);
    expect(result.items).toEqual(["outer\nnested", "second"]);
  });

  test("inline formatting and links are reduced to their text", () => {
    const schema = z.object({ text: z.string() });
    const markdown =
      "### text\n**bold** _em_ `code` [link](https://x.y) ![alt](i.png)";
    expect(markdownToDataObject(markdown, schema).text).toBe(
      "bold em code link alt"
    );
  });
});

describe("block types", () => {
  test("fenced code blocks are read verbatim for string fields", () => {
    const schema = z.object({ logs: z.string() });
    const markdown = "### logs\n```sh\n  indented\n\nafter blank\n```";
    expect(markdownToDataObject(markdown, schema).logs).toBe(
      "  indented\n\nafter blank"
    );
  });

  test("fenced code blocks are split into lines for array fields", () => {
    const schema = z.object({ lines: z.array(z.string()) });
    const markdown = "### lines\n```\na\n  b\n\nc\n```";
    expect(markdownToDataObject(markdown, schema).lines).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("blockquotes contribute their text", () => {
    const schema = z.object({ quote: z.string() });
    const markdown = "### quote\n> first\n>\n> second";
    expect(markdownToDataObject(markdown, schema).quote).toBe("first\nsecond");
  });

  test("inline html is kept as written", () => {
    const schema = z.object({ text: z.string() });
    const markdown = "### text\nContact <b>me</b> now<br>bye";
    expect(markdownToDataObject(markdown, schema).text).toBe(
      "Contact <b>me</b> now<br>bye"
    );
  });

  test("top-level html blocks and thematic breaks are ignored", () => {
    const schema = z.object({ value: z.string() });
    const markdown = "### value\n---\n\n<div>html</div>\n\nkept";
    expect(markdownToDataObject(markdown, schema).value).toBe("kept");
  });

  test("code blocks under an unknown heading are ignored", () => {
    const markdown = "### other\n```\nignored\n```\n\n### value\nkept";
    expect(markdownToDataObject(markdown, MinimalSchema).value).toBe("kept");
  });
});

describe("github issue form null values", () => {
  const schema = z.object({ note: z.string().optional() });

  test("_No response_ is treated as empty by default", () => {
    expect(markdownToDataObject("### note\n_No response_", schema)).toEqual({});
  });

  test("_No response_ followed by real content keeps the content", () => {
    expect(
      markdownToDataObject("### note\n_No response_\n\nreal", schema).note
    ).toBe("real");
  });

  test("plain 'No response' without emphasis is kept", () => {
    expect(markdownToDataObject("### note\nNo response", schema).note).toBe(
      "No response"
    );
  });

  test("can be disabled", () => {
    expect(
      markdownToDataObject("### note\n_No response_", schema, {
        githubIssueFormNullValueSupport: false,
      }).note
    ).toBe("No response");
  });

  test("leaves an optional array field absent instead of []", () => {
    const arrays = z.object({
      labels: z.array(z.string()).min(1).optional(),
    });
    expect(markdownToDataObject("### labels\n_No response_", arrays)).toEqual(
      {}
    );
  });

  test("does not erase array items collected before it", () => {
    const arrays = z.object({ labels: z.array(z.string()) });
    expect(
      markdownToDataObject("### labels\n- a\n\n_No response_", arrays).labels
    ).toEqual(["a"]);
  });
});

describe("empty array semantics", () => {
  test("a bare heading means explicitly empty, so it wins over .default()", () => {
    const schema = z.object({ tags: z.array(z.string()).default(["none"]) });
    expect(markdownToDataObject("### tags", schema).tags).toEqual([]);
    expect(markdownToDataObject("", schema).tags).toEqual(["none"]);
  });

  test("an array of only blank strings is written as a bare heading", () => {
    const schema = z.object({ items: z.array(z.string()) });
    const markdown = dataObjectToMarkdown({ items: ["  ", ""] }, schema);
    expect(markdown).toBe("### items");
    expect(markdownToDataObject(markdown, schema).items).toEqual([]);
  });
});

describe("array detection through non-wrapper schemas", () => {
  test("z.lazy", () => {
    const schema = z.object({ items: z.lazy(() => z.array(z.string())) });
    expect(markdownToDataObject("### items\n- a\n- b", schema).items).toEqual([
      "a",
      "b",
    ]);
  });

  test("z.preprocess", () => {
    const schema = z.object({
      items: z.preprocess((v) => v, z.array(z.string())),
    });
    expect(markdownToDataObject("### items\n- a\n- b", schema).items).toEqual([
      "a",
      "b",
    ]);
  });

  test("a union whose branches are all arrays", () => {
    const schema = z.object({
      items: z.union([z.array(z.string()), z.array(z.coerce.number())]),
    });
    expect(markdownToDataObject("### items\n- a\n- b", schema).items).toEqual([
      "a",
      "b",
    ]);
  });

  test("a union mixing arrays and scalars is read as a scalar", () => {
    const schema = z.object({
      value: z.union([z.array(z.string()), z.string()]),
    });
    expect(markdownToDataObject("### value\ntext", schema).value).toBe("text");
  });
});

describe("Object.prototype names", () => {
  test("a schema key named constructor works", () => {
    const schema = z.strictObject({ constructor: z.string() });
    expect(markdownToDataObject("### constructor\nx", schema).constructor).toBe(
      "x"
    );
  });

  test("a heading named constructor with no matching key is ignored", () => {
    const markdown = "### constructor\njunk\n\n### value\nkept";
    expect(markdownToDataObject(markdown, MinimalSchema)).toEqual({
      value: "kept",
    });
  });

  test("an array key named toString with a bare heading yields []", () => {
    const schema = z.strictObject({ toString: z.array(z.string()) });
    expect(markdownToDataObject("### toString", schema).toString).toEqual([]);
  });
});

describe("whitespace-significant strings", () => {
  const schema = z.object({ logs: z.string() });

  test("strings with indentation or blank lines are written as code blocks", () => {
    const markdown = dataObjectToMarkdown({ logs: "a\n  b\n\nc" }, schema);
    expect(markdown).toBe("### logs\n\n```\na\n  b\n\nc\n```");
  });

  test("a parsed code block round-trips byte for byte", () => {
    const original = "### logs\n\n```\n  indented\n\nafter blank\n```";
    const parsed = markdownToDataObject(original, schema);
    expect(parsed.logs).toBe("  indented\n\nafter blank");
    const rewritten = dataObjectToMarkdown(parsed, schema);
    expect(rewritten).toBe(original);
    expect(markdownToDataObject(rewritten, schema)).toEqual(parsed);
  });

  test("a value containing a fence still round-trips", () => {
    const value = "```\n  x\n```";
    const markdown = dataObjectToMarkdown({ logs: value }, schema);
    expect(markdownToDataObject(markdown, schema).logs).toBe(value);
  });
});

describe("errors", () => {
  test("validation failures throw a ZodError", () => {
    const schema = z.object({ n: z.coerce.number() });
    let caught: unknown;
    try {
      markdownToDataObject("### n\nnot a number", schema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });

  test("missing required fields throw a ZodError", () => {
    expect(() =>
      markdownToDataObject("no headings here", MinimalSchema)
    ).toThrow(z.ZodError);
  });

  test("serializing nested objects throws a descriptive TypeError", () => {
    const schema = z.object({ profile: z.object({ name: z.string() }) });
    expect(() =>
      dataObjectToMarkdown({ profile: { name: "x" } }, schema)
    ).toThrow(SERIALIZE_ERROR);
  });

  test("serializing nested arrays throws a descriptive TypeError", () => {
    const schema = z.object({ matrix: z.array(z.array(z.number())) });
    expect(() => dataObjectToMarkdown({ matrix: [[1]] }, schema)).toThrow(
      TypeError
    );
  });

  test("schema keys that collide after normalization throw on parse", () => {
    const schema = z.object({
      Name: z.string().optional(),
      name: z.string().optional(),
    });
    expect(() => markdownToDataObject("### name\nx", schema)).toThrow(
      KEY_COLLISION_ERROR
    );
  });

  test("schema keys that collide after normalization throw on serialize", () => {
    const schema = z.object({ Name: z.string(), name: z.string() });
    expect(() =>
      dataObjectToMarkdown({ Name: "a", name: "b" }, schema)
    ).toThrow(KEY_COLLISION_ERROR);
  });

  test("an invalid Date throws a descriptive TypeError", () => {
    const schema = z.object({ when: z.date() });
    expect(() =>
      dataObjectToMarkdown({ when: new Date(Number.NaN) }, schema)
    ).toThrow(TypeError);
  });
});

describe("dataObjectToMarkdown options", () => {
  test("headingDepth controls the heading level", () => {
    const markdown = dataObjectToMarkdown({ value: "x" }, MinimalSchema, {
      headingDepth: 2,
    });
    expect(markdown).toBe("## value\n\nx");
  });

  test("dates at midnight UTC are written as YYYY-MM-DD, others as full ISO", () => {
    const schema = z.object({
      day: z.coerce.date(),
      moment: z.coerce.date(),
    });
    const data = {
      day: new Date("2024-03-05T00:00:00.000Z"),
      moment: new Date("2024-03-05T13:45:00.000Z"),
    };
    const markdown = dataObjectToMarkdown(data, schema);
    expect(markdown).toContain("### day\n\n2024-03-05\n");
    expect(markdown).toContain("### moment\n\n2024-03-05T13:45:00.000Z");
    expect(markdownToDataObject(markdown, schema)).toEqual(data);
  });

  test("dates outside years 0000-9999 keep their expanded ISO year", () => {
    const schema = z.object({ when: z.coerce.date() });
    const data = { when: new Date("+010000-03-15T00:00:00.000Z") };
    const markdown = dataObjectToMarkdown(data, schema);
    expect(markdown).toBe("### when\n\n+010000-03-15");
    expect(markdownToDataObject(markdown, schema)).toEqual(data);
  });

  test("multi-line strings become one paragraph per line", () => {
    const markdown = dataObjectToMarkdown({ value: "a\nb" }, MinimalSchema);
    expect(markdown).toBe("### value\n\na\n\nb");
  });
});
