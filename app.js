const QUESTION_BANK_PATH = "./britizen_life_in_uk_mcq_export.json";
const CONTEXT_PATH = "./question_contexts.json";

const MIN_SET_SIZE = 20;
const MAX_SET_SIZE = 30;
const DEFAULT_SET_SIZE = 25;
const RAPID_FIRE_COUNT = 10;
const TIMER_INTERVAL_MS = 100;

const state = {
  questions: [],
  topics: [],
  contextByQuestionId: {},
  settings: {
    batchSize: DEFAULT_SET_SIZE,
    shuffle: true,
    answerMode: "choice",
  },
  mode: "topic",
  sessionAnswerMode: "choice",
  selectedTopic: null,
  selectedSetIndex: 0,
  selectedSetLabel: "",
  sessionQuestions: [],
  index: 0,
  answersByIndex: {},
  answered: 0,
  score: 0,
  complete: false,
  lastStart: null,
  timer: {
    running: false,
    startMs: 0,
    elapsedMs: 0,
    intervalId: null,
  },
};

const el = {
  topicView: document.getElementById("topic-view"),
  practiceView: document.getElementById("practice-view"),
  heroStats: document.getElementById("hero-stats"),
  contextStatus: document.getElementById("context-status"),
  topicGrid: document.getElementById("topic-grid"),
  batchSize: document.getElementById("batch-size"),
  shuffleToggle: document.getElementById("shuffle-toggle"),
  answerMode: document.getElementById("answer-mode"),
  rapidFireBtn: document.getElementById("rapid-fire-btn"),
  setupNote: document.getElementById("setup-note"),
  backBtn: document.getElementById("back-btn"),
  topicPill: document.getElementById("topic-pill"),
  practiceTitle: document.getElementById("practice-title"),
  progressText: document.getElementById("progress-text"),
  scoreText: document.getElementById("score-text"),
  remainingText: document.getElementById("remaining-text"),
  modeText: document.getElementById("mode-text"),
  timerText: document.getElementById("timer-text"),
  progressFill: document.getElementById("progress-fill"),
  questionType: document.getElementById("question-type"),
  questionText: document.getElementById("question-text"),
  optionsForm: document.getElementById("options-form"),
  typedWrap: document.getElementById("typed-answer-wrap"),
  typedLabel: document.getElementById("typed-answer-label"),
  typedInput: document.getElementById("typed-answer-input"),
  prevBtn: document.getElementById("prev-btn"),
  submitBtn: document.getElementById("submit-btn"),
  nextBtn: document.getElementById("next-btn"),
  feedbackPanel: document.getElementById("feedback-panel"),
  feedbackTitle: document.getElementById("feedback-title"),
  feedbackYourAnswer: document.getElementById("feedback-your-answer"),
  feedbackCorrectAnswer: document.getElementById("feedback-correct-answer"),
  feedbackExplanation: document.getElementById("feedback-explanation"),
  feedbackContext: document.getElementById("feedback-context"),
  previousEmpty: document.getElementById("previous-empty"),
  previousContent: document.getElementById("previous-content"),
  previousQuestionText: document.getElementById("previous-question-text"),
  previousUserAnswer: document.getElementById("previous-user-answer"),
  previousCorrectAnswer: document.getElementById("previous-correct-answer"),
  previousResult: document.getElementById("previous-result"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [bank, contextRaw] = await Promise.all([
      fetchJson(QUESTION_BANK_PATH),
      fetchJson(CONTEXT_PATH).catch(() => null),
    ]);

    state.questions = Array.isArray(bank.unique_questions) ? bank.unique_questions : [];
    state.topics = buildTopics(state.questions);

    bindEvents();
    renderHeroStats(bank);
    normalizeContexts(contextRaw);
    renderTopicGrid();
    updateSetupNote();
  } catch (error) {
    el.contextStatus.textContent = `Failed to load data: ${error.message}`;
  }
}

function bindEvents() {
  el.batchSize.addEventListener("change", handleBatchSizeChange);
  el.shuffleToggle.addEventListener("change", handleShuffleChange);
  el.answerMode.addEventListener("change", handleAnswerModeChange);
  el.rapidFireBtn.addEventListener("click", startRapidFire);

  el.backBtn.addEventListener("click", showTopicView);
  el.prevBtn.addEventListener("click", handlePrevious);
  el.submitBtn.addEventListener("click", handleSubmit);
  el.nextBtn.addEventListener("click", handleNext);
  el.typedInput.addEventListener("input", handleTypedInput);
}

function handleBatchSizeChange() {
  const parsed = Number(el.batchSize.value);
  state.settings.batchSize = clampBatchSize(parsed);
  renderTopicGrid();
  updateSetupNote();
}

function handleShuffleChange() {
  state.settings.shuffle = Boolean(el.shuffleToggle.checked);
}

function handleAnswerModeChange() {
  state.settings.answerMode = el.answerMode.value === "typed" ? "typed" : "choice";
  updateSetupNote();
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
    const chip = document.createElement("span");
    chip.className = "stat-chip";
    chip.textContent = text;
    el.heroStats.appendChild(chip);
  });
}

function normalizeContexts(raw) {
  if (!raw) {
    state.contextByQuestionId = {};
    el.contextStatus.textContent = "No context file found. Add question_contexts.json to load extra explanations.";
    return;
  }

  const input = raw.contexts && typeof raw.contexts === "object" ? raw.contexts : raw;
  const normalized = {};

  Object.entries(input).forEach(([qid, value]) => {
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
  const count = Object.values(normalized).filter((value) => String(value).trim() !== "").length;
  el.contextStatus.textContent = `Loaded context for ${count} question${count === 1 ? "" : "s"}.`;
}

function buildTopics(questions) {
  const byTopic = new Map();

  questions.forEach((question) => {
    const key = String(question.topic_id);
    if (!byTopic.has(key)) {
      byTopic.set(key, {
        topic_id: question.topic_id,
        topic_name: question.topic_name,
        questions: [],
      });
    }
    byTopic.get(key).questions.push(question);
  });

  return Array.from(byTopic.values()).sort((a, b) => b.questions.length - a.questions.length);
}

function updateSetupNote() {
  const modeLabel = state.settings.answerMode === "typed" ? "Typed exact answers" : "Multiple choice";
  el.setupNote.textContent = `Sets are auto-chunked to around ${MIN_SET_SIZE}-${MAX_SET_SIZE} questions (current target: ${state.settings.batchSize}) and never above ${MAX_SET_SIZE}. Answer mode for new sessions: ${modeLabel}.`;
}

function renderTopicGrid() {
  el.topicGrid.innerHTML = "";

  state.topics.forEach((topic) => {
    const subdivision = getTopicSubdivision(topic);
    const card = document.createElement("article");
    card.className = "topic-card";

    const title = document.createElement("h3");
    title.textContent = topic.topic_name;

    const meta = document.createElement("p");
    const methodText =
      subdivision.method === "existing"
        ? "Using existing subdivision from source quiz groups."
        : `Auto-subdivided into packs of up to ${state.settings.batchSize}.`;
    meta.className = "topic-meta";
    meta.textContent = `${topic.questions.length} questions | ${subdivision.sets.length} sets. ${methodText}`;

    const setRow = document.createElement("label");
    setRow.className = "set-row";

    const setLabel = document.createElement("span");
    setLabel.textContent = "Pick a set";

    const setSelect = document.createElement("select");
    setSelect.className = "set-select";

    subdivision.sets.forEach((setInfo, idx) => {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = `${setInfo.label} (${setInfo.questions.length} questions)`;
      setSelect.appendChild(option);
    });

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "primary-btn";
    startBtn.textContent = "Start Set";
    startBtn.addEventListener("click", () => {
      startTopicSet(topic.topic_id, Number(setSelect.value));
    });

    setRow.appendChild(setLabel);
    setRow.appendChild(setSelect);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(setRow);
    card.appendChild(startBtn);

    el.topicGrid.appendChild(card);
  });
}

function getTopicSubdivision(topic) {
  const existing = tryExistingSubdivision(topic.questions);
  if (existing) {
    return {
      method: "existing",
      sets: existing,
    };
  }

  return {
    method: "auto",
    sets: chunkQuestions(topic.questions, state.settings.batchSize),
  };
}

function tryExistingSubdivision(questions) {
  const grouped = new Map();

  for (const question of questions) {
    const slugs = Array.isArray(question.source_quiz_slugs) ? question.source_quiz_slugs : [];
    if (slugs.length !== 1) {
      return null;
    }

    const slug = String(slugs[0]).trim();
    if (slug === "") {
      return null;
    }

    if (!grouped.has(slug)) {
      grouped.set(slug, []);
    }
    grouped.get(slug).push(question);
  }

  const sets = Array.from(grouped.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([slug, list]) => ({
      id: `quiz-${slug}`,
      label: `Quiz ${slug}`,
      questions: list,
    }));

  if (sets.length < 2) {
    return null;
  }

  const allInRange = sets.every(
    (setInfo) =>
      setInfo.questions.length >= MIN_SET_SIZE && setInfo.questions.length <= MAX_SET_SIZE
  );

  if (!allInRange) {
    return null;
  }

  return sets;
}

function chunkQuestions(questions, preferredSize) {
  const size = clampBatchSize(preferredSize);
  const chunks = [];

  for (let start = 0; start < questions.length; start += size) {
    const end = Math.min(start + size, questions.length);
    chunks.push({
      id: `set-${chunks.length + 1}`,
      label: `Set ${chunks.length + 1}`,
      questions: questions.slice(start, end),
    });
  }

  return chunks;
}

function clampBatchSize(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SET_SIZE;
  }
  return Math.max(MIN_SET_SIZE, Math.min(MAX_SET_SIZE, Math.round(value)));
}

function startTopicSet(topicId, setIndex) {
  const topic = state.topics.find((entry) => String(entry.topic_id) === String(topicId));
  if (!topic) {
    return;
  }

  const subdivision = getTopicSubdivision(topic);
  const safeIndex = Math.max(0, Math.min(setIndex, subdivision.sets.length - 1));
  const setInfo = subdivision.sets[safeIndex];

  const baseQuestions = setInfo.questions.slice();
  const sessionQuestions = state.settings.shuffle ? shuffleArray(baseQuestions) : baseQuestions;

  state.mode = "topic";
  state.selectedTopic = topic;
  state.selectedSetIndex = safeIndex;
  state.selectedSetLabel = setInfo.label;
  state.lastStart = {
    type: "topic",
    topic_id: topic.topic_id,
    set_index: safeIndex,
  };

  beginSession({
    title: `Practice: ${topic.topic_name} | ${setInfo.label}`,
    pill: `${topic.topic_name} | ${setInfo.label}`,
    questions: sessionQuestions,
  });
}

function startRapidFire() {
  const shuffled = shuffleArray(state.questions.slice());
  const sessionQuestions = shuffled.slice(0, RAPID_FIRE_COUNT);

  state.mode = "rapid";
  state.selectedTopic = null;
  state.selectedSetIndex = 0;
  state.selectedSetLabel = "Rapid Fire";
  state.lastStart = {
    type: "rapid",
  };

  beginSession({
    title: `Rapid Fire: ${RAPID_FIRE_COUNT} Random Questions`,
    pill: "Rapid Fire",
    questions: sessionQuestions,
  });
}

function beginSession(config) {
  stopTimer();

  state.sessionQuestions = config.questions;
  state.sessionAnswerMode = state.settings.answerMode;
  state.index = 0;
  state.answersByIndex = {};
  state.answered = 0;
  state.score = 0;
  state.complete = false;

  el.topicView.classList.add("hidden");
  el.practiceView.classList.remove("hidden");

  el.practiceTitle.textContent = config.title;
  el.topicPill.textContent = config.pill;
  el.modeText.textContent =
    state.sessionAnswerMode === "typed"
      ? "Mode: typed exact answer"
      : "Mode: multiple choice";

  if (state.mode === "rapid") {
    startTimer();
    el.timerText.classList.remove("hidden");
  } else {
    el.timerText.classList.add("hidden");
    el.timerText.textContent = "";
  }

  renderQuestion();
}

function showTopicView() {
  stopTimer();
  el.practiceView.classList.add("hidden");
  el.topicView.classList.remove("hidden");
}

function startTimer() {
  state.timer.running = true;
  state.timer.startMs = Date.now();
  state.timer.elapsedMs = 0;

  if (state.timer.intervalId) {
    clearInterval(state.timer.intervalId);
  }

  state.timer.intervalId = setInterval(() => {
    updateTimerDisplay();
  }, TIMER_INTERVAL_MS);

  updateTimerDisplay();
}

function stopTimer() {
  if (state.timer.running) {
    state.timer.elapsedMs = Date.now() - state.timer.startMs;
  }
  state.timer.running = false;

  if (state.timer.intervalId) {
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
  }
}

function getElapsedMs() {
  if (state.timer.running) {
    return Date.now() - state.timer.startMs;
  }
  return state.timer.elapsedMs;
}

function updateTimerDisplay() {
  if (state.mode !== "rapid") {
    return;
  }
  el.timerText.textContent = `Time: ${formatDuration(getElapsedMs())}`;
}

function formatDuration(ms) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function renderQuestion() {
  const question = state.sessionQuestions[state.index];
  if (!question) {
    renderCompletion();
    return;
  }

  state.complete = false;

  const record = ensureAnswerRecord(state.index);
  const isMulti = isMultiSelect(question);

  el.questionType.textContent = questionTypeText(isMulti);
  el.questionText.textContent = question.question;

  renderAnswerInputs(question, record, isMulti);

  if (record.submitted) {
    showFeedback(question, record);
  } else {
    hideFeedback();
  }

  recomputeScore();
  updateProgress();
  updateActionButtons(record);
  updatePreviousPanel();

  if (state.mode === "rapid") {
    updateTimerDisplay();
  }
}

function questionTypeText(isMulti) {
  if (state.sessionAnswerMode === "typed") {
    if (isMulti) {
      return "Type both answers exactly and separate with a full stop";
    }
    return "Type the exact answer (case-insensitive)";
  }

  return isMulti ? "Select two answers" : "Select one answer";
}

function renderAnswerInputs(question, record, isMulti) {
  const submitted = Boolean(record.submitted);

  el.optionsForm.innerHTML = "";

  if (state.sessionAnswerMode === "choice") {
    renderChoiceInputs(question, record, isMulti, submitted);
    el.typedWrap.classList.add("hidden");
    return;
  }

  renderReadonlyOptionList(question, submitted);
  renderTypedInput(question, record, isMulti, submitted);
}

function renderChoiceInputs(question, record, isMulti, submitted) {
  const selectedIds = new Set((record.selectedOptionIds || []).map(String));
  const correctIds = new Set((question.correct_option_ids || []).map(String));
  const inputType = isMulti ? "checkbox" : "radio";

  question.possible_answers.forEach((option) => {
    const optionId = String(option.option_id);
    const row = document.createElement("label");
    row.className = "option-item";
    row.dataset.optionId = optionId;

    const input = document.createElement("input");
    input.type = inputType;
    input.name = `answer-${state.index}`;
    input.value = optionId;
    input.checked = selectedIds.has(optionId);
    input.disabled = submitted;

    input.addEventListener("change", () => {
      if (submitted) {
        return;
      }
      const draft = ensureAnswerRecord(state.index);
      let nextIds = Array.isArray(draft.selectedOptionIds) ? draft.selectedOptionIds.slice() : [];

      if (isMulti) {
        if (nextIds.includes(optionId)) {
          nextIds = nextIds.filter((item) => item !== optionId);
        } else {
          nextIds.push(optionId);
        }
      } else {
        nextIds = [optionId];
      }

      draft.selectedOptionIds = nextIds;
      updateChoiceSelectionStyles(new Set(nextIds.map(String)));
      updateActionButtons(draft);
    });

    const text = document.createElement("span");
    text.textContent = option.text;

    row.appendChild(input);
    row.appendChild(text);

    if (selectedIds.has(optionId)) {
      row.classList.add("selected");
    }

    if (submitted) {
      if (correctIds.has(optionId)) {
        row.classList.add("correct");
      } else if (selectedIds.has(optionId)) {
        row.classList.add("wrong");
      }
    }

    el.optionsForm.appendChild(row);
  });
}

function updateChoiceSelectionStyles(selectedIds) {
  Array.from(el.optionsForm.querySelectorAll(".option-item")).forEach((node) => {
    const optionId = node.dataset.optionId;
    node.classList.toggle("selected", selectedIds.has(optionId));
  });
}

function renderReadonlyOptionList(question, submitted) {
  const correctIds = new Set((question.correct_option_ids || []).map(String));

  question.possible_answers.forEach((option) => {
    const optionId = String(option.option_id);

    const row = document.createElement("div");
    row.className = "option-item readonly";

    if (submitted && correctIds.has(optionId)) {
      row.classList.add("correct");
    }

    const text = document.createElement("span");
    text.textContent = option.text;
    row.appendChild(text);

    el.optionsForm.appendChild(row);
  });
}

function renderTypedInput(question, record, isMulti, submitted) {
  el.typedWrap.classList.remove("hidden");

  if (isMulti) {
    el.typedLabel.textContent =
      "Type both answers exactly; separate them with a full stop. Example: Answer one. Answer two";
  } else {
    el.typedLabel.textContent = "Type the exact answer text. Capital letters are ignored.";
  }

  el.typedInput.value = record.typedAnswer || "";
  el.typedInput.disabled = submitted;
}

function handleTypedInput() {
  const question = state.sessionQuestions[state.index];
  if (!question || state.sessionAnswerMode !== "typed") {
    return;
  }

  const record = ensureAnswerRecord(state.index);
  if (record.submitted) {
    return;
  }

  record.typedAnswer = el.typedInput.value;
  updateActionButtons(record);
}

function ensureAnswerRecord(index) {
  if (!state.answersByIndex[index]) {
    state.answersByIndex[index] = {
      selectedOptionIds: [],
      typedAnswer: "",
      submitted: false,
      isCorrect: false,
      userAnswerDisplay: "",
      correctAnswerDisplay: "",
    };
  }

  return state.answersByIndex[index];
}

function isMultiSelect(question) {
  return Array.isArray(question.correct_option_ids) && question.correct_option_ids.length > 1;
}

function handleSubmit() {
  if (state.complete) {
    restartSession();
    return;
  }

  const question = state.sessionQuestions[state.index];
  if (!question) {
    return;
  }

  const record = ensureAnswerRecord(state.index);
  if (record.submitted || !hasDraftAnswer(record)) {
    return;
  }

  const evaluation = evaluateAnswer(question, record);

  record.submitted = true;
  record.isCorrect = evaluation.isCorrect;
  record.userAnswerDisplay = evaluation.userAnswerDisplay;
  record.correctAnswerDisplay = evaluation.correctAnswerDisplay;

  recomputeScore();
  renderQuestion();
}

function hasDraftAnswer(record) {
  if (state.sessionAnswerMode === "typed") {
    return String(record.typedAnswer || "").trim() !== "";
  }
  return Array.isArray(record.selectedOptionIds) && record.selectedOptionIds.length > 0;
}

function evaluateAnswer(question, record) {
  if (state.sessionAnswerMode === "typed") {
    return evaluateTypedAnswer(question, record.typedAnswer || "");
  }
  return evaluateChoiceAnswer(question, record.selectedOptionIds || []);
}

function evaluateChoiceAnswer(question, selectedOptionIds) {
  const correctIds = new Set((question.correct_option_ids || []).map(String));
  const selectedIds = new Set(selectedOptionIds.map(String));
  const isCorrect = isSetEqual(correctIds, selectedIds);

  return {
    isCorrect,
    userAnswerDisplay: formatChoiceAnswer(question, selectedOptionIds),
    correctAnswerDisplay: (question.correct_answers || []).join(". "),
  };
}

function evaluateTypedAnswer(question, typedAnswer) {
  const isMulti = isMultiSelect(question);
  const rawParts = parseTypedParts(typedAnswer, isMulti);
  const normalizedParts = rawParts.map(normalizeAnswerText).filter((part) => part !== "");

  const expectedRaw = Array.isArray(question.correct_answers) ? question.correct_answers : [];
  const expectedNormalized = expectedRaw.map(normalizeAnswerText).filter((part) => part !== "");

  let isCorrect = false;

  if (isMulti) {
    if (normalizedParts.length === expectedNormalized.length) {
      isCorrect = isSetEqual(new Set(normalizedParts), new Set(expectedNormalized));
    }
  } else {
    isCorrect = normalizedParts.length === 1 && normalizedParts[0] === (expectedNormalized[0] || "");
  }

  return {
    isCorrect,
    userAnswerDisplay: typedAnswer.trim() === "" ? "(blank)" : typedAnswer.trim(),
    correctAnswerDisplay: expectedRaw.join(". "),
  };
}

function parseTypedParts(input, isMulti) {
  const raw = String(input || "").trim();
  if (raw === "") {
    return [];
  }

  if (!isMulti) {
    return [raw];
  }

  return raw
    .split(".")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function normalizeAnswerText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function handleNext() {
  if (state.complete) {
    return;
  }

  const record = ensureAnswerRecord(state.index);
  if (!record.submitted) {
    return;
  }

  state.index += 1;
  renderQuestion();
}

function handlePrevious() {
  if (state.complete && state.index >= state.sessionQuestions.length) {
    state.index = Math.max(0, state.sessionQuestions.length - 1);
    renderQuestion();
    return;
  }

  if (state.index <= 0) {
    return;
  }

  state.index -= 1;
  renderQuestion();
}

function restartSession() {
  if (!state.lastStart) {
    return;
  }

  if (state.lastStart.type === "rapid") {
    startRapidFire();
    return;
  }

  startTopicSet(state.lastStart.topic_id, state.lastStart.set_index || 0);
}

function renderCompletion() {
  state.complete = true;
  stopTimer();
  recomputeScore();
  updateProgress();
  updatePreviousPanel();

  const total = state.sessionQuestions.length;
  const finalTime = state.mode === "rapid" ? ` | Time: ${formatDuration(getElapsedMs())}` : "";

  el.questionType.textContent = state.mode === "rapid" ? "Rapid fire complete" : "Set complete";
  el.questionText.textContent = `Final score: ${state.score}/${total}${finalTime}`;

  el.optionsForm.innerHTML = "";
  el.typedWrap.classList.add("hidden");

  hideFeedback();

  el.prevBtn.disabled = total === 0;
  el.submitBtn.disabled = false;
  el.submitBtn.textContent = state.mode === "rapid" ? "Try Rapid Fire Again" : "Restart This Set";

  el.nextBtn.disabled = true;
  el.nextBtn.textContent = "Next Question";

  if (state.mode === "rapid") {
    el.timerText.classList.remove("hidden");
    updateTimerDisplay();
  }
}

function updateActionButtons(record) {
  if (state.complete) {
    return;
  }

  const submitted = Boolean(record.submitted);
  const isLast = state.index >= state.sessionQuestions.length - 1;

  el.prevBtn.disabled = state.index <= 0;

  el.submitBtn.textContent = "Check Answer";
  el.submitBtn.disabled = submitted || !hasDraftAnswer(record);

  el.nextBtn.textContent = isLast ? "Finish" : "Next Question";
  el.nextBtn.disabled = !submitted;
}

function showFeedback(question, record) {
  el.feedbackPanel.classList.remove("hidden", "ok", "bad");
  el.feedbackPanel.classList.add(record.isCorrect ? "ok" : "bad");

  el.feedbackTitle.textContent = record.isCorrect ? "Correct" : "Not quite";
  el.feedbackYourAnswer.textContent = `Your answer: ${record.userAnswerDisplay || "(blank)"}`;
  el.feedbackCorrectAnswer.textContent = `Correct answer: ${record.correctAnswerDisplay || "-"}`;
  el.feedbackExplanation.textContent = question.explanation || "No explanation provided in source data.";

  const contextText = String(state.contextByQuestionId[String(question.question_id)] || "").trim();
  el.feedbackContext.textContent =
    contextText !== ""
      ? contextText
      : "No generated context available for this question.";
}

function hideFeedback() {
  el.feedbackPanel.classList.add("hidden");
  el.feedbackPanel.classList.remove("ok", "bad");
}

function updatePreviousPanel() {
  let previousIndex = state.index - 1;

  if (state.complete && state.index >= state.sessionQuestions.length) {
    previousIndex = state.sessionQuestions.length - 1;
  }

  if (previousIndex < 0) {
    showPreviousEmpty();
    return;
  }

  const question = state.sessionQuestions[previousIndex];
  const record = state.answersByIndex[previousIndex];

  if (!question || !record || !record.submitted) {
    showPreviousEmpty();
    return;
  }

  el.previousEmpty.classList.add("hidden");
  el.previousContent.classList.remove("hidden");

  el.previousQuestionText.textContent = question.question;
  el.previousUserAnswer.textContent = record.userAnswerDisplay || "(blank)";
  el.previousCorrectAnswer.textContent = record.correctAnswerDisplay || (question.correct_answers || []).join(". ");

  el.previousResult.textContent = record.isCorrect ? "Result: Correct" : "Result: Not quite";
  el.previousResult.classList.remove("ok", "bad");
  el.previousResult.classList.add(record.isCorrect ? "ok" : "bad");
}

function showPreviousEmpty() {
  el.previousEmpty.classList.remove("hidden");
  el.previousContent.classList.add("hidden");
  el.previousResult.classList.remove("ok", "bad");
}

function recomputeScore() {
  const entries = Object.values(state.answersByIndex);
  state.answered = entries.filter((entry) => entry.submitted).length;
  state.score = entries.filter((entry) => entry.submitted && entry.isCorrect).length;
}

function updateProgress() {
  const total = state.sessionQuestions.length;
  const safeTotal = total === 0 ? 1 : total;
  const current = state.complete
    ? total
    : Math.min(state.index + 1, total);

  const remaining = Math.max(0, total - state.answered);

  el.progressText.textContent = `Question ${current} / ${total}`;
  el.scoreText.textContent = `Score: ${state.score} / ${state.answered}`;
  el.remainingText.textContent = `Remaining: ${remaining}`;

  const pct = Math.max(0, Math.min(100, Math.round((state.answered / safeTotal) * 100)));
  el.progressFill.style.width = `${pct}%`;
}

function formatChoiceAnswer(question, selectedOptionIds) {
  if (!Array.isArray(selectedOptionIds) || selectedOptionIds.length === 0) {
    return "(blank)";
  }

  const byId = new Map(
    (question.possible_answers || []).map((option) => [String(option.option_id), option.text])
  );

  const parts = selectedOptionIds
    .map((id) => byId.get(String(id)))
    .filter((value) => typeof value === "string" && value.trim() !== "");

  if (parts.length === 0) {
    return "(blank)";
  }

  return parts.join(". ");
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
  for (let idx = list.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
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
