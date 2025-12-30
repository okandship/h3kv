import { z } from "zod";
import { dataObjectToMarkdown, markdownToDataObject } from "./index";

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
