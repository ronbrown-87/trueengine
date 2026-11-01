// Server-only helper: streams a Lovable AI Gateway Responses call and returns parsed JSON.
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

export async function visionJSON<T>(opts: {
  system: string;
  parts: Part[];
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new AiError("AI service is not configured.", 500);

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: opts.system,
      input: [{ role: "user", content: opts.parts }],
      text: {
        format: { type: "json_schema", name: opts.schemaName, strict: true, schema: opts.schema },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("AI gateway error", res.status, body.slice(0, 500));
    const msg =
      res.status === 429
        ? "The AI service is busy. Please wait a moment and try again."
        : res.status === 402
          ? "AI credits are used up. Please add credits to continue."
          : res.status === 403
            ? "AI access was denied for this request."
            : "The AI check failed. Please try again.";
    throw new AiError(msg, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data) as { type?: string; delta?: string };
          if (evt.type === "response.output_text.delta" && evt.delta) text += evt.delta;
          if (evt.type === "response.refusal.delta") refused = true;
          if (evt.type === "response.failed" || evt.type === "error") {
            console.error("AI stream error", data.slice(0, 500));
            throw new AiError("The AI check failed. Please try again.", 502);
          }
        } catch (e) {
          if (e instanceof AiError) throw e;
        }
      }
    }
  }
  if (refused || !text) throw new AiError("The AI could not analyse this image.", 422);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("The AI returned an unreadable answer. Please try again.", 502);
  }
}
