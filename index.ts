import type { Heading, Root, RootContent } from "mdast";
import { toString as getContentAsText } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import * as z from "zod/v4/core";

type SchemaObject = z.$ZodObject;

type SchemaOutput<T extends SchemaObject> = z.output<T>;

type SchemaOutputKey<T extends SchemaObject> = Extract<
	keyof SchemaOutput<T>,
	string
>;

function normalizeKey<T extends SchemaObject>(key: SchemaOutputKey<T>) {
	return key.trim().toLowerCase();
}

function isArrayKey<T extends SchemaObject>(
	schema: T,
	key: SchemaOutputKey<T>,
) {
	const fieldSchema = schema._zod.def.shape[key];

	if (!fieldSchema) {
		return null;
	}

	const keyShape =
		"innerType" in fieldSchema._zod.def
			? fieldSchema._zod.def.innerType // in case of optional/nullable etc. (cant use unwrap because it will return the inner type of arrays too)
			: fieldSchema;

	return keyShape instanceof z.$ZodArray;
}

function buildSchemaKeyMap<T extends SchemaObject>(
	schema: T,
): Record<string, SchemaOutputKey<T>> {
	return Object.keys(schema._zod.def.shape).reduce(
		(acc, key) => {
			acc[normalizeKey(key)] = key as SchemaOutputKey<T>;
			return acc;
		},
		{} as Record<string, SchemaOutputKey<T>>,
	);
}

export type MarkdownToDataObjectOptions = {
	githubIssueFormNullValueSupport?: boolean;
};

export type DataObjectToMarkdownOptions<T extends SchemaObject> = {
	outputOrder?: readonly SchemaOutputKey<T>[];
	headingDepth?: Heading["depth"];
};

export function markdownToDataObject<T extends SchemaObject>(
	markdown: string,
	schema: T,
	{
		githubIssueFormNullValueSupport: githubIssueFormsNullValueSupport = true,
	}: MarkdownToDataObjectOptions = {},
): SchemaOutput<T> {
	const schemaKeyMap = buildSchemaKeyMap(schema);

	const tree = unified().use(remarkParse).parse(markdown);
	const rawData: Partial<Record<SchemaOutputKey<T>, unknown>> = {};

	let currentKey: SchemaOutputKey<T> | undefined;

	visit(tree, ["heading", "paragraph", "list"], (node, _, parent) => {
		// skip non-top level nodes
		if (parent?.type !== "root") return;

		/* ---------------- key ---------------- */

		if (node.type === "heading") {
			currentKey = schemaKeyMap[normalizeKey(getContentAsText(node))];
			return;
		}

		/* ---------------- value ---------------- */

		// skip if no key is set
		if (!currentKey) {
			return;
		}

		if (node.type === "list") {
			const values = node.children
				.map((item) => getContentAsText(item).trim())
				.filter(Boolean);

			if (!values.length) return;

			if (isArrayKey(schema, currentKey)) {
				rawData[currentKey] = [
					...((rawData[currentKey] as unknown[]) ?? []),
					...values,
				];
			} else {
				rawData[currentKey] = rawData[currentKey]
					? `${rawData[currentKey]}\n${values.join("\n")}`
					: values.join("\n");
			}

			return;
		}

		if (node.type === "paragraph") {
			const value = getContentAsText(node).trim();

			if (!value) return;

			// handle github issue forms null values for unfilled optional fields (_No response_)
			if (
				githubIssueFormsNullValueSupport &&
				value === "No response" &&
				node.children[0]?.type === "emphasis"
			) {
				return;
			}

			if (isArrayKey(schema, currentKey)) {
				const values = value
					.split("\n")
					.map((item) => item.trim())
					.filter(Boolean);

				if (!values.length) return;

				rawData[currentKey] = [
					...((rawData[currentKey] as unknown[]) ?? []),
					...values,
				];
			} else {
				rawData[currentKey] = rawData[currentKey]
					? `${rawData[currentKey]}\n${value}`
					: value;
			}
		}
	});

	return z.parse(schema, rawData);
}

export function dataObjectToMarkdown<T extends SchemaObject>(
	data: SchemaOutput<T>,
	schema: T,
	{ outputOrder, headingDepth = 3 }: DataObjectToMarkdownOptions<T> = {},
): string {
	// preserve falsy values like 0 and false.
	const shouldOmit = (value: unknown) =>
		value == null || (typeof value === "string" && value.trim() === "");

	const keys =
		outputOrder ?? (Object.keys(schema._zod.def.shape) as SchemaOutputKey<T>[]);

	const children: RootContent[] = [];

	for (const key of keys) {
		const rawValue = data[key];

		if (shouldOmit(rawValue)) continue;

		children.push({
			type: "heading",
			depth: headingDepth,
			children: [{ type: "text", value: String(key) }],
		});

		if (Array.isArray(rawValue)) {
			const values = rawValue
				.filter((value) => !shouldOmit(value))
				.map((value) => String(value).trim())
				.filter(Boolean);

			if (!values.length) continue;

			children.push({
				type: "list",
				ordered: false,
				children: values.map((value) => ({
					type: "listItem",
					children: [
						{
							type: "paragraph",
							children: [{ type: "text", value }],
						},
					],
				})),
			});
		} else {
			const values = String(rawValue)
				.split("\n")
				.map((value) => value.trim())
				.filter(Boolean);

			for (const value of values) {
				children.push({
					type: "paragraph",
					children: [{ type: "text", value }],
				});
			}
		}
	}

	const tree: Root = { type: "root", children };

	return unified()
		.use(remarkStringify, {
			bullet: "-",
			join: [
				(left, right) => {
					if (left?.type === "listItem" && right?.type === "listItem") {
						return 0;
					}
					return null;
				},
			],
		})
		.stringify(tree)
		.trim();
}
