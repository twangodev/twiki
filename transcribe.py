import argparse
import os

from click import style
from qwen_asr import Qwen3ASRModel
from tqdm import tqdm

AUDIO_EXTENSIONS = {".mp3", ".opus", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma"}


def find_recordings(root: str) -> list[str]:
    recordings = []
    for dirpath, _, filenames in os.walk(root):
        for f in filenames:
            name, ext = os.path.splitext(f)
            if name == "recording" and ext.lower() in AUDIO_EXTENSIONS:
                recordings.append(os.path.join(dirpath, f))
    recordings.sort()
    return recordings


def main():
    parser = argparse.ArgumentParser(description="Transcribe recording.* audio files using Qwen3 ASR (vLLM)")
    parser.add_argument("directory", nargs="?", default="content", help="Root directory to search recursively")
    parser.add_argument("--model", default="Qwen/Qwen3-ASR-1.7B", help="Model name or path")
    parser.add_argument("--language", default=None, help="Force language (e.g. English, Chinese)")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    recordings = find_recordings(args.directory)
    if not recordings:
        print(style(f"No recording files found in {args.directory}", fg="yellow"))
        return

    print(f"\n{style(f'Found {len(recordings)} recording(s):', fg='cyan', bold=True)}\n")
    for path in recordings:
        print(f"  {style('•', dim=True)} {path}")

    print(f"\n{style('Model:', dim=True)} {args.model}")
    if args.language:
        print(f"{style('Language:', dim=True)} {args.language}")
    print()

    if not args.yes:
        try:
            answer = input(style("Proceed with transcription? [Y/n] ", fg="yellow")).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{style('Aborted.', fg='red')}")
            return
        if answer and answer not in ("y", "yes"):
            print(style("Aborted.", fg="red"))
            return

    print(f"\n{style('Loading model...', dim=True)}")
    model = Qwen3ASRModel.from_pretrained(args.model, device_map="auto")
    print(f"{style('Model loaded.', fg='green')}\n")

    for path in tqdm(recordings, desc=style("Transcribing", fg="cyan"), unit="file"):
        tqdm.write(style(path, fg="cyan"))
        results = model.transcribe(audio=path, language=args.language)
        text = results[0].text.strip()
        tqdm.write(f"  {style(text, fg='green')}\n")


if __name__ == "__main__":
    main()