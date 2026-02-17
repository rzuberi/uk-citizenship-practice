# UK Citizenship Practice (GitHub Pages)

This project is a static practice website for `britizen_life_in_uk_mcq_export.json`.

## What it does

- Topic-first practice flow (click topic, practice immediately).
- Topics are subdivided into sets (typically 20-30 questions, never above 30).
- Rapid answer/check/next loop.
- Shows progress, score, and **remaining questions**.
- Supports both single-answer and multi-select questions.
- Optional shuffle toggle.
- Previous-question side panel + previous button for back-navigation.
- Rapid Fire mode: 10 random questions with stopwatch.
- Typed-answer mode: exact wording (case-insensitive), with multi-answers separated by `.`.
- Shows source explanation and generated LLM context after each answer.

## Files

- `index.html`, `styles.css`, `app.js`: static frontend (GitHub Pages friendly)
- `britizen_life_in_uk_mcq_export.json`: question bank
- `question_contexts.json`: generated contexts keyed by `question_id`
- `scripts/generate_question_contexts.py`: one-time context generation pipeline using your HPC method

## Local run

```bash
cd /scratchc/fmlab/zuberi01/personal/uk-citizenship-practice
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Generate LLM context (same method as `hpc-llm`)

The generator calls `/scratchc/fmlab/zuberi01/phd/hpc-llm/bin/llm ask ...`, which is the same SLURM-backed Ollama flow in your `hpc-llm` repo.

### 1) Ensure `hpc-llm` is ready

```bash
cd /scratchc/fmlab/zuberi01/phd/hpc-llm
bash scripts/setup_env.sh
conda activate llm_ollama
bash scripts/install_ollama_user.sh
```

### 2) Generate contexts

From this project directory:

```bash
cd /scratchc/fmlab/zuberi01/personal/uk-citizenship-practice
python3 scripts/generate_question_contexts.py --model llama3.1:8b
```

Useful options:

```bash
# Quick test on 10 questions
python3 scripts/generate_question_contexts.py --limit 10

# Add retries for transient SLURM/Ollama failures
python3 scripts/generate_question_contexts.py --retries 2 --retry-delay 5

# Restrict to a topic
python3 scripts/generate_question_contexts.py --topic-id 1

# Override SLURM options passed through to llm ask
python3 scripts/generate_question_contexts.py \
  --partition cuda \
  --gres gpu:1 \
  --cpus-per-gpu 12 \
  --mem 64G \
  --time 00:15:00
```

The script is resumable. Re-run it and it skips already generated question IDs unless `--force` is used.

Monitor while running:

```bash
tail -f context_generation.log
jq '{contexts:(.contexts|length), errors:(.errors|length)}' question_contexts.json
```

## Deploy on GitHub Pages

1. Push this folder to a GitHub repo.
2. In repo settings, enable Pages from your target branch/folder.
3. Ensure these files are in the published root: `index.html`, `styles.css`, `app.js`, JSON files.
4. After deploy, open the Pages URL and practice by topic.
