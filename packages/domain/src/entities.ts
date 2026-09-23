// v1 gazetteer entity extractor: deterministic, no AI dependency.
const GAZETTEER = [
  "OpenAI", "Anthropic", "Google", "DeepMind", "Meta", "Apple", "Microsoft", "NVIDIA", "AMD", "Intel",
  "Claude", "GPT", "Gemini", "Llama", "Mistral",
  "React", "Next.js", "Rust", "TypeScript", "Python", "Go", "Kubernetes", "Postgres", "Redis", "CUDA",
];

export function extractEntities(text: string): string[] {
  const out = new Set<string>();
  for (const g of GAZETTEER) {
    const re = new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) out.add(g);
  }
  return [...out];
}

const TOPIC_RULES: Array<[RegExp, string]> = [
  [/\b(llm|gpt|claude|gemini|agent|diffusion|transformer)\b/i, "AI"],
  [/\b(rust|typescript|react|kubernetes|postgres|devops|cloud)\b/i, "Developer"],
  [/\b(nvidia|gpu|cuda|chip|cpu|tpu)\b/i, "Hardware"],
  [/\b(cve|exploit|ransomware|zero-day|phishing)\b/i, "Security"],
  [/\b(open source|github|oss|license)\b/i, "Open Source"],
  [/\b(paper|arxiv|benchmark|sota)\b/i, "Research"],
];

export function classifyTopics(title: string, summary = ""): string[] {
  const text = `${title} ${summary}`;
  const topics = new Set<string>();
  for (const [re, t] of TOPIC_RULES) if (re.test(text)) topics.add(t);
  return [...topics];
}
