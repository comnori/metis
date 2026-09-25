"""PRE-02 fixture preparation; standard library only, not an AsciiDoc parser."""

import argparse
import hashlib
import json
import platform
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "docs" / "fixtures" / "pre-02"
RUNS = ROOT / ".pre02-runs"
SIZES = {"small": (100, 100), "medium": (1000, 1000), "large": (5000, 10000)}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(folder):
    return {p.relative_to(folder).as_posix(): digest(p)
            for p in sorted(folder.rglob("*")) if p.is_file()}


def new_run(destination):
    target = Path(destination).resolve()
    require(target.is_relative_to(RUNS.resolve()) and target != RUNS.resolve(),
            "Destination must be a new child of the repository .pre02-runs directory")
    require(not target.exists(), "Destination already exists; use a fresh run name")
    target.mkdir(parents=True)
    return target


def source_edges(workspace):
    """Inspect only this corpus's simple macros, ignoring literal source blocks.

    Does not resolve attributes, tags, conditions or general AsciiDoc semantics.
    """
    refs, includes = [], []
    for source in sorted(workspace.rglob("*.adoc")):
        literal = False
        for line in source.read_text(encoding="utf-8-sig").splitlines():
            if line == "----":
                literal = not literal
                continue
            if literal or line.startswith("//"):
                continue
            for match in re.finditer(r"(xref:|include::)([^\[]+)\[", line):
                kind, raw = match.groups()
                path, _, anchor = raw.partition("#")
                target = (source.parent / path).resolve()
                require(target.is_relative_to(workspace.resolve()), "Unexpected external target")
                require(target.is_file(), f"Missing normal target: {target}")
                pair = [source.relative_to(workspace).as_posix(),
                        target.relative_to(workspace).as_posix()]
                if kind == "xref:":
                    require(not anchor or f"[[{anchor}]]" in target.read_text(encoding="utf-8"),
                            f"Missing normal anchor: {anchor}")
                    refs.append(pair + [anchor])
                else:
                    includes.append(pair)
    return sorted(refs), sorted(includes)


def verify():
    expected = json.loads((FIXTURES / "expectations.json").read_text(encoding="utf-8"))
    workspace = FIXTURES / "workspace"
    refs, includes = source_edges(workspace)
    require(refs == sorted(expected["references"]), "Reference ground truth mismatch")
    require(includes == sorted(expected["includes"]), "Include ground truth mismatch")
    require(sorted(r[0] for r in refs if r[1] == "domain/aggregate.adoc") ==
            expected["backlinks_to_aggregate"], "Backlink ground truth mismatch")
    for token, wanted in expected["search"].items():
        found = sorted(p.relative_to(workspace).as_posix() for p in workspace.rglob("*.adoc")
                       if token in p.read_text(encoding="utf-8"))
        require(found == wanted, f"Search ground truth mismatch: {token}")
    errors = FIXTURES / "errors"
    require(sorted(p.name for p in errors.iterdir()) == sorted(expected["intentional_cases"]),
            "Intentional error inventory mismatch")
    require(not (errors / "absent.adoc").exists(), "Missing-file fixture no longer missing")
    require(not (errors / "absent-component.adoc").exists(), "Missing-include fixture changed")
    require("[[absent-anchor]]" not in (workspace / "domain/aggregate.adoc").read_text(),
            "Missing anchor unexpectedly exists")
    require((errors / "duplicate-anchor.adoc").read_text().count("[[duplicate]]") == 2,
            "Duplicate-anchor fixture changed")
    require("include::cycle-b.adoc[]" in (errors / "cycle-a.adoc").read_text() and
            "include::cycle-a.adoc[]" in (errors / "cycle-b.adoc").read_text(), "Cycle changed")
    require((errors / "incomplete.adoc").read_text().splitlines().count("----") == 1,
            "Incomplete source block changed")
    policy = (workspace / "shared/policy.adoc").read_text()
    require(policy.count("// tag::policy[]") == policy.count("// end::policy[]") == 1,
            "Tag markers changed")
    require("POLICY-OUTSIDE-TAG-6123" in policy.split("// end::policy[]")[1],
            "Tag exclusion marker moved")
    from xml.etree import ElementTree
    ElementTree.parse(workspace / "assets/workspace.svg")
    return {"kind": "fixture_integrity_only", "python": platform.python_version(),
            "platform": platform.system(), "normal_documents": len(list(workspace.rglob("*.adoc"))),
            "references": len(refs), "includes": len(includes),
            "intentional_error_files": len(expected["intentional_cases"]),
            "source_sha256": inventory(FIXTURES),
            "not_run": ["AsciiDoc rendering", "Metis product scenarios", "performance acceptance"]}


def prepare(destination):
    verify()
    target = new_run(destination)
    for folder in ("workspace", "errors", "boundary"):
        shutil.copytree(FIXTURES / folder, target / folder)
    variants = target / "workspace" / "roundtrip"
    variants.mkdir()
    text = "= Round trip\n\n한글 café 보존  \n"
    (variants / "utf8-lf.adoc").write_bytes(text.encode("utf-8"))
    (variants / "utf8-bom-crlf.adoc").write_bytes(b"\xef\xbb\xbf" + text.replace("\n", "\r\n").encode("utf-8"))
    (variants / "no-final-newline.adoc").write_bytes(text.rstrip("\n").encode("utf-8"))
    (variants / "공백 문서.adoc").write_bytes(text.encode("utf-8"))
    (target / "empty-workspace").mkdir()
    baseline = inventory(target)
    write_json(target / "baseline.json", baseline)
    return {"kind": "prepared_copy", "destination": target.relative_to(ROOT).as_posix(),
            "files": len(baseline), "baseline_verified": inventory_without_manifest(target) == baseline}


def inventory_without_manifest(folder):
    return {k: v for k, v in inventory(folder).items() if k != "baseline.json"}


def compare(destination):
    target = Path(destination).resolve()
    require(target.is_relative_to(RUNS.resolve()), "Comparison requires a run directory")
    before = json.loads((target / "baseline.json").read_text(encoding="utf-8"))
    after = inventory_without_manifest(target)
    return {"changed": sorted(k for k in before.keys() & after.keys() if before[k] != after[k]),
            "added": sorted(after.keys() - before.keys()), "deleted": sorted(before.keys() - after.keys())}


def scale(destination, size):
    target = new_run(destination)
    count, sections = SIZES[size]
    nodes = target / "nodes"
    nodes.mkdir()
    for i in range(count):
        lines = [f"= Node {i:05d}", "", "[[node]]", "== Node", "", f"TOKEN-{i:05d}", ""]
        lines.extend(f"xref:node-{(i + step) % count:05d}.adoc#node[Next {step}]" for step in range(1, 5))
        (nodes / f"node-{i:05d}.adoc").write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    with (target / "large.adoc").open("w", encoding="utf-8", newline="\n") as output:
        output.write("= Large Document\n\n")
        for i in range(sections):
            output.write(f"[[section-{i:05d}]]\n== Section {i:05d}\n\n" + "Preserve semantic source. " * 40 + "\n\n")
    refs, includes = source_edges(nodes)
    require(len(refs) == count * 4 and not includes, "Scale edge count mismatch")
    require(sum(line.startswith("== Section ") for line in (target / "large.adoc").read_text().splitlines()) == sections,
            "Large document section count mismatch")
    manifest = {"profile": size, "node_documents": count, "references": count * 4,
                "large_document_sections": sections, "large_document_bytes": (target / "large.adoc").stat().st_size,
                "sha256": inventory(target)}
    write_json(target / "scale-manifest.json", manifest)
    return {k: v for k, v in manifest.items() if k != "sha256"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify")
    for command in ("prepare", "compare", "scale"):
        operation = sub.add_parser(command)
        operation.add_argument("--dest", required=True)
        if command == "scale":
            operation.add_argument("--size", choices=SIZES, default="small")
    args = parser.parse_args()
    if args.command == "verify":
        result = verify()
    elif args.command == "prepare":
        result = prepare(args.dest)
    elif args.command == "compare":
        result = compare(args.dest)
    else:
        result = scale(args.dest, args.size)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
