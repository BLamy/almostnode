import type {
  ApiItem,
  CardItem,
  CodeExample,
  DocsBlock,
  DocsPage,
  StepItem,
} from "./content";

// Converts the structured docs content model into GitBook-flavored markdown
// so it can be rendered by docstream's MarkdownContent renderer. Keeping the
// authored content as data (content.ts) means we get GitBook chrome for free
// without rewriting every page by hand.

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function paragraphsToMarkdown(items: readonly string[]): string {
  return items.join("\n\n");
}

function stepsToMarkdown(items: readonly StepItem[]): string {
  const steps = items
    .map(
      (item) =>
        `{% step %}\n### ${item.title}\n\n${item.body}\n{% endstep %}`,
    )
    .join("\n\n");
  return `{% stepper %}\n${steps}\n{% endstepper %}`;
}

function apiToMarkdown(items: readonly ApiItem[]): string {
  return items
    .map((item) => {
      const status = item.status ? ` _( ${item.status} )_` : "";
      return `### ${item.name}${status}\n\n\`\`\`ts\n${item.signature}\n\`\`\`\n\n${item.description}`;
    })
    .join("\n\n");
}

function cardsToMarkdown(items: readonly CardItem[]): string {
  // docstream renders an HTML table with data-view="cards" as a card grid.
  // First cell becomes the card title, remaining cells the card body.
  const rows = items
    .map((item) => {
      const title = item.kicker
        ? `<strong>${escapeCell(item.kicker)}</strong><br />${escapeCell(item.title)}`
        : escapeCell(item.title);
      return `<tr><td>${title}</td><td>${escapeCell(item.body)}</td></tr>`;
    })
    .join("");
  return `<table data-view="cards"><tbody>${rows}</tbody></table>`;
}

export function codeToMarkdown(example: CodeExample): string {
  return `\`\`\`${example.language}\n${example.code}\n\`\`\``;
}

function checklistToMarkdown(items: readonly string[]): string {
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

export function blockToMarkdown(block: DocsBlock): string {
  switch (block.type) {
    case "paragraphs":
      return paragraphsToMarkdown(block.items);
    case "steps":
      return stepsToMarkdown(block.items);
    case "api":
      return apiToMarkdown(block.items);
    case "cards":
      return cardsToMarkdown(block.items);
    case "code":
      return codeToMarkdown(block.example);
    case "checklist":
      return checklistToMarkdown(block.items);
  }
}

export function pageToMarkdown(page: DocsPage): string {
  return page.blocks.map(blockToMarkdown).join("\n\n");
}
