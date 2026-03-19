/**
 * Use AI only to summarize already-computed analytics into 2–3 insight bullets.
 * Never pass raw query for open-ended generation; pass structured data only.
 * If OpenAI is unavailable or fails, return [] so the response still has deterministic answer.
 */

interface SummarizeInsightPayload {
  intent: string;
  plan: unknown;
  data: unknown;
  answer: string;
}

async function summarizeInsight(payload: SummarizeInsightPayload): Promise<string[]> {
  const { intent, plan, data, answer } = payload;
  const key = process.env.OPENAI_API_KEY;
  if (!key || !data) return [];

  const dataStr = JSON.stringify(data);
  const systemContent =
    'You are an analytics summarizer for a logistics system. You receive structured data and a short answer. ' +
    'Generate exactly 2 or 3 short insight bullets (one sentence each). ' +
    'Use ONLY the numbers and names from the provided data. Do not invent any metric or value. ' +
    'Examples: "X contributes Y% of deliveries this month." "Top 3 customers account for Z% of volume."';

  const userContent = `Intent: ${intent}. Plan: ${JSON.stringify(plan)}. Answer: ${answer}. Data: ${dataStr}. Generate 2-3 insight bullets using only this data.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        max_tokens: 150,
        temperature: 0.2,
      }),
    });
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return [];
    return text
      .split(/\n+/)
      .map((s: string) => s.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (err: unknown) {
    const e = err as Error;
    console.error('[summarizeInsight]', e.message);
    return [];
  }
}

export { summarizeInsight };
