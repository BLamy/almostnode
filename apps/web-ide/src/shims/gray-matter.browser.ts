import { parseDocument, stringify as stringifyYaml } from "yaml";

type GrayMatterData = Record<string, unknown>;

export interface GrayMatterFile<TData = GrayMatterData> {
  content: string;
  data: TData;
  excerpt: string;
  isEmpty: boolean;
  empty?: string;
}

type GrayMatter = {
  <TData = GrayMatterData>(input: string): GrayMatterFile<TData>;
  stringify<TData = GrayMatterData>(content: string, data?: TData): string;
};

function parseMatter<TData = GrayMatterData>(input: string): GrayMatterFile<TData> {
  const normalized = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    return {
      content: normalized,
      data: {} as TData,
      excerpt: "",
      isEmpty: false,
    };
  }

  const rawFrontmatter = match[1];
  const content = normalized.slice(match[0].length);

  if (rawFrontmatter.trim() === "") {
    return {
      content,
      data: {} as TData,
      excerpt: "",
      isEmpty: true,
      empty: normalized,
    };
  }

  const document = parseDocument(rawFrontmatter);
  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  const parsed = document.toJS();
  return {
    content,
    data: ((parsed && typeof parsed === "object") ? parsed : {}) as TData,
    excerpt: "",
    isEmpty: false,
  };
}

function stringifyMatter<TData = GrayMatterData>(content: string, data?: TData): string {
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
    return content;
  }

  const frontmatter = stringifyYaml(data).trimEnd();
  return `---\n${frontmatter}\n---\n${content}`;
}

const matter = parseMatter as GrayMatter;
matter.stringify = stringifyMatter;

export default matter;
