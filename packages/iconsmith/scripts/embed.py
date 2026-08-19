#!/usr/bin/env python3
"""Batch embedding sidecar stage. Deliberately outside `dependencies`.

Style and semantic fidelity need a vision model; a vision model needs PyTorch,
and `npm install` has to keep working on a machine with no Python at all. So the
runtime lives here, is run by hand, and writes fixed-width `.f32` files beside
the record store in the format `src/corpus/build.ts` already uses. `src/eval/`
reads them if they exist and reports `null` if they do not.

Three sidecars, three jobs:

    --images    DINO ViT-B/8 CLS  → appearance, for the style metric
    --images    SigLIP image      → the image half of semantic fidelity
    --concepts  SigLIP text       → the 2,201-concept bank, embedded once

Rows are L2-normalised at write time, so every consumer treats a dot product as
a cosine and an un-normalised file is detectable rather than silently wrong. The
JSON index beside each `.f32` carries the row order as ids, the model, the
dimension and the date; `src/eval/vectors.ts` refuses a pair whose byte count
and row count disagree.

Rendering here is **not** `src/tools/render.ts`. That module's SIZE=48,
BLUR=1.6, density 200 and `currentColor → #000` are calibrated against the 0.737
cross-set cosine baseline, and changing any of them silently invalidates every
score the project has produced. These models want 224px RGB with no blur, which
is a different rendering for a different question. The one convention shared
deliberately is `currentColor → #000` on white: an SVG whose colour never
resolves renders blank, and a batch of blank images embeds to a tight cluster
that looks like excellent style agreement.

Setup — a throwaway environment, never a package dependency:

    uv venv .scratch/venv --python 3.12
    VIRTUAL_ENV=.scratch/venv uv pip install torch torchvision transformers \
        pillow numpy sentencepiece protobuf
    brew install librsvg          # or: uv pip install cairosvg

`.scratch/` is gitignored, and nothing in `package.json` references any of this.
On a machine without it, `src/eval/` finds no sidecars and reports `null`.

Usage:

    python3 scripts/embed.py --model dino \
        --svg-dir <dir> --out .corpus/style
    python3 scripts/embed.py --model siglip-image \
        --svg-dir <dir> --out .corpus/semantic-image
    python3 scripts/embed.py --model siglip-text \
        --concepts <_concepts.json> --out .corpus/semantic-text

`--svg-dir` may be given more than once; ids are `<dirname>/<stem>` so two packs
can share one sidecar without colliding. `--manifest` takes a JSON list of
`{"id": ..., "path": ...}` instead, for the case where the id is a record id
rather than a filename.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import subprocess
import sys
from pathlib import Path

DINO = "facebook/dino-vitb8"
SIGLIP = "google/siglip-base-patch16-224"

# Kept byte-identical to `CONCEPT_PROMPT` in src/eval/semantic.ts. A text
# sidecar written under one template and read against a calibration measured
# under another is the failure with no symptom: every number stays in range and
# every one is wrong by an unknown amount.
CONCEPT_PROMPT = "a simple black line icon of {}"

RENDER_PX = 224


def as_tensor(out):
    """SigLIP's `get_*_features` returns a tensor on some transformers versions
    and a `BaseModelOutputWithPooling` on others. Unwrapping here rather than
    pinning a version keeps the sidecar reproducible across a `uv pip install`
    six months from now."""
    return out if hasattr(out, "cpu") else out.pooler_output


def render_png(svg: str, px: int = RENDER_PX) -> bytes:
    """SVG → RGB PNG on white, via rsvg-convert or cairosvg.

    `currentColor` is pinned to black first. An icon whose colour never
    resolves renders blank, and a batch of blank images embeds to a very tight
    cluster — which reads as excellent style agreement rather than as a bug.
    """
    svg = svg.replace("currentColor", "#000")
    try:
        import cairosvg  # type: ignore

        return cairosvg.svg2png(
            bytestring=svg.encode(),
            output_width=px,
            output_height=px,
            background_color="white",
        )
    except ImportError:
        pass
    proc = subprocess.run(
        ["rsvg-convert", "-w", str(px), "-h", str(px), "-b", "white"],
        input=svg.encode(),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(
            "Neither cairosvg nor rsvg-convert could render an SVG.\n"
            "  pip install cairosvg    (into this script's venv)\n"
            "  brew install librsvg\n"
            f"rsvg-convert said: {proc.stderr.decode()[:400]}"
        )
    return proc.stdout


def collect(args) -> list[tuple[str, Path]]:
    """The (id, path) list to embed, in a stable order."""
    if args.manifest:
        entries = json.loads(Path(args.manifest).read_text())
        return [(e["id"], Path(e["path"])) for e in entries]
    out: list[tuple[str, Path]] = []
    for directory in args.svg_dir:
        root = Path(directory)
        prefix = args.prefix or root.name
        for path in sorted(root.rglob("*.svg")):
            out.append((f"{prefix}/{path.stem}", path))
    return out


def write_sidecar(out: str, ids: list[str], rows, model: str) -> None:
    """`<out>.f32` plus `<out>.json`, matching src/eval/vectors.ts."""
    import numpy as np

    matrix = np.asarray(rows, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    # A zero row cannot be normalised, and dividing by zero would write NaNs
    # that turn every cosine against them into NaN. It should not happen — a
    # blank render still has a non-zero CLS — so it is loud rather than nudged.
    if (norms == 0).any():
        blanks = [ids[i] for i in (norms[:, 0] == 0).nonzero()[0]]
        raise SystemExit(f"zero-length embedding for: {blanks[:5]}")
    matrix = matrix / norms
    Path(f"{out}.f32").write_bytes(matrix.tobytes())
    Path(f"{out}.json").write_text(
        json.dumps(
            {
                "builtAt": _dt.datetime.now(_dt.UTC).isoformat(),
                "dim": int(matrix.shape[1]),
                "ids": ids,
                "model": model,
                "normalised": True,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"{out}.f32 — {matrix.shape[0]} rows × {matrix.shape[1]} ({model})")


def embed_images(kind: str, items: list[tuple[str, Path]], batch: int):
    import io

    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, AutoModel

    name = DINO if kind == "dino" else SIGLIP
    processor = AutoImageProcessor.from_pretrained(name)
    model = AutoModel.from_pretrained(name).eval()

    rows = []
    for start in range(0, len(items), batch):
        chunk = items[start : start + batch]
        images = [
            Image.open(io.BytesIO(render_png(p.read_text()))).convert("RGB")
            for _, p in chunk
        ]
        inputs = processor(images=images, return_tensors="pt")
        with torch.no_grad():
            if kind == "dino":
                # CLS token, not the patch mean: the CLS is what DINO's
                # self-distillation objective actually shapes, and it is the
                # representation every DINO-similarity result is reported on.
                out = model(**inputs).last_hidden_state[:, 0]
            else:
                out = as_tensor(model.get_image_features(**inputs))
        rows.extend(out.cpu().numpy())
        print(f"  {min(start + batch, len(items))}/{len(items)}", file=sys.stderr)
    return rows, name


def embed_text(concepts: list[str], batch: int):
    import torch
    from transformers import AutoModel, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(SIGLIP)
    model = AutoModel.from_pretrained(SIGLIP).eval()
    rows = []
    for start in range(0, len(concepts), batch):
        chunk = concepts[start : start + batch]
        prompts = [CONCEPT_PROMPT.format(c.replace("-", " ")) for c in chunk]
        inputs = tokenizer(
            prompts, padding="max_length", truncation=True, return_tensors="pt"
        )
        with torch.no_grad():
            rows.extend(as_tensor(model.get_text_features(**inputs)).cpu().numpy())
        print(f"  {min(start + batch, len(concepts))}/{len(concepts)}", file=sys.stderr)
    return rows, SIGLIP


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True, choices=["dino", "siglip-image", "siglip-text"])
    ap.add_argument("--svg-dir", action="append", default=[])
    ap.add_argument("--manifest", help="JSON list of {id, path}")
    ap.add_argument("--prefix", help="id prefix; defaults to the directory name")
    ap.add_argument("--concepts", help="_concepts.json, for siglip-text")
    ap.add_argument("--out", required=True, help="path without extension")
    ap.add_argument("--batch", type=int, default=32)
    args = ap.parse_args()

    if args.model == "siglip-text":
        if not args.concepts:
            ap.error("--concepts is required for siglip-text")
        bank = json.loads(Path(args.concepts).read_text())["concepts"]
        concepts = sorted(bank)
        rows, name = embed_text(concepts, args.batch)
        write_sidecar(args.out, concepts, rows, name)
        return

    items = collect(args)
    if not items:
        ap.error("no SVGs found; pass --svg-dir or --manifest")
    rows, name = embed_images(
        "dino" if args.model == "dino" else "siglip", items, args.batch
    )
    write_sidecar(args.out, [i for i, _ in items], rows, name)


if __name__ == "__main__":
    main()
