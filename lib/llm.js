import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.LLM_API_KEY;
    const baseURL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      throw new Error('LLM_API_KEY is not set in .env file');
    }

    console.log(`[LLM] Connecting to: ${baseURL}`);
    console.log(`[LLM] Model: ${process.env.LLM_MODEL || 'gpt-4o-mini'}`);

    client = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return client;
}

export async function chat(messages, { temperature = 0.9, maxTokens = 16384 } = {}) {
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  try {
    const response = await getClient().chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
    const content = response.choices[0]?.message?.content;
    if (content == null) {
      console.warn(`[LLM WARN] Model returned null content. Full response:`, JSON.stringify(response.choices[0], null, 2));
      return '{"speech": "...말을 잃었습니다...", "action": "insist"}';
    }
    return content;
  } catch (err) {
    console.error(`[LLM ERROR] Status: ${err.status || 'N/A'}`);
    console.error(`[LLM ERROR] Message: ${err.message}`);
    if (err.error) {
      console.error(`[LLM ERROR] Details:`, JSON.stringify(err.error, null, 2));
    }
    throw err;
  }
}
