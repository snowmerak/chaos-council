import { chat } from './llm.js';
import characters from './characters.js';

const DEFAULT_TURNS = 9;

/**
 * Run a full debate session.
 * @param {string} topic - The debate topic
 * @param {number} turns - Number of debate turns
 * @param {(event: {type: string, data: any}) => void} onEvent - SSE callback
 */
export async function runDebate(topic, turns = DEFAULT_TURNS, onEvent) {
  const history = []; // Array of { turn, characterId, name, emoji, color, speech, action, target? }

  // Phase 1: Opening statements (parallel)
  onEvent({ type: 'phase', data: { phase: 'opening', topic } });

  const openingPromises = characters.map(async (char) => {
    const messages = [
      { role: 'system', content: char.systemPrompt },
      {
        role: 'user',
        content: `토론 주제: "${topic}"

당신은 이 주제에 대해 자신만의 독특한 입장을 밝혀야 합니다.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

{
  "speech": "당신의 발언 (2-4문장, 한국어)",
  "action": "insist"
}`,
      },
    ];

    const raw = await chat(messages, { temperature: 1.0 });
    const parsed = parseResponse(raw);

    return {
      turn: 0,
      characterId: char.id,
      name: char.name,
      emoji: char.emoji,
      color: char.color,
      speech: parsed.speech,
      action: 'insist',
      target: null,
    };
  });

  const openings = await Promise.all(openingPromises);
  for (const entry of openings) {
    history.push(entry);
    onEvent({ type: 'opening', data: entry });
  }

  // Phase 2: Debate turns
  for (let turn = 1; turn <= turns; turn++) {
    onEvent({ type: 'phase', data: { phase: 'turn', turn, total: turns } });

    const turnPromises = characters.map(async (char) => {
      const previousStatements = history
        .filter((h) => h.turn === turn - 1)
        .map(
          (h) =>
            `${h.emoji} ${h.name}: "${h.speech}" [${h.action === 'insist' ? '입장 고수 🔥' : `${h.target} 지지 🤝`}]`
        )
        .join('\n');

      const myHistory = history
        .filter((h) => h.characterId === char.id)
        .map((h) => `[턴 ${h.turn}] "${h.speech}" [${h.action === 'insist' ? '고수' : `${h.target} 지지`}]`)
        .join('\n');

      const otherNames = characters
        .filter((c) => c.id !== char.id)
        .map((c) => c.name);

      const messages = [
        { role: 'system', content: char.systemPrompt },
        {
          role: 'user',
          content: `토론 주제: "${topic}"
현재 턴: ${turn}/${turns}

=== 이전 턴 발언들 ===
${previousStatements}

=== 당신의 이전 발언들 ===
${myHistory || '(첫 발언)'}

=== 규칙 ===
1. 다른 참가자들의 발언을 보고 반응하세요.
2. 당신은 두 가지 행동 중 하나를 선택해야 합니다:
   - "insist": 자신의 입장을 고수하며 강하게 주장
   - "support": 다른 참가자의 입장에 동의하며 지지 (target에 그 참가자 이름)
3. 지지할 수 있는 대상: ${otherNames.join(', ')}
4. 캐릭터의 성격에 맞게 반응하세요!

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

{
  "speech": "당신의 발언 (2-4문장, 한국어)",
  "action": "insist 또는 support",
  "target": "지지할 경우 대상 이름, 고수할 경우 null"
}`,
        },
      ];

      const raw = await chat(messages, { temperature: 1.0 });
      const parsed = parseResponse(raw);

      return {
        turn,
        characterId: char.id,
        name: char.name,
        emoji: char.emoji,
        color: char.color,
        speech: parsed.speech,
        action: parsed.action === 'support' ? 'support' : 'insist',
        target: parsed.action === 'support' ? parsed.target : null,
      };
    });

    const turnResults = await Promise.all(turnPromises);
    for (const entry of turnResults) {
      history.push(entry);
      onEvent({ type: 'turn', data: entry });
    }
  }

  // Phase 3: Tally results
  const results = tallyResults(history, turns);
  onEvent({ type: 'result', data: results });

  return { history, results };
}

/**
 * Parse JSON from LLM response, handling markdown code blocks and messy output
 */
function parseResponse(raw) {
  let cleaned = raw.trim();

  // Remove markdown code block wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  // Try to extract JSON object if there's extra text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: if JSON parsing fails, treat the whole thing as speech
    return {
      speech: raw.trim().slice(0, 200),
      action: 'insist',
      target: null,
    };
  }
}

/**
 * Tally final support. Resolve chains: if A supports B who supports C, A effectively supports C.
 */
function tallyResults(history, totalTurns) {
  const lastTurn = history.filter((h) => h.turn === totalTurns);

  // Build a support map: characterId -> who they support (characterId or self)
  const supportMap = {};
  for (const entry of lastTurn) {
    if (entry.action === 'support' && entry.target) {
      // Find target character by name
      const targetEntry = lastTurn.find((e) => e.name === entry.target);
      if (targetEntry) {
        supportMap[entry.characterId] = targetEntry.characterId;
      } else {
        supportMap[entry.characterId] = entry.characterId; // self
      }
    } else {
      supportMap[entry.characterId] = entry.characterId; // insist = self
    }
  }

  // Resolve chains
  function resolveOrigin(charId, visited = new Set()) {
    if (visited.has(charId)) return charId; // cycle protection
    visited.add(charId);
    const target = supportMap[charId];
    if (target === charId) return charId;
    return resolveOrigin(target, visited);
  }

  // Count supporters for each origin
  const originCounts = {};
  const originDetails = {};

  for (const entry of lastTurn) {
    const origin = resolveOrigin(entry.characterId);
    if (!originCounts[origin]) {
      originCounts[origin] = 0;
      const originEntry = lastTurn.find((e) => e.characterId === origin);
      originDetails[origin] = {
        characterId: origin,
        name: originEntry?.name || 'Unknown',
        emoji: originEntry?.emoji || '❓',
        color: originEntry?.color || '#ffffff',
        speech: originEntry?.speech || '',
      };
    }
    originCounts[origin]++;
  }

  // Sort by support count (descending), then by first appearance for ties
  const ranked = Object.entries(originCounts)
    .sort(([aId, aCount], [bId, bCount]) => {
      if (bCount !== aCount) return bCount - aCount;
      // Tie-break: who made their opening statement first
      const aIdx = characters.findIndex((c) => c.id === aId);
      const bIdx = characters.findIndex((c) => c.id === bId);
      return aIdx - bIdx;
    })
    .map(([charId, count], rank) => ({
      rank: rank + 1,
      ...originDetails[charId],
      supporters: count,
      supporterNames: lastTurn
        .filter((e) => resolveOrigin(e.characterId) === charId)
        .map((e) => ({ name: e.name, emoji: e.emoji })),
    }));

  return ranked;
}
