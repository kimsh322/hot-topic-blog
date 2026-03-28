interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeCallOptions {
  system?: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}

export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: options.messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data = await response.json();

  // deno-lint-ignore no-explicit-any
  const text = data.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");

  return text;
}
