const topicInput = document.getElementById('topic-input');
const startBtn = document.getElementById('start-btn');
const inputSection = document.getElementById('input-section');
const progressContainer = document.getElementById('progress-bar-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const timeline = document.getElementById('debate-timeline');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');

let isRunning = false;

// Start debate
startBtn.addEventListener('click', () => {
  const topic = topicInput.value.trim();
  if (!topic || isRunning) return;
  startDebate(topic);
});

topicInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const topic = topicInput.value.trim();
    if (!topic || isRunning) return;
    startDebate(topic);
  }
});

async function startDebate(topic) {
  isRunning = true;
  startBtn.disabled = true;
  startBtn.querySelector('.btn-text').textContent = '토론 중...';

  // Reset UI
  timeline.innerHTML = '';
  timeline.classList.remove('hidden');
  resultsList.innerHTML = '';
  resultsSection.classList.add('hidden');
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '카운슬 소환 중...';

  let totalTurns = 9;
  let currentTurn = 0;

  try {
    const response = await fetch('/api/debate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, turns: 9 }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep incomplete chunk

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);

        try {
          const event = JSON.parse(jsonStr);
          handleEvent(event);

          if (event.type === 'phase' && event.data.phase === 'turn') {
            currentTurn = event.data.turn;
            totalTurns = event.data.total;
          }

          // Update progress
          if (event.type === 'opening') {
            progressFill.style.width = '5%';
            progressText.textContent = '초기 입장 발표 중...';
          } else if (event.type === 'turn') {
            const pct = 10 + (currentTurn / totalTurns) * 85;
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `턴 ${currentTurn}/${totalTurns} 진행 중...`;
          } else if (event.type === 'result') {
            progressFill.style.width = '100%';
            progressText.textContent = '토론 완료!';
          }
        } catch {
          // skip malformed
        }
      }
    }
  } catch (err) {
    console.error('Debate stream error:', err);
    progressText.textContent = '오류 발생!';
  } finally {
    isRunning = false;
    startBtn.disabled = false;
    startBtn.querySelector('.btn-text').textContent = '소환';
  }
}

let currentTurnBlock = null;
let currentTurnNumber = -1;

function handleEvent(event) {
  switch (event.type) {
    case 'phase':
      if (event.data.phase === 'opening') {
        createTurnBlock('⚡ 초기 입장');
      } else if (event.data.phase === 'turn') {
        createTurnBlock(`턴 ${event.data.turn} / ${event.data.total}`);
      }
      break;

    case 'opening':
    case 'turn':
      addSpeechBubble(event.data);
      break;

    case 'result':
      showResults(event.data);
      break;

    case 'error':
      addErrorMessage(event.data.message);
      break;
  }
}

function createTurnBlock(label) {
  const block = document.createElement('div');
  block.className = 'turn-block';
  block.innerHTML = `
    <div class="turn-header">
      <span class="turn-label">${label}</span>
    </div>
  `;
  timeline.appendChild(block);
  currentTurnBlock = block;
}

function addSpeechBubble(data) {
  if (!currentTurnBlock) createTurnBlock('???');

  const bubble = document.createElement('div');
  bubble.className = 'speech-bubble';
  bubble.style.setProperty('--char-color', data.color);

  let actionHtml;
  if (data.action === 'support' && data.target) {
    actionHtml = `<span class="action-badge support">🤝 ${data.target} 지지</span>`;
  } else {
    actionHtml = `<span class="action-badge insist">🔥 고수</span>`;
  }

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="char-emoji">${data.emoji}</span>
      <span class="char-name">${data.name}</span>
      ${actionHtml}
    </div>
    <p class="bubble-speech">${escapeHtml(data.speech)}</p>
  `;

  currentTurnBlock.appendChild(bubble);

  // Scroll to bottom
  bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showResults(ranked) {
  resultsSection.classList.remove('hidden');

  for (const item of ranked) {
    const card = document.createElement('div');
    card.className = `result-card rank-${item.rank}`;
    card.style.animationDelay = `${(item.rank - 1) * 0.15}s`;

    const supporterTags = item.supporterNames
      .map((s) => `<span class="supporter-tag">${s.emoji} ${s.name}</span>`)
      .join('');

    card.innerHTML = `
      <div class="rank-number">#${item.rank}</div>
      <div class="result-info">
        <div class="result-char-name" style="color: ${item.color}">
          ${item.emoji} ${item.name}
        </div>
        <p class="result-speech">"${escapeHtml(item.speech)}"</p>
        <div class="result-supporters">
          지지자: ${supporterTags || '<span style="opacity:0.5">없음</span>'}
        </div>
      </div>
      <div class="support-count">
        ${item.supporters}
        <small>표</small>
      </div>
    `;

    resultsList.appendChild(card);
  }

  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addErrorMessage(message) {
  const el = document.createElement('div');
  el.className = 'speech-bubble';
  el.style.setProperty('--char-color', '#ff5252');
  el.innerHTML = `
    <div class="bubble-header">
      <span class="char-emoji">💥</span>
      <span class="char-name" style="color: #ff5252">ERROR</span>
    </div>
    <p class="bubble-speech">${escapeHtml(message)}</p>
  `;
  if (currentTurnBlock) {
    currentTurnBlock.appendChild(el);
  } else {
    timeline.appendChild(el);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
