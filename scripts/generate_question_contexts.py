#!/usr/bin/env python3
"""Generate per-question learning context using the external hpc-llm CLI.

This intentionally uses the same method as /scratchc/fmlab/zuberi01/phd/hpc-llm:
`bin/llm ask ...` (which submits SLURM jobs and runs Ollama on GPU nodes).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import textwrap
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    default_questions = root / "britizen_life_in_uk_mcq_export.json"
    default_output = root / "question_contexts.json"

    parser = argparse.ArgumentParser(
        description="Generate learning context for each question via hpc-llm llm ask."
    )
    parser.add_argument("--questions", type=Path, default=default_questions)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument(
        "--llm-bin",
        type=Path,
        default=Path("/scratchc/fmlab/zuberi01/phd/hpc-llm/bin/llm"),
        help="Path to hpc-llm bin/llm entrypoint.",
    )
    parser.add_argument(
        "--conda-cmd",
        type=Path,
        default=None,
        help="Explicit conda executable to use with conda run (autodetected if unset).",
    )
    parser.add_argument(
        "--conda-run-env",
        default="llm_ollama",
        help="Conda env used to run llm ask. Set empty string to skip conda run prefix.",
    )
    parser.add_argument("--model", default="llama3.1:8b")
    parser.add_argument("--system", default="")
    parser.add_argument("--partition", default=None)
    parser.add_argument("--gres", default=None)
    parser.add_argument("--cpus-per-gpu", type=int, default=None)
    parser.add_argument("--mem", default=None)
    parser.add_argument("--time", default=None)
    parser.add_argument("--conda-env", default=None)
    parser.add_argument("--poll-interval", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--topic-id", type=int, action="append", default=[])
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.0)
    parser.add_argument("--retries", type=int, default=1, help="Retry count per question after a failure.")
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=2.0,
        help="Seconds to wait before retrying a failed question attempt.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def find_conda_cmd(explicit_path: Optional[Path]) -> Optional[Path]:
    if explicit_path is not None:
        return explicit_path if explicit_path.exists() else None

    path_conda = os.getenv("PATH", "")
    for folder in path_conda.split(":"):
        candidate = Path(folder) / "conda"
        if candidate.exists() and candidate.is_file() and os.access(str(candidate), os.X_OK):
            return candidate

    home = Path.home()
    candidates = [
        home / "miniforge3/bin/conda",
        home / "miniforge3/condabin/conda",
        home / "mambaforge/bin/conda",
        home / "mambaforge/condabin/conda",
        home / "anaconda3/bin/conda",
        home / "miniconda3/bin/conda",
        Path("/Users") / home.name / "miniforge3/bin/conda",
        Path("/Users") / home.name / "miniforge3/condabin/conda",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file() and os.access(str(candidate), os.X_OK):
            return candidate
    return None


def build_launcher_prefix(args: argparse.Namespace) -> List[str]:
    env_name = str(args.conda_run_env or "").strip()
    if env_name == "":
        return []

    conda_cmd = find_conda_cmd(args.conda_cmd)
    if conda_cmd is None:
        return []
    return [str(conda_cmd), "run", "-n", env_name]


def load_questions(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    questions = payload.get("unique_questions")
    if not isinstance(questions, list):
        raise ValueError("Input JSON missing unique_questions[]")
    return questions


def load_output(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {
            "meta": {
                "generated_at_utc": None,
                "generator": "scripts/generate_question_contexts.py",
                "method": "hpc-llm llm ask (SLURM-backed Ollama)",
            },
            "contexts": {},
            "errors": {},
        }

    existing = json.loads(path.read_text(encoding="utf-8"))
    if "contexts" not in existing or not isinstance(existing["contexts"], dict):
        existing["contexts"] = {}
    if "errors" not in existing or not isinstance(existing["errors"], dict):
        existing["errors"] = {}
    if "meta" not in existing or not isinstance(existing["meta"], dict):
        existing["meta"] = {}
    return existing


def write_output(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_prompt(question: Dict[str, Any]) -> str:
    option_lines = []
    for idx, option in enumerate(question.get("possible_answers", []), start=1):
        option_lines.append(f"{idx}. {option.get('text', '').strip()}")

    correct_answers = ", ".join(question.get("correct_answers", []))
    is_multi = len(question.get("correct_option_ids", [])) > 1
    pick_hint = "This is multi-select (two answers)." if is_multi else "This is single-answer MCQ."

    return textwrap.dedent(
        f"""
        Create concise learning context for a UK citizenship practice question.

        Question ID: {question.get('question_id')}
        Topic: {question.get('topic_name', '').strip()}
        {pick_hint}
        Question: {question.get('question', '').strip()}

        Options:
        {chr(10).join(option_lines)}

        Correct answer(s): {correct_answers}
        Official explanation:
        {question.get('explanation', '').strip()}

        Write a learner-friendly context in plain text:
        - 2-4 short bullet points.
        - Explain why the correct answer(s) are right.
        - Mention one common confusion to avoid.
        - Add one memory hook.
        Keep it under 130 words.
        """
    ).strip()


def run_llm_ask(prompt: str, args: argparse.Namespace, launcher_prefix: List[str]) -> Tuple[str, Optional[str]]:
    cmd = launcher_prefix + [str(args.llm_bin), "ask", prompt, "--model", args.model]

    if args.system:
        cmd.extend(["--system", args.system])
    else:
        cmd.append("--no-system")

    if args.partition:
        cmd.extend(["--partition", args.partition])
    if args.gres:
        cmd.extend(["--gres", args.gres])
    if args.cpus_per_gpu is not None:
        cmd.extend(["--cpus-per-gpu", str(args.cpus_per_gpu)])
    if args.mem:
        cmd.extend(["--mem", args.mem])
    if args.time:
        cmd.extend(["--time", args.time])
    if args.conda_env:
        cmd.extend(["--conda-env", args.conda_env])
    if args.poll_interval is not None:
        cmd.extend(["--poll-interval", str(args.poll_interval)])

    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        check=False,
    )

    if proc.returncode != 0:
        details = proc.stderr.strip() or proc.stdout.strip() or "Unknown llm ask failure"
        raise RuntimeError(details)

    run_dir = None
    match = re.search(r"Run dir:\s*(.+)", proc.stderr)
    if match:
        run_dir = match.group(1).strip()

    answer = proc.stdout.strip()
    if not answer:
        raise RuntimeError("llm ask returned empty answer")
    return answer, run_dir


def pick_questions(
    all_questions: List[Dict[str, Any]], args: argparse.Namespace, contexts: Dict[str, Any]
) -> List[Dict[str, Any]]:
    result = []
    wanted_topics = set(args.topic_id or [])

    for question in sorted(all_questions, key=lambda item: int(item.get("question_id", 0))):
        qid = str(question.get("question_id"))

        if wanted_topics and question.get("topic_id") not in wanted_topics:
            continue
        if not args.force and qid in contexts and str(contexts[qid]).strip() != "":
            continue

        result.append(question)

    if args.limit is not None:
        return result[: max(0, args.limit)]
    return result


def main() -> int:
    args = parse_args()
    if args.retries < 0:
        print("ERROR: --retries must be >= 0", file=sys.stderr)
        return 1
    if args.retry_delay < 0:
        print("ERROR: --retry-delay must be >= 0", file=sys.stderr)
        return 1

    if not args.questions.exists():
        print(f"ERROR: questions file not found: {args.questions}", file=sys.stderr)
        return 1
    if not args.llm_bin.exists():
        print(f"ERROR: llm binary not found: {args.llm_bin}", file=sys.stderr)
        return 1

    launcher_prefix = build_launcher_prefix(args)
    if str(args.conda_run_env or "").strip() != "" and not launcher_prefix:
        print(
            "WARN: conda not found; running llm ask without conda run prefix.",
            file=sys.stderr,
        )

    output = load_output(args.output)
    all_questions = load_questions(args.questions)
    todo = pick_questions(all_questions, args, output["contexts"])

    print(f"Questions queued for context generation: {len(todo)}")
    if args.dry_run:
        return 0

    for index, question in enumerate(todo, start=1):
        qid = str(question.get("question_id"))
        print(f"[{index}/{len(todo)}] Generating context for question_id={qid}")

        try:
            prompt = build_prompt(question)
            max_attempts = args.retries + 1
            attempt = 0
            last_error = None
            answer = None
            run_dir = None

            while attempt < max_attempts:
                attempt += 1
                try:
                    answer, run_dir = run_llm_ask(prompt, args, launcher_prefix)
                    last_error = None
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if attempt < max_attempts:
                        print(
                            f"  WARN: attempt {attempt}/{max_attempts} failed: {exc}. Retrying...",
                            file=sys.stderr,
                        )
                        if args.retry_delay > 0:
                            time.sleep(args.retry_delay)

            if last_error is not None:
                raise last_error

            output["contexts"][qid] = {
                "question_id": question.get("question_id"),
                "topic_id": question.get("topic_id"),
                "topic_name": question.get("topic_name"),
                "model": args.model,
                "generated_at_utc": utc_now(),
                "context": answer,
                "run_dir": run_dir,
            }
            if qid in output["errors"]:
                del output["errors"][qid]

        except Exception as exc:  # noqa: BLE001
            output["errors"][qid] = {
                "question_id": question.get("question_id"),
                "topic_id": question.get("topic_id"),
                "topic_name": question.get("topic_name"),
                "error": str(exc),
                "attempted_at_utc": utc_now(),
            }
            print(f"  ERROR: {exc}", file=sys.stderr)

        output["meta"]["generated_at_utc"] = utc_now()
        output["meta"]["model"] = args.model
        output["meta"]["questions_file"] = str(args.questions)
        output["meta"]["llm_bin"] = str(args.llm_bin)
        output["meta"]["launcher_prefix"] = launcher_prefix
        output["meta"]["conda_run_env"] = str(args.conda_run_env or "").strip()
        output["meta"]["method"] = "hpc-llm llm ask (SLURM-backed Ollama)"
        write_output(args.output, output)

        if args.sleep > 0:
            time.sleep(args.sleep)

    print("Finished. Output written to", args.output)
    print(
        "Generated:",
        len(output["contexts"]),
        "| Errors:",
        len(output["errors"]),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
