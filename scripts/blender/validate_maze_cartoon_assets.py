#!/usr/bin/env python3
"""Validate exported DaeMok maze GLBs inside Blender.

    blender --background --factory-startup \
      --python scripts/blender/validate_maze_cartoon_assets.py -- \
      --asset-dir public/assets/maze/v1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


EXPECTED_ASSETS = {
    "rabbit-pawn",
    "tile-cream",
    "tile-sage",
    "board-base",
    "marker-start",
    "marker-goal",
    "wall-normal",
    "wall-steel",
    "wall-fire",
    "wall-poison",
    "wall-ice",
    "wall-wind",
    "wall-phase",
    "wall-thorn",
    "wall-crystal",
    "wall-fog",
    "wall-illusion",
    "wormhole-die",
    "wormhole-board-base",
    "wormhole-rock",
    "wormhole-target-pad",
    "wormhole-portal",
    "item-mine",
    "item-mine-used",
    "item-smoke",
    "item-smoke-used",
    "goal-flag",
    "goal-lock",
    "wall-collapse",
    "wall-mirror",
    "legacy-seal-die",
}

V2_EXTENSION_ASSETS = {
    "wormhole-die",
    "wormhole-board-base",
    "wormhole-rock",
    "wormhole-target-pad",
    "wormhole-portal",
    "item-mine",
    "item-mine-used",
    "item-smoke",
    "item-smoke-used",
    "goal-flag",
    "goal-lock",
    "wall-collapse",
    "wall-mirror",
    "legacy-seal-die",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-dir", default="public/assets/maze/v1")
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(datablocks):
            datablocks.remove(block)


def bounds() -> tuple[list[float], list[float]]:
    points = [
        obj.matrix_world @ vertex.co
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        for vertex in obj.data.vertices
    ]
    assert points, "imported asset has no mesh geometry"
    lower = [min(point[i] for point in points) for i in range(3)]
    upper = [max(point[i] for point in points) for i in range(3)]
    return lower, upper


def near(actual: float, expected: float, tolerance: float = 0.015) -> bool:
    return abs(actual - expected) <= tolerance


def connected_components(mesh: bpy.types.Mesh) -> int:
    """Count disconnected pieces without relying on source object names."""
    adjacency = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        adjacency[left].add(right)
        adjacency[right].add(left)
    unseen = set(range(len(mesh.vertices)))
    components = 0
    while unseen:
        components += 1
        stack = [unseen.pop()]
        while stack:
            for neighbor in adjacency[stack.pop()]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
    return components


def main() -> None:
    args = parse_args()
    asset_dir = Path(args.asset_dir).resolve()
    manifest = json.loads((asset_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == 1, "the stable /maze/v1 runtime catalog must stay version 1"
    assert manifest["generatorRevision"] == 2, "remaining Blender asset extension is stale"
    assert manifest["dieBaseFaces"] == {
        "+Y": 1, "-Y": 6, "-Z": 2, "+Z": 5, "+X": 3, "-X": 4,
    }, "runtime die base-face contract drifted"
    assert near(manifest["dieSide"], 0.612, 0.0001)
    assert near(manifest["dieCenterY"], 0.306, 0.0001)
    assert manifest["wormholeBoard"] == {
        "size": 4,
        "gridSpan": 4.42,
        "origin": "grid center",
        "tileAssetRootY": -0.08,
        "playableTopY": 0.08,
    }, "4x4 wormhole board placement contract drifted"
    actual_assets = set(manifest["assets"])
    assert actual_assets == EXPECTED_ASSETS, (
        f"asset catalog mismatch: missing={EXPECTED_ASSETS - actual_assets}, "
        f"extra={actual_assets - EXPECTED_ASSETS}"
    )

    report = {}
    for key in sorted(EXPECTED_ASSETS):
        entry = manifest["assets"][key]
        path = asset_dir / entry["file"]
        payload = path.read_bytes()
        assert hashlib.sha256(payload).hexdigest() == entry["sha256"], f"stale hash: {key}"
        assert len(payload) == entry["bytes"], f"stale size: {key}"
        reset_scene()
        bpy.ops.import_scene.gltf(filepath=str(path))
        expected_root = entry["root"]
        imported_root = bpy.data.objects.get(expected_root)
        assert imported_root is not None, f"missing root {expected_root} in {key}"
        assert imported_root.get("daemok_asset_version") == manifest["version"], f"missing version extra: {key}"
        assert not bpy.data.images, f"unexpected texture/image payload: {key}"

        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        lower, upper = bounds()
        material_names = sorted({mat.name for obj in meshes for mat in obj.data.materials if mat})
        assert len(meshes) <= 7, f"draw-channel budget exceeded ({len(meshes)}): {key}"
        if key in V2_EXTENSION_ASSETS:
            assert material_names == entry["materials"], f"manifest material contract is stale: {key}"

        # glTF imports into Blender after performing its Y-up -> Z-up conversion,
        # so these checks use the generator's familiar Blender XYZ convention.
        if key.startswith("tile-"):
            assert len(meshes) == 2, f"tile must stay at two geometry channels: {key}"
            assert near(lower[0], -0.5) and near(upper[0], 0.5), f"tile width drift: {key}"
            assert near(lower[2], 0.0) and near(upper[2], 0.166), f"tile height drift: {key}"
        elif key == "board-base":
            assert near(lower[2], -0.46) and near(upper[2], -0.08), "board base seam drift"
        elif key == "wormhole-board-base":
            assert len(meshes) == 2, "wormhole base must not duplicate the 16 shared tile GLBs"
            assert near(lower[0], -2.45) and near(upper[0], 2.45), "wormhole base width drift"
            assert near(lower[1], -2.45) and near(upper[1], 2.45), "wormhole base depth drift"
            assert near(lower[2], -0.46) and near(upper[2], -0.08), "wormhole base/tile seam drift"
        elif key == "rabbit-pawn":
            assert near(lower[2], 0.0) and upper[2] <= 0.93, "rabbit ground/height drift"
            expected_materials = {
                "mat_rabbit_cape",
                "mat_rabbit_cream",
                "mat_rabbit_ear",
                "mat_rabbit_eye_white",
                "mat_rabbit_fur",
                "mat_rabbit_ink",
                "mat_rabbit_player_accent",
            }
            assert set(material_names) == expected_materials, f"rabbit material contract drift: {material_names}"
            accent_meshes = [obj for obj in meshes if obj.get("daemok_role") == "player_accent"]
            assert len(accent_meshes) == 1, "player tint must have exactly one mesh channel"
        elif key in {"wall-collapse", "wall-mirror"}:
            assert near(lower[0], -0.542, 0.001) and near(upper[0], 0.542, 0.001), f"exact wall length drift: {key}"
            assert near(lower[1], -0.08, 0.001) and near(upper[1], 0.08, 0.001), f"exact wall depth drift: {key}"
            assert near(lower[2], 0, 0.001) and near(upper[2], 0.5, 0.001), f"exact wall height drift: {key}"
        elif key.startswith("wall-"):
            # Solid shells reach the exact 1.084 segment span. The deliberately
            # open wind/phase silhouettes may inset their end posts slightly.
            assert lower[0] <= -0.51 and upper[0] >= 0.51, f"wall length drift: {key}"
            assert lower[0] >= -0.56 and upper[0] <= 0.56, f"wall exceeds slot: {key}"
            assert lower[2] >= -0.001, f"wall is below board surface: {key}"
        elif key.startswith("marker-"):
            assert near(lower[2], 0.0), f"marker is not root-anchored: {key}"
        elif key == "wormhole-die":
            assert len(meshes) == 2, "rolling die must stay at body + pip channels"
            assert all(near(value, expected, 0.001) for value, expected in zip(
                (*lower, *upper), (-0.306, -0.306, 0, 0.306, 0.306, 0.612)
            )), "rolling die side/ground contract drifted"
            assert imported_root.get("daemok_die_base_faces") == "1:+Y,6:-Y,2:-Z,5:+Z,3:+X,4:-X"
            assert imported_root.get("daemok_die_pip_count") == 21
            pip_meshes = [obj for obj in meshes if any(mat and mat.name == "mat_wormhole_die_pips" for mat in obj.data.materials)]
            assert len(pip_meshes) == 1 and connected_components(pip_meshes[0].data) == 21, "die must contain 21 physical pips across all six faces"
        elif key == "legacy-seal-die":
            assert imported_root.get("daemok_die_pip_count") == 21
            assert near(lower[2], 0, 0.001), "legacy seal must be ground anchored"
        elif key in V2_EXTENSION_ASSETS:
            assert near(lower[2], 0, 0.001), f"new prop is not ground anchored: {key}"

        for contract in manifest.get("materialContracts", {}).values():
            for contract_material in contract.values():
                if contract_material in entry.get("materials", []):
                    assert contract_material in material_names, f"missing runtime material {contract_material}: {key}"

        report[key] = {
            "bytes": len(payload),
            "meshes": len(meshes),
            "materials": material_names,
            "bounds_xyz": [round(value, 4) for value in (*lower, *upper)],
        }

    total_bytes = sum(item["bytes"] for item in report.values())
    print(json.dumps({"ok": True, "totalBytes": total_bytes, "assets": report}, indent=2))


if __name__ == "__main__":
    main()
