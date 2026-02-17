const QUESTION_BANK_PATH = "./britizen_life_in_uk_mcq_export.json";
const CONTEXT_PATH = "./question_contexts.json";

const state = {
  questions: [],
  topics: [],
  contextByQuestionId: {},
  selectedTopic: null,
  sessionQuestions: [],
  index: 0,
  answered: 0,
  score: 0,
  selectedOptionIds: new Set(),
  submitted: false,
  complete: false,
};

const el = {
  topicView: document.getElementById("topic-view"),
  practiceView: document.getElementById("practice-view"),
  heroStats: document.getElementById("hero-stats"),
  topicGrid: document.getElementById("topic-grid"),
  contextStatus: document.getElementById("context-status"),
  backBtn: document.getElementById("back-btn"),
  topicPill: document.getElementById("topic-pill"),
  practiceTitle: document.getElementById("practice-title"),
  progressText: document.getElementById("progress-text"),
  scoreText: document.getElementById("score-text"),
  remainingText: document.getElementById("remaining-text"),
  progressFill: document.getElementById("progress-fill"),
  questionCard: document.getElementById("question-card"),
  questionType: document.getElementById("question-type"),
  questionText: document.getElementById("question-text"),
  optionsForm: document.getElementById("options-form"),
  submitBtn: document.getElementById("submit-btn"),
  nextBtn: document.getElementById("next-btn"),
  feedbackPanel: document.getElementById("feedback-panel"),
  feedbackTitle: document.getElementById("feedback-title"),
  feedbackExplanation: document.getElementById("feedback-explanation"),
  feedbackContext: document.getElementById("feedback-context"),
};

async function init() {
  try {
    const [bank, contextResult] = await Promise.all([
      fetchJson(QUESTION_BANK_PATH),
      fetchJson(CONTEXT_PATH).catch(() => null),
    ]);

    state.questions = Array.isArray(bank.unique_questions) ? bank.unique_questions : [];
    state.topics = buildTopics(state.questions);

    renderHeroStats(bank);
    normalizeContexts(contextResult);
    renderTopicGrid();

    el.backBtn.addEventListener("click", showTopicView);
    el.submitBtn.addEventListener("click", handleSubmit);
    el.nextBtn.addEventListener("click", handleNext);
  } catch (error) {
    el.contextStatus.textContent = `Failed to load data: ${error.message}`;
  }
}

function renderHeroStats(bank) {
  const counts = bank.counts || {};
  const chips = [
    `${counts.unique_question_count || state.questions.length} unique questions`,
    `${counts.quiz_count || 0} mock tests`,
    `${state.topics.length} topics`,
  ];
  el.heroStats.innerHTML = "";
  chips.forEach((text) => {
    const node = document.createElement("span");
    node.className = "stat-chip";
    node.textContent = text;
    el.heroStats.appendChild(node);
  });
}

function normalizeContexts(raw) {
  if (!raw) {
    state.contextByQuestionId = {};
    el.contextStatus.textContent = "No context file yet. Generate it with scripts/generate_question_contexts.py";
    return;
  }

  const rawContexts = raw.contexts && typeof raw.contexts === "object" ? raw.contexts : raw;
  const normalized = {};

  Object.entries(rawContexts).forEach(([qid, value]) => {
    if (typeof value === "string") {
      normalized[String(qid)] = value;
      return;
    }
    if (value && typeof value === "object") {
      normalized[String(qid)] =
        value.context || value.text || value.llm_context || value.content || "";
    }
  });

  state.contextByQuestionId = normalized;
  const count = Object.values(normalized).filter((v) => v && v.trim()).length;
  el.contextStatus.textContent = `Loaded context for ${count} question${count === 1 ? "" : "s"}.`;
}

function buildTopics(questions) {
  const byTopic = new Map();
  questions.forEach((q) => {
    const key = String(q.topic_id);
    if (!byTopic.has(key)) {
      byTopic.set(key, {
        topic_id: q.topic_id,
        topic_name: q.topic_name,
        questions: [],
      });
    }
    byTopic.get(key).questions.push(q);
  });

  return Array.from(byTopic.values()).sort((a, b) => b.questions.length - a.questions.length);
}

function renderTopicGrid() {
  el.topicGrid.innerHTML = "";

  state.topics.forEach((topic) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "topic-btn";
    btn.innerHTML = `
      <h3>${escapeHtml(topic.topic_name)}</h3>
      <p>${topic.questions.length} questions</p>
    `;
    btn.addEventListener("click", () => startTopic(topic.topic_id));
    el.topicGrid.appendChild(btn);
  });
}

function startTopic(topicId) {
  const topic = state.topics.find((item) => String(item.topic_id) === String(topicId));
  if (!topic) {
    return;
  }

  state.selectedTopic = topic;
  state.sessionQuestions = shuffleArray(topic.questions.slice());
  state.index = 0;
  state.answered = 0;
  state.score = 0;
  state.selectedOptionIds = new Set();
  state.submitted = false;
  state.complete = false;

  el.topicView.classList.add("hidden");
  el.practiceView.classList.remove("hidden");

  el.topicPill.textContent = topic.topic_name;
  el.practiceTitle.textContent = `Practice: ${topic.topic_name}`;
  renderQuestion();
}

function showTopicView() {
  el.practiceView.classList.add("hidden");
  el.topicView.classList.remove("hidden");
}

function renderQuestion() {
  const question = state.sessionQuestions[state.index];
  if (!question) {
    renderCompletion();
    return;
  }

  updateProgress();
  el.feedbackPanel.classList.add("hidden");
  el.feedbackPanel.classList.remove("ok", "bad");
  el.submitBtn.disabled = false;
  el.nextBtn.disabled = true;
  el.submitBtn.textContent = "Check Answer";
  state.selectedOptionIds = new Set();
  state.submitted = false;
  state.complete = false;

  const isMulti = Array.isArray(question.correct_option_ids) && question.correct_option_ids.length > 1;
  el.questionType.textContent = isMulti ? "Select two answers" : "Select one answer";
  el.questionText.textContent = question.question;

  el.optionsForm.innerHTML = "";
  const inputType = isMulti ? "checkbox" : "radio";

  question.possible_answers.forEach((option) => {
    const label = document.createElement("label");
    label.className = "option-item";
    label.dataset.optionId = String(option.option_id);

    const input = document.createElement("input");
    input.type = inputType;
    input.name = "answer";
    input.value = String(option.option_id);
    input.addEventListener("change", () => handleOptionChange(option.option_id, isMulti));

    const text = document.createElement("span");
    text.textContent = option.text;

    label.appendChild(input);
    label.appendChild(text);
    el.optionsForm.appendChild(label);
  });
}

function handleOptionChange(optionId, isMulti) {
  const id = String(optionId);

  if (isMulti) {
    if (state.selectedOptionIds.has(id)) {
      state.selectedOptionIds.delete(id);
    } else {
      state.selectedOptionIds.add(id);
    }
  } else {
    state.selectedOptionIds = new Set([id]);
  }

  [...el.optionsForm.querySelectorAll(".option-item")].forEach((node) => {
    const optionIdValue = node.dataset.optionId;
    node.classList.toggle("selected", state.selectedOptionIds.has(optionIdValue));
  });
}

function handleSubmit() {
  if (state.complete && state.selectedTopic) {
    startTopic(state.selectedTopic.topic_id);
    return;
  }

  if (state.submitted) {
    return;
  }

  const question = state.sessionQuestions[state.index];
  if (!question || state.selectedOptionIds.size === 0) {
    return;
  }

  const correctIds = new Set((question.correct_option_ids || []).map(String));
  const selectedIds = new Set([...state.selectedOptionIds].map(String));
  const isCorrect = isSetEqual(correctIds, selectedIds);

  state.submitted = true;
  state.answered += 1;
  if (isCorrect) {
    state.score += 1;
  }
  updateProgress();

  [...el.optionsForm.querySelectorAll("input")].forEach((input) => {
    input.disabled = true;
  });

  [...el.optionsForm.querySelectorAll(".option-item")].forEach((node) => {
    const id = node.dataset.optionId;
    const isRight = correctIds.has(id);
    const isPicked = selectedIds.has(id);

    if (isRight) {
      node.classList.add("correct");
    } else if (isPicked) {
      node.classList.add("wrong");
    }
  });

  showFeedback(question, isCorrect);
  el.submitBtn.disabled = true;
  el.nextBtn.disabled = false;
}

function showFeedback(question, isCorrect) {
  el.feedbackPanel.classList.remove("hidden");
  el.feedbackPanel.classList.add(isCorrect ? "ok" : "bad");
  el.feedbackTitle.textContent = isCorrect ? "Correct" : "Not quite";
  el.feedbackExplanation.textContent = question.explanation || "No explanation provided in source data.";

  const contextText = state.contextByQuestionId[String(question.question_id)]?.trim();
  el.feedbackContext.textContent =
    contextText && contextText.length > 0
      ? contextText
      : "No generated context available yet for this question. Run scripts/generate_question_contexts.py and refresh.";
}

function handleNext() {
  if (!state.submitted) {
    return;
  }

  state.index += 1;
  renderQuestion();
}

function renderCompletion() {
  state.complete = true;
  const total = state.sessionQuestions.length;
  el.questionType.textContent = "Topic complete";
  el.questionText.textContent = `You finished ${total} questions.`;
  el.optionsForm.innerHTML = "";

  const summary = document.createElement("p");
  summary.textContent = `Final score: ${state.score}/${total}`;
  el.optionsForm.appendChild(summary);

  el.submitBtn.textContent = "Restart Topic";
  el.submitBtn.disabled = false;

  el.nextBtn.disabled = true;
  el.feedbackPanel.classList.add("hidden");
}

function updateProgress() {
  const total = state.sessionQuestions.length || 1;
  const current = Math.min(state.index + 1, total);
  const remaining = (state.sessionQuestions.length || 0) - state.answered;

  el.progressText.textContent = `Question ${current} / ${state.sessionQuestions.length || 0}`;
  el.scoreText.textContent = `Score: ${state.score} / ${state.answered}`;
  el.remainingText.textContent = `Remaining: ${remaining < 0 ? 0 : remaining}`;

  const pct = Math.max(0, Math.min(100, Math.round((state.answered / total) * 100)));
  el.progressFill.style.width = `${pct}%`;
}

function isSetEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function shuffleArray(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not fetch ${path}`);
  }
  return response.json();
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.addEventListener("DOMContentLoaded", init);
