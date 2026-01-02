import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type DataObjectToMarkdownOptions,
  dataObjectToMarkdown,
  markdownToDataObject,
} from "./index";

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

// TODO add optional arrays
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
      expect(markdown).toContain("\nfalse\n");

      // array items include 0
      expect(markdown).toContain("### quantities");
      expect(markdown).toContain("- 0");

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
      expect(markdown).toContain("- false");
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
