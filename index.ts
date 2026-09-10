import type { Heading, Nodes, Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { parse } from "zod";
import type { $ZodObject, $ZodType, output } from "zod/v4/core";

type SchemaObject = $ZodObject;

type SchemaOutput<T extends SchemaObject> = output<T>;

type SchemaOutputKey<T extends SchemaObject> = Extract<
  keyof SchemaOutput<T>,
  string
>;

/** Raw values collected from markdown before schema validation. */
type RawData = Record<string, string | string[]>;

/* -------------------------------------------------------------------------- */
/*                                   schema                                   */
/* -------------------------------------------------------------------------- */

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * The def shapes we need to look through. Wrappers (optional, nullable,
 * default, catch, readonly, ...) expose the wrapped schema as `innerType`;
 * pipes (transform, preprocess, codec) expose `in` / `out`; unions expose
 * `options`; lazy schemas expose the resolved schema on `_zod.innerType`.
 */
interface WrapperDef {
  type: string;
  innerType?: $ZodType;
  in?: $ZodType;
  out?: $ZodType;
  options?: readonly $ZodType[];
}

/**
 * Peel every wrapper off a field schema and return the schema that will
 * actually receive the raw markdown input.
 */
function getInputSchema(schema: $ZodType): $ZodType {
  const def = schema._zod.def as WrapperDef;

  if (def.type === "lazy") {
    const inner = (schema._zod as { innerType?: $ZodType }).innerType;
    return inner ? getInputSchema(inner) : schema;
  }

  if (def.type === "pipe" && def.in && def.out) {
    const input = getInputSchema(def.in);
    // z.preprocess(fn, target): the pipe's input is a bare transform, so the
    // schema that describes the expected shape is the output side
    return input._zod.def.type === "transform"
      ? getInputSchema(def.out)
      : input;
  }

  return def.innerType ? getInputSchema(def.innerType) : schema;
}

function isArraySchema(schema: $ZodType): boolean {
  const def = getInputSchema(schema)._zod.def as WrapperDef;

  if (def.type === "array") {
    return true;
  }

  // a union is treated as an array only when every branch is one
  return def.type === "union" && def.options !== undefined
    ? def.options.every(isArraySchema)
    : false;
}

/**
 * Maps normalized heading text (`"favorite colors"`) to the schema key and
 * remembers which keys take arrays.
 *
 * @throws {Error} when two schema keys normalize to the same heading, since
 * such a schema could neither be written nor read unambiguously.
 */
function inspectSchema(schema: SchemaObject): {
  keyByHeading: Map<string, string>;
  arrayKeys: Set<string>;
} {
  const keyByHeading = new Map<string, string>();
  const arrayKeys = new Set<string>();

  for (const [key, fieldSchema] of Object.entries(schema._zod.def.shape)) {
    const heading = normalizeKey(key);
    const existing = keyByHeading.get(heading);

    if (existing !== undefined) {
      throw new Error(
        `h3kv: schema keys "${existing}" and "${key}" both normalize to heading "${heading}"`
      );
    }

    keyByHeading.set(heading, key);

    if (isArraySchema(fieldSchema)) {
      arrayKeys.add(key);
    }
  }

  return { keyByHeading, arrayKeys };
}

/* -------------------------------------------------------------------------- */
/*                               markdown → text                              */
/* -------------------------------------------------------------------------- */

/** Nodes whose children are inline (phrasing) content and join without separators. */
const PHRASING_CONTAINERS: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

/**
 * Plain-text content of a node. Unlike `mdast-util-to-string`, hard line
 * breaks become `"\n"` and block-level children (nested lists, blockquote
 * paragraphs, ...) are separated by `"\n"` instead of being glued together.
 * Inline html is kept as written.
 */
function nodeToText(node: Nodes): string {
  if (node.type === "break") {
    return "\n";
  }

  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }

  if ("value" in node) {
    return node.value;
  }

  if ("children" in node) {
    const separator = PHRASING_CONTAINERS.has(node.type) ? "" : "\n";
    return node.children.map(nodeToText).join(separator);
  }

  return "";
}

/** Leading and trailing blank lines only; inner whitespace is left untouched. */
const EDGE_BLANK_LINES = /^\n+|\n+$/g;

function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** GitHub issue forms render unfilled optional fields as `_No response_`. */
function isGithubIssueFormNullValue(node: RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.length === 1 &&
    node.children[0]?.type === "emphasis" &&
    nodeToText(node).trim() === "No response"
  );
}

/**
 * Extracts the values a top-level block contributes to the current key.
 *
 * - list: one value per list item
 * - paragraph / blockquote / code for an array key: one value per line
 * - paragraph / blockquote for a scalar key: lines re-joined with `"\n"`
 * - code for a scalar key: verbatim content (indentation preserved)
 *
 * Any other block type (thematic break, html, ...) is ignored.
 */
function extractValues(node: RootContent, isArray: boolean): string[] {
  if (node.type === "list") {
    return node.children.map((item) => nodeToText(item).trim()).filter(Boolean);
  }

  if (
    node.type !== "paragraph" &&
    node.type !== "blockquote" &&
    node.type !== "code"
  ) {
    return [];
  }

  const text = nodeToText(node);

  if (isArray) {
    return toLines(text);
  }

  const value =
    node.type === "code"
      ? text.replace(EDGE_BLANK_LINES, "")
      : toLines(text).join("\n");

  return value.trim() ? [value] : [];
}

/** `_No response_` under an array key that has collected nothing means absent. */
function clearEmptyArray(rawData: RawData, key: string): void {
  const existing = rawData[key];

  if (Array.isArray(existing) && existing.length === 0) {
    delete rawData[key];
  }
}

function appendValues(
  rawData: RawData,
  key: string,
  values: string[],
  isArray: boolean
): void {
  if (values.length === 0) {
    return;
  }

  const existing = rawData[key];

  if (isArray) {
    if (Array.isArray(existing)) {
      existing.push(...values);
    } else {
      rawData[key] = [...values];
    }
    return;
  }

  const joined = values.join("\n");
  rawData[key] =
    typeof existing === "string" ? `${existing}\n${joined}` : joined;
}

/* -------------------------------------------------------------------------- */
/*                                 public api                                 */
/* -------------------------------------------------------------------------- */

export interface MarkdownToDataObjectOptions {
  /**
   * Treat a paragraph consisting solely of `_No response_` as an absent value.
   * GitHub issue forms emit this for unfilled optional fields.
   *
   * @default true
   */
  githubIssueFormNullValueSupport?: boolean;
}

export interface DataObjectToMarkdownOptions<T extends SchemaObject> {
  /**
   * Keys to emit, in order. Defaults to the schema's key order.
   * Keys whose value is `null`, `undefined` or a blank string are skipped.
   */
  outputOrder?: readonly SchemaOutputKey<T>[];
  /**
   * Heading level used for keys.
   *
   * @default 3
   */
  headingDepth?: Heading["depth"];
}

/**
 * Parses H3KV markdown into an object validated by `schema`.
 *
 * Headings (any depth) are matched case-insensitively against the schema's
 * keys. Content under a heading is collected as text, so every value reaches
 * zod as a `string` (or `string[]` for array fields): use `z.coerce.number()`,
 * `z.coerce.date()`, `z.stringbool()` etc. for non-string fields.
 *
 * A heading with nothing under it yields `[]` for an array field and leaves a
 * scalar field absent.
 *
 * @throws {ZodError} when the collected data does not satisfy `schema`.
 * @throws {Error} when two schema keys differ only by case or whitespace.
 */
export function markdownToDataObject<T extends SchemaObject>(
  markdown: string,
  schema: T,
  { githubIssueFormNullValueSupport = true }: MarkdownToDataObjectOptions = {}
): SchemaOutput<T> {
  const { keyByHeading, arrayKeys } = inspectSchema(schema);
  const tree = unified().use(remarkParse).parse(markdown);
  // null prototype: heading text like "constructor" must not hit Object.prototype
  const rawData: RawData = Object.create(null);

  let currentKey: string | undefined;
  let currentIsArray = false;

  for (const node of tree.children) {
    if (node.type === "heading") {
      currentKey = keyByHeading.get(normalizeKey(nodeToText(node)));
      currentIsArray = currentKey !== undefined && arrayKeys.has(currentKey);

      // a bare heading is the only way markdown can express an empty list
      if (currentKey !== undefined && currentIsArray) {
        rawData[currentKey] ??= [];
      }

      continue;
    }

    // content before the first known heading, or under an unknown heading
    if (currentKey === undefined) {
      continue;
    }

    if (githubIssueFormNullValueSupport && isGithubIssueFormNullValue(node)) {
      clearEmptyArray(rawData, currentKey);
      continue;
    }

    const values = extractValues(node, currentIsArray);
    appendValues(rawData, currentKey, values, currentIsArray);
  }

  return parse(schema, rawData);
}

/* -------------------------------------------------------------------------- */
/*                               object → markdown                            */
/* -------------------------------------------------------------------------- */

/** `null`, `undefined` and blank strings are omitted; `0` and `false` are kept. */
function shouldOmit(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function stringifyValue(value: unknown, key: string): string {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`h3kv: cannot serialize key "${key}": invalid Date`);
    }

    const iso = value.toISOString();
    const isMidnightUtc = iso.endsWith("T00:00:00.000Z");
    // slice at "T" rather than a fixed width: years outside 0000-9999 are
    // written as ±YYYYYY
    return isMidnightUtc ? iso.slice(0, iso.indexOf("T")) : iso;
  }

  if (typeof value === "object" || typeof value === "function") {
    throw new TypeError(
      `h3kv: cannot serialize key "${key}": expected a string, number, boolean, bigint, Date or an array of those, received ${Array.isArray(value) ? "nested array" : typeof value}`
    );
  }

  return String(value);
}

/**
 * Paragraphs cannot carry indentation or blank lines, so a string that needs
 * either is written as a fenced code block and read back verbatim.
 */
function needsCodeBlock(text: string): boolean {
  return text.split("\n").some((line) => line === "" || line !== line.trim());
}

function scalarToNodes(value: unknown, key: string): RootContent[] {
  const text = stringifyValue(value, key).replace(EDGE_BLANK_LINES, "");

  if (needsCodeBlock(text)) {
    return [{ type: "code", value: text }];
  }

  return toLines(text).map((line) => ({
    type: "paragraph",
    children: [{ type: "text", value: line }],
  }));
}

function arrayToNodes(values: unknown[], key: string): RootContent[] {
  const items = values
    .filter((value) => !shouldOmit(value))
    .map((value) => stringifyValue(value, key).trim())
    .filter(Boolean);

  if (items.length === 0) {
    return [];
  }

  return [
    {
      type: "list",
      ordered: false,
      children: items.map((item) => ({
        type: "listItem",
        children: [
          { type: "paragraph", children: [{ type: "text", value: item }] },
        ],
      })),
    },
  ];
}

/**
 * Serializes `data` to H3KV markdown: one heading per key followed by its
 * value. Arrays become bullet lists, booleans become `yes` / `no`, dates
 * become ISO strings (`YYYY-MM-DD` when the time is midnight UTC), and
 * multi-line strings become one paragraph per line, or a fenced code block
 * when they contain indentation or blank lines. Keys whose value is `null`,
 * `undefined` or a blank string are omitted entirely; an empty array (or one
 * containing only blank strings) is written as a bare heading, which parses
 * back to `[]`.
 *
 * Markdown syntax inside values is escaped, so the output always parses back
 * to the same text.
 *
 * @throws {TypeError} when a value is not a primitive, Date, or array of those.
 * @throws {Error} when two schema keys differ only by case or whitespace.
 */
export function dataObjectToMarkdown<T extends SchemaObject>(
  data: SchemaOutput<T>,
  schema: T,
  { outputOrder, headingDepth = 3 }: DataObjectToMarkdownOptions<T> = {}
): string {
  // same validation as the parser, so we never emit a document we cannot read
  inspectSchema(schema);

  const keys =
    outputOrder ?? (Object.keys(schema._zod.def.shape) as SchemaOutputKey<T>[]);

  const children: RootContent[] = [];

  for (const key of keys) {
    const rawValue: unknown = data[key];

    if (shouldOmit(rawValue)) {
      continue;
    }

    const valueNodes = Array.isArray(rawValue)
      ? arrayToNodes(rawValue, key)
      : scalarToNodes(rawValue, key);

    children.push(
      {
        type: "heading",
        depth: headingDepth,
        children: [{ type: "text", value: key }],
      },
      ...valueNodes
    );
  }

  const tree: Root = { type: "root", children };

  return unified()
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
      join: [
        (left, right) => {
          if (left.type === "listItem" && right.type === "listItem") {
            return 0;
          }
          return null;
        },
      ],
    })
    .stringify(tree)
    .trim();
}
