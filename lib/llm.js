import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    });
  }
  return client;
}

export async function chat(messages, { temperature = 0.9, maxTokens = 1024 } = {}) {
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const response = await getClient().chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return response.choices[0].message.content;
}
